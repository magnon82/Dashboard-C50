/**
 * Exime documentación de alta para socios/colaboradores sin expediente.
 * Uso: node scripts/update-socios-sin-docs.mjs
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const NAMES = [
  {
    label: 'David Campos',
    match: (t) => t.has('david') && t.has('campos'),
    patchNotes: (notes) => ensureFlag(notes, 'sin_vacaciones'),
    puesto: 'Socios',
    area: 'Administración',
  },
  {
    label: 'Diego Olvera',
    match: (t) => t.has('diego') && t.has('olvera'),
    patchNotes: (notes) => ensureFlag(notes, 'externo'),
    puesto: null,
    area: null,
  },
  {
    label: 'Juan Manuel Mondragón',
    match: (t) => t.has('juan') && t.has('manuel'),
    patchNotes: (notes) => ensureFlag(notes, 'sin_vacaciones'),
    puesto: 'Socios',
    area: 'Administración',
  },
  {
    label: 'Sergio Mañón',
    match: (t) =>
      t.has('sergio') &&
      (t.has('manon') || t.has('namon') || t.has('manion')) &&
      !t.has('loera'),
    patchNotes: (notes) => ensureFlag(notes, 'sin_vacaciones'),
    puesto: 'Socios',
    area: 'Administración',
  },
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

function tokens(fullName) {
  return new Set(
    String(fullName || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  );
}

function ensureFlag(notes, flag) {
  const n = String(notes || '').trim();
  if (n.toLowerCase().includes(flag.toLowerCase())) return n || `${flag}.`;
  return n ? `${flag}. ${n}` : `${flag}.`;
}

async function main() {
  const env = loadEnv();
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: emps, error } = await sb
    .from('hr_employees')
    .select('id, full_name, notes, puesto, area');
  if (error) throw error;

  for (const target of NAMES) {
    const hit = (emps || []).find((e) => target.match(tokens(e.full_name)));
    if (!hit) {
      console.warn(`No encontrado: ${target.label}`);
      continue;
    }
    const patch = {
      notes: target.patchNotes(hit.notes),
      updated_at: new Date().toISOString(),
    };
    if (target.puesto) patch.puesto = target.puesto;
    if (target.area) patch.area = target.area;

    const { data, error: upErr } = await sb
      .from('hr_employees')
      .update(patch)
      .eq('id', hit.id)
      .select('id, full_name, puesto, notes')
      .single();
    if (upErr) {
      console.error(`${target.label}:`, upErr.message);
      continue;
    }
    console.log(`OK ${data.full_name} · puesto=${data.puesto || '—'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
