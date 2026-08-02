/**
 * Bulk soft-pull: expediente Drive (File Stream) → hr_employee_documents.
 * Por defecto: plantilla vigente con docs obligatorios faltantes.
 *
 * Uso:
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-pull-expediente-docs.mjs
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-pull-expediente-docs.mjs --dry-run
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-pull-expediente-docs.mjs --all-linked
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-pull-expediente-docs.mjs --force
 *
 * Requiere .env.local + I:\Mi unidad montado.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  HR_REQUIRED_DOC_TYPES,
  isRequiredDocSatisfied,
} from '../app/lib/hr-employee-profile.ts';
import {
  pullExpedienteDocuments,
  repairMislabeledPackFromStorage,
  repairSharedPackFromStorage,
} from '../app/lib/hr-expediente-docs-pull.ts';
import { resolvePlantillaVigente } from '../app/lib/hr-plantilla.ts';
import { localDriveFsEnabled } from '../app/lib/local-fs.ts';

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const ALL_LINKED = process.argv.includes('--all-linked');
const INCLUDE_COMPLETE = process.argv.includes('--include-complete');

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

async function main() {
  const env = { ...process.env, ...loadEnv() };
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] == null) process.env[k] = v;
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!localDriveFsEnabled()) {
    console.error('File Stream deshabilitado (HR_ALLOW_LOCAL_FS=0 o serverless).');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // CV opcional en filas ya sembradas
  const cvFix = await sb
    .from('hr_employee_documents')
    .update({
      required: false,
      notes: 'Curriculum vitae · opcional',
      updated_at: new Date().toISOString(),
    })
    .eq('doc_type', 'cv')
    .eq('required', true)
    .select('id');
  if (cvFix.error) {
    console.warn('Aviso CV required=false:', cvFix.error.message);
  } else {
    console.log(`CV marcado opcional en ${cvFix.data?.length || 0} fila(s)`);
  }

  const requiredIds = HR_REQUIRED_DOC_TYPES.map((d) => d.id);
  console.log(
    'Docs obligatorios:',
    HR_REQUIRED_DOC_TYPES.map((d) => d.title).join(', ')
  );

  /** @type {{ id: string, full_name: string, drive_folder_path: string | null }[]} */
  let employees = [];
  if (ALL_LINKED) {
    const { data, error } = await sb
      .from('hr_employees')
      .select('id, full_name, drive_folder_path')
      .not('drive_folder_path', 'is', null)
      .order('full_name', { ascending: true })
      .limit(200);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    employees = data || [];
  } else {
    const plantilla = await resolvePlantillaVigente(sb, { allowSeed: false });
    // Incluye sin path: pull resuelve Altas/Bajas por nombre.
    employees = plantilla.employees.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      drive_folder_path: e.drive_folder_path,
    }));
    const linked = employees.filter((e) => e.drive_folder_path?.trim()).length;
    console.log(
      `Plantilla: ${employees.length} (con path: ${linked}; resto se resuelve en Altas/Bajas)`
    );
  }

  if (!INCLUDE_COMPLETE && employees.length) {
    const ids = employees.map((e) => e.id);
    const byEmp = new Map();
    const CHUNK = 80;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await sb
        .from('hr_employee_documents')
        .select('employee_id, doc_type, status')
        .in('employee_id', chunk)
        .in('doc_type', requiredIds);
      if (res.error) {
        console.error(res.error.message);
        process.exit(1);
      }
      for (const r of res.data || []) {
        const list = byEmp.get(r.employee_id) || [];
        list.push({ doc_type: r.doc_type, status: r.status });
        byEmp.set(r.employee_id, list);
      }
    }
    const before = employees.length;
    employees = employees.filter((e) => {
      const rows = byEmp.get(e.id) || [];
      const byType = new Map(rows.map((r) => [r.doc_type, r.status]));
      return requiredIds.some((id) => !isRequiredDocSatisfied(byType.get(id)));
    });
    console.log(
      `Con docs obligatorios faltantes: ${employees.length}/${before}`
    );
  }

  if (DRY) {
    console.log('(dry-run) Empleados a jalar:');
    for (const e of employees) {
      console.log(`  - ${e.full_name}`);
    }
    process.exit(0);
  }

  let importedTotal = 0;
  let skippedTotal = 0;
  let okCount = 0;
  let failCount = 0;
  const failures = [];

  for (const emp of employees) {
    process.stdout.write(`→ ${emp.full_name} ... `);
    const result = await pullExpedienteDocuments({
      employeeId: emp.id,
      driveFolderPath: emp.drive_folder_path,
      fullName: emp.full_name,
      who: 'hr-pull-script',
      force: FORCE,
    });
    const repaired = await repairSharedPackFromStorage({
      employeeId: emp.id,
      who: 'hr-pull-script',
      force: FORCE,
    });
    const relabeled = await repairMislabeledPackFromStorage({
      employeeId: emp.id,
      who: 'hr-pull-script',
      force: FORCE,
    });
    const imported =
      result.imported + repaired.imported + relabeled.imported;
    const skipped =
      result.skipped + repaired.skipped + relabeled.skipped;
    if (result.ok || repaired.repaired || relabeled.repaired) {
      okCount += 1;
      importedTotal += imported;
      skippedTotal += skipped;
      console.log(`ok +${imported} (skip ${skipped})`);
    } else {
      failCount += 1;
      failures.push({ name: emp.full_name, error: result.error });
      console.log(`FAIL: ${result.error || 'unknown'}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Procesados: ${employees.length}`);
  console.log(`OK: ${okCount} · Fallidos: ${failCount}`);
  console.log(`Docs importados: ${importedTotal} · omitidos: ${skippedTotal}`);
  if (failures.length) {
    console.log('Fallidos:');
    for (const f of failures.slice(0, 20)) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
