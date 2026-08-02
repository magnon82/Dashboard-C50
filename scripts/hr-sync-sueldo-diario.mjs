/**
 * One-shot: copia sueldo_diario desde nómina pagada → hr_employees
 * (ficha RH → tab Datos → «Sueldo diario (MXN)»).
 *
 * Fuente: hr_payroll_lines.sueldo_diario (import Excel / UI nómina).
 *
 * Operativa: la nómina se paga los martes ~19:00 CDMX y RH marca el periodo
 * `pagado` (paid_at = esa fecha). Por defecto se usa la última semana pagada
 * (max period_end). Con --all-paid se toma, por empleado, el SD de su
 * periodo pagado más reciente (cubre ausentes de la última semana).
 *
 * Después, rellena cáscaras de horario (nombres cortos sin línea de nómina)
 * copiando el SD del canónico vía matchPerson (p. ej. Erick Azuara ← ERICK…).
 * Desactivar: --no-shells
 *
 * Al marcar pagado en la UI, applyPaidSideEffects también sincroniza SD.
 *
 * Uso:
 *   node --experimental-strip-types scripts/hr-sync-sueldo-diario.mjs
 *   node --experimental-strip-types scripts/hr-sync-sueldo-diario.mjs --dry-run
 *   node --experimental-strip-types scripts/hr-sync-sueldo-diario.mjs --all-paid
 *   node --experimental-strip-types scripts/hr-sync-sueldo-diario.mjs --only-empty
 *   npm run hr:sync-sueldo
 *
 * Requiere .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Si falta la columna: supabase/hr_employee_sueldo.sql
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { matchPerson } from '../app/lib/hr-person-match.ts';

const DRY = process.argv.includes('--dry-run');
const ONLY_EMPTY = process.argv.includes('--only-empty');
const ALL_PAID = process.argv.includes('--all-paid');
const FILL_SHELLS = !process.argv.includes('--no-shells');

/** Espacia CamelCase / pegados: RobertoRamirez → Roberto Ramirez */
function loosenShellName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2');
  const aliases = {
    'pamale avila': 'Pamela Avila',
    'robertoramirez': 'Roberto Ramirez',
  };
  const key = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return aliases[key] || s;
}

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

async function periodIdsWithLines(sb, ids) {
  if (!ids.length) return new Set();
  const { data, error } = await sb
    .from('hr_payroll_lines')
    .select('period_id')
    .in('period_id', ids);
  if (error || !data) return new Set();
  return new Set(data.map((r) => String(r.period_id)));
}

async function findLatestPaidPeriod(sb) {
  for (const status of ['pagado', 'cerrado']) {
    const { data, error } = await sb
      .from('hr_payroll_periods')
      .select('id, label, period_start, period_end, status, paid_at')
      .eq('status', status)
      .order('period_end', { ascending: false })
      .order('paid_at', { ascending: false })
      .limit(8);
    if (error) throw new Error(error.message);
    if (!data?.length) continue;
    const withLines = await periodIdsWithLines(
      sb,
      data.map((p) => p.id)
    );
    for (const p of data) {
      if (withLines.has(p.id)) return p;
    }
  }
  return null;
}

