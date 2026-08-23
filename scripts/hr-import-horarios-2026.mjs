/**
 * Verifica / importa HORARIOS C50 2026.xlsx → Supabase.
 *
 * Uso:
 *   node scripts/hr-import-horarios-2026.mjs
 *   node scripts/hr-import-horarios-2026.mjs --dry-run
 *   node scripts/hr-import-horarios-2026.mjs --refresh
 *
 * Requiere .env.local y el xlsx en Descargas (o HR_HORARIOS_LOCAL_DIR).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const DRY = process.argv.includes('--dry-run');
const REFRESH = process.argv.includes('--refresh');
const YEAR = 2026;
const WEEK1_MONDAY = '2026-01-05';

function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  const env = {};
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
    env[k] = v;
  }
  return env;
}

function getDir(env) {
  return (
    env.HR_HORARIOS_LOCAL_DIR?.trim() ||
    env.HR_NOMINA_LOCAL_DIR?.trim() ||
    join(env.USERPROFILE || env.HOME || '', 'Downloads')
  );
}

function resolveFile(dir) {
  const known = ['HORARIOS C50 2026.xlsx', 'Horarios C50 2026.xlsx'];
  for (const name of known) {
    const full = join(dir, name);
    if (existsSync(full)) return { absolutePath: full, fileName: name };
  }
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((name) => {
    if (!/\.xlsx$/i.test(name)) return false;
    const key = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return key.includes('horario') && key.includes('c50') && key.includes('2026');
  });
  return hit ? { absolutePath: join(dir, hit), fileName: hit } : null;
}

function addIsoDays(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function sundayOf(monday) {
  return addIsoDays(monday, 6);
}

function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDay(); // 0=dom
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function todayCdmx() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function weekStart(weekNumber) {
  return addIsoDays(WEEK1_MONDAY, (weekNumber - 1) * 7);
}

function cellStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function isOff(v) {
  const s = cellStr(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (
    s === 'x' ||
    s === 'descanso' ||
    s === 'off' ||
    s.startsWith('descanso') ||
    s === '-'
  );
}

function cellToTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    let frac = v >= 1 ? v % 1 : v;
    const totalSec = Math.round(frac * 24 * 60 * 60);
    const hh = Math.floor(totalSec / 3600) % 24;
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v.trim());
    if (m) {
      return `${m[1].padStart(2, '0')}:${m[2]}:${(m[3] || '00').padStart(2, '0')}`;
    }
  }
  return null;
}

const DAY_PAIRS = [
  { ent: 1, sal: 2, offset: 0 },
  { ent: 3, sal: 4, offset: 1 },
  { ent: 5, sal: 6, offset: 2 },
  { ent: 7, sal: 8, offset: 3 },
  { ent: 9, sal: 10, offset: 4 },
  { ent: 11, sal: 12, offset: 5 },
  { ent: 13, sal: 14, offset: 6 },
];

const AREA_RE = [
  [/^gerencia$/i, 'Gerencia'],
  [/^hostess$/i, 'Hostess'],
  [/^caja$/i, 'Caja'],
  [/^barra$/i, 'Barra'],
  [/^meseros$/i, 'Meseros'],
  [/^runner$/i, 'Runner'],
  [/^cocina$/i, 'Cocina'],
  [/^limpieza$/i, 'Limpieza'],
  [/^mantenimiento$/i, 'Mantenimiento'],
  [/^administraci[oó]n$/i, 'Administración'],
];

function parseWeek(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (rows.length < 9) return null;
  const m = /semana\s*(\d+)/i.exec(sheetName);
  let weekNumber = m ? Number(m[1]) : null;
  if (!weekNumber) {
    const b3 = rows[2]?.[1];
    weekNumber =
      typeof b3 === 'number' ? Math.round(b3) : Number(cellStr(b3)) || null;
  }
  if (!weekNumber || weekNumber < 1) return null;

  const week_start = weekStart(weekNumber);
  const week_end = sundayOf(week_start);
  const shifts = [];
  const people = new Set();
  let area = null;

  for (let r = 7; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawName = cellStr(row[0]);
    if (!rawName) continue;
    let isArea = false;
    for (const [re, label] of AREA_RE) {
      if (re.test(rawName.trim())) {
        area = label;
        isArea = true;
        break;
      }
    }
    if (isArea) continue;

    const name = rawName.replace(/\s+/g, ' ').trim();
    const low = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (
      ['ent.', 'sal.', 'captura', 'etc', 'gerencia', 'hostess'].includes(low)
    ) {
      continue;
    }

    let any = false;
    for (const pair of DAY_PAIRS) {
      if (isOff(row[pair.ent]) || isOff(row[pair.sal])) continue;
      const start = cellToTime(row[pair.ent]);
      const end = cellToTime(row[pair.sal]);
      if (!start || !end) continue;
      shifts.push({
        employee_name: name,
        shift_date: addIsoDays(week_start, pair.offset),
        start_time: start,
        end_time: end,
        area,
      });
      any = true;
    }
    if (any) people.add(name);
  }

  if (shifts.length === 0) return null;
  return {
    sheetName,
    weekNumber,
    week_start,
    week_end,
    shifts,
    people: [...people],
  };
}

function parseAll(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const weekSheets = wb.SheetNames.filter((n) => /^semana\s*\d+/i.test(n));
  const weeks = [];
  for (const name of weekSheets) {
    const parsed = parseWeek(wb.Sheets[name], name);
    if (parsed) weeks.push(parsed);
  }
  weeks.sort((a, b) => a.weekNumber - b.weekNumber);
  return { weekSheets, weeks };
}

function normalizeName(n) {
  return String(n || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(n) {
  return normalizeName(n).split(' ').filter((t) => t.length >= 2);
}

/** Prefiere ficha canónica (nombre más largo) si el Excel trae un alias corto. */
function softMatchEmployee(name, employees) {
  const q = nameTokens(name);
  if (q.length < 2) return null;
  let best = null;
  let bestLen = -1;
  for (const e of employees) {
    const toks = nameTokens(e.full_name);
    if (toks.length < 2) continue;
    const qInE = q.every((t) => toks.some((x) => x === t || x.startsWith(t) || t.startsWith(x)));
    const eInQ = toks.every((t) => q.some((x) => x === t || x.startsWith(t) || t.startsWith(x)));
    if (!qInE && !eInQ) continue;
    const len = String(e.full_name).replace(/\s+/g, '').length;
    if (len > bestLen) {
      best = e;
      bestLen = len;
    }
  }
  return best;
}

