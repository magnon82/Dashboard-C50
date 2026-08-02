/**
 * One-shot: semanas futuras (week_start > lunes ISO CDMX) → borrador.
 * Uso:
 *   node scripts/hr-future-weeks-to-borrador.mjs
 *   node scripts/hr-future-weeks-to-borrador.mjs --dry-run
 *   node scripts/hr-future-weeks-to-borrador.mjs --year=2026
 *
 * Requiere .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry-run');
const yearArg = process.argv.find((a) => a.startsWith('--year='));
const YEAR = yearArg
  ? Number(yearArg.slice('--year='.length))
  : new Date().getFullYear();

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

function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function todayCdmx() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const currentMon = mondayOf(todayCdmx());
const nowIso = new Date().toISOString();

console.log(
  DRY ? '[dry-run]' : '[apply]',
  `year=${YEAR}`,
  `currentMon=${currentMon}`,
  '→ futuras a borrador'
);

const { data: candidates, error: qErr } = await sb
  .from('hr_schedule_weeks')
  .select('id, week_start, week_end, status')
  .gte('week_start', `${YEAR}-01-01`)
  .lte('week_start', `${YEAR}-12-31`)
  .gt('week_start', currentMon)
  .neq('status', 'borrador')
  .order('week_start', { ascending: true });

if (qErr) {
  console.error(qErr.message);
  process.exit(1);
}

const rows = candidates || [];
console.log(`Candidatas: ${rows.length}`);
for (const w of rows) {
  console.log(`  ${w.week_start} … ${w.week_end}  ${w.status}`);
}

if (DRY || rows.length === 0) {
  process.exit(0);
}

const ids = rows.map((r) => r.id);
const { data: updated, error: uErr } = await sb
  .from('hr_schedule_weeks')
  .update({
    status: 'borrador',
    published_by: null,
    published_at: null,
    updated_at: nowIso,
  })
  .in('id', ids)
  .select('id, week_start, status');

if (uErr) {
  console.error(uErr.message);
  process.exit(1);
}

console.log(`Actualizadas a borrador: ${updated?.length ?? 0}`);
for (const w of updated || []) {
  console.log(`  ${w.week_start} → ${w.status}`);
}
