/**
 * Reimporta líneas de nómina 2026 desde el xlsx local (incl. periodos pagado)
 * y realinea hr_employees.sueldo_diario con SUELDO DIARIO del Excel.
 *
 * Uso:
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-reimport-sueldo-diario.mjs
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-reimport-sueldo-diario.mjs --year=2026
 *
 * Requiere .env.local + archivo NOMINA C50 en Downloads / HR_NOMINA_LOCAL_DIR.
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  ensureYearPayrollFromLocal,
  syncSueldoDiarioFromLatestPaid,
} from '../app/lib/hr-payroll-sync.ts';
import { importNominaSheet } from '../app/lib/hr-payroll-import.ts';
import { resolveLocalNominaPath } from '../app/lib/hr-payroll-local.ts';

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

const yearArg = process.argv.find((a) => a.startsWith('--year='));
const year = yearArg ? Number(yearArg.split('=')[1]) : 2026;

const env = { ...process.env, ...loadEnv() };
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Faltan credenciales Supabase en .env.local');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// Smoke: parser debe leer SUELDO DIARIO (≈315), no SEMANAL (≈2205)
const local = await resolveLocalNominaPath(year);
if (!local) {
  console.error(`No se encontró xlsx local NOMINA C50 ${year}`);
  process.exit(1);
}
const smoke = importNominaSheet(readFileSync(local.absolutePath), '30');
const roman = smoke.lines.find((l) =>
  /roman/i.test(l.full_name || '')
);
console.log('Parser smoke sheet 30:', {
  file: local.fileName,
  lines: smoke.lines.length,
  roman: roman
    ? {
        name: roman.full_name,
        puesto: roman.puesto,
        sueldo_diario: roman.sueldo_diario,
        dias: roman.dias_trabajados,
        importe: roman.importe_pagado,
      }
    : null,
});
if (!roman || !roman.sueldo_diario || roman.sueldo_diario > 500) {
  console.error(
    'Parser aún no lee SUELDO DIARIO (~315). Abortando reimport.'
  );
  process.exit(1);
}

console.log(`\nReimport año ${year} (refreshExisting + refreshPaid)…`);
const result = await ensureYearPayrollFromLocal(sb, 'script-reimport-sd', year, {
  refreshExisting: true,
  refreshPaid: true,
  enrichBase: false,
});
console.log(result);

console.log('\nSync sueldo_diario → fichas (allPaid)…');
const sync = await syncSueldoDiarioFromLatestPaid(sb, { allPaid: true });
console.log(sync);

const { data: check } = await sb
  .from('hr_employees')
  .select('full_name, sueldo_diario, puesto')
  .or(
    'full_name.ilike.%roman%,full_name.ilike.%carmona%,full_name.ilike.%erik martinez%,full_name.ilike.%monica herrera%'
  );
console.log('\nPerfiles tras sync:');
for (const e of check || []) {
  console.log(`  ${e.full_name}: SD=${e.sueldo_diario} puesto=${e.puesto}`);
}

const { data: latest } = await sb
  .from('hr_payroll_periods')
  .select('id, label')
  .eq('status', 'pagado')
  .order('period_end', { ascending: false })
  .limit(1)
  .maybeSingle();
if (latest) {
  const { data: lines } = await sb
    .from('hr_payroll_lines')
    .select('sueldo_diario, importe_pagado, hr_employees!inner(full_name)')
    .eq('period_id', latest.id)
    .ilike('hr_employees.full_name', '%roman%');
  console.log(`\nLínea ${latest.label}:`, lines);
}

process.exit(0);
