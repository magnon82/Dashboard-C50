/**
 * Nómina quincenal — periodos 1–15 / 16–fin de mes para admin/socios.
 * Reutiliza hr_payroll_periods (cadence=quincenal) + hr_payroll_lines.
 * Server-only (Supabase + sync). UI helpers: pickDefaultQuincena in hr-payroll.ts.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  employeePayCadence,
  resolveSueldoQuincenal,
  type HrEmployee,
} from '@/app/lib/hr';
import {
  type HrPayrollCadence,
  type HrPayrollLineInput,
  type HrPayrollPeriod,
  isPayrollCadence,
  todayIsoCdmxPayroll,
  pickDefaultQuincena,
} from '@/app/lib/hr-payroll';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';
import { replacePeriodLines } from '@/app/lib/hr-payroll-sync';

export { pickDefaultQuincena };

const MONTH_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

export type QuincenaHalf = 1 | 2;

export type QuincenaSpec = {
  year: number;
  month: number; // 1–12
  half: QuincenaHalf;
  label: string;
  period_start: string;
  period_end: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Genera las 24 quincenas del año calendario. */
export function listQuincenaSpecs(year: number): QuincenaSpec[] {
  const out: QuincenaSpec[] = [];
  for (let month = 1; month <= 12; month++) {
    const mon = MONTH_SHORT[month - 1];
    const last = lastDayOfMonth(year, month);
    out.push({
      year,
      month,
      half: 1,
      label: `Quincena 1 · ${mon} ${year}`,
      period_start: `${year}-${pad2(month)}-01`,
      period_end: `${year}-${pad2(month)}-15`,
    });
    out.push({
      year,
      month,
      half: 2,
      label: `Quincena 2 · ${mon} ${year}`,
      period_start: `${year}-${pad2(month)}-16`,
      period_end: `${year}-${pad2(month)}-${pad2(last)}`,
    });
  }
  return out;
}

/** Quincena que contiene la fecha ISO (CDMX-friendly YYYY-MM-DD). */
export function quincenaSpecForDate(iso: string): QuincenaSpec | null {
  const s = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (!year || !month || !day) return null;
  const half: QuincenaHalf = day <= 15 ? 1 : 2;
  return (
    listQuincenaSpecs(year).find((q) => q.month === month && q.half === half) ||
    null
  );
}

export function mapPeriodCadence(raw: unknown): HrPayrollCadence {
  return isPayrollCadence(raw) ? raw : 'semanal';
}

/** Empleados de plantilla con pago quincenal + importe documentado. */
export function filterQuincenalEmployees(employees: HrEmployee[]): Array<{
  employee: HrEmployee;
  importe: number | null;
}> {
  return employees
    .filter((e) => employeePayCadence(e) === 'quincenal')
    .map((e) => ({
      employee: e,
      importe: resolveSueldoQuincenal(e),
    }))
    .sort((a, b) =>
      a.employee.full_name.localeCompare(b.employee.full_name, 'es')
    );
}

/** Líneas de captura para una quincena (importe fijo; días = 15). */
export function quincenalLinesFromEmployees(
  rows: Array<{ employee: HrEmployee; importe: number | null }>
): HrPayrollLineInput[] {
  return rows.map(({ employee: e, importe }) => {
    const amount =
      importe != null && Number.isFinite(importe) ? importe : null;
    const sd =
      amount != null ? Math.round((amount / 15) * 100) / 100 : e.sueldo_diario;
    return {
      full_name: e.full_name,
      puesto: e.puesto,
      area: e.area,
      sueldo_diario: sd ?? null,
      dias_trabajados: 15,
      horas_extra: 0,
      bonos: 0,
      retenciones: 0,
      importe_pagado: amount ?? 0,
      notes: amount != null ? `sueldo_quincenal:${amount}` : null,
    };
  });
}

export const PERIOD_SELECT_Q =
  'id, label, period_start, period_end, status, cadence, paid_at, notes, source_file, created_by, updated_by, created_at, updated_at';

export const PERIOD_SELECT_LEGACY =
  'id, label, period_start, period_end, status, paid_at, notes, source_file, created_by, updated_by, created_at, updated_at';

