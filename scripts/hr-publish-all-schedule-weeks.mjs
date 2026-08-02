/**
 * One-shot: marca todas las semanas de `hr_schedule_weeks` como `publicado`.
 * Uso: node scripts/hr-publish-all-schedule-weeks.mjs
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

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
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { count: total, error: totalErr } = await sb
    .from('hr_schedule_weeks')
    .select('id', { count: 'exact', head: true });
  if (totalErr) {
    console.error('Error contando semanas:', totalErr.message);
    process.exit(1);
  }

  const { count: already, error: alreadyErr } = await sb
    .from('hr_schedule_weeks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'publicado');
  if (alreadyErr) {
    console.error('Error contando publicadas:', alreadyErr.message);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('hr_schedule_weeks')
    .update({
      status: 'publicado',
      published_by: 'system-publish-all',
      published_at: nowIso,
      updated_at: nowIso,
    })
    .neq('status', 'publicado')
    .select('id, week_start, status');

  if (error) {
    console.error('Error actualizando:', error.message);
    process.exit(1);
  }

  const updated = data?.length ?? 0;
  console.log(
    JSON.stringify(
      {
        totalWeeks: total ?? 0,
        alreadyPublicado: already ?? 0,
        updatedToPublicado: updated,
        sample: (data || []).slice(0, 10).map((r) => ({
          id: r.id,
          week_start: r.week_start,
        })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
