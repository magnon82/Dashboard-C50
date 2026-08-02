/**
 * One-shot: marca leads abiertos de Eventos como stage=perdido.
 * Criterio Tablero: stage NOT IN ('ganado','perdido').
 * Uso: node scripts/close-open-event-leads.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAG = 'closed_bulk_2026-08-01';
const PAGE = 1000;

function loadEnvLocal() {
  const envPath = resolve(root, '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function appendFlag(notes) {
  const raw = (notes || '').trim();
  if (!raw) return `[${FLAG}]`;
  if (raw.includes(FLAG)) return notes;
  return `${notes}\n[${FLAG}]`;
}

async function countByStage(sb) {
  const { data, error } = await sb.from('event_leads').select('stage');
  if (error) throw error;
  const by = {};
  let open = 0;
  for (const row of data || []) {
    by[row.stage] = (by[row.stage] || 0) + 1;
    if (row.stage !== 'ganado' && row.stage !== 'perdido') open += 1;
  }
  return { total: (data || []).length, open, by };
}

async function fetchOpenLeads(sb) {
  const rows = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await sb
      .from('event_leads')
      .select('id, notes, stage')
      .not('stage', 'in', '(ganado,perdido)')
      .range(from, to);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  loadEnvLocal();
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const before = await countByStage(sb);
  console.log('ANTES:', JSON.stringify(before));

  const open = await fetchOpenLeads(sb);
  console.log(`Leads abiertos a cerrar: ${open.length}`);

  let updated = 0;
  const now = new Date().toISOString();
  const CONCURRENCY = 25;
  for (let i = 0; i < open.length; i += CONCURRENCY) {
    const chunk = open.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((lead) =>
        sb
          .from('event_leads')
          .update({
            stage: 'perdido',
            notes: appendFlag(lead.notes),
            updated_at: now,
          })
          .eq('id', lead.id)
          .not('stage', 'in', '(ganado,perdido)')
      )
    );
    for (const r of results) {
      if (r.error) throw r.error;
      updated += 1;
    }
    console.log(`Progreso: ${updated}/${open.length}`);
  }

  const after = await countByStage(sb);
  console.log('DESPUÉS:', JSON.stringify(after));
  console.log(`Actualizados: ${updated}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
