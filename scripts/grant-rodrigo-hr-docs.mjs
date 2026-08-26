/**
 * Concede a Rodrigo León acceso RR.HH. + subida de documentos del expediente.
 *
 * - Módulo: rrhh (lectura /rrhh)
 * - Capacidad: rrhh.employees_edit (escanear/foto/archivo por documento)
 * - Vincula suite_username ↔ hr_employees
 *
 * Uso: node scripts/grant-rodrigo-hr-docs.mjs
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'fs';
import { randomBytes, scryptSync } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUITE_USERNAME = 'rodrigo';
const DISPLAY_NAME = 'Rodrigo León';
const MODULES = ['rrhh'];
const CAPABILITIES = ['rrhh.employees_edit'];

const AUTH_SOURCE_FILE = 'dashboard_auth';
const AUTH_CATEGORY = 'DashboardUser';

const SEARCH_NAMES = [
  'GONZALEZ LEON RODRIGO ALEJANDRO',
  'GONZÁLEZ LEÓN RODRIGO ALEJANDRO',
  'Rodrigo León',
  'Rodrigo Leon',
  'Rodrigo González León',
  'Rodrigo Gonzalez Leon',
  'Rodrigo Alejandro González León',
  'Rodrigo Alejandro Gonzalez Leon',
];

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

function normalizePersonName(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function fuzzyMatchRodrigo(fullName) {
  const k = normalizePersonName(fullName);
  const targets = SEARCH_NAMES.map(normalizePersonName);
  if (targets.includes(k)) return true;
  const tokens = new Set(k.split(' '));
  if (!tokens.has('rodrigo')) return false;
  return tokens.has('leon') || tokens.has('gonzalez');
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function mergeUnique(arr, add) {
  const out = [...(arr || [])];
  for (const item of add) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function parseUserPayload(description) {
  try {
    const p = JSON.parse(description || '');
    if (!p?.username || !p?.password_hash || !p?.role) return null;
    return p;
  } catch {
    return null;
  }
}

async function listAuthUsers(sb) {
  const { data, error } = await sb
    .from('financial_records')
    .select('id, date, description')
    .eq('source_file', AUTH_SOURCE_FILE)
    .eq('category', AUTH_CATEGORY)
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || [])
    .map((r) => {
      const p = parseUserPayload(r.description);
      if (!p) return null;
      return {
        id: r.id,
        username: String(p.username).toLowerCase(),
        payload: p,
      };
    })
    .filter(Boolean);
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: emps, error: empErr } = await sb
    .from('hr_employees')
    .select(
      'id, full_name, status, puesto, area, suite_username, drive_folder_path'
    );
  if (empErr) {
    console.error('Error hr_employees:', empErr.message);
    process.exit(1);
  }

  const hits = (emps || []).filter((e) => fuzzyMatchRodrigo(e.full_name));
  if (!hits.length) {
    console.error('No se encontró a Rodrigo León en hr_employees');
    process.exit(1);
  }
  hits.sort((a, b) => {
    let sa = 0;
    let sb2 = 0;
    if (a.drive_folder_path) sa += 3;
    if (a.suite_username) sa += 2;
    if (a.status === 'activo') sa += 2;
    if (b.drive_folder_path) sb2 += 3;
    if (b.suite_username) sb2 += 2;
    if (b.status === 'activo') sb2 += 2;
    return sb2 - sa;
  });
  const employee = hits[0];
  console.log('Empleado RH:', employee.id, employee.full_name);

  if (employee.suite_username?.toLowerCase() !== SUITE_USERNAME) {
    const { error: linkErr } = await sb
      .from('hr_employees')
      .update({
        suite_username: SUITE_USERNAME,
        updated_at: new Date().toISOString(),
      })
      .eq('id', employee.id);
    if (linkErr) {
      console.error('No se pudo vincular suite_username:', linkErr.message);
      process.exit(1);
    }
    console.log('Vinculado suite_username →', SUITE_USERNAME);
  } else {
    console.log('suite_username ya era', SUITE_USERNAME);
  }

  const users = await listAuthUsers(sb);
  let user = users.find((u) => u.username === SUITE_USERNAME);
  const now = new Date().toISOString();

  if (!user) {
    const password = 'Rodrigo26';
    const payload = {
      username: SUITE_USERNAME,
      display_name: DISPLAY_NAME,
      password_hash: hashPassword(password),
      password,
      role: 'viewer',
      modules: MODULES,
      capabilities: CAPABILITIES,
      active: true,
      updated_at: now,
    };
    const { data: inserted, error: insErr } = await sb
      .from('financial_records')
      .insert({
        date: now.slice(0, 10),
        type: 'commission',
        category: AUTH_CATEGORY,
        amount: 0,
        description: JSON.stringify(payload),
        source_file: AUTH_SOURCE_FILE,
      })
      .select('id')
      .single();
    if (insErr) {
      console.error('No se pudo crear usuario Suite:', insErr.message);
      process.exit(1);
    }
    console.log('\n=== Usuario Suite creado ===');
    console.log('username:', SUITE_USERNAME);
    console.log('password inicial:', password);
    console.log('id:', inserted.id);
    console.log('modules:', MODULES.join(', '));
    console.log('capabilities:', CAPABILITIES.join(', '));
    return;
  }

  const p = { ...user.payload };
  const nextModules = mergeUnique(p.modules, MODULES);
  const nextCaps = mergeUnique(p.capabilities, CAPABILITIES);
  const changed =
    JSON.stringify(nextModules) !== JSON.stringify(p.modules || []) ||
    JSON.stringify(nextCaps) !== JSON.stringify(p.capabilities || []) ||
    p.active === false;

  if (!changed) {
    console.log('\nUsuario @rodrigo ya tenía rrhh + rrhh.employees_edit');
    return;
  }

  p.modules = nextModules;
  p.capabilities = nextCaps;
  p.active = true;
  p.display_name = p.display_name || DISPLAY_NAME;
  p.updated_at = now;

  const { error: upErr } = await sb
    .from('financial_records')
    .update({ description: JSON.stringify(p), date: now.slice(0, 10) })
    .eq('id', user.id);
  if (upErr) {
    console.error('No se pudo actualizar usuario:', upErr.message);
    process.exit(1);
  }

  console.log('\n=== Usuario Suite actualizado ===');
  console.log('username:', SUITE_USERNAME);
  console.log('modules:', nextModules.join(', '));
  console.log('capabilities:', nextCaps.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
