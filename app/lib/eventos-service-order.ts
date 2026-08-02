/**
 * Órdenes de servicio digitales — crear/actualizar desde cotización aceptada.
 * Coexiste con PDFs en Drive (listEventOs); no los reemplaza.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EVENTOS_SERVICIO_PCT,
  type QuoteLineOptions,
} from '@/app/lib/eventos';
import { syncLeadFollowUpAfterQuote } from '@/app/lib/eventos-follow-up';

export type ServiceOrderLine = {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  options: QuoteLineOptions;
};

export type ServiceOrderPayload = {
  lines: ServiceOrderLine[];
  quote_number?: string | null;
  source?: string;
  phone?: string | null;
  email?: string | null;
};

export const SERVICE_ORDER_STATUSES = [
  'borrador',
  'emitida',
  'en_curso',
  'cerrada',
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export type ServiceOrderRow = {
  id: string;
  os_number: string | null;
  status: string;
  quote_id: string | null;
  lead_id: string | null;
  client_id: string | null;
  event_date: string | null;
  pax: number | null;
  celebration: string | null;
  client_name: string | null;
  contact_name: string | null;
  /** Desde payload (snapshot al generar OS) */
  phone: string | null;
  email: string | null;
  notes: string | null;
  subtotal: number;
  servicio_pct: number;
  servicio_amount: number;
  total: number;
  apply_servicio: boolean;
  owner_username: string | null;
  payload: ServiceOrderPayload;
  created_at?: string;
  updated_at?: string;
};

export type CreateOsResult = {
  order: ServiceOrderRow | null;
  created: boolean;
  error?: string;
  hint?: string;
};

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isMissingTable(msg: string): boolean {
  return /does not exist|schema cache|relation .*event_service_orders|PGRST205/i.test(
    msg
  );
}

function buildOsNumber(eventDate: string | null, quoteNumber: string | null): string {
  const day = (eventDate || new Date().toISOString().slice(0, 10)).replace(
    /-/g,
    ''
  );
  const suffix = quoteNumber
    ? String(quoteNumber).replace(/^EVT-?/i, '').slice(-6)
    : String(Math.floor(Math.random() * 900 + 100));
  return `OS-${day}-${suffix}`;
}

function mapRow(raw: Record<string, unknown>): ServiceOrderRow {
  const payload =
    raw.payload && typeof raw.payload === 'object'
      ? (raw.payload as ServiceOrderPayload)
      : { lines: [] };
  return {
    id: String(raw.id),
    os_number: (raw.os_number as string | null) || null,
    status: String(raw.status || 'borrador'),
    quote_id: (raw.quote_id as string | null) || null,
    lead_id: (raw.lead_id as string | null) || null,
    client_id: (raw.client_id as string | null) || null,
    event_date: (raw.event_date as string | null) || null,
    pax: raw.pax != null ? Number(raw.pax) : null,
    celebration: (raw.celebration as string | null) || null,
    client_name: (raw.client_name as string | null) || null,
    contact_name: (raw.contact_name as string | null) || null,
    phone: trimOrNull(payload.phone) || (raw.phone as string | null) || null,
    email: trimOrNull(payload.email) || (raw.email as string | null) || null,
    notes: (raw.notes as string | null) || null,
    subtotal: Number(raw.subtotal || 0),
    servicio_pct: Number(raw.servicio_pct ?? EVENTOS_SERVICIO_PCT),
    servicio_amount: Number(raw.servicio_amount || 0),
    total: Number(raw.total || 0),
    apply_servicio: raw.apply_servicio !== false,
    owner_username: (raw.owner_username as string | null) || null,
    payload: {
      lines: Array.isArray(payload.lines) ? payload.lines : [],
      quote_number: payload.quote_number ?? null,
      source: payload.source,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
    },
    created_at: raw.created_at as string | undefined,
    updated_at: raw.updated_at as string | undefined,
  };
}

/**
 * Crea o reutiliza OS digital a partir de una cotización.
 * Idempotente por quote_id (unique parcial).
 * Si refresh=true y ya existe, actualiza snapshot desde la cotización.
 */
