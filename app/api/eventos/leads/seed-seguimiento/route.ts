import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import { LEAD_STAGES, type LeadStage } from '@/app/lib/eventos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SeedLead = {
  title: string;
  celebration?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  stage?: string;
  event_date?: string | null;
  pax?: number | null;
  notes?: string | null;
  owner_username?: string | null;
  source?: string;
};

type SeedFile = {
  leads?: SeedLead[];
};

const OPEN_STAGES = new Set([
  'nuevo',
  'contactado',
  'cotizado',
  'negociacion',
]);

function norm(s: string | null | undefined): string {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let digits = String(v).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
  return digits.length >= 7 ? digits : null;
}

function normalizeEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return s.includes('@') && !s.includes(' ') ? s : null;
}

function matchKeys(row: {
  client_id?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  title?: string | null;
  event_date?: string | null;
}): string[] {
  const ed = row.event_date || '';
  const phone = normalizePhone(row.phone) || '';
  const email = normalizeEmail(row.email) || '';
  const clientId = row.client_id || '';
  const contact = norm(row.contact_name || row.title || '');
  const keys: string[] = [];
  if (clientId && ed) keys.push(`c:${clientId}|d:${ed}`);
  if (phone && ed) keys.push(`p:${phone}|d:${ed}`);
  if (email && ed) keys.push(`e:${email}|d:${ed}`);
  if (contact && ed) keys.push(`n:${contact}|d:${ed}`);
  if (phone && !ed) keys.push(`p:${phone}|d:`);
  if (email && !ed) keys.push(`e:${email}|d:`);
  if (contact && !ed) keys.push(`n:${contact}|d:`);
  return keys;
}

/**
 * Importa leads desde supabase/seed_event_leads_seguimiento.json
 * (generado por scripts/seed_event_leads_from_seguimiento.py --json-only).
 * Idempotente: upsert por cliente/tel/email + fecha evento.
 * Requiere permiso de edición en Eventos (mismo patrón que clients/seed).
 */
