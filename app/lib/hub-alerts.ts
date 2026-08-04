import { daysUntilEventMexico } from '@/app/lib/eventos';
import type { ModuleId } from '@/app/lib/modules';

export type HubAlertSeverity = 'warn' | 'ok' | 'neutral';

export type HubModuleAlert = {
  text: string;
  severity: HubAlertSeverity;
  /** Línea secundaria (p. ej. cuánto falta para el siguiente evento). */
  detail?: string;
};

/** Módulos activos del hub con fuente de alerta (o «Sin alertas»). */
export const HUB_ALERT_MODULE_IDS = [
  'reportes-socios',
  'staff',
  'ventas',
  'finanzas',
  'eventos',
  'rrhh',
] as const satisfies readonly ModuleId[];

export type HubAlertModuleId = (typeof HUB_ALERT_MODULE_IDS)[number];

export function isHubAlertModule(id: string): id is HubAlertModuleId {
  return (HUB_ALERT_MODULE_IDS as readonly string[]).includes(id);
}

/**
 * Countdown relativo al próximo evento (días civiles CDMX).
 * Ej.: "Hoy · 3 ago", "Mañana · 12 ago", "En 3 días · 12 ago".
 */
export function formatNextEventCountdown(
  eventDate: string | null | undefined,
  from = new Date()
): string | null {
  const days = daysUntilEventMexico(eventDate, from);
  if (days === null || days < 0 || !eventDate) return null;
  const iso = eventDate.slice(0, 10);
  const shortDate = new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
  });
  const relative =
    days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : `En ${days} días`;
  return `${relative} · ${shortDate}`;
}

export type EventosHubEventRef = {
  title?: string | null;
  celebration?: string | null;
  company?: string | null;
  folio?: string | null;
  event_date?: string | null;
};

/** Nombre · Folio X — omite partes vacías. */
export function formatEventosHubEventIdentity(
  ev: EventosHubEventRef | null | undefined
): string | null {
  if (!ev) return null;
  const name = (
    ev.title ||
    ev.celebration ||
    ev.company ||
    ''
  ).trim();
  const folio = (ev.folio || '').trim();
  if (name && folio) return `${name} · Folio ${folio}`;
  if (name) return name;
  if (folio) return `Folio ${folio}`;
  return null;
}

/**
 * Detalle hub: identidad del evento + countdown.
 * Ej.: "Boda García · Folio G7 · En 2 días · 5 ago"
 */
export function formatEventosHubDetail(
  ev: EventosHubEventRef | null | undefined,
  from = new Date()
): string | null {
  const identity = formatEventosHubEventIdentity(ev);
  const countdown = formatNextEventCountdown(ev?.event_date, from);
  const parts = [identity, countdown].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function formatAnticipoSinOsAlert(count: number): HubModuleAlert {
  if (count <= 0) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  if (count === 1) {
    return {
      text: 'Falta una orden de servicio de un evento con anticipo',
      severity: 'warn',
    };
  }
  return {
    text: `Faltan ${count} órdenes de servicio de eventos con anticipo`,
    severity: 'warn',
  };
}

/**
 * Alerta hub Eventos: anticipo sin OS + identidad/countdown.
 * Si hay un solo anticipoSinOs, prioriza ese evento; si no, el próximo en puerta.
 */
export function formatEventosHubAlert(
  anticipoSinOs: number,
  nextEvent?: EventosHubEventRef | string | null,
  anticipoEvent?: EventosHubEventRef | null
): HubModuleAlert {
  const base = formatAnticipoSinOsAlert(anticipoSinOs);
  const nextRef: EventosHubEventRef | null =
    typeof nextEvent === 'string'
      ? { event_date: nextEvent }
      : nextEvent ?? null;
  const focus =
    anticipoSinOs === 1 && anticipoEvent
      ? anticipoEvent
      : nextRef || anticipoEvent || null;
  const detail = formatEventosHubDetail(focus);
  return detail ? { ...base, detail } : base;
}

export function formatHrDocsMissingAlert(withMissing: number): HubModuleAlert {
  if (withMissing <= 0) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  if (withMissing === 1) {
    return {
      text: 'Falta documentación de personal (1 persona)',
      severity: 'warn',
    };
  }
  return {
    text: `Falta documentación de personal (${withMissing} personas)`,
    severity: 'warn',
  };
}

/** Prioriza docs faltantes; si no, primera alerta warn del tablero RR.HH. */
export function pickRrhhHubAlert(opts: {
  withMissing: number | null;
  summaryAlerts?: { severity: string; message: string }[] | null;
}): HubModuleAlert {
  if (opts.withMissing != null && opts.withMissing > 0) {
    return formatHrDocsMissingAlert(opts.withMissing);
  }
  const warn = (opts.summaryAlerts || []).find((a) => a.severity === 'warn');
  if (warn?.message) {
    return { text: warn.message, severity: 'warn' };
  }
  if (opts.withMissing === 0) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  return { text: 'Sin alertas', severity: 'ok' };
}

export function calmNoAlert(): HubModuleAlert {
  return { text: 'Sin alertas', severity: 'ok' };
}
