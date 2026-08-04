/**
 * Folio de cotización (cliente): COT-YYYY-### secuencial por año CDMX.
 * Independiente del folio de OS (os_number) y de folios legacy EVT-….
 */

import { mexicoTodayIso } from '@/app/lib/eventos';
import type { getServiceSupabase } from '@/app/lib/users';

export type EventosSb = ReturnType<typeof getServiceSupabase>;

/** Prefijo + año civil CDMX + secuencia (mín. 3 dígitos). Ej. COT-2026-017 */
export const QUOTE_FOLIO_PREFIX = 'COT';

export function quoteFolioYear(from = new Date()): number {
  return Number(mexicoTodayIso(from).slice(0, 4));
}

export function formatQuoteFolio(year: number, seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  return `${QUOTE_FOLIO_PREFIX}-${year}-${String(n).padStart(3, '0')}`;
}

/** Parsea COT-YYYY-N; null si no es folio de cotización nuevo. */
export function parseQuoteFolio(
  value: string | null | undefined
): { year: number; seq: number } | null {
  if (!value) return null;
  const m = String(value)
    .trim()
    .match(/^COT-(\d{4})-(\d+)$/i);
  if (!m) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
}

export function isAssignedQuoteFolio(value: string | null | undefined): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  // Folios nuevos COT-… o legacy EVT-… ya guardados
  return /^COT-\d{4}-\d+$/i.test(v) || /^EVT-/i.test(v);
}

/**
 * Siguiente folio COT-YYYY-### del año CDMX (consulta máximas secuencias).
 * Reintentar en el caller si hay colisión unique.
 */
export async function allocateNextQuoteFolio(
  sb: EventosSb,
  from = new Date()
): Promise<string> {
  const year = quoteFolioYear(from);
  const prefix = `${QUOTE_FOLIO_PREFIX}-${year}-`;

  const { data, error } = await sb
    .from('event_quotes')
    .select('quote_number')
    .like('quote_number', `${prefix}%`)
    .limit(500);

  let max = 0;
  if (!error) {
    for (const row of data || []) {
      const parsed = parseQuoteFolio(
        (row as { quote_number?: string | null }).quote_number
      );
      if (parsed && parsed.year === year) {
        max = Math.max(max, parsed.seq);
      }
    }
  }

  return formatQuoteFolio(year, max + 1);
}

/**
 * Si la cotización no tiene folio, asigna uno COT-… y lo persiste.
 * No toca folios EVT- legacy ni os_number.
 */
export async function ensureQuoteFolio(
  sb: EventosSb,
  quoteId: string,
  existing?: string | null
): Promise<string | null> {
  if (isAssignedQuoteFolio(existing)) return String(existing).trim();

  for (let attempt = 0; attempt < 5; attempt++) {
    const folio = await allocateNextQuoteFolio(sb);
    const { data, error } = await sb
      .from('event_quotes')
      .update({
        quote_number: folio,
        updated_at: new Date().toISOString(),
      })
      .eq('id', quoteId)
      .is('quote_number', null)
      .select('quote_number')
      .maybeSingle();

    if (error) {
      // Columna ausente / unique race → re-leer
      const { data: again } = await sb
        .from('event_quotes')
        .select('quote_number')
        .eq('id', quoteId)
        .maybeSingle();
      if (isAssignedQuoteFolio(again?.quote_number)) {
        return String(again!.quote_number).trim();
      }
      if (/quote_number|schema cache|column/i.test(error.message)) {
        return null;
      }
      continue;
    }

    if (data?.quote_number) return String(data.quote_number);

    const { data: current } = await sb
      .from('event_quotes')
      .select('quote_number')
      .eq('id', quoteId)
      .maybeSingle();
    if (isAssignedQuoteFolio(current?.quote_number)) {
      return String(current!.quote_number).trim();
    }
    // Filas con quote_number = '' (no null): forzar update
    if (current && !isAssignedQuoteFolio(current.quote_number)) {
      const { data: forced, error: forceErr } = await sb
        .from('event_quotes')
        .update({
          quote_number: folio,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quoteId)
        .select('quote_number')
        .maybeSingle();
      if (!forceErr && forced?.quote_number) {
        return String(forced.quote_number);
      }
    }
  }

  return null;
}
