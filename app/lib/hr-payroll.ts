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

export type HrPayrollPeriod = {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  status: HrPayrollStatus;
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

/** Pesos por día (Lun–Dom). Excel: Lun–Sáb = 1; Dom = 1.25 (prima 25%). */
export type HrPayrollDiasSemana = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Índice Dom en `dias_semana` (Lun=0 … Dom=6). */
export const HR_PAYROLL_SUNDAY_INDEX = 6;

/** Prima dominical: Dom marcado cuenta 1.25 (solo quien trabaja domingo). */
export const HR_PAYROLL_SUNDAY_WEIGHT = 1.25;

/** Peso al marcar un día en UI (Lun–Sáb = 1; Dom = 1.25). */
export function payrollDayOnWeight(dayIndex: number): number {
  return dayIndex === HR_PAYROLL_SUNDAY_INDEX
    ? HR_PAYROLL_SUNDAY_WEIGHT
    : 1;
}

export type HrPayrollLine = {
  id?: string;
  period_id?: string;
  employee_id: string;
  sueldo_diario: number | null;
  dias_trabajados: number;
  /** Marcas Lun–Dom (0 / 1 / fracciones). Suma → dias_trabajados. */
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

/** Marca de celda Excel: 0, 1, 1.25…; valores >2 suelen ser sangrado del día del mes. */
export function sanitizePayrollDayMark(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n) || n <= 0) return 0;
  if (n > 2) return 1;
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
  const s = days.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return Math.round(s * 100) / 100;
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
    out[i] = sanitizePayrollDayMark((a[i] || 0) + (b[i] || 0));
  }
  return out;
}

/** Activa/desactiva un día (Lun–Sáb → 1; Dom → 1.25; off → 0). */
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
