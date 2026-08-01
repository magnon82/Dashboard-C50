/**
 * Modelo de documento de cotización presentable (HTML / impresión PDF).
 */

import {
  EVENTOS_CONTACT,
  EVENTOS_HOLD_BUSINESS_HOURS,
  EVENTOS_SERVICIO_PCT,
  computeQuoteTotals,
  formatMxn,
  type QuoteLineOptions,
} from '@/app/lib/eventos';

export type CotizacionDocLine = {
  description: string;
  quantity: number;
  unit_price: number;
  unit?: string | null;
  options?: QuoteLineOptions | null;
};

export type CotizacionDoc = {
  quote_number: string | null;
  status?: string | null;
  client_name: string | null;
  contact_name?: string | null;
  celebration: string | null;
  event_date: string | null;
  pax: number;
  notes: string | null;
  apply_servicio: boolean;
  servicio_pct: number;
  hold_until: string | null;
  lines: CotizacionDocLine[];
  issued_at?: string | null;
};

export const COTIZACION_DRAFT_STORAGE_KEY = 'eventos_cotizacion_draft_v1';

export function buildCotizacionTotals(doc: CotizacionDoc) {
  return computeQuoteTotals(
    doc.lines,
    doc.apply_servicio,
    doc.servicio_pct ?? EVENTOS_SERVICIO_PCT
  );
}

export function formatEventDateEs(iso: string | null | undefined): string {
  if (!iso) return 'Por confirmar';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatIssuedAtEs(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function optionEntries(
  options: QuoteLineOptions | null | undefined
): Array<{ key: string; label: string; value: string }> {
  if (!options) return [];
  const labels: Record<string, string> = {
    plato_fuerte: 'Plato fuerte',
    entrada: 'Entrada',
    postre: 'Postre',
  };
  const order = ['entrada', 'plato_fuerte', 'postre'];
  const keys = [
    ...order.filter((k) => options[k]),
    ...Object.keys(options).filter((k) => !order.includes(k) && options[k]),
  ];
  return keys.map((key) => ({
    key,
    label: labels[key] || key.replace(/_/g, ' '),
    value: options[key],
  }));
}

export function holdNoteEs(holdUntil: string | null | undefined): string {
  if (!holdUntil) {
    return `Disponibilidad sujeta a confirmación. Hold estándar: ${EVENTOS_HOLD_BUSINESS_HOURS} h hábiles tras aceptar (no aplica si faltan menos de 15 días al evento).`;
  }
  const d = new Date(holdUntil);
  const when = Number.isNaN(d.getTime())
    ? holdUntil
    : d.toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  return `Hold de fecha hasta ${when} (${EVENTOS_HOLD_BUSINESS_HOURS} h hábiles).`;
}

export function shortTermsEs(): string[] {
  return [
    'Precios y disponibilidad sujetos a cambio hasta cubrir el 50 % de anticipo.',
    'El 50 % del total debe cubrirse 30 días naturales antes del evento; liquidación total 7 días antes.',
    'El volumen del audio no puede superar la música ambiente del restaurante.',
  ];
}

export { EVENTOS_CONTACT, formatMxn };
