/**
 * Google Calendar hold sync (service account JWT + domain-wide delegation).
 * Requiere GCAL_CALENDAR_ID + GCAL_CLIENT_EMAIL + GCAL_PRIVATE_KEY.
 * Con Workspace, preferir GCAL_IMPERSONATE_USER (DWD) en lugar de ACL write al SA.
 */

import { google } from 'googleapis';
import {
  canPlaceHold,
  defaultHoldUntil,
  EVENTOS_HOLD_BUSINESS_HOURS,
  EVENTOS_NO_HOLD_WITHIN_DAYS,
} from '@/app/lib/eventos';
import { getServiceSupabase } from '@/app/lib/users';

const GCAL_TZ = 'America/Mexico_City';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar';

let warnedMissingImpersonate = false;

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
  booking_id?: string | null;
  message: string;
  error?: string;
};

/** Normalize PEM from .env (escaped \\n, accidental JSON-paste wrappers). */
export function normalizeGcalPrivateKey(raw: string | undefined): string {
  let v = String(raw ?? '').trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  const forMatch = v.includes('-----BEGIN') ? v : v.replace(/\\n/g, '\n');
  const m = forMatch.match(
    /-----BEGIN [A-Z0-9 ]+-----[\s\S]+?-----END [A-Z0-9 ]+-----/
  );
  if (m) {
    let pem = m[0];
    if (pem.includes('\\n')) pem = pem.replace(/\\n/g, '\n');
    return pem.replace(/\r\n/g, '\n').trim();
  }
  return v.replace(/\\n/g, '\n').trim();
}

export function getGcalConfig() {
  const calendarId = process.env.GCAL_CALENDAR_ID?.trim() || '';
  const clientEmail = process.env.GCAL_CLIENT_EMAIL?.trim() || '';
  const privateKey = normalizeGcalPrivateKey(process.env.GCAL_PRIVATE_KEY);
  const impersonateUser = process.env.GCAL_IMPERSONATE_USER?.trim() || '';
  return {
    calendarId,
    clientEmail,
    privateKey,
    impersonateUser,
    configured: Boolean(calendarId && clientEmail && privateKey),
    hasCalendarId: Boolean(calendarId),
    hasImpersonate: Boolean(impersonateUser),
  };
}

/**
 * JWT for Calendar API. With GCAL_IMPERSONATE_USER, sets JWT `subject`
 * so the SA acts as that Workspace user (domain-wide delegation).
 */
export function createGcalAuth() {
  const cfg = getGcalConfig();
  if (cfg.configured && !cfg.hasImpersonate && !warnedMissingImpersonate) {
    warnedMissingImpersonate = true;
    console.error(
      '[eventos-gcal] GCAL_IMPERSONATE_USER no está definido. ' +
        'Sin impersonación (domain-wide delegation), Workspace suele rechazar writes del service account ' +
        `(${cfg.clientEmail}). Configura DWD en Admin + GCAL_IMPERSONATE_USER=usuario@dominio.`
    );
  }

  return new google.auth.JWT({
    email: cfg.clientEmail,
    key: cfg.privateKey,
    scopes: [GCAL_SCOPE],
    ...(cfg.impersonateUser ? { subject: cfg.impersonateUser } : {}),
  });
}

