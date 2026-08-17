/**
 * Relee PDFs en Storage y corrige slots (INE / acta / CURP / domicilio).
 * No requiere File Stream.
 *
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-repair-doc-slots.mjs
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-repair-doc-slots.mjs --name Gael
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-repair-doc-slots.mjs --dry-run
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { repairMislabeledPackFromStorage, pullExpedienteDocuments } from '../app/lib/hr-expediente-docs-pull.ts';
import { localDriveFsEnabled } from '../app/lib/local-fs.ts';
import { classifyPdfBuffer, detectDocTypeFromText } from '../app/lib/hr-docs-pack-split.ts';
import { resolvePlantillaVigente } from '../app/lib/hr-plantilla.ts';
import {
  HR_DOCS_BUCKET,
  HR_REQUIRED_DOC_TYPES,
  missingRequiredDocs,
} from '../app/lib/hr-employee-profile.ts';

const DRY = process.argv.includes('--dry-run');
const INSPECT = process.argv.includes('--inspect');
const CLASSIFY = process.argv.includes('--classify');
const ALL = process.argv.includes('--all');
const nameArgIdx = process.argv.indexOf('--name');
const NAME_FILTER =
  nameArgIdx >= 0 ? String(process.argv[nameArgIdx + 1] || '').trim() : '';

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

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const plantilla = await resolvePlantillaVigente(sb, { allowSeed: false });
  let employees = plantilla.employees.map((e) => ({
    id: e.id,
    full_name: e.full_name,
    drive_folder_path: e.drive_folder_path,
  }));
  if (NAME_FILTER) {
    const q = NAME_FILTER.toLowerCase();
    employees = employees.filter((e) => e.full_name.toLowerCase().includes(q));
  }

  const requiredIds = HR_REQUIRED_DOC_TYPES.map((d) => d.id);
  if (!ALL && !NAME_FILTER && employees.length) {
    const ids = employees.map((e) => e.id);
    const byEmp = new Map();
    const CHUNK = 80;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await sb
        .from('hr_employee_documents')
        .select('employee_id, doc_type, status, storage_path, notes')
        .in('employee_id', chunk)
        .in('doc_type', requiredIds);
      if (res.error) throw new Error(res.error.message);
      for (const r of res.data || []) {
        const list = byEmp.get(r.employee_id) || [];
        list.push(r);
        byEmp.set(r.employee_id, list);
      }
    }
    const before = employees.length;
    employees = employees.filter((e) => {
      const rows = byEmp.get(e.id) || [];
      const missing = missingRequiredDocs(rows);
      if (missing.length) return true;
      // También reparar si hay slots del pack (heurística / -exp-) sin marca nueva.
      return rows.some(
        (r) =>
          r.storage_path &&
          (r.status === 'uploaded' || r.status === 'verified') &&
          (String(r.notes || '').includes('paquete p.') ||
            /(?:^|\/)(?:ine|acta_nacimiento|curp|comprobante_domicilio)-exp-\d+\./i.test(
              r.storage_path
            )) &&
          !String(r.notes || '').includes('contenido verificado identidad-2026-08-17')
      );
    });
    console.log(
      `A reparar (faltantes o pack sin verificar): ${employees.length}/${before}`
    );
  }

  console.log(`Empleados: ${employees.length}${NAME_FILTER ? ` (filtro ${NAME_FILTER})` : ''}`);

  if (DRY || INSPECT || CLASSIFY) {
    for (const emp of employees) {
      const { data: docs } = await sb
        .from('hr_employee_documents')
        .select('doc_type, status, storage_path, notes')
        .eq('employee_id', emp.id)
        .in('doc_type', requiredIds);
      const missing = missingRequiredDocs(docs || []);
      console.log(`\n${emp.full_name}`);
      for (const d of docs || []) {
        const path = d.storage_path || '(vacío)';
        const notes = String(d.notes || '').slice(0, 100);
        console.log(`  ${d.doc_type} [${d.status}] ${path} ${notes}`);
      }
      if (missing.length) {
        console.log(`  FALTAN: ${missing.map((m) => m.title).join(', ')}`);
      }
      if (CLASSIFY) {
        for (const d of docs || []) {
          if (!d.storage_path) continue;
          const dl = await sb.storage.from(HR_DOCS_BUCKET).download(d.storage_path);
          if (dl.error || !dl.data) {
            console.log(`  classify ${d.doc_type}: download fail ${dl.error?.message || ''}`);
            continue;
          }
          const buf = Buffer.from(await dl.data.arrayBuffer());
          const mag = buf.subarray(0, 8).toString('latin1');
          try {
            const c = await classifyPdfBuffer(buf);
            const fromText = detectDocTypeFromText(c.textSample || '');
            console.log(
              `  classify ${d.doc_type}: magic=${JSON.stringify(mag)} bytes=${buf.length} method=${c.method} docType=${c.docType} fromSample=${fromText}`
            );
            console.log(`    sample: ${JSON.stringify((c.textSample || '').slice(0, 400))}`);
            console.log(`    scores: ${JSON.stringify(c.scores)}`);
          } catch (err) {
            console.log(`  classify ${d.doc_type}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }
    if (CLASSIFY) process.exit(0);
    if (INSPECT) process.exit(0);
    if (DRY) process.exit(0);
  }

  let repairedPeople = 0;
  let swapCount = 0;
  let stillMissing = 0;

  for (const emp of employees) {
    process.stdout.write(`→ ${emp.full_name} ... `);
    const result = await repairMislabeledPackFromStorage({
      employeeId: emp.id,
      who: 'hr-repair-doc-slots',
      force: true,
    });
    let { data: docs } = await sb
      .from('hr_employee_documents')
      .select('doc_type, status, storage_path')
      .eq('employee_id', emp.id)
      .in('doc_type', requiredIds);
    let missing = missingRequiredDocs(docs || []);
    if (missing.length && localDriveFsEnabled()) {
      try {
        await pullExpedienteDocuments({
          employeeId: emp.id,
          driveFolderPath: emp.drive_folder_path,
          fullName: emp.full_name,
          who: 'hr-repair-doc-slots',
          force: false,
        });
        await repairMislabeledPackFromStorage({
          employeeId: emp.id,
          who: 'hr-repair-doc-slots',
          force: true,
        });
        const refetch = await sb
          .from('hr_employee_documents')
          .select('doc_type, status, storage_path')
          .eq('employee_id', emp.id)
          .in('doc_type', requiredIds);
        docs = refetch.data;
        missing = missingRequiredDocs(docs || []);
      } catch {
        /* best-effort pull */
      }
    }
    if (result.repaired) {
      repairedPeople += 1;
      swapCount += result.swaps.length;
      const swaps = result.swaps
        .map((s) => `${s.from}→${s.to}`)
        .join(', ');
      console.log(
        `reclasificado ${result.imported} (${swaps || 'ok'})${
          missing.length ? ` · faltan ${missing.map((m) => m.title).join(', ')}` : ''
        }`
      );
    } else if (missing.length) {
      stillMissing += 1;
      console.log(`sin cambio · faltan ${missing.map((m) => m.title).join(', ')}`);
    } else {
      console.log('ok');
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Procesados: ${employees.length}`);
  console.log(`Con reclasificación: ${repairedPeople} (${swapCount} movimientos)`);
  console.log(`Aún con faltantes: ${stillMissing}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
