/**
 * Rellena campos vacíos de hr_employees desde
 * «DATOS TRABAJADORES PARA CONTRATO.xlsx» (hoja PERSONAL ACTIVO).
 *
 * Solo escribe si el campo en DB está vacío / inválido.
 * No crea empleados nuevos. RFC no se persiste (sin columna en hr_employees).
 *
 * Uso:
 *   npm run hr:fill-contrato -- --dry-run
 *   npm run hr:fill-contrato
 *   npm run hr:fill-contrato -- --xlsx "I:\\Mi unidad\\DATOS TRABAJADORES PARA CONTRATO.xlsx"
 *   npm run hr:fill-contrato -- --all-employees
 *
 * Requiere .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */

import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import * as XLSXNS from 'xlsx';
import { resolvePlantillaVigente } from '../app/lib/hr-plantilla.ts';
import {
  excelSerialToIso as payrollExcelSerialToIso,
  normalizePersonName,
  parseLooseNumber,
} from '../app/lib/hr-payroll.ts';
import {
  folderBasenameFromPath,
  matchPerson,
} from '../app/lib/hr-person-match.ts';
import {
  dobIsoFromCurp,
  normalizeCurp,
  normalizeFechaNacimiento,
} from '../app/lib/hr-identity.ts';

/** xlsx CJS/ESM: en Node a veces las exports viven en `.default`. */
const XLSX =
  /** @type {typeof XLSXNS} */ (
    (XLSXNS).default ?? XLSXNS
  );