export async function POST() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  try {
    const file = path.join(
      process.cwd(),
      'supabase',
      'seed_event_leads_seguimiento.json'
    );
    let raw: string;
    try {
      raw = await readFile(file, 'utf-8');
    } catch {
      return NextResponse.json(
        {
          error:
            'No existe seed_event_leads_seguimiento.json. Genera con: python scripts/seed_event_leads_from_seguimiento.py --json-only',
        },
        { status: 400 }
      );
    }

    const parsed = JSON.parse(raw) as SeedFile | SeedLead[];
    const rows = Array.isArray(parsed) ? parsed : parsed.leads || [];
    if (!rows.length) {
      return NextResponse.json({ error: 'Seed de leads vacío' }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const { data: clients, error: cErr } = await sb
      .from('event_clients')
      .select('id, company_name, contact_name, email, phone')
      .limit(5000);
    if (cErr) {
      return NextResponse.json({ error: cErr.message }, { status: 500 });
    }

    const byEmail = new Map<string, string>();
    const byPhone = new Map<string, string>();
    const byCompany = new Map<string, string>();
    const byContact = new Map<string, string>();
    for (const c of clients || []) {
      const e = normalizeEmail(c.email);
      if (e && !byEmail.has(e)) byEmail.set(e, c.id);
      const p = normalizePhone(c.phone);
      if (p && !byPhone.has(p)) byPhone.set(p, c.id);
      const cn = norm(c.company_name);
      if (cn && !byCompany.has(cn)) byCompany.set(cn, c.id);
      const ct = norm(c.contact_name);
      if (ct && !byContact.has(ct)) byContact.set(ct, c.id);
    }

    let leadsQuery = await sb
      .from('event_leads')
      .select(
        'id, client_id, phone, email, contact_name, title, event_date, stage, source, notes'
      )
      .limit(5000);

    let hasSourceCol = true;
    if (leadsQuery.error && /source/i.test(leadsQuery.error.message)) {
      hasSourceCol = false;
      // Fallback when `source` column is not yet migrated; widen type for assignability.
      leadsQuery = (await sb
        .from('event_leads')
        .select(
          'id, client_id, phone, email, contact_name, title, event_date, stage, notes'
        )
        .limit(5000)) as typeof leadsQuery;
    }
    if (leadsQuery.error) {
      return NextResponse.json({ error: leadsQuery.error.message }, { status: 500 });
    }

    type LeadRow = {
      id: string;
      client_id?: string | null;
      phone?: string | null;
      email?: string | null;
      contact_name?: string | null;
      title?: string | null;
      event_date?: string | null;
      stage?: string | null;
      source?: string | null;
      notes?: string | null;
    };

    const index = new Map<string, LeadRow>();
    for (const lead of (leadsQuery.data || []) as LeadRow[]) {
      const fromSheets =
        lead.source === 'sheets' ||
        (lead.notes || '').includes('Status Sheet:');
      const keys = matchKeys(lead);
      for (const k of keys) {
        if (!index.has(k) || fromSheets) index.set(k, lead);
      }
    }

    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;
    let matchedClients = 0;
    let skipped = 0;

    for (const r of rows) {
      const title = (r.title || '').trim();
      if (!title) {
        skipped += 1;
        continue;
      }
      const stage = (r.stage || 'nuevo') as LeadStage;
      if (!LEAD_STAGES.includes(stage)) {
        skipped += 1;
        continue;
      }

      const email = normalizeEmail(r.email);
      const phone = normalizePhone(r.phone);
      let clientId: string | null = null;
      if (email && byEmail.has(email)) clientId = byEmail.get(email)!;
      else if (phone && byPhone.has(phone)) clientId = byPhone.get(phone)!;
      else if (norm(r.company) && byCompany.has(norm(r.company)))
        clientId = byCompany.get(norm(r.company))!;
      else if (norm(r.contact_name) && byContact.has(norm(r.contact_name)))
        clientId = byContact.get(norm(r.contact_name))!;
      else if (norm(r.celebration) && byCompany.has(norm(r.celebration)))
        clientId = byCompany.get(norm(r.celebration))!;

      if (clientId) matchedClients += 1;

      const payload: Record<string, unknown> = {
        title: title.slice(0, 200),
        celebration: (r.celebration || title).trim(),
        contact_name: (r.contact_name || '').trim() || null,
        phone,
        email,
        company: (r.company || '').trim() || null,
        client_id: clientId,
        stage,
        event_date: r.event_date || null,
        pax: r.pax ?? null,
        notes: (r.notes || '').trim() || null,
        owner_username: (r.owner_username || auth.username || 'seguimiento')
          .toString()
          .slice(0, 80),
        updated_at: now,
      };
      if (hasSourceCol) payload.source = 'sheets';

      const keys = matchKeys({
        client_id: clientId,
        phone,
        email,
        contact_name: r.contact_name || title,
        title,
        event_date: r.event_date,
      });

      let existing: LeadRow | undefined;
      for (const k of keys) {
        if (index.has(k)) {
          existing = index.get(k);
          break;
        }
      }

      if (existing) {
        const fromSheets =
          existing.source === 'sheets' ||
          (existing.notes || '').includes('Status Sheet:');
        if (fromSheets || OPEN_STAGES.has(existing.stage || '')) {
          const { error } = await sb
            .from('event_leads')
            .update(payload)
            .eq('id', existing.id);
          if (error) {
            return NextResponse.json(
              { error: error.message, inserted, updated },
              { status: 500 }
            );
          }
          updated += 1;
          const merged = { ...existing, ...payload, id: existing.id } as LeadRow;
          for (const k of keys) index.set(k, merged);
        } else {
          skipped += 1;
        }
      } else {
        const { data, error } = await sb
          .from('event_leads')
          .insert({ ...payload, created_at: now })
          .select('id')
          .single();
        if (error) {
          return NextResponse.json(
            { error: error.message, inserted, updated },
            { status: 500 }
          );
        }
        inserted += 1;
        const fake = { ...payload, id: data.id } as LeadRow;
        for (const k of keys) index.set(k, fake);
      }
    }

    return NextResponse.json({
      inserted,
      updated,
      skipped,
      matchedClients,
      totalSeed: rows.length,
      hasSourceColumn: hasSourceCol,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : 'Error al importar leads desde Seguimiento',
      },
      { status: 500 }
    );
  }
}
