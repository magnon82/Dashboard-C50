import { randomBytes } from 'crypto';
import type { getServiceSupabase } from '@/app/lib/users';
import {
  EVENTOS_SERVICIO_PCT,
  type QuoteLineOptions,
} from '@/app/lib/eventos';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';

export type EventosSb = ReturnType<typeof getServiceSupabase>;

/** Path público compartible (sin login). */
export function publicQuotePath(token: string): string {
  return `/c/${encodeURIComponent(token)}`;
}

export function generateQuotePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

const MISSING_TOKEN_COL =
  /public_token|schema cache|column/i;

export async function ensureQuotePublicToken(
  sb: EventosSb,
  quoteId: string,
  existing?: string | null
): Promise<string | null> {
  if (existing && existing.trim()) return existing.trim();

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateQuotePublicToken();
    const { data, error } = await sb
      .from('event_quotes')
      .update({ public_token: token, updated_at: new Date().toISOString() })
      .eq('id', quoteId)
      .is('public_token', null)
      .select('public_token')
      .maybeSingle();

    if (error) {
      if (MISSING_TOKEN_COL.test(error.message)) return null;
      // Unique race → re-read
      const { data: again } = await sb
        .from('event_quotes')
        .select('public_token')
        .eq('id', quoteId)
        .maybeSingle();
      if (again?.public_token) return String(again.public_token);
      continue;
    }

    if (data?.public_token) return String(data.public_token);

    const { data: current } = await sb
      .from('event_quotes')
      .select('public_token')
      .eq('id', quoteId)
      .maybeSingle();
    if (current?.public_token) return String(current.public_token);
  }

  return null;
}

/** Invalida el enlace anterior y crea uno nuevo (opaco). */
export async function regenerateQuotePublicToken(
  sb: EventosSb,
  quoteId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateQuotePublicToken();
    const { data, error } = await sb
      .from('event_quotes')
      .update({ public_token: token, updated_at: new Date().toISOString() })
      .eq('id', quoteId)
      .select('public_token')
      .maybeSingle();

    if (error) {
      if (MISSING_TOKEN_COL.test(error.message)) return null;
      continue;
    }
    if (data?.public_token) return String(data.public_token);
  }
  return null;
}

/** Desactiva el enlace público (el token deja de resolver). */
export async function revokeQuotePublicToken(
  sb: EventosSb,
  quoteId: string
): Promise<{ ok: boolean; missingColumn?: boolean }> {
  const { error } = await sb
    .from('event_quotes')
    .update({ public_token: null, updated_at: new Date().toISOString() })
    .eq('id', quoteId);

  if (error) {
    if (MISSING_TOKEN_COL.test(error.message)) {
      return { ok: false, missingColumn: true };
    }
    return { ok: false };
  }
  return { ok: true };
}

type QuoteRowForDoc = {
  quote_number?: string | null;
  status?: string | null;
  celebration?: string | null;
  event_date?: string | null;
  pax?: number | null;
  notes?: string | null;
  apply_servicio?: boolean | null;
  servicio_pct?: number | null;
  hold_until?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  accepted_at?: string | null;
  payment_method?: string | null;
  client_accept_note?: string | null;
  payment_link_url?: string | null;
  client?: {
    company_name?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  lines?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    options?: QuoteLineOptions | null;
    sort_order?: number;
  }> | null;
};

/** Documento presentable (público o interno) a partir del row de Supabase. */
export function buildCotizacionDocFromQuoteRow(
  data: QuoteRowForDoc
): CotizacionDoc {
  const client = data.client || null;
  const lines = (data.lines || [])
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      options: (l.options || {}) as QuoteLineOptions,
    }));

  return {
    quote_number: data.quote_number || null,
    status: data.status || null,
    client_name: client?.company_name || null,
    contact_name: client?.contact_name || null,
    phone: client?.phone || null,
    email: client?.email || null,
    celebration: data.celebration || null,
    event_date: data.event_date || null,
    pax: Number(data.pax || 0),
    notes: data.notes || null,
    apply_servicio: data.apply_servicio !== false,
    servicio_pct: Number(data.servicio_pct ?? EVENTOS_SERVICIO_PCT),
    hold_until: data.hold_until || null,
    lines,
    issued_at: data.created_at || data.updated_at || null,
    accepted_at: data.accepted_at || null,
    payment_method: data.payment_method || null,
    client_accept_note: data.client_accept_note || null,
    payment_link_url: data.payment_link_url || null,
  };
}