export function mapPeriodRow(raw: Record<string, unknown>): HrPayrollPeriod {
  return {
    id: String(raw.id),
    label: String(raw.label),
    period_start: String(raw.period_start).slice(0, 10),
    period_end: String(raw.period_end).slice(0, 10),
    status: raw.status as HrPayrollPeriod['status'],
    cadence: mapPeriodCadence(raw.cadence),
    paid_at: raw.paid_at ? String(raw.paid_at).slice(0, 10) : null,
    notes: raw.notes != null ? String(raw.notes) : null,
    source_file: raw.source_file != null ? String(raw.source_file) : null,
    created_by: raw.created_by != null ? String(raw.created_by) : null,
    updated_by: raw.updated_by != null ? String(raw.updated_by) : null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

function cadenceColumnMissing(msg: string | undefined): boolean {
  return /cadence|column .* does not exist|42703/i.test(String(msg || ''));
}

/** Arma líneas desde plantilla quincenal si el periodo está vacío (borrador). */
export async function seedQuincenaPeriodIfEmpty(
  sb: SupabaseClient,
  periodId: string,
  opts?: { username?: string; force?: boolean }
): Promise<{ seeded: boolean; lineCount: number; message?: string }> {
  const username = opts?.username || 'sistema';
  const { data: period, error: pErr } = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT_Q)
    .eq('id', periodId)
    .maybeSingle();
  if (pErr || !period) {
    return {
      seeded: false,
      lineCount: 0,
      message: pErr?.message || 'Periodo no encontrado',
    };
  }
  const mapped = mapPeriodRow(period as Record<string, unknown>);
  if (mapped.cadence !== 'quincenal') {
    return { seeded: false, lineCount: 0, message: 'No es quincena' };
  }
  if (!opts?.force && mapped.status !== 'borrador') {
    return { seeded: false, lineCount: 0 };
  }

  const { count, error: cErr } = await sb
    .from('hr_payroll_lines')
    .select('id', { count: 'exact', head: true })
    .eq('period_id', periodId);
  if (cErr) {
    return { seeded: false, lineCount: 0, message: cErr.message };
  }
  if ((count ?? 0) > 0 && !opts?.force) {
    return { seeded: false, lineCount: count ?? 0 };
  }

  const plantilla = await resolvePlantillaVigente(sb, {
    allowSeed: false,
    username,
  });
  const qRows = filterQuincenalEmployees(plantilla.employees || []);
  const lines = quincenalLinesFromEmployees(qRows);
  if (!lines.length) {
    return {
      seeded: false,
      lineCount: 0,
      message: 'No hay personal quincenal en plantilla',
    };
  }
  const stats = await replacePeriodLines(sb, periodId, lines, 'manual');
  return { seeded: true, lineCount: stats.lineCount };
}

/**
 * Crea las 24 quincenas del año si faltan (borrador).
 * No siembra líneas (usar seedQuincenaPeriodIfEmpty al abrir detalle).
 */
export async function ensureQuincenaYear(
  sb: SupabaseClient,
  year: number,
  opts?: {
    username?: string;
  }
): Promise<{
  ready: boolean;
  created: number;
  seeded: number;
  periods: HrPayrollPeriod[];
  message?: string;
  schemaMissing?: boolean;
}> {
  const username = opts?.username || 'sistema';
  const specs = listQuincenaSpecs(year);

  let listRes = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT_Q)
    .eq('cadence', 'quincenal')
    .gte('period_start', `${year}-01-01`)
    .lte('period_start', `${year}-12-31`)
    .order('period_start', { ascending: true });

  if (listRes.error && cadenceColumnMissing(listRes.error.message)) {
    return {
      ready: false,
      created: 0,
      seeded: 0,
      periods: [],
      schemaMissing: true,
      message:
        'Ejecuta supabase/hr_payroll_quincena.sql en Supabase para habilitar quincenas.',
    };
  }
  if (listRes.error) {
    return {
      ready: false,
      created: 0,
      seeded: 0,
      periods: [],
      message: listRes.error.message,
    };
  }

  const existing = (listRes.data || []).map((r) =>
    mapPeriodRow(r as Record<string, unknown>)
  );
  const byStart = new Map(existing.map((p) => [p.period_start, p]));
  let created = 0;

  for (const spec of specs) {
    if (byStart.has(spec.period_start)) continue;
    const ins = await sb
      .from('hr_payroll_periods')
      .insert({
        label: spec.label,
        period_start: spec.period_start,
        period_end: spec.period_end,
        status: 'borrador',
        cadence: 'quincenal',
        notes: 'Control de pago quincenal (admin/socios)',
        created_by: username,
        updated_by: username,
      })
      .select(PERIOD_SELECT_Q)
      .single();

    if (ins.error) {
      if (cadenceColumnMissing(ins.error.message)) {
        return {
          ready: false,
          created,
          seeded: 0,
          periods: existing,
          schemaMissing: true,
          message:
            'Ejecuta supabase/hr_payroll_quincena.sql en Supabase para habilitar quincenas.',
        };
      }
      if (!/unique|duplicate/i.test(ins.error.message)) {
        return {
          ready: false,
          created,
          seeded: 0,
          periods: existing,
          message: ins.error.message,
        };
      }
      continue;
    }
    if (ins.data) {
      const mapped = mapPeriodRow(ins.data as Record<string, unknown>);
      byStart.set(mapped.period_start, mapped);
      created += 1;
    }
  }

  listRes = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT_Q)
    .eq('cadence', 'quincenal')
    .gte('period_start', `${year}-01-01`)
    .lte('period_start', `${year}-12-31`)
    .order('period_start', { ascending: false });

  if (listRes.error) {
    return {
      ready: true,
      created,
      seeded: 0,
      periods: [...byStart.values()],
      message: listRes.error.message,
    };
  }

  const periods = (listRes.data || []).map((r) =>
    mapPeriodRow(r as Record<string, unknown>)
  );

  return {
    ready: true,
    created,
    seeded: 0,
    periods,
    message:
      created > 0
        ? `Quincenas ${year}: ${created} periodo${created === 1 ? '' : 's'} creado${created === 1 ? '' : 's'}.`
        : undefined,
  };
}

