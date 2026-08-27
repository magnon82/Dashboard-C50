/**
 * Preferencias de alertas por usuario (Master → Usuarios).
 * Se guardan en el payload dashboard_auth: `alert_prefs: string[]`.
 * Admin recibe todas; viewers solo las marcadas.
 */

export type AlertPrefId = 'hr.next_week_schedule' | 'hr.leave_upcoming';

export type AppAlertPref = {
  id: AlertPrefId;
  label: string;
  hint: string;
  /** Módulo sugerido (informativo en Master). */
  moduleHint?: string;
};

export const APP_ALERT_PREFS: AppAlertPref[] = [
  {
    id: 'hr.next_week_schedule',
    label: 'Horario próxima semana (viernes)',
    hint:
      'Vie–dom CDMX: avisa si la semana siguiente no existe o está en borrador (crear / publicar). Push + banner al abrir la app.',
    moduleHint: 'rrhh / staff',
  },
  {
    id: 'hr.leave_upcoming',
    label: 'Vacaciones en ≤2 días hábiles',
    hint:
      'Avisa cuando alguien (pendiente o aprobada) inicia vacaciones pronto. Ideal para RH.',
    moduleHint: 'rrhh',
  },
];

export const ALERT_PREF_IDS = new Set(
  APP_ALERT_PREFS.map((p) => p.id as string)
);

/**
 * Destinatarios por defecto de la alerta de horario (semilla idempotente).
 * Confirmar que existan en Master; si no hay usuario, se omite.
 */
export const HR_NEXT_WEEK_SCHEDULE_ALERT_SEED_USERNAMES = [
  'roman',
  'roberto',
  'juan',
  'david',
] as const;

export function normalizeAlertPrefs(raw: unknown): AlertPrefId[] {
  if (!Array.isArray(raw)) return [];
  const out: AlertPrefId[] = [];
  for (const item of raw) {
    const id = String(item || '')
      .trim()
      .toLowerCase();
    if (ALERT_PREF_IDS.has(id) && !out.includes(id as AlertPrefId)) {
      out.push(id as AlertPrefId);
    }
  }
  return out;
}

export function hasAlertPref(
  prefs: string[] | null | undefined,
  id: AlertPrefId,
  opts?: { role?: string; modules?: string[] }
): boolean {
  if (opts?.role === 'admin' || opts?.modules?.includes('*')) return true;
  return (prefs || []).includes(id);
}
