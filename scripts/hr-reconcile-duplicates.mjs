/**
 * Reconcilia duplicados hr_employees (horarios + expedientes).
 *
 * Uso:
 *   node --experimental-strip-types scripts/hr-reconcile-duplicates.mjs --dry-run
 *   node --experimental-strip-types scripts/hr-reconcile-duplicates.mjs
 *   npm run hr:reconcile-dupes -- --dry-run
 *
 * Requiere .env.local (Supabase). Expedientes opcionales en
 *   I:\Mi unidad\RH\Expedientes personal C50\Altas  (o HR_EXPEDIENTES_DIR).
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  folderBasenameFromPath,
  formatHrListName,
  matchPerson,
  normalizePersonKey,
  preferCanonicalFullName,
  significantTokenCount,
} from '../app/lib/hr-person-match.ts';

const DRY = process.argv.includes('--dry-run');
const MERGE_NOTE = 'duplicado_fusionado';
const EMP_COLS =
  'id, full_name, status, puesto, area, fecha_ingreso, drive_folder_path, suite_username, force_include, force_exclude, notes, email, phone';

function loadEnv() {
  const env = { ...process.env };
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (env[k] === undefined) env[k] = v;
    }
  }
  return env;
}

function findAltasDir(root) {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root, { withFileTypes: true });
  const altas = entries.find(
    (e) =>
      e.isDirectory() &&
      e.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim() === 'altas'
  );
  return altas ? join(root, altas.name) : null;
}

function listAltasFolders(root) {
  const altas = findAltasDir(root);
  if (!altas) return [];
  return readdirSync(altas, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name.replace(/\s+/g, ' ').trim(),
      path: join(altas, e.name),
    }));
}

function toNamed(e) {
  const alias = folderBasenameFromPath(e.drive_folder_path);
  const aliases = [];
  if (
    alias &&
    normalizePersonKey(alias) !== normalizePersonKey(e.full_name)
  ) {
    aliases.push(alias);
  }
  return {
    id: e.id,
    full_name: e.full_name,
    aliases: aliases.length ? aliases : undefined,
  };
}

class UFind {
  constructor() {
    this.parent = new Map();
  }
  ensure(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x) {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function dataRichness(e) {
  let n = 0;
  if (e.fecha_ingreso) n += 3;
  if (e.drive_folder_path) n += 5;
  if (e.suite_username) n += 2;
  if (e.email) n += 1;
  if (e.phone) n += 1;
  if (e.puesto) n += 1;
  if (e.area) n += 1;
  n += significantTokenCount(e.full_name);
  const base = folderBasenameFromPath(e.drive_folder_path);
  if (base) n += significantTokenCount(base);
  return n;
}

function pickSurvivor(members, scheduleIds) {
  return [...members].sort((a, b) => {
    const aExp = a.drive_folder_path ? 1 : 0;
    const bExp = b.drive_folder_path ? 1 : 0;
    if (bExp !== aExp) return bExp - aExp;
    const aBase = folderBasenameFromPath(a.drive_folder_path) || a.full_name;
    const bBase = folderBasenameFromPath(b.drive_folder_path) || b.full_name;
    const aTok = significantTokenCount(aBase);
    const bTok = significantTokenCount(bBase);
    if (bTok !== aTok) return bTok - aTok;
    if (bBase.length !== aBase.length) return bBase.length - aBase.length;
    const aRich = dataRichness(a);
    const bRich = dataRichness(b);
    if (bRich !== aRich) return bRich - aRich;
    const aSch = scheduleIds.has(a.id) ? 1 : 0;
    const bSch = scheduleIds.has(b.id) ? 1 : 0;
    if (bSch !== aSch) return bSch - aSch;
    return a.full_name.localeCompare(b.full_name, 'es');
  })[0];
}

function resolveCanonicalName(survivor, members, folders) {
  const folderNames = [];
  for (const m of members) {
    const base = folderBasenameFromPath(m.drive_folder_path);
    if (base) folderNames.push(base);
  }
  for (const f of folders) {
    const hit = matchPerson(
      f.name,
      members.map((m) => toNamed(m))
    );
    if (hit.autoLink && hit.employeeId) folderNames.push(f.name);
  }
  let best =
    folderBasenameFromPath(survivor.drive_folder_path) || survivor.full_name;
  for (const n of folderNames) best = preferCanonicalFullName(best, n);
  for (const m of members) best = preferCanonicalFullName(best, m.full_name);
  return best.replace(/\s+/g, ' ').trim();
}

function clusterDuplicates(employees, scheduleIds, folders) {
  const active = employees.filter(
    (e) =>
      e.status !== 'baja' &&
      !e.force_exclude &&
      !(e.notes || '').includes(MERGE_NOTE)
  );
  const byId = new Map(active.map((e) => [e.id, e]));
  const uf = new UFind();
  for (const e of active) uf.ensure(e.id);

  const pairMeta = new Map();
  const skippedAmbiguous = [];
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const tryLink = (a, b, reason) => {
    if (a.id === b.id) return;
    const m = matchPerson(a.full_name, [toNamed(b)]);
    const m2 = matchPerson(b.full_name, [toNamed(a)]);
    const best = m.score >= m2.score ? m : m2;
    if (best.confidence === 'ambiguous') {
      skippedAmbiguous.push({
        a: a.full_name,
        b: b.full_name,
        score: best.score,
      });
      return;
    }
    if (
      best.autoLink &&
      (best.confidence === 'exact' || best.confidence === 'high')
    ) {
      uf.union(a.id, b.id);
      const k = pairKey(a.id, b.id);
      const prev = pairMeta.get(k);
      if (!prev || best.score > prev.score) {
        pairMeta.set(k, { score: best.score, reason });
      }
    }
  };

  const priority = active.filter(
    (e) =>
      scheduleIds.has(e.id) ||
      Boolean(e.drive_folder_path) ||
      significantTokenCount(e.full_name) >= 3
  );
  const pool = priority.length >= 2 ? priority : active;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      tryLink(pool[i], pool[j], 'employee_pair');
    }
  }

  for (const folder of folders) {
    const named = active.map(toNamed);
    const matches = [];
    for (const e of active) {
      const m = matchPerson(folder.name, [toNamed(e)]);
      if (
        m.autoLink &&
        (m.confidence === 'exact' || m.confidence === 'high')
      ) {
        matches.push(e);
      }
    }
    const global = matchPerson(folder.name, named);
    if (global.autoLink && global.employeeId) {
      const emp = byId.get(global.employeeId);
      if (emp && !matches.some((x) => x.id === emp.id)) matches.push(emp);
    }
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        uf.union(matches[i].id, matches[j].id);
        const k = pairKey(matches[i].id, matches[j].id);
        if (!pairMeta.has(k)) {
          pairMeta.set(k, { score: 1, reason: `expediente:${folder.name}` });
        }
      }
    }
    for (const e of active) {
      if (matches.some((m) => m.id === e.id)) continue;
      const m = matchPerson(e.full_name, [
        { id: 'folder', full_name: folder.name },
      ]);
      if (
        m.autoLink &&
        (m.confidence === 'exact' || m.confidence === 'high') &&
        matches.length === 1
      ) {
        uf.union(e.id, matches[0].id);
        pairMeta.set(pairKey(e.id, matches[0].id), {
          score: m.score,
          reason: `expediente_bridge:${folder.name}`,
        });
      }
    }
  }

  const groups = new Map();
  for (const e of active) {
    const root = uf.find(e.id);
    const list = groups.get(root) || [];
    list.push(e.id);
    groups.set(root, list);
  }

  const clusters = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const members = ids.map((id) => byId.get(id)).filter(Boolean);
    const survivor = pickSurvivor(members, scheduleIds);
    const losers = members.filter((m) => m.id !== survivor.id);
    const canonicalName = resolveCanonicalName(survivor, members, folders);
    let scoreHint = 0;
    let reason = 'high_confidence_pair';
    for (const a of members) {
      for (const b of members) {
        if (a.id >= b.id) continue;
        const meta = pairMeta.get(pairKey(a.id, b.id));
        if (meta && meta.score > scoreHint) {
          scoreHint = meta.score;
          reason = meta.reason;
        }
      }
    }
    clusters.push({
      ids: members.map((m) => m.id),
      survivorId: survivor.id,
      loserIds: losers.map((m) => m.id),
      survivorName: survivor.full_name,
      loserNames: losers.map((m) => m.full_name),
      canonicalName,
      scoreHint,
      reason,
    });
  }
  clusters.sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName, 'es')
  );
  return { clusters, skippedAmbiguous };
}

async function weekHasRealShifts(sb, weekId) {
  const { count, error } = await sb
    .from('hr_schedule_shifts')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', weekId)
    .not('start_time', 'is', null)
    .not('end_time', 'is', null);
  return !error && (count ?? 0) > 0;
}

async function loadScheduleIds(sb) {
  let weekId = null;
  const published = await sb
    .from('hr_schedule_weeks')
    .select('id, week_start')
    .eq('status', 'publicado')
    .order('week_start', { ascending: false })
    .limit(16);
  if (!published.error && published.data?.length) {
    for (const raw of published.data) {
      if (await weekHasRealShifts(sb, raw.id)) {
        weekId = raw.id;
        break;
      }
    }
  }
  if (!weekId) {
    const any = await sb
      .from('hr_schedule_weeks')
      .select('id, week_start')
      .order('week_start', { ascending: false })
      .limit(16);
    for (const raw of any.data || []) {
      if (await weekHasRealShifts(sb, raw.id)) {
        weekId = raw.id;
        break;
      }
    }
  }

  const weeks = await sb
    .from('hr_schedule_weeks')
    .select('id')
    .in('status', ['publicado', 'borrador'])
    .order('week_start', { ascending: false })
    .limit(4);
  const weekIds = new Set();
  if (weekId) weekIds.add(weekId);
  for (const w of weeks.data || []) weekIds.add(w.id);
  if (!weekIds.size) return { weekId: null, ids: new Set() };

  const { data: shifts } = await sb
    .from('hr_schedule_shifts')
    .select('employee_id')
    .in('week_id', [...weekIds])
    .not('start_time', 'is', null);
  const ids = new Set();
  for (const s of shifts || []) {
    if (s.employee_id) ids.add(s.employee_id);
  }
  return { weekId, ids };
}

async function countPlantillaApprox(sb) {
  const ids = new Set();
  const paid = await sb
    .from('hr_payroll_periods')
    .select('id')
    .eq('status', 'pagado')
    .order('period_end', { ascending: false })
    .limit(1);
  let periodId = paid.data?.[0]?.id || null;
  if (!periodId) {
    const closed = await sb
      .from('hr_payroll_periods')
      .select('id')
      .eq('status', 'cerrado')
      .order('period_end', { ascending: false })
      .limit(1);
    periodId = closed.data?.[0]?.id || null;
  }
  if (periodId) {
    const { data: lines } = await sb
      .from('hr_payroll_lines')
      .select('employee_id')
      .eq('period_id', periodId);
    for (const l of lines || []) if (l.employee_id) ids.add(l.employee_id);
  }
  const { ids: schIds } = await loadScheduleIds(sb);
  for (const id of schIds) ids.add(id);
  if (!ids.size) return 0;
  const { data: emps } = await sb
    .from('hr_employees')
    .select('id, status, force_exclude')
    .in('id', [...ids]);
  let n = 0;
  for (const e of emps || []) {
    if (e.status === 'baja' || e.force_exclude) continue;
    n += 1;
  }
  return n;
}

async function reassignOrDropUnique(
  sb,
  table,
  uniqueCols,
  loserId,
  survivorId
) {
  const { data: rows, error } = await sb
    .from(table)
    .select(`id, ${uniqueCols.join(', ')}`)
    .eq('employee_id', loserId);
  if (error || !rows?.length) return { moved: 0, dropped: 0 };
  let moved = 0;
  let dropped = 0;
  for (const row of rows) {
    let q = sb.from(table).select('id').eq('employee_id', survivorId);
    for (const c of uniqueCols) {
      if (c === 'employee_id') continue;
      q = q.eq(c, row[c]);
    }
    const { data: conflict } = await q.maybeSingle();
    if (conflict) {
      if (!DRY) await sb.from(table).delete().eq('id', row.id);
      dropped += 1;
    } else {
      if (!DRY) {
        await sb
          .from(table)
          .update({ employee_id: survivorId })
          .eq('id', row.id);
      }
      moved += 1;
    }
  }
  return { moved, dropped };
}

async function reassignAll(sb, table, loserId, survivorId) {
  const { data: rows, error } = await sb
    .from(table)
    .select('id')
    .eq('employee_id', loserId);
  if (error || !rows?.length) return 0;
  if (!DRY) {
    await sb
      .from(table)
      .update({ employee_id: survivorId })
      .eq('employee_id', loserId);
  }
  return rows.length;
}

async function mergeCluster(sb, cluster, byId) {
  const survivor = byId.get(cluster.survivorId);
  let payrollLinesMoved = 0;
  let payrollLinesDropped = 0;
  let scheduleShiftsMoved = 0;
  let availabilityMoved = 0;
  let leaveBalancesMoved = 0;
  let leaveBalancesDropped = 0;
  let leaveRequestsMoved = 0;
  let resguardoMoved = 0;

  for (const loserId of cluster.loserIds) {
    const loser = byId.get(loserId);
    if (!loser) continue;

    const pl = await reassignOrDropUnique(
      sb,
      'hr_payroll_lines',
      ['period_id', 'employee_id'],
      loserId,
      cluster.survivorId
    );
    payrollLinesMoved += pl.moved;
    payrollLinesDropped += pl.dropped;

    scheduleShiftsMoved += await reassignAll(
      sb,
      'hr_schedule_shifts',
      loserId,
      cluster.survivorId
    );
    availabilityMoved += await reassignAll(
      sb,
      'hr_availability',
      loserId,
      cluster.survivorId
    );
    const lb = await reassignOrDropUnique(
      sb,
      'hr_leave_balances',
      ['employee_id', 'year'],
      loserId,
      cluster.survivorId
    );
    leaveBalancesMoved += lb.moved;
    leaveBalancesDropped += lb.dropped;
    leaveRequestsMoved += await reassignAll(
      sb,
      'hr_leave_requests',
      loserId,
      cluster.survivorId
    );
    resguardoMoved += await reassignAll(
      sb,
      'hr_resguardo_requests',
      loserId,
      cluster.survivorId
    );

    const noteBits = [loser.notes, `${MERGE_NOTE}→${cluster.survivorId}`]
      .filter(Boolean)
      .join(' | ');
    const patch = {
      status: 'baja',
      force_exclude: true,
      force_include: false,
      notes: noteBits,
      updated_at: new Date().toISOString(),
    };
    if (loser.suite_username) {
      patch.suite_username = null;
      if (!survivor.suite_username && !DRY) {
        await sb
          .from('hr_employees')
          .update({
            suite_username: loser.suite_username,
            updated_at: new Date().toISOString(),
          })
          .eq('id', cluster.survivorId)
          .is('suite_username', null);
        survivor.suite_username = loser.suite_username;
      }
    }
    if (loser.drive_folder_path && !survivor.drive_folder_path) {
      if (!DRY) {
        await sb
          .from('hr_employees')
          .update({
            drive_folder_path: loser.drive_folder_path,
            updated_at: new Date().toISOString(),
          })
          .eq('id', cluster.survivorId)
          .is('drive_folder_path', null);
      }
      survivor.drive_folder_path = loser.drive_folder_path;
    }
    if (loser.fecha_ingreso && !survivor.fecha_ingreso) {
      if (!DRY) {
        await sb
          .from('hr_employees')
          .update({
            fecha_ingreso: loser.fecha_ingreso,
            updated_at: new Date().toISOString(),
          })
          .eq('id', cluster.survivorId)
          .is('fecha_ingreso', null);
      }
      survivor.fecha_ingreso = loser.fecha_ingreso;
    }
    if (!DRY) {
      await sb.from('hr_employees').update(patch).eq('id', loserId);
    }
  }

  if (!DRY && cluster.canonicalName) {
    await sb
      .from('hr_employees')
      .update({
        full_name: cluster.canonicalName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cluster.survivorId);
  }

  return {
    payrollLinesMoved,
    payrollLinesDropped,
    scheduleShiftsMoved,
    availabilityMoved,
    leaveBalancesMoved,
    leaveBalancesDropped,
    leaveRequestsMoved,
    resguardoMoved,
  };
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const expedientesRoot =
    env.HR_EXPEDIENTES_DIR?.trim() ||
    'I:\\Mi unidad\\RH\\Expedientes personal C50';

  if (DRY) console.log('(dry-run: no escribe en Supabase)\n');

  const { data, error } = await sb
    .from('hr_employees')
    .select(EMP_COLS)
    .order('full_name', { ascending: true });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  const employees = (data || []).map((e) => ({
    ...e,
    full_name: String(e.full_name || '')
      .replace(/\s+/g, ' ')
      .trim(),
  }));

  const { weekId, ids: scheduleIds } = await loadScheduleIds(sb);
  const diskFolders = listAltasFolders(expedientesRoot);
  const folders = [...diskFolders];
  const seen = new Set(diskFolders.map((f) => normalizePersonKey(f.name)));
  for (const e of employees) {
    const base = folderBasenameFromPath(e.drive_folder_path);
    if (base && e.drive_folder_path) {
      const k = normalizePersonKey(base);
      if (!seen.has(k)) {
        seen.add(k);
        folders.push({ name: base, path: e.drive_folder_path });
      }
    }
  }

  const plantillaBefore = await countPlantillaApprox(sb);
  const activeBefore = employees.filter(
    (e) => e.status !== 'baja' && !e.force_exclude
  ).length;

  const { clusters, skippedAmbiguous } = clusterDuplicates(
    employees,
    scheduleIds,
    folders
  );
  const byId = new Map(employees.map((e) => [e.id, e]));

  console.log('=== Reconcile hr_employees ===');
  console.log(
    `Plantilla vigente: ${plantillaBefore}${DRY ? ' (dry-run)' : ''}`
  );
  console.log(`Activos (no baja/exclude): ${activeBefore}`);
  console.log(`Semana horarios: ${weekId || '—'}`);
  console.log(`Empleados en horarios recientes: ${scheduleIds.size}`);
  console.log(
    `Carpetas expediente (disco=${diskFolders.length}, total=${folders.length})`
  );
  console.log(`Clusters a fusionar: ${clusters.length}`);
  console.log('');

  const merges = [];
  for (const c of clusters) {
    const stats = await mergeCluster(sb, c, byId);
    merges.push({ c, stats });
    const display = formatHrListName(c.canonicalName);
    console.log(`• Survivor: ${c.survivorName}`);
    console.log(`  → canónico: ${c.canonicalName}  (lista: ${display})`);
    console.log(`  Losers: ${c.loserNames.join(' | ')}`);
    console.log(`  score=${c.scoreHint.toFixed(3)} reason=${c.reason}`);
    console.log(
      `  moves: payroll=${stats.payrollLinesMoved}/${stats.payrollLinesDropped} drops, shifts=${stats.scheduleShiftsMoved}, avail=${stats.availabilityMoved}, leaveBal=${stats.leaveBalancesMoved}, leaveReq=${stats.leaveRequestsMoved}, resguardo=${stats.resguardoMoved}`
    );
    console.log('');
  }

  let plantillaAfter = null;
  if (!DRY) {
    plantillaAfter = await countPlantillaApprox(sb);
    console.log(`Plantilla vigente: ${plantillaBefore} → ${plantillaAfter}`);
  }

  if (skippedAmbiguous.length) {
    console.log(`Ambiguos omitidos: ${skippedAmbiguous.length}`);
    for (const s of skippedAmbiguous.slice(0, 20)) {
      console.log(`  ~ ${s.a} ↔ ${s.b} (${s.score.toFixed(3)})`);
    }
  }

  const spotlight = clusters.filter((c) => {
    const blob =
      `${c.survivorName} ${c.loserNames.join(' ')} ${c.canonicalName}`.toLowerCase();
    return (
      blob.includes('paula') ||
      blob.includes('villar') ||
      blob.includes('gael') ||
      blob.includes('alvarez')
    );
  });
  console.log('\n--- Spotlight (Paula / Gael) ---');
  if (spotlight.length) {
    for (const c of spotlight) {
      console.log(
        `OK merge: [${c.loserNames.join(', ')}] → ${c.canonicalName}`
      );
    }
  } else {
    console.log('(No cluster Paula/Gael detectado en este run)');
    // Debug: list names containing those tokens
    const hits = employees.filter((e) => {
      const n = e.full_name.toLowerCase();
      return (
        n.includes('paula') ||
        n.includes('villar') ||
        n.includes('gael') ||
        n.includes('alvarez')
      );
    });
    for (const e of hits) {
      console.log(
        `  candidate: [${e.status}${e.force_exclude ? '/excl' : ''}] ${e.full_name}`
      );
    }
  }

  console.log(
    DRY ? '\nDry-run listo. Quita --dry-run para aplicar.' : '\nMerges aplicados.'
  );
  console.log(
    JSON.stringify({
      dryRun: DRY,
      plantillaBefore,
      plantillaAfter,
      activeBefore,
      clusterCount: clusters.length,
      merges: merges.map(({ c }) => ({
        survivor: c.canonicalName,
        losers: c.loserNames,
        display: formatHrListName(c.canonicalName),
      })),
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
