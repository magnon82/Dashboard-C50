/**
 * Rellena CURP / NSS / fecha_nacimiento vacíos en plantilla vigente desde:
 *   1) BASE DATOS PERSONAL C50.xlsx (columnas CURP / NSS / Fecha de Nacimiento)
 *   2) Documentos subidos:
 *        - curp, ine, acta_nacimiento → CURP
 *        - nss → NSS
 *        - acta_nacimiento → fecha_nacimiento («Fecha de Nacimiento» o CURP pos. 5–10)
 *   3) payload.curp de solicitudes de vacaciones
 *   4) Fallback DOB desde CURP ya resuelta en ficha
 *
 * No sobrescribe valores ya presentes y plausibles en hr_employees.
 *
 * Uso:
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-fill-identity.mjs --dry-run
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/hr-fill-identity.mjs
 *   npm run hr:fill-identity -- --dry-run
 *   npm run hr:fill-identity -- --only "Juan Roman"
 *
 * Requiere .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * BASE DATOS local opcional: I:\Mi unidad\RH\BASE DATOS PERSONAL C50.xlsx
 */

import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolvePlantillaVigente } from '../app/lib/hr-plantilla.ts';
import { loadBaseDatosRows } from '../app/lib/hr-payroll-drive.ts';
import { normalizePersonName } from '../app/lib/hr-payroll.ts';
import {
  folderBasenameFromPath,
  matchPerson,
} from '../app/lib/hr-person-match.ts';
import {
  fillEmptyEmployeeIdentity,
  normalizeCurp,
  normalizeFechaNacimiento,
  normalizeNss,
} from '../app/lib/hr-identity.ts';

const DRY = process.argv.includes('--dry-run');
const NO_DOCS = process.argv.includes('--no-docs');
const NO_BASE = process.argv.includes('--no-base');
const ONLY_NAME = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();

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

if (DRY) console.log('(dry-run: no escribe en Supabase)\n');

const plantilla = await resolvePlantillaVigente(sb);
let employees = plantilla.employees || [];
if (ONLY_NAME) {
  const needle = ONLY_NAME.toLowerCase();
  employees = employees.filter((e) =>
    String(e.full_name || '')
      .toLowerCase()
      .includes(needle)
  );
  console.log(`Filtro --only "${ONLY_NAME}": ${employees.length} empleado(s)\n`);
}

const ids = employees.map((e) => e.id);
console.log(`Plantilla vigente: ${ids.length} personas (${plantilla.source || '—'})`);

/** Match BASE DATOS → employeeId */
const baseDatosByEmployeeId = new Map();
let baseRowsWithCurp = 0;
let baseRowsWithNss = 0;
let baseRowsWithDob = 0;
let baseMatched = 0;

if (!NO_BASE) {
  try {
    const { rows, source } = await loadBaseDatosRows();
    console.log(`BASE DATOS: ${rows.length} filas (fuente: ${source})`);
    const candidates = employees.map((e) => ({
      id: e.id,
      full_name: e.full_name || '',
      aliases: (() => {
        const base = folderBasenameFromPath(e.drive_folder_path);
        return base ? [base] : undefined;
      })(),
    }));
    const byKey = new Map(
      candidates.map((c) => [normalizePersonName(c.full_name), c.id])
    );

    for (const row of rows) {
      const curp = normalizeCurp(row.curp);
      const nss = normalizeNss(row.nss);
      const dob = normalizeFechaNacimiento(row.fecha_nacimiento);
      if (curp) baseRowsWithCurp += 1;
      if (nss) baseRowsWithNss += 1;
      if (dob) baseRowsWithDob += 1;
      if (!curp && !nss && !dob) continue;

      const key = normalizePersonName(row.full_name);
      let empId = byKey.get(key) || null;
      if (!empId) {
        const soft = matchPerson(row.full_name, candidates);
        if (
          soft.autoLink ||
          soft.confidence === 'exact' ||
          soft.confidence === 'high'
        ) {
          empId = soft.employeeId;
        }
      }
      if (!empId) continue;
      baseMatched += 1;
      const prev = baseDatosByEmployeeId.get(empId) || {};
      baseDatosByEmployeeId.set(empId, {
        curp: prev.curp || curp || null,
        nss: prev.nss || nss || null,
        fecha_nacimiento: prev.fecha_nacimiento || dob || null,
      });
    }
    console.log(
      `BASE DATOS con CURP=${baseRowsWithCurp} NSS=${baseRowsWithNss} DOB=${baseRowsWithDob}; matcheados a plantilla=${baseDatosByEmployeeId.size} (filas con id=${baseMatched})`
    );
  } catch (e) {
    console.warn(
      'BASE DATOS no disponible:',
      e instanceof Error ? e.message : e
    );
  }
}

