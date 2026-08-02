/**
 * Backfill: vincula Altas ↔ hr_employees y fija full_name canónico
 * (= basename de carpeta de expediente / drive_folder_path).
 *
 * Uso: node --experimental-strip-types scripts/hr-backfill-expediente-links.mjs
 *      node --experimental-strip-types scripts/hr-backfill-expediente-links.mjs --dry-run
 *      npm run hr:backfill-expedientes
 *
 * Pasos:
 *  1) Empleados con drive_folder_path → full_name = basename de la carpeta
 *  2) Carpetas Altas sin path: fuzzy match → escribe path + full_name carpeta
 *
 * Requiere .env.local (Supabase). Paso 2 necesita Drive montado en
 * I:\Mi unidad\RH\Expedientes personal C50\Altas (o HR_EXPEDIENTES_DIR).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  folderBasenameFromPath,
  matchPerson,
  linkStatusFromMatch,
  normalizePersonKey,
} from '../app/lib/hr-person-match.ts';

const DRY = process.argv.includes('--dry-run');

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

function findAltasDir(expedientesRoot) {
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

function listPersonFolders(altasDir) {
  return readdirSync(altasDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const path = join(altasDir, e.name);
      let mtimeMs = null;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        /* ignore */
      }
      return { name: e.name, path, mtimeMs };
    });
}

