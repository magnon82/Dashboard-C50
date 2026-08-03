/** Tipos y helpers — nómina RR.HH. (Fase 2). */

import type { HrPayrollStatus } from '@/app/lib/hr';

/** Carpeta Google Drive de nóminas (legacy / BASE DATOS opcional). */
export const HR_NOMINA_DRIVE_FOLDER_ID =
  process.env.HR_NOMINA_DRIVE_FOLDER_ID?.trim() ||
  '1qIZq7O2lcvs5zxG6p5jjzh4wRMXoFK3J';

/** Fallback local opcional (no se muestra en UI; BASE DATOS silencioso). */
export const HR_BASE_DATOS_XLSX =
  process.env.HR_BASE_DATOS_XLSX?.trim() ||
  'I:\\Mi unidad\\RH\\BASE DATOS PERSONAL C50.xlsx';

export const HR_PAYROLL_STATUS_LABELS: Record<HrPayrollStatus, string> = {
  borrador: 'Borrador',
  cerrado: 'Cerrado',
  pagado: 'Pagado',
};

/** Cadencia de periodo: semanal (ops) o quincenal (admin/socios). */
export type HrPayrollCadence = 'semanal' | 'quincenal';

export const HR_PAYROLL_CADENCE_LABELS: Record<HrPayrollCadence, string> = {
  semanal: 'Semanal',
  quincenal: 'Quincenal',
};

export function isPayrollCadence(v: unknown): v is HrPayrollCadence {
  return v === 'semanal' || v === 'quincenal';
}

export type HrPayrollPeriod = {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  status: HrPayrollStatus;
  /** Default semanal si la columna aún no existe en DB. */
  cadence: HrPayrollCadence;
  paid_at: string | null;
  notes: string | null;
  source_file: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  line_count?: number;
  total_pagado?: number;
};

/** Letras Lun–Dom como en Excel de nómina (M/M → M/X). */
export const HR_PAYROLL_DAY_LETTERS = [
  'L',
  'M',
  'X',
  'J',
  'V',
  'S',
  'D',
] as const;

/**
 * Pesos / marcas por día (Lun–Dom) en `dias_semana`:
 * - 0 = falta / sin marca (no paga)
 * - >0 = trabajado (Lun–Sáb = 1; Dom = 1.25 prima dominical)
 * - <0 = descanso semanal pagado (sentinel −1; al sumar cuenta 1)
 *
 * Jornada 48h (MX típica): 6 días laborables + 1 descanso semanal pagado.
 * Σ pagable = suma de pesos; semana completa 6 trabajados + 1 descanso → Σ = 7
 * (o 6.25+1 si el día trabajado extra es domingo con prima).
 * Importe = sueldo_diario × Σ + HE + bonos − retenciones.
 */
export type HrPayrollDiasSemana = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type HrPayrollDayKind = 'off' | 'worked' | 'descanso';

/** Índice Dom en `dias_semana` (Lun=0 … Dom=6). */
export const HR_PAYROLL_SUNDAY_INDEX = 6;

/** Prima dominical: Dom trabajado cuenta 1.25. */
export const HR_PAYROLL_SUNDAY_WEIGHT = 1.25;

/** Sentinel: descanso semanal pagado (cuenta 1 en Σ; sin prima). */
export const HR_PAYROLL_DESCANSO_MARK = -1;

/** Techo razonable de Σ semanal (evita totales absurdos tipo dual-rol ×2). */
export const HR_PAYROLL_MAX_DIAS_SEMANA = 8.75;

/** Peso al marcar trabajado (Lun–Sáb = 1; Dom = 1.25). */
export function payrollDayOnWeight(dayIndex: number): number {
  return dayIndex === HR_PAYROLL_SUNDAY_INDEX
    ? HR_PAYROLL_SUNDAY_WEIGHT
    : 1;
}

export function payrollDayKind(v: number): HrPayrollDayKind {
  if (!Number.isFinite(v) || v === 0) return 'off';
  if (v < 0) return 'descanso';
  return 'worked';
}

/** Peso que suma a Σ / dias_trabajados. */
export function dayPayWeight(v: number): number {
  if (!Number.isFinite(v) || v === 0) return 0;
  if (v < 0) return Math.abs(v);
  return v;
}

