/**
 * Google Calendar hold scaffolding (Fase 2).
 * Real sync requires GCAL_CALENDAR_ID + service account credentials.
 * Never invent full OAuth sync without explicit product request.
 */

import {
  canPlaceHold,
  defaultHoldUntil,
  EVENTOS_HOLD_BUSINESS_HOURS,
  EVENTOS_NO_HOLD_WITHIN_DAYS,
} from '@/app/lib/eventos';

export type GcalHoldRequest = {
  title: string;
  event_date: string | null;
  client?: string | null;
  lead_id?: string | null;
  quote_id?: string | null;
  hold_until?: string | null;
  notes?: string | null;
};

export type GcalHoldResult = {
  ok: boolean;
  configured: boolean;
  stub: boolean;
  hold_until: string | null;
  gcal_event_id: string | null;
  calendar_id: string | null;
  message: string;
  error?: string;
};

export function getGcalConfig() {
  const calendarId = process.env.GCAL_CALENDAR_ID?.trim() || '';
  const clientEmail = process.env.GCAL_CLIENT_EMAIL?.trim() || '';
  const privateKey = process.env.GCAL_PRIVATE_KEY?.replace(/\\n/g, '\n').trim() || '';
  return {
    calendarId,
    clientEmail,
    privateKey,
    configured: Boolean(calendarId && clientEmail && privateKey),
    hasCalendarId: Boolean(calendarId),
  };
}

/**
 * Crea (o simula) un hold de 72 h hábiles en el calendario compartido.
 * Sin GCAL_CALENDAR_ID → respuesta clara, sin inventar evento remoto.
 */
export async function createCalendarHold(
  req: GcalHoldRequest
): Promise<GcalHoldResult> {
  const cfg = getGcalConfig();

  if (req.event_date && !canPlaceHold(req.event_date)) {
    return {
      ok: false,
      configured: cfg.configured,
      stub: true,
      hold_until: null,
      gcal_event_id: null,
      calendar_id: cfg.calendarId || null,
      message: `No se puede poner hold: faltan menos de ${EVENTOS_NO_HOLD_WITHIN_DAYS} días para el evento.`,
      error: 'hold_too_close',
    };
  }

  const holdUntil =
    req.hold_until || defaultHoldUntil().toISOString();

  if (!cfg.hasCalendarId) {
    return {
      ok: false,
      configured: false,
      stub: true,
      hold_until: holdUntil,
      gcal_event_id: null,
      calendar_id: null,
      message:
        'Hold local registrado (72 h hábiles). Para publicar en Google Calendar configura GCAL_CALENDAR_ID (y credenciales de service account).',
      error: 'requires_GCAL_CALENDAR_ID',
    };
  }

  if (!cfg.configured) {
    return {
      ok: false,
      configured: false,
      stub: true,
      hold_until: holdUntil,
      gcal_event_id: null,
      calendar_id: cfg.calendarId,
      message:
        'GCAL_CALENDAR_ID está definido, pero faltan GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY. Hold local listo; sync GCal pendiente.',
      error: 'requires_gcal_credentials',
    };
  }

  // Stub: no llama a Google aún (Fase 2 — OAuth/sync real).
  return {
    ok: true,
    configured: true,
    stub: true,
    hold_until: holdUntil,
    gcal_event_id: null,
    calendar_id: cfg.calendarId,
    message: `Calendario ${cfg.calendarId} listo. Sync real de hold (${EVENTOS_HOLD_BUSINESS_HOURS} h hábiles) pendiente de implementación.`,
  };
}