function isoDateOnly(value: string): string | null {
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** All-day Google end date is exclusive → day after event_date. */
function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function formatHoldUntilEs(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      timeZone: GCAL_TZ,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function buildHoldDescription(req: GcalHoldRequest, holdUntil: string): string {
  const lines = [
    `HOLD de disponibilidad — ${EVENTOS_HOLD_BUSINESS_HOURS} h hábiles.`,
    `Válido hasta: ${formatHoldUntilEs(holdUntil)} (${holdUntil}).`,
  ];
  if (req.client) lines.push(`Cliente: ${req.client}`);
  if (req.lead_id) lines.push(`Lead: ${req.lead_id}`);
  if (req.quote_id) lines.push(`Cotización: ${req.quote_id}`);
  if (req.notes) lines.push(`Notas: ${req.notes}`);
  lines.push(
    '',
    'Bloquea la fecha del evento mientras el hold esté vigente. No es confirmación definitiva.'
  );
  return lines.join('\n');
}

function mapGcalError(
  err: unknown,
  clientEmail: string,
  impersonateUser: string
): {
  message: string;
  error: string;
} {
  const anyErr = err as {
    code?: number | string;
    status?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
    response?: { status?: number; data?: { error?: { message?: string } } };
  };
  const status =
    Number(anyErr?.code) ||
    Number(anyErr?.status) ||
    Number(anyErr?.response?.status) ||
    0;
  const raw =
    anyErr?.response?.data?.error?.message ||
    anyErr?.errors?.[0]?.message ||
    anyErr?.message ||
    String(err);
  const lower = raw.toLowerCase();
  const dwdHint = impersonateUser
    ? `Impersonando a ${impersonateUser}: confirma domain-wide delegation (Client ID del SA + scope ${GCAL_SCOPE}) y que ese usuario tenga acceso de escritura al calendario.`
    : `Sin GCAL_IMPERSONATE_USER: en Workspace suele fallar el write del SA. Activa domain-wide delegation y define GCAL_IMPERSONATE_USER (p. ej. el dueño del calendario). Alternativa: comparte el calendario con ${clientEmail || 'el service account'} (permiso «Hacer cambios en eventos»).`;

  if (
    status === 403 ||
    status === 404 ||
    lower.includes('forbidden') ||
    lower.includes('not found') ||
    lower.includes('accessnotconfigured') ||
    lower.includes('insufficient') ||
    lower.includes('not a calendar user')
  ) {
    return {
      error: 'gcal_forbidden',
      message:
        `Google Calendar rechazó el hold. Verifica GCAL_CALENDAR_ID. ${dwdHint} Detalle: ${raw}`,
    };
  }

  if (
    status === 401 ||
    lower.includes('invalid_grant') ||
    lower.includes('unauthorized') ||
    lower.includes('client is unauthorized') ||
    lower.includes('unauthorized_client')
  ) {
    return {
      error: 'gcal_auth',
      message:
        `Credenciales GCal / DWD inválidas. Revisa GCAL_CLIENT_EMAIL, GCAL_PRIVATE_KEY (\\n) y domain-wide delegation + GCAL_IMPERSONATE_USER. Detalle: ${raw}`,
    };
  }

  return {
    error: 'gcal_api_error',
    message: `Error al crear hold en Google Calendar: ${raw}`,
  };
}

async function persistGcalOnBooking(
  req: GcalHoldRequest,
  gcalEventId: string
): Promise<string | null> {
  const eventDate = req.event_date ? isoDateOnly(req.event_date) : null;
  if (!eventDate) return null;

  try {
    const sb = getServiceSupabase();
    let existingId: string | null = null;

    if (req.lead_id) {
      const { data } = await sb
        .from('event_bookings')
        .select('id')
        .eq('lead_id', req.lead_id)
        .eq('event_date', eventDate)
        .neq('status', 'cancelado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      existingId = data?.id || null;
    }

    if (!existingId && req.quote_id) {
      const { data } = await sb
        .from('event_bookings')
        .select('id')
        .eq('quote_id', req.quote_id)
        .eq('event_date', eventDate)
        .neq('status', 'cancelado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      existingId = data?.id || null;
    }

    if (existingId) {
      const { error } = await sb
        .from('event_bookings')
        .update({
          gcal_event_id: gcalEventId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId);
      if (error) return null;
      return existingId;
    }

    const { data, error } = await sb
      .from('event_bookings')
      .insert({
        lead_id: req.lead_id || null,
        quote_id: req.quote_id || null,
        event_date: eventDate,
        status: 'tentativo',
        gcal_event_id: gcalEventId,
        notes: req.notes || null,
      })
      .select('id')
      .single();

    if (error) return null;
    return data?.id || null;
  } catch {
    // Persist is best-effort; hold in GCal already succeeded.
    return null;
  }
}

/**
 * Crea un hold de 72 h hábiles en el calendario compartido (evento todo el día en event_date).
 * Sin GCAL_* → respuesta clara, sin inventar evento remoto.
 */
export async function createCalendarHold(
  req: GcalHoldRequest
): Promise<GcalHoldResult> {
  const cfg = getGcalConfig();

  if (req.event_date && !canPlaceHold(req.event_date)) {
    return {
      ok: false,
      configured: cfg.configured,
      stub: false,
      hold_until: null,
      gcal_event_id: null,
      calendar_id: cfg.calendarId || null,
      message: `No se puede poner hold: faltan menos de ${EVENTOS_NO_HOLD_WITHIN_DAYS} días para el evento.`,
      error: 'hold_too_close',
    };
  }

  const holdUntil = req.hold_until || defaultHoldUntil().toISOString();
  const eventDate = req.event_date ? isoDateOnly(req.event_date) : null;

  if (!eventDate) {
    return {
      ok: false,
      configured: cfg.configured,
      stub: false,
      hold_until: holdUntil,
      gcal_event_id: null,
      calendar_id: cfg.calendarId || null,
      message:
        'Indica la fecha del evento para bloquearla en Google Calendar (hold de día completo).',
      error: 'requires_event_date',
    };
  }

  if (!cfg.hasCalendarId) {
    return {
      ok: false,
      configured: false,
      stub: false,
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
      stub: false,
      hold_until: holdUntil,
      gcal_event_id: null,
      calendar_id: cfg.calendarId,
      message:
        'GCAL_CALENDAR_ID está definido, pero faltan GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY. Hold local listo; sync GCal pendiente.',
      error: 'requires_gcal_credentials',
    };
  }

  const title = `HOLD · ${String(req.title || '').trim() || 'Evento'}`;
  const description = buildHoldDescription(req, holdUntil);

  try {
    const auth = createGcalAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const { data } = await calendar.events.insert({
      calendarId: cfg.calendarId,
      requestBody: {
        summary: title,
        description,
        start: { date: eventDate, timeZone: GCAL_TZ },
        end: { date: nextIsoDate(eventDate), timeZone: GCAL_TZ },
        transparency: 'opaque',
        status: 'tentative',
        extendedProperties: {
          private: {
            hold_until: holdUntil,
            lead_id: req.lead_id || '',
            quote_id: req.quote_id || '',
            source: 'dashboard-eventos',
          },
        },
      },
    });

    const gcalEventId = data.id || null;
    if (!gcalEventId) {
      return {
        ok: false,
        configured: true,
        stub: false,
        hold_until: holdUntil,
        gcal_event_id: null,
        calendar_id: cfg.calendarId,
        message:
          'Google Calendar respondió sin id de evento. Revisa el calendario compartido e inténtalo de nuevo.',
        error: 'gcal_no_event_id',
      };
    }

    const bookingId = await persistGcalOnBooking(req, gcalEventId);

    return {
      ok: true,
      configured: true,
      stub: false,
      hold_until: holdUntil,
      gcal_event_id: gcalEventId,
      calendar_id: cfg.calendarId,
      booking_id: bookingId,
      message: `Hold publicado en Google Calendar (${EVENTOS_HOLD_BUSINESS_HOURS} h hábiles hasta ${formatHoldUntilEs(holdUntil)}).`,
    };
  } catch (err) {
    const mapped = mapGcalError(err, cfg.clientEmail, cfg.impersonateUser);
    return {
      ok: false,
      configured: true,
      stub: false,
      hold_until: holdUntil,
      gcal_event_id: null,
      calendar_id: cfg.calendarId,
      message: mapped.message,
      error: mapped.error,
    };
  }
}

/**
 * Dry-check: lista el calendario y crea+borra un evento sonda.
 * No deja eventos basura. Para scripts locales / diagnóstico.
 */
export async function probeGcalAccess(): Promise<{
  ok: boolean;
  configured: boolean;
  impersonateUser: string | null;
  calendar_id: string | null;
  calendar_summary?: string | null;
  listed?: boolean;
  probe_created?: boolean;
  probe_deleted?: boolean;
  message: string;
  error?: string;
}> {
  const cfg = getGcalConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      configured: false,
      impersonateUser: cfg.impersonateUser || null,
      calendar_id: cfg.calendarId || null,
      message: 'Faltan GCAL_CALENDAR_ID / GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY.',
      error: 'requires_gcal_credentials',
    };
  }

  try {
    const auth = createGcalAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const meta = await calendar.calendars.get({ calendarId: cfg.calendarId });
    const summary = meta.data.summary || null;

    const probeDate = '2099-01-01';
    const inserted = await calendar.events.insert({
      calendarId: cfg.calendarId,
      requestBody: {
        summary: '[PROBE] dashboard-eventos — borrar',
        description: 'Sonda temporal; se elimina al instante.',
        start: { date: probeDate, timeZone: GCAL_TZ },
        end: { date: '2099-01-02', timeZone: GCAL_TZ },
        status: 'tentative',
        transparency: 'transparent',
        extendedProperties: {
          private: { source: 'dashboard-eventos-probe' },
        },
      },
    });

    const probeId = inserted.data.id;
    let deleted = false;
    if (probeId) {
      await calendar.events.delete({
        calendarId: cfg.calendarId,
        eventId: probeId,
      });
      deleted = true;
    }

    return {
      ok: Boolean(probeId && deleted),
      configured: true,
      impersonateUser: cfg.impersonateUser || null,
      calendar_id: cfg.calendarId,
      calendar_summary: summary,
      listed: true,
      probe_created: Boolean(probeId),
      probe_deleted: deleted,
      message: probeId
        ? `OK: calendario «${summary || cfg.calendarId}» accesible (impersonate=${cfg.impersonateUser || 'ninguno'}). Sonda creada y borrada.`
        : 'Calendario listado pero la sonda no devolvió id.',
      error: probeId ? undefined : 'gcal_no_event_id',
    };
  } catch (err) {
    const mapped = mapGcalError(err, cfg.clientEmail, cfg.impersonateUser);
    return {
      ok: false,
      configured: true,
      impersonateUser: cfg.impersonateUser || null,
      calendar_id: cfg.calendarId,
      message: mapped.message,
      error: mapped.error,
    };
  }
}