export async function createServiceOrderFromQuote(
  sb: SupabaseClient,
  opts: {
    quoteId: string;
    ownerUsername: string;
    /** Si ya hay OS, refrescar campos desde la cotización */
    refresh?: boolean;
    /** Marcar cotización como aceptada */
    markQuoteAccepted?: boolean;
    /** Subir lead vinculado a ganado */
    markLeadGanado?: boolean;
  }
): Promise<CreateOsResult> {
  const quoteId = opts.quoteId.trim();
  if (!quoteId) {
    return { order: null, created: false, error: 'quote_id requerido' };
  }

  const { data: quote, error: qErr } = await sb
    .from('event_quotes')
    .select(
      '*, lines:event_quote_lines(*), client:event_clients(id, company_name, contact_name, phone, email)'
    )
    .eq('id', quoteId)
    .maybeSingle();

  if (qErr) {
    return { order: null, created: false, error: qErr.message };
  }
  if (!quote) {
    return { order: null, created: false, error: 'Cotización no encontrada' };
  }

  const { data: existing, error: exErr } = await sb
    .from('event_service_orders')
    .select('*')
    .eq('quote_id', quoteId)
    .maybeSingle();

  if (exErr && isMissingTable(exErr.message)) {
    return {
      order: null,
      created: false,
      error: exErr.message,
      hint: 'Ejecuta supabase/eventos_service_orders.sql (o eventos_module.sql) en el SQL Editor de Supabase.',
    };
  }
  if (exErr) {
    return { order: null, created: false, error: exErr.message };
  }

  const client = quote.client as {
    company_name?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;

  const linesRaw = (
    (quote.lines as Array<{
      description: string;
      quantity: number;
      unit_price: number;
      line_total?: number;
      options?: QuoteLineOptions | null;
      sort_order?: number;
    }>) || []
  )
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  const lines: ServiceOrderLine[] = linesRaw.map((l) => {
    const qty = Number(l.quantity);
    const price = Number(l.unit_price);
    return {
      description: l.description,
      quantity: qty,
      unit_price: price,
      line_total:
        l.line_total != null
          ? Number(l.line_total)
          : Math.round(qty * price * 100) / 100,
      options: (l.options || {}) as QuoteLineOptions,
    };
  });

  const now = new Date().toISOString();
  const payload: ServiceOrderPayload = {
    lines,
    quote_number: quote.quote_number || null,
    source: 'quote',
    phone: trimOrNull(client?.phone),
    email: trimOrNull(client?.email),
  };

  const row = {
    quote_id: quoteId,
    lead_id: (quote.lead_id as string | null) || null,
    client_id: (quote.client_id as string | null) || null,
    os_number:
      (existing?.os_number as string | null) ||
      buildOsNumber(quote.event_date || null, quote.quote_number || null),
    status: (existing?.status as string) || 'emitida',
    event_date: quote.event_date || null,
    pax: quote.pax != null ? Number(quote.pax) : null,
    celebration: trimOrNull(quote.celebration),
    client_name: trimOrNull(client?.company_name),
    contact_name: trimOrNull(client?.contact_name),
    notes: trimOrNull(quote.notes),
    subtotal: Number(quote.subtotal || 0),
    servicio_pct: Number(quote.servicio_pct ?? EVENTOS_SERVICIO_PCT),
    servicio_amount: Number(quote.servicio_amount || 0),
    total: Number(quote.total || 0),
    apply_servicio: quote.apply_servicio !== false,
    owner_username: opts.ownerUsername || (quote.owner_username as string) || null,
    payload,
    updated_at: now,
  };

  let order: ServiceOrderRow | null = null;
  let created = false;

  if (existing?.id) {
    if (opts.refresh !== false) {
      const { data, error } = await sb
        .from('event_service_orders')
        .update(row)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) {
        return { order: null, created: false, error: error.message };
      }
      order = mapRow(data as Record<string, unknown>);
    } else {
      order = mapRow(existing as Record<string, unknown>);
    }
  } else {
    const { data, error } = await sb
      .from('event_service_orders')
      .insert({ ...row, created_at: now })
      .select('*')
      .single();
    if (error) {
      if (isMissingTable(error.message)) {
        return {
          order: null,
          created: false,
          error: error.message,
          hint: 'Ejecuta supabase/eventos_service_orders.sql en el SQL Editor de Supabase.',
        };
      }
      // Carrera: unique quote_id → reutilizar
      if (/unique|duplicate/i.test(error.message)) {
        const { data: again } = await sb
          .from('event_service_orders')
          .select('*')
          .eq('quote_id', quoteId)
          .maybeSingle();
        if (again) {
          order = mapRow(again as Record<string, unknown>);
        } else {
          return { order: null, created: false, error: error.message };
        }
      } else {
        return { order: null, created: false, error: error.message };
      }
    } else {
      order = mapRow(data as Record<string, unknown>);
      created = true;
    }
  }

  if (opts.markQuoteAccepted !== false && quote.status !== 'aceptada') {
    await sb
      .from('event_quotes')
      .update({ status: 'aceptada', updated_at: now })
      .eq('id', quoteId);
  }

  const leadId = (quote.lead_id as string | null) || null;
  if (opts.markLeadGanado !== false && leadId) {
    await sb
      .from('event_leads')
      .update({ stage: 'ganado', updated_at: now })
      .eq('id', leadId)
      .neq('stage', 'perdido');
    // Checklist: cotización hecha + cierre operativo (OS generada)
    await syncLeadFollowUpAfterQuote(sb, leadId, {
      extraSteps: ['cierre'],
    });
  } else if (leadId) {
    await syncLeadFollowUpAfterQuote(sb, leadId);
  }

  return { order, created };
}

