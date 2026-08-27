/**
 * Política C50 de puntualidad (5 min tolerancia) + clasificación de checadas.
 * Fuente: Política de puntualidad y asistencia.docx
 */

/** Minutos posteriores a Ent. programada sin descuento (tolerancia). */
export const HR_ATTENDANCE_TOLERANCE_MINUTES = 5;

/** 3 retardos = 1 falta (política 5.6). */
export const HR_ATTENDANCE_RETARDOS_PER_FALTA = 3;

/** Omisión entrada o salida = ½ día (política 5.6). */
export const HR_ATTENDANCE_OMISSION_DAY_FRACTION = 0.5;

export type HrAttendanceDayStatus =
  | 'ok'
  | 'tolerancia'
  | 'retardo'
  | 'sin_entrada'
  | 'sin_salida'
  | 'falta'
  | 'descanso'
  | 'vacaciones'
  | 'sin_horario';

export const HR_ATTENDANCE_DAY_STATUS_LABELS: Record<
  HrAttendanceDayStatus,
  string
> = {
  ok: 'A tiempo',
  tolerancia: 'Entrada en tolerancia',
  retardo: 'Entrada con retardo',
  sin_entrada: 'Sin registro de entrada',
  sin_salida: 'Sin registro de salida',
  falta: 'Falta',
  descanso: 'Descanso',
  vacaciones: 'Vacaciones',
  sin_horario: 'Sin turno programado',
};

/**
 * Clasifica llegada vs hora programada.
 * 0 → ok · 1–5 → tolerancia · &gt;5 → retardo.
 */
export function classifyArrivalMinutes(
  lateMinutes: number | null
): Extract<HrAttendanceDayStatus, 'ok' | 'tolerancia' | 'retardo'> {
  if (lateMinutes == null || lateMinutes <= 0) return 'ok';
  if (lateMinutes <= HR_ATTENDANCE_TOLERANCE_MINUTES) return 'tolerancia';
  return 'retardo';
}

/** Minutos entre dos HH:mm el mismo día civil (puede ser negativo). */
export function minutesBetweenHm(
  scheduledHm: string,
  actualHm: string
): number | null {
  const a = parseHm(scheduledHm);
  const b = parseHm(actualHm);
  if (a == null || b == null) return null;
  return b - a;
}

export function parseHm(hm: string): number | null {
  const m = String(hm || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatHmFromMinutes(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Resume sanciones semanales según política:
 * 3 retardos → 1 falta · cada omisión entrada/salida → ½ día.
 */
export function summarizePolicySanctions(opts: {
  retardos: number;
  omisiones: number;
}): { faltasFromRetardos: number; diasOmision: number; faltasEquiv: number } {
  const faltasFromRetardos = Math.floor(
    opts.retardos / HR_ATTENDANCE_RETARDOS_PER_FALTA
  );
  const diasOmision =
    opts.omisiones * HR_ATTENDANCE_OMISSION_DAY_FRACTION;
  return {
    faltasFromRetardos,
    diasOmision,
    faltasEquiv: faltasFromRetardos + diasOmision,
  };
}