export type HrPayrollLine = {
  id?: string;
  period_id?: string;
  employee_id: string;
  sueldo_diario: number | null;
  dias_trabajados: number;
  /** Marcas Lun–Dom (0 / trabajado / descanso−1). Suma pesos → dias_trabajados. */
  dias_semana: HrPayrollDiasSemana | null;
  horas_extra: number;
  bonos: number;
  retenciones: number;
  importe_pagado: number;
  vacaciones_tomadas: number | null;
  vacaciones_restantes: number | null;
  puesto_snapshot: string | null;
  notes: string | null;
  employee_name?: string | null;
  employee_area?: string | null;
  fecha_ingreso?: string | null;
};

/** Línea cruda de captura/import (antes de resolver employee_id). */
export type HrPayrollLineInput = {
  full_name: string;
  puesto?: string | null;
  area?: string | null;
  sueldo_diario?: number | null;
  dias_trabajados?: number | null;
  /** Marcas Lun–Dom; si viene, dias_trabajados se deriva de la suma al guardar. */
  dias_semana?: HrPayrollDiasSemana | null;
  horas_extra?: number | null;
  bonos?: number | null;
  retenciones?: number | null;
  importe_pagado?: number | null;
  vacaciones_entitled?: number | null;
  vacaciones_tomadas?: number | null;
  vacaciones_restantes?: number | null;
  antiguedad?: string | null;
  fecha_ingreso?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export function emptyDiasSemana(): HrPayrollDiasSemana {
  return [0, 0, 0, 0, 0, 0, 0];
}

/**
 * Marca de celda / DB: 0, 1, 1.25, −1 (descanso).
 * Dual-rol 1+1 → 2 → 1; Dom 1.25+1.25 → 2.5 → 1.25.
 * >2.6 → sangrado día-del-mes → 1.
 */
export function sanitizePayrollDayMark(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n) || n === 0) return 0;
  if (n < 0) return HR_PAYROLL_DESCANSO_MARK;
  if (n > 2) {
    if (n >= 2.2 && n <= 2.6) return HR_PAYROLL_SUNDAY_WEIGHT;
    return 1;
  }
  if (n > HR_PAYROLL_SUNDAY_WEIGHT) return 1;
  return Math.round(n * 100) / 100;
}

export function normalizeDiasSemana(raw: unknown): HrPayrollDiasSemana | null {
  if (raw == null) return null;
  let arr: unknown[] | null = null;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      return null;
    }
  }
  if (!arr || arr.length < 7) return null;
  const out = emptyDiasSemana();
  for (let i = 0; i < 7; i++) {
    out[i] = sanitizePayrollDayMark(parseLooseNumber(arr[i]));
  }
  return out;
}

export function sumDiasSemana(days: HrPayrollDiasSemana): number {
  const s = days.reduce((a, b) => a + dayPayWeight(b), 0);
  return Math.round(s * 100) / 100;
}

/** Une marcas del mismo empleado (dual rol): OR por día, no suma (evita Σ≈13). */
function mergeDayMark(a: number, b: number): number {
  const ka = payrollDayKind(a);
  const kb = payrollDayKind(b);
  if (ka === 'worked' && kb === 'worked') {
    return sanitizePayrollDayMark(Math.max(a, b));
  }
  if (ka === 'worked') return sanitizePayrollDayMark(a);
  if (kb === 'worked') return sanitizePayrollDayMark(b);
  if (ka === 'descanso' || kb === 'descanso') return HR_PAYROLL_DESCANSO_MARK;
  return 0;
}

/** Importe base: SD × días (+ extras/bonos − retenciones). HE se trata como monto. */
export function computePayrollImporte(opts: {
  sueldo_diario: number | null | undefined;
  dias_trabajados: number;
  horas_extra?: number | null;
  bonos?: number | null;
  retenciones?: number | null;
}): number {
  const sd = Number(opts.sueldo_diario) || 0;
  const dias = Number(opts.dias_trabajados) || 0;
  const he = Number(opts.horas_extra) || 0;
  const bonos = Number(opts.bonos) || 0;
  const ret = Number(opts.retenciones) || 0;
  return Math.round((sd * dias + he + bonos - ret) * 100) / 100;
}

/**
 * Índice Lun=0 … Dom=6 a partir de YYYY-MM-DD (mediodía local-friendly).
 * Alineado con `dias_semana` / prima dominical.
 */
