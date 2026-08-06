/**
 * One-shot: actualiza ROMAN SANCHEZ (doble rol limpieza matutina + mesero encargado).
 * Uso: node scripts/update-roman-sanchez-dual-role.mjs
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Preferencia guardada:
 *   puesto: Mesero encargado
 *   puestos_secundarios: ['Limpieza']  (si la columna existe)
 *   area:   Piso
 *   notes:  dual_limpieza_mesero + descripción (mañana limpieza / tarde-noche mesero)
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const CANONICAL_NAME = 'ROMAN SANCHEZ';
const PUESTO = 'Mesero encargado';
const PUESTOS_SECUNDARIOS = ['Limpieza'];
const AREA = 'Piso';
const NOTES =
  'dual_limpieza_mesero. También limpieza matutina; mesero encargado tardes/noches.';

const SEARCH_NAMES = [
  'ROMAN SANCHEZ',
  'Roman Sanchez',
  'Román Sánchez',
  'ROMÁN SÁNCHEZ',
  'Sanchez Roman',
  'Sánchez Román',
  'Juan Roman Sanchez',
  'JUAN ROMAN SANCHEZ',
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

function fuzzyMatch(fullName) {
  const k = normalizePersonName(fullName);
  const targets = SEARCH_NAMES.map(normalizePersonName);
  if (targets.includes(k)) return true;
  const tokens = new Set(k.split(' '));
  // Roman + Sanchez (evita solo "Sanchez" genérico)
  if (tokens.has('roman') && tokens.has('sanchez')) return true;
  return false;
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

  const { data: emps, error } = await sb
    .from('hr_employees')
    .select(
      'id, full_name, status, puesto, puestos_secundarios, area, notes, force_include, force_exclude, fecha_ingreso, suite_username'
    );
  if (error && /puestos_secundarios|42703/i.test(error.message)) {
    console.warn(
      'Columna puestos_secundarios ausente — aplica supabase/hr_employee_puestos.sql'
    );
  }
  if (error && !/puestos_secundarios|42703/i.test(error.message)) {
    console.error('Error listando hr_employees:', error.message);
    process.exit(1);
  }

  let list = emps;
  if (error) {
    const retry = await sb
      .from('hr_employees')
      .select(
        'id, full_name, status, puesto, area, notes, force_include, force_exclude, fecha_ingreso, suite_username'
      );
    if (retry.error) {
      console.error('Error listando hr_employees:', retry.error.message);
      process.exit(1);
    }
    list = retry.data;
  }

  const hits = (list || []).filter((e) => fuzzyMatch(e.full_name));
  console.log('Coincidencias:', hits.length);
  for (const h of hits) {
    console.log(
      ' -',
      h.id,
      h.full_name,
      '|',
      h.puesto,
      '/',
      h.area,
      '|',
      h.status
    );
  }

  const patch = {
    full_name: CANONICAL_NAME,
    puesto: PUESTO,
    puestos_secundarios: PUESTOS_SECUNDARIOS,
    area: AREA,
    notes: NOTES,
    status: 'activo',
    force_exclude: false,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (hits.length === 0) {
    console.log('No existe en DB → insert activo con doble rol');
    const { data, error: insErr } = await sb
      .from('hr_employees')
      .insert({
        ...patch,
        source: 'manual',
        force_include: true,
      })
      .select()
      .single();
    if (insErr && /puestos_secundarios|42703/i.test(insErr.message)) {
      delete patch.puestos_secundarios;
      const again = await sb
        .from('hr_employees')
        .insert({
          ...patch,
          source: 'manual',
          force_include: true,
        })
        .select()
        .single();
      if (again.error) {
        console.error('Insert falló:', again.error.message);
        process.exit(1);
      }
      result = again.data;
    } else if (insErr) {
      console.error('Insert falló:', insErr.message);
      process.exit(1);
    } else {
      result = data;
    }
  } else if (hits.length === 1) {
    const id = hits[0].id;
    const { data, error: upErr } = await sb
      .from('hr_employees')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (upErr && /puestos_secundarios|42703/i.test(upErr.message)) {
      delete patch.puestos_secundarios;
      const again = await sb
        .from('hr_employees')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (again.error) {
        console.error('Update falló:', again.error.message);
        process.exit(1);
      }
      result = again.data;
      console.warn(
        'Actualizado sin puestos_secundarios — aplica supabase/hr_employee_puestos.sql'
      );
    } else if (upErr) {
      console.error('Update falló:', upErr.message);
      process.exit(1);
    } else {
      result = data;
    }
  } else {
    console.error(
      'Varias coincidencias; revisa a mano:',
      hits.map((h) => h.full_name)
    );
    process.exit(2);
  }

  console.log('Empleado guardado:', JSON.stringify(result, null, 2));
  console.log('Flag dual:', NOTES.includes('dual_limpieza_mesero') ? 'sí' : 'no');
  console.log(
    'En Horarios debe verse en Meseros + Limpieza (dos filas dual).'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
