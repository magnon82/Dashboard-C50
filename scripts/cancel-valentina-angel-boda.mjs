/**
 * Marca BODA VALENTINA Y ANGEL (2027-06-12) como cancelada + nota de reembolso.
 * Uso: node scripts/cancel-valentina-angel-boda.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TITLE = 'BODA VALENTINA Y ANGEL';
const EVENT_DATE = '2027-06-12';
const NOTE =
  'Cancelado. Se le realizó el reembolso del anticipo.';

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

async function main() {
  loadEnvLocal();
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  // Idempotente: lead existente por título + fecha
  const { data: existingLeads, error: findErr } = await sb
    .from('event_leads')
    .select('id, title, stage, notes, event_date')
    .eq('event_date', EVENT_DATE)
    .ilike('title', TITLE);
  if (findErr) throw findErr;

  let leadId = existingLeads?.[0]?.id || null;
  if (leadId) {
    const prevNotes = existingLeads[0].notes || '';
    const notes = prevNotes.includes('reembolso del anticipo')
      ? prevNotes
      : [prevNotes.trim(), NOTE].filter(Boolean).join('\n');
    const { error } = await sb
      .from('event_leads')
      .update({
        stage: 'perdido',
        celebration: TITLE,
        company: TITLE,
        notes,
        updated_at: now,
      })
      .eq('id', leadId);
    if (error) throw error;
    console.log('Lead actualizado:', leadId);
  } else {
    const { data, error } = await sb
      .from('event_leads')
      .insert({
        title: TITLE,
        celebration: TITLE,
        company: TITLE,
        event_date: EVENT_DATE,
        stage: 'perdido',
        notes: NOTE,
        updated_at: now,
      })
      .select('id')
      .single();
    if (error) throw error;
    leadId = data.id;
    console.log('Lead creado:', leadId);
  }

  const { data: existingBookings, error: bFindErr } = await sb
    .from('event_bookings')
    .select('id, status, notes, lead_id')
    .eq('event_date', EVENT_DATE)
    .eq('lead_id', leadId);
  if (bFindErr) throw bFindErr;

  if (existingBookings?.length) {
    const { error } = await sb
      .from('event_bookings')
      .update({
        status: 'cancelado',
        notes: NOTE,
        updated_at: now,
      })
      .eq('id', existingBookings[0].id);
    if (error) throw error;
    console.log('Booking actualizado:', existingBookings[0].id);
  } else {
    const { data, error } = await sb
      .from('event_bookings')
      .insert({
        lead_id: leadId,
        event_date: EVENT_DATE,
        status: 'cancelado',
        notes: NOTE,
        updated_at: now,
      })
      .select('id')
      .single();
    if (error) throw error;
    console.log('Booking creado:', data.id);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        title: TITLE,
        event_date: EVENT_DATE,
        lead_id: leadId,
        lead_stage: 'perdido',
        booking_status: 'cancelado',
        notes: NOTE,
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