export function payrollDayIndexFromIso(iso: string): number | null {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  // JS: 0=Dom … 6=Sáb → Lun=0 … Dom=6
  return (d.getDay() + 6) % 7;
}

export function mergeDiasSemana(
  a: HrPayrollDiasSemana | null | undefined,
  b: HrPayrollDiasSemana | null | undefined
): HrPayrollDiasSemana | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  const out = emptyDiasSemana();
  for (let i = 0; i < 7; i++) {
    out[i] = mergeDayMark(a[i] || 0, b[i] || 0);
  }
  return out;
}

/** Activa/desactiva trabajado (Lun–Sáb → 1; Dom → 1.25; off → 0). */
export function setDiasSemanaDay(
  days: HrPayrollDiasSemana | null | undefined,
  index: number,
  on: boolean
): HrPayrollDiasSemana {
  const next = days ? ([...days] as HrPayrollDiasSemana) : emptyDiasSemana();
  if (index < 0 || index > 6) return next;
  next[index] = on ? payrollDayOnWeight(index) : 0;
  return next;
}

/** Ciclo asistencia: off → trabajado → descanso → off. */
export function cycleDiasSemanaDay(
  days: HrPayrollDiasSemana | null | undefined,
  index: number
): HrPayrollDiasSemana {
  const next = days ? ([...days] as HrPayrollDiasSemana) : emptyDiasSemana();
  if (index < 0 || index > 6) return next;
  const kind = payrollDayKind(next[index]);
  if (kind === 'off') next[index] = payrollDayOnWeight(index);
  else if (kind === 'worked') next[index] = HR_PAYROLL_DESCANSO_MARK;
  else next[index] = 0;
  return next;
}

/**
 * Si hay exactamente 1 día sin marca y ≥1 trabajado, ese hueco = descanso pagado.
 * Heurística jornada 48h al sembrar desde horarios (DESCANSO no se guarda como turno).
 */
export function applyPaidRestIfSingleOff(
  days: HrPayrollDiasSemana
): HrPayrollDiasSemana {
  const next = [...days] as HrPayrollDiasSemana;
  let worked = 0;
  let offIdx = -1;
  let offCount = 0;
  for (let i = 0; i < 7; i++) {
    const k = payrollDayKind(next[i]);
    if (k === 'worked') worked += 1;
    else if (k === 'off') {
      offCount += 1;
      offIdx = i;
    }
  }
  if (worked > 0 && worked <= 6 && offCount === 1 && offIdx >= 0) {
    next[offIdx] = HR_PAYROLL_DESCANSO_MARK;
  }
  return next;
}

export type HrNominaSheetInfo = {
  name: string;
  weekLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rowCount: number;
};

/**
 * Normaliza nombre (sin acentos, tokens ordenados).
 * Para matching robusto (nicknames / fuzzy / ambiguos) usar `hr-person-match`.
 */
export function normalizePersonName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function parseLooseNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  const s = String(v)
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/^-+$/, '')
    .trim();
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Excel serial date → ISO YYYY-MM-DD (epoch 1899-12-30). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 60000) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoFromUnknownDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerialToIso(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 20000) return excelSerialToIso(asNum);
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

export function todayIsoCdmxPayroll(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function isPayrollStatus(v: unknown): v is HrPayrollStatus {
  return v === 'borrador' || v === 'cerrado' || v === 'pagado';
}

/** RH puede mover estatus libremente (flujo habitual: borrador → cerrado → pagado). */
export function canTransitionPayroll(
  from: HrPayrollStatus,
  to: HrPayrollStatus
): boolean {
  return isPayrollStatus(from) && isPayrollStatus(to);
}

/** Periodo quincenal por defecto (hoy CDMX, o el más reciente ≤ hoy). Safe for client. */
export function pickDefaultQuincena(
  periods: HrPayrollPeriod[],
  today: string = todayIsoCdmxPayroll()
): HrPayrollPeriod | null {
  if (!periods.length) return null;
  const sorted = [...periods].sort((a, b) =>
    b.period_start.localeCompare(a.period_start)
  );
  const current = sorted.find(
    (p) => p.period_start <= today && p.period_end >= today
  );
  if (current) return current;
  const past = sorted.find((p) => p.period_end < today);
  return past || sorted[0] || null;
}
