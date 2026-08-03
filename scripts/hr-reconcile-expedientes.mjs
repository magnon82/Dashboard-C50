/**
 * Audita desajustes Altas↔status en hr_employees (solo lectura).
 * No auto-baja activos ni escribe en DB.
 *
 * Uso:
 *   npm run hr:reconcile-expedientes
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-reconcile-expedientes.mjs
 *
 * Requiere .env.local (Supabase).
 */
import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { auditExpedienteStatusMismatches } from '../app/lib/hr-drive-sync.ts';
import { formatHrListName } from '../app/lib/hr-person-match.ts';

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

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key);
const { data, error } = await sb
  .from('hr_employees')
  .select('id, full_name, status, fecha_baja, drive_folder_path, notes')
  .order('full_name', { ascending: true });

if (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = (data || []).map((e) => ({
  id: e.id,
  full_name: e.full_name,
  status: e.status,
  fecha_baja: e.fecha_baja ? String(e.fecha_baja).slice(0, 10) : null,
  drive_folder_path: e.drive_folder_path ?? null,
  notes: e.notes ?? null,
}));

const mismatches = auditExpedienteStatusMismatches(rows);

console.log('=== Reconciliar expedientes (solo lectura) ===');
console.log(`Empleados: ${rows.length}`);
console.log(`Desajustes: ${mismatches.length}`);
console.log('(Sin auto-baja de activos. Corregir en /rrhh → Archivo / Bajas.)\n');

for (const m of mismatches) {
  console.log(
    `- [${m.kind}] ${formatHrListName(m.full_name)} · ${m.note}${
      m.drive_folder_path ? `\n    path: ${m.drive_folder_path}` : ''
    }`
  );
}

if (!mismatches.length) {
  console.log('OK: sin desajustes Altas↔status.');
}