const DRY = process.argv.includes('--dry-run');
const ALL_EMPLOYEES = process.argv.includes('--all-employees');
const XLSX_FLAG = (() => {
  const i = process.argv.indexOf('--xlsx');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();

const DEFAULT_PATHS = [
  XLSX_FLAG,
  process.env.HR_CONTRATO_XLSX || '',
  String.raw`I:\Mi unidad\DATOS TRABAJADORES PARA CONTRATO.xlsx`,
].filter(Boolean);

const FIELD_KEYS = [
  'curp',
  'fecha_nacimiento',
  'fecha_ingreso',
  'domicilio',
  'phone',
  'emergency_phone',
  'emergency_contact',
  'sueldo_diario',
  'puesto',
];

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

function resolveXlsxPath() {
  for (const p of DEFAULT_PATHS) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Excel serial (días desde 1899-12-30) → YYYY-MM-DD */
function excelSerialToIso(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (typeof payrollExcelSerialToIso === 'function') {
    return payrollExcelSerialToIso(n);
  }
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(n) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toDateIso(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number') return excelSerialToIso(raw);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y = y > 50 ? 1900 + y : 2000 + y;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

function cell(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  // Tolerar espacios en headers
  for (const [hk, hv] of Object.entries(row)) {
    const n = String(hk).trim().toUpperCase();
    for (const k of keys) {
      if (n === String(k).trim().toUpperCase()) {
        if (hv != null && String(hv).trim() !== '') return hv;
      }
    }
  }
  return null;
}

function normalizePhone(raw) {
  if (raw == null || raw === '') return null;
  let s =
    typeof raw === 'number'
      ? String(Math.trunc(raw))
      : String(raw).trim().replace(/\.0+$/, '');
  s = s.replace(/[^\d+]/g, '');
  if (s.startsWith('+52')) s = s.slice(3);
  if (s.startsWith('52') && s.length >= 12) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (s.length < 8 || s.length > 15) return null;
  return s;
}

function normalizeText(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s || null;
}

function normalizePuesto(raw) {
  const s = normalizeText(raw);
  if (!s) return null;
  // Title-ish: ENCARGADO DE COCINA → Encargado de cocina (keep short tokens)
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bDe\b/g, 'de')
    .replace(/\bDel\b/g, 'del')
    .replace(/\bLa\b/g, 'la')
    .replace(/\bLos\b/g, 'los')
    .replace(/\bY\b/g, 'y')
    .trim();
}

function isBlank(v) {
  if (v == null) return true;
  if (typeof v === 'number') return !Number.isFinite(v) || v <= 0;
  return String(v).trim() === '';
}

function isBlankDob(v) {
  return !normalizeFechaNacimiento(v);
}

function parseContratoRows(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => /personal\s*activo/i.test(n)) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const rows = [];
  for (const row of raw) {
    const fullName = normalizeText(cell(row, 'NOMBRE COMPLETO', 'NOMBRE'));
    if (!fullName) continue;
    if (/^nombre/i.test(fullName)) continue;

    const curp = normalizeCurp(cell(row, 'CURP'));
    const dobRaw = toDateIso(cell(row, 'FDN (D/M/A)', 'FDN', 'FECHA DE NACIMIENTO'));
    const fechaNacimiento =
      normalizeFechaNacimiento(dobRaw) || dobIsoFromCurp(curp);

    const fechaIngreso = toDateIso(cell(row, 'FECHA DE INGRESO'));
    const sueldo = parseLooseNumber(cell(row, 'SALARIO DIARIO'));
    const phone = normalizePhone(cell(row, 'MOVIL', 'TELÉFONO', 'TELEFONO'));
    const emergencyPhone = normalizePhone(
      cell(row, 'TELEFONO DE EMERGENCIA', 'TELÉFONO DE EMERGENCIA')
    );
    const emergencyContact = normalizeText(
      cell(row, 'NOMBRE DE CONTACTO', 'CONTACTO DE EMERGENCIA')
    );
    const domicilio = normalizeText(cell(row, 'DOMICILIO'));
    const puesto = normalizePuesto(cell(row, 'PUESTO'));
    const rfc = normalizeText(cell(row, 'RFC'));

    rows.push({
      fullName,
      curp,
      rfc,
      fecha_nacimiento: fechaNacimiento,
      fecha_ingreso: fechaIngreso,
      domicilio,
      phone,
      emergency_phone: emergencyPhone,
      emergency_contact: emergencyContact,
      sueldo_diario:
        sueldo != null && sueldo > 0 ? Math.round(sueldo * 100) / 100 : null,
      puesto,
    });
  }
  return { sheetName, rows };
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const xlsxPath = resolveXlsxPath();
if (!xlsxPath) {
  console.error(
    'No se encontró el Excel. Probé:\n' +
      DEFAULT_PATHS.map((p) => `  · ${p}`).join('\n') +
      '\nUsa --xlsx "ruta"'
  );
  process.exit(1);
}

const sb = createClient(url, key);
if (DRY) console.log('(dry-run: no escribe en Supabase)\n');

const { sheetName, rows } = parseContratoRows(xlsxPath);
console.log(`Excel: ${xlsxPath}`);
console.log(`Hoja: ${sheetName} · ${rows.length} filas con nombre\n`);

const SELECT_TRIES = [
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_nacimiento, sueldo_diario, email, phone, domicilio, curp, nss, emergency_contact, emergency_phone, drive_folder_path, force_exclude, fecha_baja',
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_nacimiento, sueldo_diario, email, phone, domicilio, curp, nss, emergency_contact, emergency_phone, drive_folder_path',
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_nacimiento, sueldo_diario, email, phone, curp, nss, emergency_contact, emergency_phone, drive_folder_path',
  'id, full_name, status, puesto, area, fecha_ingreso, sueldo_diario, email, phone, drive_folder_path',
];

/** Columnas de perfil que pueden faltar si no se corrió el patch SQL. */
const OPTIONAL_COLS = [
  'domicilio',
  'fecha_nacimiento',
  'curp',
  'nss',
  'emergency_contact',
  'emergency_phone',
  'sueldo_diario',
  'phone',
];

async function probeWritableColumns() {
  const missing = new Set();
  const { data, error } = await sb
    .from('hr_employees')
    .select(
      'id, domicilio, fecha_nacimiento, curp, nss, emergency_contact, emergency_phone, sueldo_diario, phone'
    )
    .limit(1);
  if (!error) return missing;
  const msg = error.message || '';
  for (const col of OPTIONAL_COLS) {
    if (new RegExp(`['\"]?${col}['\"]?`, 'i').test(msg)) {
      missing.add(col);
    }
  }
  // Fallback: probar una a una
  if (!missing.size) {
    for (const col of OPTIONAL_COLS) {
      const r = await sb.from('hr_employees').select(`id, ${col}`).limit(1);
      if (r.error && /column|schema cache|does not exist/i.test(r.error.message || '')) {
        missing.add(col);
      }
    }
  }
  return missing;
}

async function loadEmployees() {
  if (!ALL_EMPLOYEES) {
    const plantilla = await resolvePlantillaVigente(sb);
    const list = plantilla.employees || [];
    console.log(
      `Plantilla vigente: ${list.length} personas (${plantilla.source || '—'})`
    );
    // Enriquecer con columnas de perfil si plantilla no las trae todas
    const ids = list.map((e) => e.id);
    if (!ids.length) return [];
    for (const cols of SELECT_TRIES) {
      const { data, error } = await sb
        .from('hr_employees')
        .select(cols)
        .in('id', ids);
      if (!error && data) return data;
    }
    return list;
  }

  for (const cols of SELECT_TRIES) {
    const { data, error } = await sb
      .from('hr_employees')
      .select(cols)
      .neq('status', 'baja');
    if (!error && data) {
      console.log(`Empleados (no baja): ${data.length}`);
      return data;
    }
  }
  throw new Error('No se pudo leer hr_employees');
}

const employees = await loadEmployees();
const missingCols = await probeWritableColumns();
if (missingCols.size) {
  console.log(
    `⚠ Columnas ausentes en DB (se omiten): ${[...missingCols].join(', ')}`
  );
  console.log(
    '  → Ejecuta supabase/hr_employee_documents.sql (ALTER domicilio, etc.) y re-corre npm run hr:fill-contrato\n'
  );
}
const byNormName = new Map();
const byCurp = new Map();
const candidates = employees.map((e) => {
  const base = folderBasenameFromPath(e.drive_folder_path);
  return {
    id: e.id,
    full_name: e.full_name || '',
    aliases: base ? [base] : undefined,
  };
});
for (const e of employees) {
  byNormName.set(normalizePersonName(e.full_name || ''), e);
  const c = normalizeCurp(e.curp);
  if (c) byCurp.set(c, e);
}

function matchRow(row) {
  if (row.curp && byCurp.has(row.curp)) {
    return { emp: byCurp.get(row.curp), how: 'curp' };
  }
  const key = normalizePersonName(row.fullName);
  if (byNormName.has(key)) {
    return { emp: byNormName.get(key), how: 'name_exact' };
  }
  const soft = matchPerson(row.fullName, candidates);
  if (
    soft.employeeId &&
    (soft.autoLink ||
      soft.confidence === 'exact' ||
      soft.confidence === 'high')
  ) {
    const emp = employees.find((e) => e.id === soft.employeeId);
    if (emp) return { emp, how: `name_${soft.confidence}` };
  }
  return { emp: null, how: soft?.confidence || 'none' };
}

function buildPatch(emp, row) {
  const patch = {};
  const filled = [];
  const blocked = [];

  const trySet = (key, value, blankFn = isBlank) => {
    if (value == null || value === '') return;
    if (missingCols.has(key)) {
      blocked.push(key);
      return;
    }
    if (blankFn(emp[key])) {
      patch[key] = value;
      filled.push(key);
    }
  };

  trySet('curp', row.curp);
  trySet('fecha_nacimiento', row.fecha_nacimiento, isBlankDob);
  trySet('fecha_ingreso', row.fecha_ingreso);
  trySet('domicilio', row.domicilio);
  trySet('phone', row.phone);
  trySet('emergency_phone', row.emergency_phone);
  trySet('emergency_contact', row.emergency_contact);
  if (
    row.sueldo_diario != null &&
    !missingCols.has('sueldo_diario') &&
    (emp.sueldo_diario == null ||
      !Number.isFinite(Number(emp.sueldo_diario)) ||
      Number(emp.sueldo_diario) <= 0)
  ) {
    patch.sueldo_diario = row.sueldo_diario;
    filled.push('sueldo_diario');
  } else if (row.sueldo_diario != null && missingCols.has('sueldo_diario')) {
    blocked.push('sueldo_diario');
  }
  trySet('puesto', row.puesto);

  return { patch, filled, blocked };
}

const matched = [];
const unmatched = [];
const updated = [];
const skippedNoNeed = [];
const blockedByMissingCol = [];
const errors = [];
const fieldCounts = Object.fromEntries(FIELD_KEYS.map((k) => [k, 0]));
const rfcSkipped = [];

for (const row of rows) {
  if (row.rfc) rfcSkipped.push(row.fullName);
  const { emp, how } = matchRow(row);
  if (!emp) {
    unmatched.push({ name: row.fullName, curp: row.curp, how });
    continue;
  }
  matched.push({ name: row.fullName, emp: emp.full_name, how, id: emp.id });
  const { patch, filled, blocked } = buildPatch(emp, row);
  if (blocked.length) {
    blockedByMissingCol.push({ name: emp.full_name, blocked });
  }
  if (!filled.length) {
    skippedNoNeed.push(emp.full_name);
    continue;
  }
  for (const f of filled) fieldCounts[f] = (fieldCounts[f] || 0) + 1;

  if (DRY) {
    updated.push({ name: emp.full_name, filled, patch, how });
    continue;
  }

  const { error } = await sb
    .from('hr_employees')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', emp.id);
  if (error) {
    errors.push({ name: emp.full_name, error: error.message, patch });
    continue;
  }
  updated.push({ name: emp.full_name, filled, patch, how });
}

console.log('=== Fill desde DATOS TRABAJADORES PARA CONTRATO ===');
console.log(`Filas Excel:     ${rows.length}`);
console.log(`Matcheados:      ${matched.length}`);
console.log(`Actualizados:    ${updated.length}${DRY ? ' (dry-run)' : ''}`);
console.log(`Ya completos:    ${skippedNoNeed.length}`);
console.log(`Sin match:       ${unmatched.length}`);
console.log(`Errores:         ${errors.length}`);

const filledSummary = FIELD_KEYS.filter((k) => fieldCounts[k] > 0)
  .map((k) => `${k}=${fieldCounts[k]}`)
  .join(', ');
console.log(`Campos rellenados: ${filledSummary || '—'}`);
console.log(
  `RFC en Excel (no hay columna DB; omitidos): ${rfcSkipped.length}`
);
if (blockedByMissingCol.length) {
  const cols = new Set();
  for (const b of blockedByMissingCol) for (const c of b.blocked) cols.add(c);
  console.log(
    `Bloqueados por columna ausente (${blockedByMissingCol.length} personas): ${[...cols].join(', ')}`
  );
}

if (matched.length) {
  console.log('\nMatches:');
  for (const m of matched) {
    const u = updated.find((x) => x.name === m.emp);
    const note = u
      ? `→ ${u.filled.join(', ')}`
      : skippedNoNeed.includes(m.emp)
        ? '→ (ya completo)'
        : '';
    console.log(`  · ${m.name} ↔ ${m.emp} [${m.how}] ${note}`);
  }
}

if (unmatched.length) {
  console.log('\nSin match:');
  for (const u of unmatched) {
    console.log(`  · ${u.name}${u.curp ? ` CURP=${u.curp}` : ''} (${u.how})`);
  }
}

if (errors.length) {
  console.log('\nErrores:');
  for (const e of errors) {
    console.log(`  · ${e.name}: ${e.error}`);
  }
}

if (updated.length) {
  console.log(DRY ? '\nPatches (dry-run):' : '\nActualizados:');
  for (const u of updated) {
    console.log(`  · ${u.name}: ${JSON.stringify(u.patch)}`);
  }
}

if (DRY) console.log('\n(dry-run: nada escrito; quita --dry-run para aplicar)');