async function main() {
  const env = { ...process.env, ...loadEnv() };
  const dir = getDir(env);
  console.log('Dir horarios:', dir);

  const resolved = resolveFile(dir);
  if (!resolved) {
    console.error(
      'No se encontró HORARIOS C50 2026.xlsx en',
      dir,
      '\nColoca el archivo o define HR_HORARIOS_LOCAL_DIR.'
    );
    process.exit(1);
  }
  console.log('Archivo:', resolved.fileName, `(${statSync(resolved.absolutePath).size} bytes)`);

  const buffer = readFileSync(resolved.absolutePath);
  const { weekSheets, weeks } = parseAll(buffer);
  const shiftTotal = weeks.reduce((n, w) => n + w.shifts.length, 0);
  console.log('Hojas SEMANA:', weekSheets.length);
  console.log('Semanas parseadas (con turnos):', weeks.length);
  console.log('Turnos parseados:', shiftTotal);
  if (weeks[0]) {
    console.log(
      'Primera: SEMANA',
      weeks[0].weekNumber,
      weeks[0].week_start
    );
  }
  if (weeks.length) {
    const last = weeks[weeks.length - 1];
    console.log('Última: SEMANA', last.weekNumber, last.week_start);
  }

  if (weeks.length === 0) {
    console.error('FAIL: 0 semanas parseadas');
    process.exit(1);
  }

  if (DRY) {
    console.log('OK dry-run');
    process.exit(0);
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: probeErr, count: beforeCount } = await sb
    .from('hr_schedule_weeks')
    .select('id', { count: 'exact', head: true })
    .gte('week_start', `${YEAR}-01-01`)
    .lte('week_start', `${YEAR}-12-31`);

  if (probeErr) {
    const missing = /does not exist|schema cache|42P01/i.test(probeErr.message);
    console.error(
      'FAIL:',
      missing
        ? 'Faltan tablas. Ejecuta supabase/hr_module.sql en Supabase.'
        : probeErr.message
    );
    process.exit(1);
  }

  console.log('Semanas en DB antes:', beforeCount ?? 0);
  const doReplace = REFRESH || (beforeCount ?? 0) === 0;

  const { data: empRows, error: empErr } = await sb
    .from('hr_employees')
    .select('id, full_name, area, status, force_exclude, notes');
  if (empErr) {
    console.error('FAIL hr_employees:', empErr.message);
    process.exit(1);
  }

  // No matchear cáscaras fusionadas / bajas: si no, el Excel vuelve a
  // colgar turnos en el duplicado y la plantilla siembra al canónico = fila doble.
  const employees = (empRows || []).filter(
    (e) =>
      e.status !== 'baja' &&
      !e.force_exclude &&
      !String(e.notes || '').includes('duplicado_fusionado') &&
      !/merged_into\s*:/i.test(String(e.notes || ''))
  );
  const byKey = new Map(employees.map((e) => [normalizeName(e.full_name), e]));
  const nameToId = new Map();
  let createdEmployees = 0;

  const allNames = new Set();
  for (const w of weeks) for (const p of w.people) allNames.add(p);

  for (const name of allNames) {
    const hit = byKey.get(normalizeName(name));
    if (hit) {
      nameToId.set(name, hit.id);
      continue;
    }
    const soft = softMatchEmployee(name, employees);
    if (soft) {
      nameToId.set(name, soft.id);
      byKey.set(normalizeName(name), soft);
      continue;
    }
    let area = null;
    for (const w of weeks) {
      const s = w.shifts.find((x) => x.employee_name === name && x.area);
      if (s?.area) {
        area = s.area;
        break;
      }
    }
    const { data: created, error: cErr } = await sb
      .from('hr_employees')
      .insert({
        full_name: name,
        status: 'activo',
        area,
        source: 'xlsx',
      })
      .select('id, full_name')
      .single();
    if (cErr || !created) {
      console.warn('No match/create:', name, cErr?.message);
      continue;
    }
    nameToId.set(name, created.id);
    byKey.set(normalizeName(name), created);
    employees.push(created);
    createdEmployees += 1;
  }

  const currentMon = mondayOf(todayCdmx());
  let weeksImported = 0;
  let shiftsImported = 0;
  let weeksSkipped = 0;

  for (const week of weeks) {
    const { data: existing } = await sb
      .from('hr_schedule_weeks')
      .select('id')
      .eq('week_start', week.week_start)
      .maybeSingle();

    if (existing && !doReplace) {
      weeksSkipped += 1;
      continue;
    }
    if (existing && doReplace) {
      await sb.from('hr_schedule_weeks').delete().eq('id', existing.id);
    }

    const status = week.week_start <= currentMon ? 'publicado' : 'borrador';
    const nowIso = new Date().toISOString();
    const insert = {
      week_start: week.week_start,
      week_end: week.week_end,
      status,
      notes: `Importado de ${resolved.fileName} · Hoja ${week.sheetName}`,
      created_by: 'script-import',
      updated_at: nowIso,
    };
    if (status === 'publicado') {
      insert.published_by = 'script-import';
      insert.published_at = nowIso;
    }

    const { data: weekRow, error: wErr } = await sb
      .from('hr_schedule_weeks')
      .insert(insert)
      .select('id')
      .single();
    if (wErr || !weekRow) {
      console.error('FAIL semana', week.week_start, wErr?.message);
      process.exit(1);
    }

    const shiftRows = [];
    for (const s of week.shifts) {
      const employee_id = nameToId.get(s.employee_name);
      if (!employee_id) continue;
      shiftRows.push({
        week_id: weekRow.id,
        employee_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        area: s.area,
        origin: 'manual',
      });
    }

    for (let i = 0; i < shiftRows.length; i += 200) {
      const { error: sErr } = await sb
        .from('hr_schedule_shifts')
        .insert(shiftRows.slice(i, i + 200));
      if (sErr) {
        console.error('FAIL shifts', week.week_start, sErr.message);
        process.exit(1);
      }
    }

    weeksImported += 1;
    shiftsImported += shiftRows.length;
  }

  const { count: afterCount, data: sample, error: afterErr } = await sb
    .from('hr_schedule_weeks')
    .select('id, week_start, status', { count: 'exact' })
    .gte('week_start', `${YEAR}-01-01`)
    .lte('week_start', `${YEAR}-12-31`)
    .order('week_start', { ascending: true })
    .limit(5);

  if (afterErr) {
    console.error('FAIL recount:', afterErr.message);
    process.exit(1);
  }

  console.log({
    weeksImported,
    weeksSkipped,
    shiftsImported,
    createdEmployees,
    weeksInDb: afterCount ?? 0,
  });
  console.log(
    'Muestra:',
    (sample || []).map((w) => `${w.week_start}/${w.status}`).join(', ')
  );

  if ((afterCount ?? 0) <= 0) {
    console.error('FAIL: weeks count <= 0');
    process.exit(1);
  }
  console.log('OK: weeks count > 0');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
