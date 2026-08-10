import { randomBytes } from 'crypto';
import type { getServiceSupabase } from '@/app/lib/users';
import {
  EVENTOS_SERVICIO_PCT,
  type QuoteLineOptions,
} from '@/app/lib/eventos';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';

export type EventosSb = ReturnType<typeof getServiceSupabase>;

/** Marcador en `notes` cuando el schema aún no tiene status/columnas perdida. */
export const PERDIDA_NOTES_MARKER = '⟦PERDIDA⟧';

export type PerdidaLegacyParsed = {
  perdida_at: string;
  perdida_note: string;
  notesRest: string | null;
};

/** Parsea cierre perdido guardado en notes (fallback pre-migración). */
export function parsePerdidaLegacyNotes(
  notes: string | null | undefined
): PerdidaLegacyParsed | null {
  const raw = String(notes || '');
  if (!raw.startsWith(PERDIDA_NOTES_MARKER)) return null;
  const body = raw.slice(PERDIDA_NOTES_MARKER.length).trim();
  const pipe = body.indexOf('|');
  if (pipe < 0) return null;
  const perdida_at = body.slice(0, pipe).trim();
  const after = body.slice(pipe + 1);
  const nl = after.indexOf('\n');
  const perdida_note = (nl < 0 ? after : after.slice(0, nl)).trim();
  const notesRest = (nl < 0 ? '' : after.slice(nl + 1)).trim();
  return {
    perdida_at,
    perdida_note,
    notesRest: notesRest || null,
  };
}

export function encodePerdidaLegacyNotes(
  perdidaAtIso: string,
  perdidaNote: string,
  previousNotes?: string | null
): string {
  const head = `${PERDIDA_NOTES_MARKER} ${perdidaAtIso} | ${perdidaNote.trim()}`;
  const prev = String(previousNotes || '').trim();
  // Evitar apilar marcadores si se re-guarda.
  const cleaned = prev
    .split('\n')
    .filter((line) => !line.includes(PERDIDA_NOTES_MARKER))
    .join('\n')
    .trim();
  return cleaned ? `${head}\n${cleaned}` : head;
}

/**
 * Hidrata status/perdida_* desde columnas reales o desde el marcador en notes.
 * Así la UI ve `perdida` aunque la BD aún solo tenga `rechazada` + notes.
 */
export function hydrateQuotePerdidaFields<T extends Record<string, unknown>>(
  row: T
): T & {
  status: string;
  perdida_note: string | null;
  perdida_at: string | null;
  notes: string | null;
} {
  const status = String(row.status || '');
  const notes = row.notes == null ? null : String(row.notes);
  if (status === 'perdida') {
    return {
      ...row,
      status,
      perdida_note:
        row.perdida_note == null ? null : String(row.perdida_note),
      perdida_at: row.perdida_at == null ? null : String(row.perdida_at),
      notes,
    };
  }
  const legacy = parsePerdidaLegacyNotes(notes);
  if (legacy && (status === 'rechazada' || status === 'vencida' || !status)) {
    return {
      ...row,
      status: 'perdida',
      perdida_note: legacy.perdida_note || null,
      perdida_at: legacy.perdida_at || null,
      notes: legacy.notesRest,
    };
  }
  return {
    ...row,
    status,
    perdida_note:
      row.perdida_note == null ? null : String(row.perdida_note),
    perdida_at: row.perdida_at == null ? null : String(row.perdida_at),
    notes,
  };
}

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
  perdida_note?: string | null;
  perdida_at?: string | null;
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
  const hydrated = hydrateQuotePerdidaFields(
    data as unknown as Record<string, unknown>
  );
  const client = (hydrated.client || null) as QuoteRowForDoc['client'];
  const lines = ((hydrated.lines || []) as NonNullable<QuoteRowForDoc['lines']>)
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      options: (l.options || {}) as QuoteLineOptions,
    }));

  return {
    quote_number: (hydrated.quote_number as string | null) || null,
    status: hydrated.status || null,
    client_name: client?.company_name || null,
    contact_name: client?.contact_name || null,
    phone: client?.phone || null,
    email: client?.email || null,
    celebration: (hydrated.celebration as string | null) || null,
    event_date: (hydrated.event_date as string | null) || null,
    pax: Number(hydrated.pax || 0),
    notes: hydrated.notes || null,
    apply_servicio: hydrated.apply_servicio !== false,
    servicio_pct: Number(hydrated.servicio_pct ?? EVENTOS_SERVICIO_PCT),
    hold_until: (hydrated.hold_until as string | null) || null,
    lines,
    issued_at:
      (hydrated.created_at as string | null) ||
      (hydrated.updated_at as string | null) ||
      null,
    accepted_at: (hydrated.accepted_at as string | null) || null,
    payment_method: (hydrated.payment_method as string | null) || null,
    client_accept_note: (hydrated.client_accept_note as string | null) || null,
    payment_link_url: (hydrated.payment_link_url as string | null) || null,
    perdida_note: hydrated.perdida_note || null,
    perdida_at: hydrated.perdida_at || null,
  };
}
