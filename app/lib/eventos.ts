/** Reglas y tipos del módulo operativo Eventos (no confundir con Ventas WI/Eventos). */

export const EVENTOS_SERVICIO_PCT = 0.15;
export const EVENTOS_HOLD_BUSINESS_HOURS = 72;
export const EVENTOS_NO_HOLD_WITHIN_DAYS = 15;
export const EVENTOS_MIN_PAX_GRUPOS = 10;
export const EVENTOS_MAX_PAX = 150;
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
  /** Título kanban; normalmente igual a celebration. */
  title: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  /** Empresa (si aplica); opcional frente a client_id. */
  company: string | null;
  /** ¿Qué celebran? */
  celebration: string | null;
  stage: LeadStage;
  event_date: string | null;
  pax: number | null;
  /** Presupuesto por persona (MXN). */
  estimated_amount: number | null;
  owner_username: string | null;
  /** Notas / requisiciones del cliente. */
  notes: string | null;
  hold_until: string | null;
  hold_extended_by: string | null;
  /** Ids del checklist de seguimiento (captura…alta_cliente…cotizacion…cierre). */
  follow_up_done?: string[] | null;
  /** Próxima acción de seguimiento; difiere alertas de cadencia hasta esa fecha. */
  next_follow_up_at?: string | null;
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

/** Opción dentro de un grupo de elección (p. ej. plato fuerte). */
export type MenuChoiceOption = {
  id: string;
  label: string;
  /** Si está definido y el grupo afecta precio, reemplaza unit_price del ítem. */
  unit_price?: number | null;
  is_vegetarian?: boolean;
  price_verified?: boolean;
  price_source?: string | null;
};

/** Grupo de elección en un ítem de menú (reutilizable para futuros menús). */
export type MenuChoiceGroup = {
  id: string;
  label: string;
  required: boolean;
  /** Si true, al elegir una opción con unit_price se actualiza el precio de línea. */
  affects_price?: boolean;
  options: MenuChoiceOption[];
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
  /** Grupos de elección (plato fuerte, entrada, postre, …). */
  choice_groups?: MenuChoiceGroup[] | null;
};

/** Selecciones guardadas en la línea de cotización: groupId → label (o id). */
export type QuoteLineOptions = Record<string, string>;

export type QuoteLineInput = {
  menu_item_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  options?: QuoteLineOptions | null;
};

export const EVENTOS_CONTACT = {
  brand: 'Cluster Culinario · Carranza 50',
  phone: '(442) 212 3031',
  email: 'eventos@carranza50.com.mx',
  emailAlt: 'hola@carranza50.com.mx',
  address:
    'C. Venustiano Carranza 50, Centro, 76020 Santiago de Querétaro, Qro.',
  web: 'www.carranza50.com.mx',
} as const;

/** Precio unitario según opciones (grupos con affects_price). */
export function resolveItemUnitPrice(
  item: EventMenuItem,
  selections: QuoteLineOptions
): number {
  const groups = item.choice_groups || [];
  for (const g of groups) {
    if (!g.affects_price) continue;
    const selected = selections[g.id];
    if (!selected) continue;
    const opt = g.options.find(
      (o) => o.id === selected || o.label === selected
    );
    if (opt != null && opt.unit_price != null && Number.isFinite(Number(opt.unit_price))) {
      return Number(opt.unit_price);
    }
  }
  return Number(item.unit_price) || 0;
}

/** Valida selecciones requeridas de choice_groups. */
export function validateChoiceSelections(
  item: EventMenuItem,
  selections: QuoteLineOptions
): string | null {
  const groups = item.choice_groups || [];
  for (const g of groups) {
    if (!g.required) continue;
    const v = (selections[g.id] || '').trim();
    if (!v) return `Elige ${g.label.toLowerCase()} para «${item.name}».`;
    const ok = g.options.some((o) => o.id === v || o.label === v);
    if (!ok) return `Opción inválida en ${g.label.toLowerCase()}.`;
  }
  return null;
}

/**
 * Repara texto UTF-8 mal interpretado como Latin-1/Windows-1252
 * (p. ej. "MenÃº" → "Menú", "â‰¥" → "≥"). Idempotente si ya es UTF-8 correcto.
 */
