export type CalendarSource = 'crm' | 'os' | 'activity';

export type CalendarEventItem = {
  id: string;
  event_date: string;
  title: string;
  client: string | null;
  pax: number | null;
  source: CalendarSource;
  source_label: string;
  detail: string | null;
  /** Etapa CRM (lead) si aplica */
  stage: string | null;
  /** Reserva / fecha: tentativo | confirmado | cancelado | completado */
  status: string | null;
  /** Nota operativa (p. ej. reembolso de anticipo en cancelados) */
  notes: string | null;
  /** PDF en disco (scan). Vacío si solo hay seed / Anticipos. */
  os_path: string | null;
  os_filename: string | null;
  /** id de event_service_orders (OS digital) */
  digital_os_id: string | null;
  /**
   * True si hay OS consultable: PDF en disco, OS digital, o OS indexada
   * (seed / activity) aunque no haya path descargable.
   */
  has_os: boolean;
  /** True si el evento viene de Anticipos C50 (pago de anticipo registrado). */
  has_anticipo: boolean;
  /** Folio OS / anticipo (G7, numérico, etc.) si se pudo resolver. */
  folio: string | null;
  /** id de event_quotes si hay match en Supabase */
  quote_id: string | null;
  lead_id: string | null;
  client_id: string | null;
};

export type CalendarPayload = {
  ready: boolean;
  today: string;
  events: CalendarEventItem[];
  count: number;
  sources: {
    activity: boolean;
    os: boolean;
    crm: boolean;
  };
  note: string;
  error?: string;
};

/** True si el evento ya tiene OS (PDF, digital, seed indexada, o source os). */
export function eventHasOs(
  ev: Partial<{
    has_os: boolean;
    os_path: string | null;
    digital_os_id: string | null;
    source: string;
    os_filename: string | null;
  }>
): boolean {
  if (ev.has_os) return true;
  if (ev.os_path || ev.digital_os_id) return true;
  if (ev.os_filename) return true;
  if (ev.source === 'os') return true;
  return false;
}

/** Anticipo C50 por flag o por etiqueta de fuente (p. ej. Tablero summary). */
export function eventHasAnticipo(
  ev: Partial<{
    has_anticipo: boolean;
    source_label: string;
  }>
): boolean {
  if (ev.has_anticipo) return true;
  if (
    typeof ev.source_label === 'string' &&
    /Anticipos\s*C50/i.test(ev.source_label)
  ) {
    return true;
  }
  return false;
}

/** Anticipo registrado y aún sin OS (PDF, digital ni seed). Cancelados no alertan. */
export function isAnticipoSinOs(
  ev: Partial<{
    has_anticipo: boolean;
    status: string | null;
    source_label: string;
    has_os: boolean;
    os_path: string | null;
    digital_os_id: string | null;
    source: string;
    os_filename: string | null;
  }>
): boolean {
  if (!eventHasAnticipo(ev)) return false;
  if (ev.status === 'cancelado') return false;
  return !eventHasOs(ev);
}

/**
 * Tablero «Próximos eventos» / en puerta:
 * solo eventos con anticipo u orden de servicio (no cotizaciones sueltas ni cancelados).
 */
export function isEventoEnPuerta(
  ev: Partial<{
    has_anticipo: boolean;
    status: string | null;
    source_label: string;
    has_os: boolean;
    os_path: string | null;
    digital_os_id: string | null;
    source: string;
    os_filename: string | null;
  }>
): boolean {
  if (ev.status === 'cancelado') return false;
  return eventHasAnticipo(ev) || eventHasOs(ev);
}

export function filterEnPuertaEvents(
  events: CalendarEventItem[]
): CalendarEventItem[] {
  return events.filter(isEventoEnPuerta);
}