/** Por empleado: SD del periodo pagado más reciente (period_end desc). */
async function collectSdFromAllPaid(sb) {
  const { data: periods, error } = await sb
    .from('hr_payroll_periods')
    .select('id, label, period_end, status, paid_at')
    .eq('status', 'pagado')
    .order('period_end', { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);

  const byEmp = new Map();
  let periodsUsed = 0;
  for (const p of periods || []) {
    const { data: lines, error: lErr } = await sb
      .from('hr_payroll_lines')
      .select('employee_id, sueldo_diario, hr_employees(full_name)')
      .eq('period_id', p.id);
    if (lErr) throw new Error(lErr.message);
    let any = false;
    for (const raw of lines || []) {
      const sd = raw.sueldo_diario != null ? Number(raw.sueldo_diario) : NaN;
      if (!raw.employee_id || !Number.isFinite(sd) || sd <= 0) continue;
      const id = String(raw.employee_id);
      if (byEmp.has(id)) continue;
      const name =
        raw.hr_employees?.full_name ||
        (Array.isArray(raw.hr_employees)
          ? raw.hr_employees[0]?.full_name
          : null) ||
        id;
      byEmp.set(id, {
        sueldo: Math.round(sd * 100) / 100,
        name,
        source: p.label,
      });
      any = true;
    }
    if (any) periodsUsed += 1;
  }
  return { byEmp, periodsUsed, latest: periods?.[0] || null };
}

const env = { ...process.env, ...loadEnv() };
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

console.log(
  DRY ? '[dry-run]' : '[apply]',
  ONLY_EMPTY ? 'solo vacíos/0' : 'alinear con nómina',
  ALL_PAID ? '← todos los pagados (último SD/empleado)' : '← última pagada',
  '→ sueldo_diario'
);

/** @type {Map<string, { sueldo: number, name: string, source?: string }>} */
let byEmp;
if (ALL_PAID) {
  const collected = await collectSdFromAllPaid(sb);
  byEmp = collected.byEmp;
  if (collected.latest) {
    console.log(
      `Última pagada ref: ${collected.latest.label}`,
      `period_end=${String(collected.latest.period_end).slice(0, 10)}`,
      collected.latest.paid_at
        ? `paid_at=${String(collected.latest.paid_at).slice(0, 10)}`
        : '',
      `| periodos con SD: ${collected.periodsUsed}`
    );
  }
} else {
  const period = await findLatestPaidPeriod(sb);
  if (!period) {
    console.error('No hay periodo pagado/cerrado con líneas de nómina.');
    process.exit(1);
  }
  console.log(
    `Periodo: ${period.label} (${period.status})`,
    `${String(period.period_start).slice(0, 10)} … ${String(period.period_end).slice(0, 10)}`,
    period.paid_at ? `paid_at=${String(period.paid_at).slice(0, 10)}` : ''
  );
  const { data: lines, error: lErr } = await sb
    .from('hr_payroll_lines')
    .select('employee_id, sueldo_diario, hr_employees(full_name)')
    .eq('period_id', period.id);
  if (lErr) {
    console.error(lErr.message);
    process.exit(1);
  }
  byEmp = new Map();
  for (const raw of lines || []) {
    const sd = raw.sueldo_diario != null ? Number(raw.sueldo_diario) : NaN;
    if (!raw.employee_id || !Number.isFinite(sd) || sd <= 0) continue;
    const name =
      raw.hr_employees?.full_name ||
      (Array.isArray(raw.hr_employees)
        ? raw.hr_employees[0]?.full_name
        : null) ||
      raw.employee_id;
    byEmp.set(String(raw.employee_id), {
      sueldo: Math.round(sd * 100) / 100,
      name,
      source: period.label,
    });
  }
}

const ids = [...byEmp.keys()];
console.log(`Empleados con SD > 0 en fuente: ${ids.length}`);

if (ids.length === 0) {
  console.error(
    'No hay sueldo_diario en líneas. Revisa el import Excel (columna Sueldo diario).'
  );
  process.exit(1);
}

const { data: emps, error: eErr } = await sb
  .from('hr_employees')
  .select('id, full_name, sueldo_diario')
  .in('id', ids);
if (eErr) {
  if (/sueldo_diario|column .* does not exist|42703/i.test(eErr.message)) {
    console.error(
      'Falta columna sueldo_diario. Ejecuta supabase/hr_employee_sueldo.sql en Supabase.'
    );
  } else {
    console.error(eErr.message);
  }
  process.exit(1);
}

const curById = new Map(
  (emps || []).map((e) => [
    String(e.id),
    e.sueldo_diario != null ? Number(e.sueldo_diario) : null,
  ])
);

const toUpdate = [];
let skipped = 0;
for (const [id, { sueldo, name, source }] of byEmp) {
  if (!curById.has(id)) {
    skipped += 1;
    continue;
  }
  const cur = curById.get(id);
  const empty = cur == null || !Number.isFinite(cur) || cur === 0;
  if (ONLY_EMPTY && !empty) {
    skipped += 1;
    continue;
  }
  if (!empty && cur === sueldo) {
    skipped += 1;
    continue;
  }
  toUpdate.push({ id, name, from: cur, to: sueldo, source });
}

console.log(`A actualizar: ${toUpdate.length}  |  sin cambio: ${skipped}`);
for (const row of toUpdate.slice(0, 40)) {
  const src = row.source ? ` [${row.source}]` : '';
  console.log(`  ${row.name}: ${row.from ?? 'null'} → ${row.to}${src}`);
}
if (toUpdate.length > 40) {
  console.log(`  … y ${toUpdate.length - 40} más`);
}

// Activos sin SD y sin línea en la fuente (p. ej. fichas duplicadas / solo horario)
const { data: activos } = await sb
  .from('hr_employees')
  .select('id, full_name, sueldo_diario')
  .eq('status', 'activo');
const stillEmpty = (activos || []).filter((e) => {
  const cur = e.sueldo_diario != null ? Number(e.sueldo_diario) : null;
  return (cur == null || cur === 0) && !byEmp.has(String(e.id));
});
if (stillEmpty.length) {
  console.log(
    `Activos sin SD y sin nómina en fuente (${stillEmpty.length}):`,
    stillEmpty.map((e) => e.full_name).join(' · ')
  );
}

if (!DRY && toUpdate.length === 0) {
  console.log('Nómina→ficha: nada que actualizar (ya alineadas).');
}

let updated = 0;
let failed = 0;
if (!DRY) {
  for (const row of toUpdate) {
    const { error } = await sb
      .from('hr_employees')
      .update({ sueldo_diario: row.to })
      .eq('id', row.id);
    if (error) {
      console.error(`  FAIL ${row.name}: ${error.message}`);
      failed += 1;
    } else {
      updated += 1;
    }
  }
  if (toUpdate.length) {
    console.log(`Nómina→ficha: actualizados=${updated} fallidos=${failed}`);
  }
} else if (toUpdate.length) {
  console.log(`[dry-run] Nómina→ficha pendientes: ${toUpdate.length}`);
}

/** Cáscaras de horario sin línea de nómina: copiar SD del canónico emparejado. */
if (FILL_SHELLS) {
  const { data: allActivos, error: aErr } = await sb
    .from('hr_employees')
    .select('id, full_name, sueldo_diario')
    .eq('status', 'activo');
  if (aErr) {
    console.error('Shells: no se pudo listar activos:', aErr.message);
  } else {
    const withSd = (allActivos || []).filter((e) => {
      const n = e.sueldo_diario != null ? Number(e.sueldo_diario) : NaN;
      return Number.isFinite(n) && n > 0;
    });
    const empty = (allActivos || []).filter((e) => {
      const n = e.sueldo_diario != null ? Number(e.sueldo_diario) : NaN;
      return !Number.isFinite(n) || n === 0;
    });
    const candidates = withSd.map((e) => ({
      id: String(e.id),
      full_name: String(e.full_name || ''),
    }));
    const shellUpdates = [];
    for (const shell of empty) {
      const query = loosenShellName(shell.full_name);
      const m = matchPerson(query, candidates);
      if (!m.autoLink || !m.employeeId) continue;
      const donor = withSd.find((e) => String(e.id) === m.employeeId);
      if (!donor) continue;
      const to = Math.round(Number(donor.sueldo_diario) * 100) / 100;
      shellUpdates.push({
        id: String(shell.id),
        name: shell.full_name,
        from: shell.sueldo_diario != null ? Number(shell.sueldo_diario) : null,
        to,
        source: `shell←${donor.full_name}`,
      });
    }
    console.log(
      `Cáscaras a rellenar por nombre: ${shellUpdates.length}  (vacíos=${empty.length})`
    );
    for (const row of shellUpdates.slice(0, 40)) {
      console.log(
        `  ${row.name}: ${row.from ?? 'null'} → ${row.to} [${row.source}]`
      );
    }
    if (DRY) {
      console.log(`[dry-run] shells pendientes: ${shellUpdates.length}`);
    } else {
      for (const row of shellUpdates) {
        const { error } = await sb
          .from('hr_employees')
          .update({ sueldo_diario: row.to })
          .eq('id', row.id);
        if (error) {
          console.error(`  FAIL shell ${row.name}: ${error.message}`);
          failed += 1;
        } else {
          updated += 1;
        }
      }
    }
  }
}

console.log(`Total: actualizados=${updated} fallidos=${failed}${DRY ? ' (dry-run)' : ''}`);
process.exit(failed ? 1 : 0);
