/** Reglas y tipos del módulo operativo Eventos (no confundir con Ventas WI/Eventos). */

export const EVENTOS_SERVICIO_PCT = 0.15;
export const EVENTOS_HOLD_BUSINESS_HOURS = 72;
export const EVENTOS_NO_HOLD_WITHIN_DAYS = 15;
export const EVENTOS_MIN_PAX_GRUPOS = 10;
export const EVENTOS_DESAYUNOS_PACK_MIN_PAX = 50;
export const EVENTOS_DESAYUNOS_PACK_PRICE = 30_000;

export const LEAD_STAGES = [
  'nuevo',
  'contactado',
  'cotizado',
  'negociacion',
  'ganado',
  'perdido',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  cotizado: 'Cotizado',
  negociacion: 'Negociación',
  ganado: 'Ganado',
  perdido: 'Perdido',
};

export type EventClient = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  source: string;
  owner_username: string | null;
  created_at: string;
  updated_at: string;
  /** Enrichment from seed_event_client_activity.json (OS / Sheets). */
  last_activity_at?: string | null;
  last_activity_source?: string | null;
  activity_count?: number;
  activity_timeline?: Array<{
    date: string;
    source: string;
    label?: string | null;
    detail?: string | null;
    folio?: string | null;
  }>;
};

export type EventLead = {
  id: string;
  client_id: string | null;
  title: string;
  stage: LeadStage;
  event_date: string | null;
  pax: number | null;
  estimated_amount: number | null;
  owner_username: string | null;
  notes: string | null;
  hold_until: string | null;
  hold_extended_by: string | null;
  created_at: string;
  updated_at: string;
  client?: EventClient | null;
};

export type EventMenu = {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
  min_pax: number | null;
  requires_food: boolean;
  includes_servicio: boolean;
  active: boolean;
  sort_order: number;
  notes: string | null;
  items?: EventMenuItem[];
};

export type EventMenuItem = {
  id: string;
  menu_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  unit_price: number;
  min_pax: number | null;
  is_vegetarian: boolean;
  active: boolean;
  sort_order: number;
  price_source: string | null;
  price_verified: boolean;
};

export type QuoteLineInput = {
  menu_item_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
};

export type QuoteTotals = {
  subtotal: number;
  servicioPct: number;
  servicioAmount: number;
  total: number;
  applyServicio: boolean;
};

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeQuoteTotals(
  lines: QuoteLineInput[],
  applyServicio = true,
  servicioPct = EVENTOS_SERVICIO_PCT
): QuoteTotals {
  const subtotal = roundMoney(
    lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0), 0)
  );
  const servicioAmount = applyServicio ? roundMoney(subtotal * servicioPct) : 0;
  return {
    subtotal,
    servicioPct,
    servicioAmount,
    total: roundMoney(subtotal + servicioAmount),
    applyServicio,
  };
}

/** Días calendario hasta la fecha del evento (fecha local YYYY-MM-DD). */
export function daysUntilEvent(eventDate: string | null | undefined, from = new Date()): number | null {
  if (!eventDate) return null;
  const [y, m, d] = eventDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function canPlaceHold(eventDate: string | null | undefined, from = new Date()): boolean {
  const days = daysUntilEvent(eventDate, from);
  if (days === null) return true;
  return days >= EVENTOS_NO_HOLD_WITHIN_DAYS;
}

/** Aproxima 72 h hábiles como 3 días hábiles a partir de ahora (MVP). */
export function defaultHoldUntil(from = new Date()): Date {
  const d = new Date(from);
  let hours = 0;
  while (hours < EVENTOS_HOLD_BUSINESS_HOURS) {
    d.setHours(d.getHours() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) hours += 1;
  }
  return d;
}

export function formatMxn(n: number): string {
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  });
}

export function validateQuotePax(
  pax: number,
  lines: { requiresFood?: boolean; category?: string; min_pax?: number | null }[]
): string | null {
  if (!Number.isFinite(pax) || pax < 1) return 'Indica un número de personas válido.';
  const hasBarra = lines.some(
    (l) => l.category === 'barra_libre' || l.requiresFood === true
  );
  const hasFood = lines.some((l) =>
    ['tres_tiempos', 'desayunos', 'parejas', 'paquete'].includes(
      String(l.category || '')
    )
  );
  if (hasBarra && !hasFood) {
    return 'Barra libre solo se cotiza junto con alimentos.';
  }
  if (pax < EVENTOS_MIN_PAX_GRUPOS && lines.some((l) => l.category === 'tres_tiempos')) {
    return `Grupos de menú 3 tiempos desde ${EVENTOS_MIN_PAX_GRUPOS} personas.`;
  }
  return null;
}