export function repairUtf8Mojibake(input: string | null | undefined): string {
  if (input == null || input === '') return input ?? '';
  if (!/Ã.|Â.|â/.test(input)) return input;

  const cp1252ToByte: Record<number, number> = {
    0x20ac: 0x80,
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  };

  const bytes: number[] = [];
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }
    const mapped = cp1252ToByte[code];
    if (mapped == null) return input;
    bytes.push(mapped);
  }

  try {
    const decoded = new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
    if (!decoded || decoded.includes('\uFFFD')) return input;
    // Prefer repaired text when it recovers Spanish accents / symbols.
    if (/[áéíóúñüÁÉÍÓÚÑ¿¡≥≤—–]/.test(decoded) || !/[ÃâÂ]/.test(decoded)) {
      return decoded;
    }
  } catch {
    /* keep original */
  }
  return input;
}

/** Aplica repairUtf8Mojibake a strings de catálogo (menú + ítems + choice_groups). */
export function sanitizeEventMenuTextFields<T extends EventMenu>(menu: T): T {
  const fix = repairUtf8Mojibake;
  const items = (menu.items || []).map((it) => ({
    ...it,
    name: fix(it.name),
    description: it.description == null ? null : fix(it.description),
    choice_groups: it.choice_groups
      ? it.choice_groups.map((g) => ({
          ...g,
          label: fix(g.label),
          options: (g.options || []).map((o) => ({
            ...o,
            label: fix(o.label),
          })),
        }))
      : it.choice_groups,
  }));
  return {
    ...menu,
    name: fix(menu.name),
    description: menu.description == null ? null : fix(menu.description),
    notes: menu.notes == null ? null : fix(menu.notes),
    items,
  };
}

/** Descripción legible de línea con elecciones (para cotización / PDF). */
export function formatQuoteLineDescription(
  itemName: string,
  selections: QuoteLineOptions,
  groups?: MenuChoiceGroup[] | null
): string {
  const parts: string[] = [itemName];
  const order = groups?.length
    ? groups
    : Object.keys(selections).map((id) => ({
        id,
        label: id.replace(/_/g, ' '),
      }));
  for (const g of order) {
    const v = selections[g.id];
    if (!v) continue;
    const label =
      'label' in g && typeof g.label === 'string'
        ? g.label
        : g.id.replace(/_/g, ' ');
    parts.push(`${label}: ${v}`);
  }
  return parts.join(' · ');
}

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

/** Hoy en CDMX como YYYY-MM-DD (calendario / filtros futuros). */
export function mexicoTodayIso(from = new Date()): string {
  return from.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

export function validateQuotePax(
  pax: number,
  lines: { requiresFood?: boolean; category?: string; min_pax?: number | null }[]
): string | null {
  if (!Number.isFinite(pax) || pax < 1) return 'Indica un número de personas válido.';
  const hasBarra = lines.some((l) => l.category === 'barra_libre');
  const hasFood = lines.some((l) =>
    ['tres_tiempos', 'desayunos', 'parejas', 'paquete'].includes(
      String(l.category || '')
    )
  );
  if (hasBarra && !hasFood) {
    return 'Barra libre solo se cotiza junto con alimentos (menú 3 tiempos u otro menú de comida).';
  }
  if (pax < EVENTOS_MIN_PAX_GRUPOS && lines.some((l) => l.category === 'tres_tiempos')) {
    return `Grupos de menú 3 tiempos desde ${EVENTOS_MIN_PAX_GRUPOS} personas.`;
  }
  for (const l of lines) {
    const min = Number(l.min_pax || 0);
    if (min > 0 && pax < min) {
      if (min >= EVENTOS_DESAYUNOS_PACK_MIN_PAX) {
        return `Pack desayunos desde ${EVENTOS_DESAYUNOS_PACK_MIN_PAX} personas (${formatMxn(EVENTOS_DESAYUNOS_PACK_PRICE)}).`;
      }
      return `Este ítem requiere mínimo ${min} personas.`;
    }
  }
  return null;
}