async function main() {
  const env = { ...process.env, ...loadEnv() };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('hr_employees')
    .select('id, full_name, status, drive_folder_path')
    .order('full_name', { ascending: true });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  const employees = data || [];
  const byId = new Map(employees.map((e) => [e.id, e]));

  if (DRY) console.log('(dry-run: no escribe en Supabase)\n');

  // -------------------------------------------------------------------------
  // Paso 1: renombrar full_name desde drive_folder_path existente
  // -------------------------------------------------------------------------
  let renamedFromPath = 0;
  const renameSamples = [];
  for (const emp of employees) {
    const base = folderBasenameFromPath(emp.drive_folder_path);
    if (!base) continue;
    const cur = String(emp.full_name || '').replace(/\s+/g, ' ').trim();
    if (cur === base) continue;
    if (renameSamples.length < 12) {
      renameSamples.push({ before: cur, after: base, id: emp.id });
    }
    if (DRY) {
      renamedFromPath += 1;
      emp.full_name = base;
      continue;
    }
    const { error: upErr } = await sb
      .from('hr_employees')
      .update({
        full_name: base,
        updated_at: new Date().toISOString(),
      })
      .eq('id', emp.id);
    if (!upErr) {
      renamedFromPath += 1;
      emp.full_name = base;
    }
  }

  console.log('=== Paso 1: full_name ← basename(drive_folder_path) ===');
  console.log(`Actualizados: ${renamedFromPath}`);
  if (renameSamples.length) {
    console.log('Ejemplos (antes → después):');
    for (const s of renameSamples) {
      console.log(`  ${s.before}  →  ${s.after}`);
    }
  }

  // -------------------------------------------------------------------------
  // Paso 2: match carpetas Altas → path + nombre canónico
  // -------------------------------------------------------------------------
  const expedientesRoot =
    env.HR_EXPEDIENTES_DIR?.trim() ||
    'I:\\Mi unidad\\RH\\Expedientes personal C50';
  const altasDir = findAltasDir(expedientesRoot);

  let linked = 0;
  let written = 0;
  let namesFromMatch = 0;
  let already = 0;
  let ambiguous = 0;
  let unlinked = 0;
  const samples = { linked: [], ambiguous: [], unlinked: [], renamed: [] };

  if (!altasDir) {
    console.log(
      `\n=== Paso 2: omitido (no hay carpeta Altas en ${expedientesRoot}) ===`
    );
  } else {
    const folders = listPersonFolders(altasDir);
    console.log(`\n=== Paso 2: Altas (${folders.length} carpetas) ===`);
    console.log(`Ruta: ${altasDir}`);

    const named = employees.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      aliases: (() => {
        const base = folderBasenameFromPath(e.drive_folder_path);
        return base && normalizePersonKey(base) !== normalizePersonKey(e.full_name)
          ? [base]
          : undefined;
      })(),
    }));

    for (const folder of folders) {
      const match = matchPerson(folder.name, named);
      const status = linkStatusFromMatch(match);
      if (status === 'ambiguous') {
        ambiguous += 1;
        if (samples.ambiguous.length < 8) {
          samples.ambiguous.push({
            folder: folder.name,
            candidates: (match.candidates || []).map((c) => c.full_name),
          });
        }
        continue;
      }
      if (!match.autoLink || !match.employeeId) {
        unlinked += 1;
        if (samples.unlinked.length < 8) {
          samples.unlinked.push(folder.name);
        }
        continue;
      }

      linked += 1;
      const emp = byId.get(match.employeeId);
      const beforeName = emp?.full_name;
      if (samples.linked.length < 10) {
        samples.linked.push({
          folder: folder.name,
          employeeBefore: beforeName,
          score: Number(match.score.toFixed(3)),
        });
      }

      const patch = {
        updated_at: new Date().toISOString(),
      };
      let willWritePath = false;
      let willRename = false;

      if (!emp?.drive_folder_path) {
        patch.drive_folder_path = folder.path;
        willWritePath = true;
      }
      const canonical = folder.name.replace(/\s+/g, ' ').trim();
      if (
        emp &&
        canonical &&
        String(emp.full_name || '').replace(/\s+/g, ' ').trim() !== canonical
      ) {
        patch.full_name = canonical;
        willRename = true;
      }

      if (!willWritePath && !willRename) {
        already += 1;
        continue;
      }

      if (willRename && samples.renamed.length < 10) {
        samples.renamed.push({
          before: beforeName,
          after: canonical,
          excelHint: beforeName,
        });
      }

      if (DRY) {
        if (willWritePath) written += 1;
        if (willRename) {
          namesFromMatch += 1;
          if (emp) emp.full_name = canonical;
          const n = named.find((x) => x.id === match.employeeId);
          if (n) n.full_name = canonical;
        }
        continue;
      }

      let q = sb.from('hr_employees').update(patch).eq('id', match.employeeId);
      if (willWritePath) q = q.is('drive_folder_path', null);
      const { error: upErr } = await q;
      if (!upErr) {
        if (willWritePath) {
          written += 1;
          if (emp) emp.drive_folder_path = folder.path;
        }
        if (willRename) {
          namesFromMatch += 1;
          if (emp) emp.full_name = canonical;
          const n = named.find((x) => x.id === match.employeeId);
          if (n) n.full_name = canonical;
        }
      }
    }

    console.log(`Vinculados (match OK): ${linked}`);
    console.log(`Ambiguos:             ${ambiguous}`);
    console.log(`Sin vincular:         ${unlinked}`);
    console.log(
      `drive_folder_path:    ${written} ${DRY ? 'pendientes (dry-run)' : 'escritos'}; ${already} ya ok`
    );
    console.log(
      `full_name carpeta:    ${namesFromMatch} ${DRY ? 'pendientes (dry-run)' : 'actualizados'}`
    );
  }

  const totalNames = renamedFromPath + namesFromMatch;
  console.log('\n=== Resumen nombres canónicos ===');
  console.log(`Total full_name actualizados: ${totalNames}`);
  if (samples.renamed.length) {
    console.log('\nExcel corto / previo → expediente completo:');
    for (const s of samples.renamed) {
      console.log(`  ${s.before}  →  ${s.after}`);
    }
  }
  if (samples.linked.length) {
    console.log('\nEjemplos vinculados (carpeta ↔ empleado previo):');
    for (const s of samples.linked) {
      console.log(
        `  ${s.folder}  ←  ${s.employeeBefore}  (${s.score})`
      );
    }
  }
  if (samples.ambiguous.length) {
    console.log('\nEjemplos ambiguos:');
    for (const s of samples.ambiguous) {
      console.log(`  ${s.folder}  ≈  ${s.candidates.join(' | ')}`);
    }
  }
  if (samples.unlinked.length) {
    console.log('\nEjemplos sin vincular:');
    for (const s of samples.unlinked) console.log(`  ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