/**
 * Actualiza campos operativos de una OS digital (status, notes).
 */
export async function updateServiceOrder(
  sb: SupabaseClient,
  id: string,
  patch: {
    status?: string;
    notes?: string | null;
  }
): Promise<{
  order: ServiceOrderRow | null;
  error?: string;
  hint?: string;
}> {
  const osId = id.trim();
  if (!osId) return { order: null, error: 'id requerido' };

  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) {
    if (
      !(SERVICE_ORDER_STATUSES as readonly string[]).includes(patch.status)
    ) {
      return { order: null, error: 'status inválido' };
    }
    row.status = patch.status;
  }
  if (patch.notes !== undefined) {
    row.notes = trimOrNull(patch.notes);
  }

  if (Object.keys(row).length <= 1) {
    return { order: null, error: 'Nada que actualizar' };
  }

  const { data, error } = await sb
    .from('event_service_orders')
    .update(row)
    .eq('id', osId)
    .select('*')
    .single();

  if (error) {
    return {
      order: null,
      error: error.message,
      hint: isMissingTable(error.message)
        ? 'Ejecuta supabase/eventos_service_orders.sql en el SQL Editor de Supabase.'
        : undefined,
    };
  }
  return { order: mapRow(data as Record<string, unknown>) };
}

/**
 * Busca la mejor cotización del lead (aceptada > enviada > borrador) y genera OS.
 */
export async function createServiceOrderFromLead(
  sb: SupabaseClient,
  opts: {
    leadId: string;
    ownerUsername: string;
  }
): Promise<CreateOsResult> {
  const leadId = opts.leadId.trim();
  if (!leadId) {
    return { order: null, created: false, error: 'lead_id requerido' };
  }

  // ¿Ya hay OS para este lead?
  const { data: existingOs, error: exErr } = await sb
    .from('event_service_orders')
    .select('*')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exErr && isMissingTable(exErr.message)) {
    return {
      order: null,
      created: false,
      error: exErr.message,
      hint: 'Ejecuta supabase/eventos_service_orders.sql en el SQL Editor de Supabase.',
    };
  }

  if (existingOs?.id) {
    return {
      order: mapRow(existingOs as Record<string, unknown>),
      created: false,
    };
  }

  const { data: quotes, error: qErr } = await sb
    .from('event_quotes')
    .select('id, status, updated_at')
    .eq('lead_id', leadId)
    .neq('status', 'rechazada')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (qErr) {
    return { order: null, created: false, error: qErr.message };
  }
  if (!quotes?.length) {
    return {
      order: null,
      created: false,
      error: 'El lead no tiene cotización vinculada para generar OS',
    };
  }

  const rank: Record<string, number> = {
    aceptada: 4,
    enviada: 3,
    borrador: 2,
    vencida: 1,
  };
  const best = [...quotes].sort(
    (a, b) =>
      (rank[String(b.status)] || 0) - (rank[String(a.status)] || 0)
  )[0];

  return createServiceOrderFromQuote(sb, {
    quoteId: String(best.id),
    ownerUsername: opts.ownerUsername,
    markQuoteAccepted: true,
    markLeadGanado: true,
  });
}

export async function getServiceOrderById(
  sb: SupabaseClient,
  id: string
): Promise<{ order: ServiceOrderRow | null; error?: string; hint?: string }> {
  const { data, error } = await sb
    .from('event_service_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return {
      order: null,
      error: error.message,
      hint: isMissingTable(error.message)
        ? 'Ejecuta supabase/eventos_service_orders.sql en el SQL Editor de Supabase.'
        : undefined,
    };
  }
  if (!data) return { order: null, error: 'OS no encontrada' };
  return { order: mapRow(data as Record<string, unknown>) };
}

export async function listDigitalServiceOrders(
  sb: SupabaseClient,
  opts?: { year?: number; q?: string }
): Promise<{
  items: ServiceOrderRow[];
  error?: string;
  ready: boolean;
}> {
  const { data, error } = await sb
    .from('event_service_orders')
    .select('*')
    .order('event_date', { ascending: false })
    .limit(400);

  if (error) {
    if (isMissingTable(error.message)) {
      return { items: [], ready: false, error: error.message };
    }
    return { items: [], ready: false, error: error.message };
  }

  let items = (data || []).map((r) => mapRow(r as Record<string, unknown>));

  if (opts?.year) {
    const y = String(opts.year);
    items = items.filter((it) => (it.event_date || '').startsWith(y));
  }
  if (opts?.q?.trim()) {
    const needle = opts.q.trim().toLowerCase();
    items = items.filter((it) => {
      const hay = [
        it.os_number,
        it.client_name,
        it.celebration,
        it.contact_name,
        it.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  return { items, ready: true };
}