const results = await fillEmptyEmployeeIdentity(sb, ids, {
  dryRun: DRY,
  extractFromDocs: !NO_DOCS,
  includeLeavePayloads: true,
  maxDocExtracts: 400,
  baseDatosByEmployeeId,
});

const curpFilled = results.filter((r) => r.curpUpdated);
const nssFilled = results.filter((r) => r.nssUpdated);
const dobFilled = results.filter((r) => r.fechaNacimientoUpdated);
const curpHave = results.filter((r) => r.curp);
const nssHave = results.filter((r) => r.nss);
const dobHave = results.filter((r) => r.fechaNacimiento);

console.log('\n=== Fill identity (CURP / NSS / fecha_nacimiento) ===');
console.log(
  `CURP: ${curpHave.length}/${ids.length} con valor; ${curpFilled.length} rellenados ahora`
);
console.log(
  `NSS:  ${nssHave.length}/${ids.length} con valor; ${nssFilled.length} rellenados ahora`
);
console.log(
  `DOB:  ${dobHave.length}/${ids.length} con valor; ${dobFilled.length} rellenados ahora`
);

const bySource = (key) => {
  const m = new Map();
  for (const r of results) {
    const src = r[key];
    if (!src || src === 'none') continue;
    m.set(src, (m.get(src) || 0) + 1);
  }
  return [...m.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
};
console.log(`Fuentes CURP: ${bySource('curpSource') || '—'}`);
console.log(`Fuentes NSS:  ${bySource('nssSource') || '—'}`);
console.log(`Fuentes DOB:  ${bySource('fechaNacimientoSource') || '—'}`);

if (curpFilled.length || nssFilled.length || dobFilled.length) {
  console.log('\nRellenados:');
  for (const r of results) {
    if (!r.curpUpdated && !r.nssUpdated && !r.fechaNacimientoUpdated) continue;
    const name = r.fullName || r.employeeId;
    const parts = [];
    if (r.curpUpdated) parts.push(`CURP=${r.curp} (${r.curpSource})`);
    if (r.nssUpdated) parts.push(`NSS=${r.nss} (${r.nssSource})`);
    if (r.fechaNacimientoUpdated) {
      parts.push(
        `DOB=${r.fechaNacimiento} (${r.fechaNacimientoSource})`
      );
    }
    console.log(`  • ${name}: ${parts.join(' · ')}`);
  }
}

const dobBlocked = results.filter((r) => r.dobColumnMissing);
if (dobBlocked.length) {
  console.log(
    `\n⚠ ${dobBlocked.length} DOB resuelto(s) pero NO guardados: falta columna fecha_nacimiento.`
  );
  console.log(
    '  Ejecuta supabase/hr_employee_nacimiento.sql en Supabase SQL Editor, luego re-corre:'
  );
  console.log('  npm run hr:fill-identity');
  for (const r of dobBlocked) {
    console.log(
      `  · ${r.fullName || r.employeeId}: ${r.fechaNacimiento} (${r.fechaNacimientoSource})`
    );
  }
}

// Spotlight Juan Roman / SACJ
const spotlight = results.filter(
  (r) =>
    /roman|sanchez cortes/i.test(r.fullName || '') ||
    (r.curp && r.curp.startsWith('SACJ'))
);
if (spotlight.length) {
  console.log('\nVerificación (Juan Roman / SACJ…):');
  for (const r of spotlight) {
    console.log(
      `  • ${r.fullName}: CURP=${r.curp || '—'} (${r.curpSource}) NSS=${r.nss || '—'} (${r.nssSource}) DOB=${r.fechaNacimiento || '—'} (${r.fechaNacimientoSource})${r.curpUpdated || r.nssUpdated || r.fechaNacimientoUpdated ? ' [updated]' : ''}`
    );
  }
}

if (DRY) console.log('\n(dry-run: nada escrito; quita --dry-run para aplicar)');
