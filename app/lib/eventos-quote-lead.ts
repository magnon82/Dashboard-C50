import type { SupabaseClient } from '@supabase/supabase-js';
import { syncLeadFollowUpAfterQuote } from '@/app/lib/eventos-follow-up';

export type QuoteLeadResult = {
  leadId: string | null;
  leadCreated: boolean;
  followUpSynced?: boolean;
  error?: string;
};

const OPEN_LEAD_STAGES = [
  'nuevo',
  'contactado',
  'cotizado',
  'negociacion',
] as const;

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Al guardar cotización: crea o reutiliza lead CRM (campos del form «Nuevo lead»)
 * y escribe quote.lead_id.
 *
 * Dedup: lead_id ya en quote/body → lead abierto mismo client_id+event_date →
 * mismo phone/email+event_date. Evita duplicar al regenerar para el mismo evento.
 */
export async function ensureLeadForQuote(
  sb: SupabaseClient,
  opts: {
    quoteId: string;
    existingLeadId?: string | null;
    clientId: string;
    eventDate?: string | null;
    pax: number;
    celebration?: string | null;
    notes?: string | null;
    holdUntil?: string | null;
    total: number;
    ownerUsername: string;
    quoteNumber?: string | null;
  }
): Promise<QuoteLeadResult> {
  const now = new Date().toISOString();
  const existing = trimOrNull(opts.existingLeadId);

  const { data: client, error: clientErr } = await sb
    .from('event_clients')
    .select('id, company_name, contact_name, email, phone')
    .eq('id', opts.clientId)
    .maybeSingle();

  if (clientErr) {
    return {
      leadId: existing,
      leadCreated: false,
      error: clientErr.message,
    };
  }

  const company = trimOrNull(client?.company_name);
  const contactName =
    trimOrNull(client?.contact_name) || company || 'Contacto';
  const phone = trimOrNull(client?.phone);
  const email = trimOrNull(client?.email);
  const celebration =
    trimOrNull(opts.celebration) ||
    (opts.quoteNumber ? `Cotización ${opts.quoteNumber}` : null) ||
    company ||
    'Cotización eventos';

  const pax = Number(opts.pax);
  const total = Number(opts.total);
  let estimated: number | null = null;
  if (Number.isFinite(pax) && pax > 0 && Number.isFinite(total) && total > 0) {
    estimated = Math.round((total / pax) * 100) / 100;
  }

  const leadFields = {
    title: celebration,
    celebration,
    contact_name: contactName,
    phone,
    email,
    company,
    client_id: opts.clientId,
    event_date: opts.eventDate || null,
    pax: Number.isFinite(pax) && pax > 0 ? pax : null,
    estimated_amount: estimated,
    notes: trimOrNull(opts.notes),
    owner_username: opts.ownerUsername,
    updated_at: now,
    ...(opts.holdUntil ? { hold_until: opts.holdUntil } : {}),
  };

  async function linkQuote(leadId: string): Promise<string | undefined> {
    const { error: linkErr } = await sb
      .from('event_quotes')
      .update({ lead_id: leadId, updated_at: now })
      .eq('id', opts.quoteId);
    return linkErr?.message;
  }

  async function finishLead(
    leadId: string,
    leadCreated: boolean,
    linkError?: string
  ): Promise<QuoteLeadResult> {
    const fu = await syncLeadFollowUpAfterQuote(sb, leadId);
    const parts = [linkError, fu.error].filter(Boolean);
    return {
      leadId,
      leadCreated,
      followUpSynced: fu.updated,
      error: parts.length ? parts.join(' · ') : undefined,
    };
  }

  // 1) lead_id ya presente → actualizar datos y (si aplica) subir a cotizado
  if (existing) {
    const { data: cur } = await sb
      .from('event_leads')
      .select('id, stage')
      .eq('id', existing)
      .maybeSingle();
    if (cur?.id) {
      const stage =
        cur.stage === 'ganado' || cur.stage === 'perdido'
          ? cur.stage
          : cur.stage === 'nuevo' || cur.stage === 'contactado'
            ? 'cotizado'
            : cur.stage;
      await sb
        .from('event_leads')
        .update({ ...leadFields, stage })
        .eq('id', cur.id);
      const linkErr = await linkQuote(cur.id);
      return finishLead(
        cur.id,
        false,
        linkErr
          ? `Lead existente pero no se pudo vincular: ${linkErr}`
          : undefined
      );
    }
  }

  // 2) Lead abierto mismo cliente + fecha de evento
  let matchId: string | null = null;
  let matchStage: string | null = null;
  if (opts.eventDate) {
    const { data: byClient } = await sb
      .from('event_leads')
      .select('id, stage')
      .eq('client_id', opts.clientId)
      .eq('event_date', opts.eventDate)
      .in('stage', [...OPEN_LEAD_STAGES])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byClient?.id) {
      matchId = byClient.id;
      matchStage = byClient.stage;
    }
  }

  // 3) Mismo teléfono o correo + fecha (match en memoria)
  if (!matchId && opts.eventDate && (phone || email)) {
    const { data: candidates } = await sb
      .from('event_leads')
      .select('id, stage, phone, email')
      .eq('event_date', opts.eventDate)
      .in('stage', [...OPEN_LEAD_STAGES])
      .order('updated_at', { ascending: false })
      .limit(30);
    const byContact = (candidates || []).find(
      (row) =>
        (phone && trimOrNull(row.phone) === phone) ||
        (email &&
          trimOrNull(row.email)?.toLowerCase() === email.toLowerCase())
    );
    if (byContact?.id) {
      matchId = byContact.id;
      matchStage = byContact.stage;
    }
  }

  if (matchId) {
    const stage =
      matchStage === 'nuevo' || matchStage === 'contactado'
        ? 'cotizado'
        : matchStage || 'cotizado';
    const { error: updErr } = await sb
      .from('event_leads')
      .update({ ...leadFields, stage })
      .eq('id', matchId);
    if (updErr) {
      return {
        leadId: matchId,
        leadCreated: false,
        error: updErr.message,
      };
    }
    const linkErr = await linkQuote(matchId);
    return finishLead(
      matchId,
      false,
      linkErr
        ? `Lead reutilizado pero no se pudo vincular: ${linkErr}`
        : undefined
    );
  }

  // 4) Nuevo lead en etapa Cotizado (origen cotizador → alertas CRM)
  const { data: lead, error: leadErr } = await sb
    .from('event_leads')
    .insert({
      ...leadFields,
      stage: 'cotizado',
      source: 'cotizador',
      hold_until: opts.holdUntil || null,
      created_at: now,
    })
    .select('id')
    .single();

  if (leadErr || !lead) {
    return {
      leadId: null,
      leadCreated: false,
      error: leadErr?.message || 'No se pudo crear lead desde cotización',
    };
  }

  const linkErr = await linkQuote(lead.id);
  return finishLead(
    lead.id,
    true,
    linkErr
      ? `Lead creado pero no se pudo vincular a la cotización: ${linkErr}`
      : undefined
  );
}
