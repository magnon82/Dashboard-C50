/**
 * Salud del sync Infocaja (Gmail → financial_records).
 * GitHub Actions cron es best-effort: esto detecta atraso en datos, no el job.
 */

import { todayMexicoIso } from '@/app/lib/ventas-semana';

export type InfocajaSyncHealth = {
  ok: boolean;
  stale: boolean;
  todayCdmx: string;
  hourCdmx: number;
  /** Último día con filas Infocaja (YYYY-MM-DD). */
  maxInfocajaDate: string | null;
  /** Día mínimo esperado ya en BD según hora CDMX. */
  expectedMinDate: string;
  message: string;
  /** Enlace al workflow (UI). */
  actionsUrl: string;
};

const ACTIONS_URL =
  'https://github.com/magnon82/Dashboard-C50/actions/workflows/sync-gmail.yml';

/** Hora 0–23 en America/Mexico_City. */
export function hourMexico(from = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(from);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/** Resta N días a YYYY-MM-DD (calendario, sin TZ). */
export function isoMinusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Tras 10:00 CDMX exigimos al menos el día de ayer.
 * Tras 22:00 CDMX exigimos también el día de hoy (Fin de Día nocturno).
 */
export function expectedMinInfocajaDate(
  todayIso: string,
  hourCdmx: number
): string {
  if (hourCdmx >= 22) return todayIso;
  return isoMinusDays(todayIso, 1);
}

export function evaluateInfocajaSyncHealth(opts: {
  maxInfocajaDate: string | null;
  now?: Date;
}): InfocajaSyncHealth {
  const now = opts.now ?? new Date();
  const todayCdmx = todayMexicoIso(now);
  const hourCdmx = hourMexico(now);
  const expectedMinDate = expectedMinInfocajaDate(todayCdmx, hourCdmx);
  const max = opts.maxInfocajaDate
    ? String(opts.maxInfocajaDate).slice(0, 10)
    : null;

  const stale = !max || max < expectedMinDate;
  let message: string;
  if (!max) {
    message =
      'No hay ventas Infocaja en Supabase. El sync automático (Actions) debería cargarlas; si persiste, revisa Gmail Fin de Día.';
  } else if (stale) {
    // Actions puede salir en verde sin el día nuevo (correo aún no llega).
    // No afirmar que el workflow “falló”: el dato en BD es lo que falta.
    message = `Ventas desactualizadas: último día ${max} (se espera ≥ ${expectedMinDate}). El sync automático reintenta en horario; si el Fin de Día de ${expectedMinDate} ya está en Gmail y sigue faltando, revisa Actions.`;
  } else {
    message = `Infocaja al día (último ${max}).`;
  }

  return {
    ok: !stale,
    stale,
    todayCdmx,
    hourCdmx,
    maxInfocajaDate: max,
    expectedMinDate,
    message,
    actionsUrl: ACTIONS_URL,
  };
}

export function formatInfocajaSyncHubAlert(
  health: InfocajaSyncHealth
): { text: string; severity: 'warn' | 'ok' } {
  if (!health.stale) {
    return { text: 'Sin alertas', severity: 'ok' };
  }
  return {
    text: `Sync ventas atrasado (últ. ${health.maxInfocajaDate || '—'})`,
    severity: 'warn',
  };
}
