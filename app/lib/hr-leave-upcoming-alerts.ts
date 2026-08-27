/**
 * Alertas Tablero: vacaciones que empiezan en ≤2 días hábiles
 * (pendientes y aprobadas). Se mantienen en Alertas hasta el día de inicio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addIsoDays,
  formatHrDate,
  HR_LEAVE_STATUS_LABELS,
  todayIsoCdmx,
  type HrLeaveStatus,
  type HrSummaryAlert,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { mxBusinessDaysBefore } from '@/app/lib/mx-holidays';

/** Días hábiles de anticipación (fijo). */
export const HR_LEAVE_UPCOMING_BUSINESS_DAYS = 2;

export type HrLeaveUpcomingRow = {
  id: string;
  employee_id: string | null;
  date_from: string;
  date_to: string;
  status: HrLeaveStatus;
  employee_name: string | null;
  /** Primer día hábil en que debe mostrarse la alerta. */
  alert_start: string;
};

function hrSchemaMissing(msg: string | undefined): boolean {
  const m = String(msg || '');
  return m.includes('does not exist') || m.includes('42P01');
}

/**
 * True si hoy CDMX está en la ventana de alerta:
 * [date_from − 2 días hábiles, date_from) — no incluye el día de inicio.
 */
export function isLeaveUpcomingAlertWindow(
  dateFrom: string,
  today: string = todayIsoCdmx(),
  businessDaysBefore: number = HR_LEAVE_UPCOMING_BUSINESS_DAYS
): boolean {
  const start = dateFrom.slice(0, 10);
  const t = today.slice(0, 10);
  if (!start || t >= start) return false;
  const alertStart = mxBusinessDaysBefore(start, businessDaysBefore);
  return t >= alertStart;
}

export function buildLeaveUpcomingSummaryAlerts(
  rows: HrLeaveUpcomingRow[],
  opts?: { maxDetail?: number }
): HrSummaryAlert[] {
  if (rows.length === 0) return [];
  const maxDetail = opts?.maxDetail ?? 8;
  const out: HrSummaryAlert[] = [
    {
      id: 'leave-upcoming',
      severity: 'warn',
      message:
        rows.length === 1
          ? `1 persona sale de vacaciones en ≤${HR_LEAVE_UPCOMING_BUSINESS_DAYS} días hábiles`
          : `${rows.length} personas salen de vacaciones en ≤${HR_LEAVE_UPCOMING_BUSINESS_DAYS} días hábiles`,
      go: 'vacaciones',
    },
  ];

  for (const r of rows.slice(0, maxDetail)) {
    const name = r.employee_name
      ? formatHrListName(r.employee_name)
      : 'Colaborador';
    const st = HR_LEAVE_STATUS_LABELS[r.status] || r.status;
    out.push({
      id: `leave-upcoming-${r.id}`,
      severity: r.status === 'pendiente' ? 'warn' : 'info',
      message: `${name}: inicia ${formatHrDate(r.date_from)} (${st})`,
      go: 'vacaciones',
    });
  }

  if (rows.length > maxDetail) {
    out.push({
      id: 'leave-upcoming-more',
      severity: 'info',
      message: `… y ${rows.length - maxDetail} más`,
      go: 'vacaciones',
    });
  }

  return out;
}

/**
 * Carga solicitudes pendiente/aprobada cuyo inicio está en ventana de alerta.
 */
export async function listLeaveUpcomingAlerts(
  sb: SupabaseClient,
  opts?: { today?: string; limit?: number }
): Promise<{
  rows: HrLeaveUpcomingRow[];
  schemaMissing: boolean;
  message?: string;
}> {
  const today = (opts?.today || todayIsoCdmx()).slice(0, 10);
  // Horizonte calendario: 2 hábiles ≈ hasta ~14 días si hay puentes
  const horizon = addIsoDays(today, 14);

  const { data, error } = await sb
    .from('hr_leave_requests')
    .select(
      'id, employee_id, date_from, date_to, status, hr_employees ( full_name )'
    )
    .in('status', ['pendiente', 'aprobada'])
    .gte('date_from', today)
    .lte('date_from', horizon)
    .order('date_from', { ascending: true })
    .limit(opts?.limit ?? 40);

  if (error) {
    const missing = hrSchemaMissing(error.message);
    return {
      rows: [],
      schemaMissing: missing,
      message: missing
        ? 'Tablas de vacaciones no migradas.'
        : error.message,
    };
  }

  const rows: HrLeaveUpcomingRow[] = [];
  for (const raw of data || []) {
    const r = raw as {
      id: string;
      employee_id: string | null;
      date_from: string;
      date_to: string;
      status: HrLeaveStatus;
      hr_employees?:
        | { full_name: string | null }
        | { full_name: string | null }[]
        | null;
    };
    const dateFrom = String(r.date_from || '').slice(0, 10);
    if (!dateFrom || !isLeaveUpcomingAlertWindow(dateFrom, today)) continue;

    const emp = Array.isArray(r.hr_employees)
      ? r.hr_employees[0]
      : r.hr_employees;

    rows.push({
      id: String(r.id),
      employee_id: r.employee_id ? String(r.employee_id) : null,
      date_from: dateFrom,
      date_to: String(r.date_to || '').slice(0, 10),
      status: r.status,
      employee_name: emp?.full_name ?? null,
      alert_start: mxBusinessDaysBefore(
        dateFrom,
        HR_LEAVE_UPCOMING_BUSINESS_DAYS
      ),
    });
  }

  return { rows, schemaMissing: false };
}
