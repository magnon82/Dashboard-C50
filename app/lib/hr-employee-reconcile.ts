/**
 * Reconciliación de duplicados en hr_employees.
 * Cluster por matchPerson (exact/high, autoLink) + carpetas Altas / drive_folder_path.
 * Survivor: expediente → nombre canónico más largo → más datos (fecha_ingreso).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { isMergedDuplicateShell } from '@/app/lib/hr';
import {
  canonicalHrEmployeeName,
  folderBasenameFromPath,
  matchPerson,
  normalizePersonKey,
  preferCanonicalFullName,
  significantTokenCount,
  type NamedPerson,
} from './hr-person-match';

export type ReconcileEmployee = {
  id: string;
  full_name: string;
  status: string;
  puesto: string | null;
  area: string | null;
  fecha_ingreso: string | null;
  drive_folder_path: string | null;
  suite_username: string | null;
  force_include: boolean;
  force_exclude: boolean;
  notes: string | null;
  email: string | null;
  phone: string | null;
};

export type ExpedienteFolder = {
  name: string;
  path: string;
};

export type ReconcileCluster = {
  ids: string[];
  survivorId: string;
  loserIds: string[];
  survivorName: string;
  loserNames: string[];
  canonicalName: string;
  scoreHint: number;
  reason: string;
};

export type MergeAction = {
  cluster: ReconcileCluster;
  payrollLinesMoved: number;
  payrollLinesDropped: number;
  scheduleShiftsMoved: number;
  availabilityMoved: number;
  leaveBalancesMoved: number;
  leaveBalancesDropped: number;
  leaveRequestsMoved: number;
  resguardoMoved: number;
  loserUpdates: { id: string; full_name: string }[];
  dryRun: boolean;
};

export type ReconcileReport = {
  dryRun: boolean;
  plantillaBefore: number;
  plantillaAfter: number | null;
  activeBefore: number;
  scheduleEmployeeIds: string[];
  scheduleWeekId: string | null;
  expedienteFolders: number;
  clusters: ReconcileCluster[];
  merges: MergeAction[];
  skippedAmbiguous: { a: string; b: string; score: number; reason: string }[];
};

const EMP_COLS =
  'id, full_name, status, puesto, area, fecha_ingreso, drive_folder_path, suite_username, force_include, force_exclude, notes, email, phone';

const MERGE_NOTE = 'duplicado_fusionado';

function asEmp(row: Record<string, unknown>): ReconcileEmployee {
  return {
    id: String(row.id),
    full_name: String(row.full_name || '').replace(/\s+/g, ' ').trim(),
    status: String(row.status || 'activo'),
    puesto: (row.puesto as string | null) ?? null,
    area: (row.area as string | null) ?? null,
    fecha_ingreso: row.fecha_ingreso
      ? String(row.fecha_ingreso).slice(0, 10)
      : null,
    drive_folder_path: (row.drive_folder_path as string | null) ?? null,
    suite_username: (row.suite_username as string | null) ?? null,
    force_include: Boolean(row.force_include),
    force_exclude: Boolean(row.force_exclude),
    notes: (row.notes as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
  };
}

export function findAltasDir(expedientesRoot: string): string | null {
  if (!existsSync(expedientesRoot)) return null;
  const entries = readdirSync(expedientesRoot, { withFileTypes: true });
  const altas = entries.find(
    (e) =>
      e.isDirectory() &&
      e.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim() === 'altas'
  );
  return altas ? join(expedientesRoot, altas.name) : null;
}

export function listAltasPersonFolders(
  expedientesRoot: string
): ExpedienteFolder[] {
  const altas = findAltasDir(expedientesRoot);
  if (!altas) return [];
  return readdirSync(altas, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name.replace(/\s+/g, ' ').trim(),
      path: join(altas, e.name),
    }));
}

function toNamed(e: ReconcileEmployee): NamedPerson {
  const alias = folderBasenameFromPath(e.drive_folder_path);
  const aliases: string[] = [];
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

/** Union-find */
class UFind {
  parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
  ensure(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
}

function dataRichness(e: ReconcileEmployee): number {
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

/**
 * Survivor: expediente link → carpeta más larga / más tokens → más datos.
 */
export function pickSurvivor(
  members: ReconcileEmployee[],
  scheduleIds: Set<string>
): ReconcileEmployee {
  const scored = [...members].sort((a, b) => {
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
  });
  return scored[0]!;
}

export function resolveCanonicalName(
  survivor: ReconcileEmployee,
  members: ReconcileEmployee[],
  folders: ExpedienteFolder[]
): string {
  const folderNames: string[] = [];
  for (const m of members) {
    const base = folderBasenameFromPath(m.drive_folder_path);
    if (base) folderNames.push(base);
  }
  for (const f of folders) {
    const hit = matchPerson(
      f.name,
      members.map((m) => toNamed(m))
    );
    if (hit.autoLink && hit.employeeId) {
      folderNames.push(f.name);
    }
  }
  let best =
    folderBasenameFromPath(survivor.drive_folder_path) || survivor.full_name;
  for (const n of folderNames) {
    best = preferCanonicalFullName(best, n);
  }
  for (const m of members) {
    best = preferCanonicalFullName(best, m.full_name);
  }
  // Persistir «nombres + un apellido», no basename ALL CAPS de carpeta.
  return canonicalHrEmployeeName(best, survivor.full_name);
}

/**
 * Cluster duplicados entre activos elegibles (no force_exclude),
 * priorizando quienes están en horarios recientes o tienen expediente.
 */
export function clusterDuplicateEmployees(
  employees: ReconcileEmployee[],
  opts: {
    scheduleIds: Set<string>;
    folders: ExpedienteFolder[];
  }
): {
  clusters: ReconcileCluster[];
  skippedAmbiguous: ReconcileReport['skippedAmbiguous'];
} {
  const active = employees.filter(
    (e) =>
      e.status !== 'baja' &&
      !e.force_exclude &&
      !isMergedDuplicateShell(e.notes)
  );
  const byId = new Map(active.map((e) => [e.id, e]));
  const uf = new UFind();
  for (const e of active) uf.ensure(e.id);

  const pairMeta = new Map<string, { score: number; reason: string }>();
  const skippedAmbiguous: ReconcileReport['skippedAmbiguous'] = [];

  const pairKey = (a: string, b: string) =>
    a < b ? `${a}|${b}` : `${b}|${a}`;

  const tryLink = (
    a: ReconcileEmployee,
    b: ReconcileEmployee,
    reason: string
  ) => {
    if (a.id === b.id) return;
    const m = matchPerson(a.full_name, [toNamed(b)]);
    const m2 = matchPerson(b.full_name, [toNamed(a)]);
    const best = m.score >= m2.score ? m : m2;
    if (best.confidence === 'ambiguous') {
      skippedAmbiguous.push({
        a: a.full_name,
        b: b.full_name,
        score: best.score,
        reason: 'ambiguous',
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

  // Prioridad: empleados en horarios o con expediente
  const priority = active.filter(
    (e) =>
      opts.scheduleIds.has(e.id) ||
      Boolean(e.drive_folder_path) ||
      significantTokenCount(e.full_name) >= 3
  );
  const pool = priority.length >= 2 ? priority : active;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      tryLink(pool[i]!, pool[j]!, 'employee_pair');
    }
  }

  // Misma carpeta Altas → une empleados que matchean esa carpeta
  for (const folder of opts.folders) {
    const named = active.map(toNamed);
    const matches: ReconcileEmployee[] = [];
    for (const e of active) {
      const m = matchPerson(folder.name, [toNamed(e)]);
      if (
        m.autoLink &&
        (m.confidence === 'exact' || m.confidence === 'high')
      ) {
        matches.push(e);
      }
    }
    // También: match carpeta contra todos y tomar autoLink
    const global = matchPerson(folder.name, named);
    if (global.autoLink && global.employeeId) {
      const emp = byId.get(global.employeeId);
      if (emp && !matches.some((x) => x.id === emp.id)) matches.push(emp);
    }
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        uf.union(matches[i]!.id, matches[j]!.id);
        const k = pairKey(matches[i]!.id, matches[j]!.id);
        if (!pairMeta.has(k)) {
          pairMeta.set(k, {
            score: 1,
            reason: `expediente:${folder.name}`,
          });
        }
      }
    }
    // Carpeta vs cada activo: si auto-linkea a A y A ya está en cluster con B corto…
    // (cubierto por pair matching). Además: si carpeta matchea A y hay B
    // en horarios que matchea carpeta vía nombre corto.
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
        uf.union(e.id, matches[0]!.id);
        pairMeta.set(pairKey(e.id, matches[0]!.id), {
          score: m.score,
          reason: `expediente_bridge:${folder.name}`,
        });
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const e of active) {
    const root = uf.find(e.id);
    const list = groups.get(root) || [];
    list.push(e.id);
    groups.set(root, list);
  }

  const clusters: ReconcileCluster[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const members = ids.map((id) => byId.get(id)!).filter(Boolean);
    const survivor = pickSurvivor(members, opts.scheduleIds);
    const losers = members.filter((m) => m.id !== survivor.id);
    const canonicalName = resolveCanonicalName(
      survivor,
      members,
      opts.folders
    );
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

async function reassignOrDropUnique(
  sb: SupabaseClient,
  table: string,
  uniqueCols: string[],
  loserId: string,
  survivorId: string,
  dryRun: boolean
): Promise<{ moved: number; dropped: number }> {
  const { data: rows, error } = await sb
    .from(table)
    .select(`id, ${uniqueCols.join(', ')}`)
    .eq('employee_id', loserId);
  if (error || !rows?.length) return { moved: 0, dropped: 0 };

  let moved = 0;
  let dropped = 0;
  for (const raw of rows) {
    const row = raw as unknown as Record<string, unknown>;
    const filters: Record<string, unknown> = { employee_id: survivorId };
    for (const c of uniqueCols) {
      if (c === 'employee_id') continue;
      filters[c] = row[c];
    }
    let q = sb.from(table).select('id').eq('employee_id', survivorId);
    for (const [k, v] of Object.entries(filters)) {
      if (k === 'employee_id') continue;
      q = q.eq(k, v as string);
    }
    const { data: conflict } = await q.maybeSingle();
    if (conflict) {
      if (!dryRun) {
        await sb.from(table).delete().eq('id', row.id as string);
      }
      dropped += 1;
    } else {
      if (!dryRun) {
        await sb
          .from(table)
          .update({ employee_id: survivorId })
          .eq('id', row.id as string);
      }
      moved += 1;
    }
  }
  return { moved, dropped };
}

async function reassignAll(
  sb: SupabaseClient,
  table: string,
  loserId: string,
  survivorId: string,
  dryRun: boolean
): Promise<number> {
  const { data: rows, error } = await sb
    .from(table)
    .select('id')
    .eq('employee_id', loserId);
  if (error || !rows?.length) return 0;
  if (!dryRun) {
    await sb
      .from(table)
      .update({ employee_id: survivorId })
      .eq('employee_id', loserId);
  }
  return rows.length;
}

export async function mergeCluster(
  sb: SupabaseClient,
  cluster: ReconcileCluster,
  byId: Map<string, ReconcileEmployee>,
  dryRun: boolean
): Promise<MergeAction> {
  const survivor = byId.get(cluster.survivorId)!;
  let payrollLinesMoved = 0;
  let payrollLinesDropped = 0;
  let scheduleShiftsMoved = 0;
  let availabilityMoved = 0;
  let leaveBalancesMoved = 0;
  let leaveBalancesDropped = 0;
  let leaveRequestsMoved = 0;
  let resguardoMoved = 0;
  const loserUpdates: { id: string; full_name: string }[] = [];

  for (const loserId of cluster.loserIds) {
    const loser = byId.get(loserId);
    if (!loser) continue;

    const pl = await reassignOrDropUnique(
      sb,
      'hr_payroll_lines',
      ['period_id', 'employee_id'],
      loserId,
      cluster.survivorId,
      dryRun
    );
    payrollLinesMoved += pl.moved;
    payrollLinesDropped += pl.dropped;

    scheduleShiftsMoved += await reassignAll(
      sb,
      'hr_schedule_shifts',
      loserId,
      cluster.survivorId,
      dryRun
    );
    availabilityMoved += await reassignAll(
      sb,
      'hr_availability',
      loserId,
      cluster.survivorId,
      dryRun
    );

    const lb = await reassignOrDropUnique(
      sb,
      'hr_leave_balances',
      ['employee_id', 'year'],
      loserId,
      cluster.survivorId,
      dryRun
    );
    leaveBalancesMoved += lb.moved;
    leaveBalancesDropped += lb.dropped;

    leaveRequestsMoved += await reassignAll(
      sb,
      'hr_leave_requests',
      loserId,
      cluster.survivorId,
      dryRun
    );
    resguardoMoved += await reassignAll(
      sb,
      'hr_resguardo_requests',
      loserId,
      cluster.survivorId,
      dryRun
    );

    const noteBits = [loser.notes, `${MERGE_NOTE}→${cluster.survivorId}`]
      .filter(Boolean)
      .join(' | ');
    const patch: Record<string, unknown> = {
      status: 'baja',
      force_exclude: true,
      force_include: false,
      notes: noteBits,
      updated_at: new Date().toISOString(),
    };
    // Liberar suite_username único si lo tenía el loser
    if (loser.suite_username) {
      patch.suite_username = null;
      if (!survivor.suite_username && !dryRun) {
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
    // Transferir drive_folder_path si survivor no tiene
    if (loser.drive_folder_path && !survivor.drive_folder_path) {
      if (!dryRun) {
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
    // Transferir fecha_ingreso si falta
    if (loser.fecha_ingreso && !survivor.fecha_ingreso) {
      if (!dryRun) {
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

    if (!dryRun) {
      await sb.from('hr_employees').update(patch).eq('id', loserId);
    }
    loserUpdates.push({ id: loserId, full_name: loser.full_name });
  }

  // Nombre canónico del survivor (carpeta expediente)
  if (!dryRun && cluster.canonicalName) {
    const patch: Record<string, unknown> = {
      full_name: cluster.canonicalName,
      updated_at: new Date().toISOString(),
    };
    // Vincular carpeta si falta y hay match
    await sb.from('hr_employees').update(patch).eq('id', cluster.survivorId);
  }

  return {
    cluster,
    payrollLinesMoved,
    payrollLinesDropped,
    scheduleShiftsMoved,
    availabilityMoved,
    leaveBalancesMoved,
    leaveBalancesDropped,
    leaveRequestsMoved,
    resguardoMoved,
    loserUpdates,
    dryRun,
  };
}

export async function loadActiveEmployees(
  sb: SupabaseClient
): Promise<ReconcileEmployee[]> {
  const { data, error } = await sb
    .from('hr_employees')
    .select(EMP_COLS)
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data || []) as unknown as Record<string, unknown>[]).map(asEmp);
}

async function weekHasRealShifts(
  sb: SupabaseClient,
  weekId: string
): Promise<boolean> {
  const { count, error } = await sb
    .from('hr_schedule_shifts')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', weekId)
    .not('start_time', 'is', null)
    .not('end_time', 'is', null);
  return !error && (count ?? 0) > 0;
}

/** Última semana con turnos reales (publicado, si no cualquier reciente). */
async function findLatestScheduleWeekId(
  sb: SupabaseClient
): Promise<string | null> {
  const published = await sb
    .from('hr_schedule_weeks')
    .select('id, week_start')
    .eq('status', 'publicado')
    .order('week_start', { ascending: false })
    .limit(16);
  if (!published.error && published.data?.length) {
    for (const raw of published.data) {
      const id = String((raw as { id: string }).id);
      if (await weekHasRealShifts(sb, id)) return id;
    }
  }
  const any = await sb
    .from('hr_schedule_weeks')
    .select('id, week_start')
    .order('week_start', { ascending: false })
    .limit(16);
  if (!any.error && any.data?.length) {
    for (const raw of any.data) {
      const id = String((raw as { id: string }).id);
      if (await weekHasRealShifts(sb, id)) return id;
    }
  }
  return null;
}

export async function loadScheduleEmployeeIds(
  sb: SupabaseClient
): Promise<{ weekId: string | null; ids: Set<string> }> {
  const weekId = await findLatestScheduleWeekId(sb);

  const weeks = await sb
    .from('hr_schedule_weeks')
    .select('id, week_start, status')
    .in('status', ['publicado', 'borrador'])
    .order('week_start', { ascending: false })
    .limit(4);

  const weekIds = new Set<string>();
  if (weekId) weekIds.add(weekId);
  for (const w of weeks.data || []) {
    weekIds.add(String((w as { id: string }).id));
  }
  if (weekIds.size === 0) return { weekId: null, ids: new Set() };

  const { data: shifts } = await sb
    .from('hr_schedule_shifts')
    .select('employee_id')
    .in('week_id', [...weekIds])
    .not('start_time', 'is', null);

  const ids = new Set<string>();
  for (const s of shifts || []) {
    const id = String((s as { employee_id: string }).employee_id || '');
    if (id) ids.add(id);
  }
  return { weekId, ids };
}

/** Conteo aproximado plantilla: ids únicos en última nómina pagada/cerrada ∪ horarios. */
async function countPlantillaApprox(sb: SupabaseClient): Promise<number> {
  const ids = new Set<string>();

  const paid = await sb
    .from('hr_payroll_periods')
    .select('id')
    .eq('status', 'pagado')
    .order('period_end', { ascending: false })
    .limit(1);
  let periodId =
    !paid.error && paid.data?.[0]
      ? String((paid.data[0] as { id: string }).id)
      : null;
  if (!periodId) {
    const closed = await sb
      .from('hr_payroll_periods')
      .select('id')
      .eq('status', 'cerrado')
      .order('period_end', { ascending: false })
      .limit(1);
    periodId =
      !closed.error && closed.data?.[0]
        ? String((closed.data[0] as { id: string }).id)
        : null;
  }
  if (periodId) {
    const { data: lines } = await sb
      .from('hr_payroll_lines')
      .select('employee_id')
      .eq('period_id', periodId);
    for (const l of lines || []) {
      const id = String((l as { employee_id: string }).employee_id || '');
      if (id) ids.add(id);
    }
  }

  const { ids: schIds } = await loadScheduleEmployeeIds(sb);
  for (const id of schIds) ids.add(id);

  if (ids.size === 0) return 0;

  const { data: emps } = await sb
    .from('hr_employees')
    .select('id, status, force_exclude')
    .in('id', [...ids]);
  let n = 0;
  for (const e of emps || []) {
    const row = e as {
      id: string;
      status: string;
      force_exclude: boolean;
    };
    if (row.status === 'baja' || row.force_exclude) continue;
    n += 1;
  }
  return n;
}

export async function runEmployeeReconcile(
  sb: SupabaseClient,
  opts: {
    dryRun?: boolean;
    expedientesRoot?: string;
  } = {}
): Promise<ReconcileReport> {
  const dryRun = Boolean(opts.dryRun);
  const employees = await loadActiveEmployees(sb);
  const { weekId, ids: scheduleIds } = await loadScheduleEmployeeIds(sb);

  const folders = opts.expedientesRoot
    ? listAltasPersonFolders(opts.expedientesRoot)
    : [];

  // También tratar basenames de drive_folder_path como "folders" virtuales
  const virtualFolders: ExpedienteFolder[] = [];
  for (const e of employees) {
    const base = folderBasenameFromPath(e.drive_folder_path);
    if (base && e.drive_folder_path) {
      virtualFolders.push({ name: base, path: e.drive_folder_path });
    }
  }
  const allFolders = [...folders];
  const seenFolder = new Set(
    folders.map((f) => normalizePersonKey(f.name))
  );
  for (const v of virtualFolders) {
    const k = normalizePersonKey(v.name);
    if (!seenFolder.has(k)) {
      seenFolder.add(k);
      allFolders.push(v);
    }
  }

  const plantillaBefore = await countPlantillaApprox(sb);
  const activeBefore = employees.filter(
    (e) => e.status !== 'baja' && !e.force_exclude
  ).length;

  const { clusters, skippedAmbiguous } = clusterDuplicateEmployees(employees, {
    scheduleIds,
    folders: allFolders,
  });

  const byId = new Map(employees.map((e) => [e.id, e]));
  const merges: MergeAction[] = [];
  for (const c of clusters) {
    merges.push(await mergeCluster(sb, c, byId, dryRun));
  }

  let plantillaAfter: number | null = null;
  if (!dryRun) {
    plantillaAfter = await countPlantillaApprox(sb);
  }

  return {
    dryRun,
    plantillaBefore,
    plantillaAfter,
    activeBefore,
    scheduleEmployeeIds: [...scheduleIds],
    scheduleWeekId: weekId,
    expedienteFolders: allFolders.length,
    clusters,
    merges,
    skippedAmbiguous,
  };
}
