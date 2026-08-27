import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireRrhhSession } from '@/app/lib/hr-api';
import {
  HR_LEAVE_LOW_THRESHOLD,
  isLeaveExemptEmployee,
  todayIsoCdmx,
  type HrSummaryAlert,
  type HrSummaryKpis,
} from '@/app/lib/hr';
import { listLeaveRenewalAlerts } from '@/app/lib/hr-leave-accrual';
import {
  buildLeaveUpcomingSummaryAlerts,
  listLeaveUpcomingAlerts,
} from '@/app/lib/hr-leave-upcoming-alerts';
import {
  buildNextWeekScheduleSummaryAlerts,
  evaluateNextWeekScheduleAlert,
} from '@/app/lib/hr-next-week-schedule-alert';
import { mondayOfWeek } from '@/app/lib/hr-schedule-propose';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const emptyKpis: HrSummaryKpis = {
  plantilla: 0,
  employeesTotal: 0,
  leavePending: 0,
  resguardoPending: 0,
  scheduleDraft: 0,
  schedulePublished: 0,
  payrollOpen: 0,
  lastPaidLabel: null,
  lastPaidEnd: null,
  currentWeekStart: null,
  currentWeekPublished: false,
  leaveLowBalance: 0,
  leaveLowThreshold: HR_LEAVE_LOW_THRESHOLD,
  leaveUpcoming: 0,
};

/**
 * GET /api/hr/summary — KPIs + alertas del Tablero RR.HH.
 */
export async function GET() {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const weekStart = mondayOfWeek(todayIsoCdmx());
  const year = Number(todayIsoCdmx().slice(0, 4));

  try {
    const sb = getServiceSupabase();

    const [
      plantillaResolved,
      employees,
      leavePending,
      resguardoPending,
      scheduleDraft,
      schedulePublished,
      payrollOpen,
      currentWeek,
      leaveLowRows,
    ] = await Promise.all([
      resolvePlantillaVigente(sb, { allowSeed: false }),
      sb.from('hr_employees').select('id', { count: 'exact', head: true }),
      sb
        .from('hr_leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendiente'),
      sb
        .from('hr_resguardo_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendiente'),
      sb
        .from('hr_schedule_weeks')
        .select('id', { count: 'exact', head: true })
        .in('status', ['propuesta', 'borrador']),
      sb
        .from('hr_schedule_weeks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'publicado'),
      sb
        .from('hr_payroll_periods')
        .select('id', { count: 'exact', head: true })
        .in('status', ['borrador', 'cerrado']),
      sb
        .from('hr_schedule_weeks')
        .select('id, status')
        .eq('week_start', weekStart)
        .eq('status', 'publicado')
        .limit(1)
        .maybeSingle(),
      sb
        .from('hr_leave_balances')
        .select('employee_id, days_remaining')
        .eq('year', year)
        .lte('days_remaining', HR_LEAVE_LOW_THRESHOLD),
    ]);

    const schemaMissing =
      employees.error?.message?.includes('does not exist') ||
      employees.error?.code === '42P01';

    if (schemaMissing) {
      return NextResponse.json({
        ready: false,
        error:
          'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.',
        kpis: { ...emptyKpis, currentWeekStart: weekStart },
        alerts: [] as HrSummaryAlert[],
        note: 'Plantilla vigente = nómina conciliada ∪ última semana de horarios.',
      });
    }

    const resguardoMissing =
      resguardoPending.error?.message?.includes('does not exist') ||
      resguardoPending.error?.code === '42P01';

    const leaveBalMissing =
      leaveLowRows.error?.message?.includes('does not exist') ||
      leaveLowRows.error?.code === '42P01';

    const err =
      employees.error ||
      leavePending.error ||
      (!resguardoMissing && resguardoPending.error) ||
      scheduleDraft.error ||
      schedulePublished.error ||
      payrollOpen.error;

    const leavePendingCount = leavePending.count ?? 0;
    const resguardoCount = resguardoMissing ? 0 : (resguardoPending.count ?? 0);
    const draftWeeks = scheduleDraft.count ?? 0;
    const currentWeekPublished = Boolean(currentWeek.data?.id);

    // Excluir socios / sin_vacaciones del KPI de saldos bajos
    let leaveLowCount = 0;
    if (!leaveBalMissing && leaveLowRows.data?.length) {
      const lowIds = [
        ...new Set(
          leaveLowRows.data.map((r: { employee_id: string }) =>
            String(r.employee_id)
          )
        ),
      ];
      const exemptIds = new Set(
        plantillaResolved.employees
          .filter((e) => isLeaveExemptEmployee(e))
          .map((e) => e.id)
      );
      const missing = lowIds.filter(
        (id) =>
          !exemptIds.has(id) &&
          !plantillaResolved.employees.some((e) => e.id === id)
      );
      if (missing.length > 0) {
        const { data: extra } = await sb
          .from('hr_employees')
          .select('id, puesto, area, notes')
          .in('id', missing);
        for (const row of extra || []) {
          const r = row as {
            id: string;
            puesto: string | null;
            area: string | null;
            notes: string | null;
          };
          if (isLeaveExemptEmployee(r)) exemptIds.add(String(r.id));
        }
      }
      leaveLowCount = lowIds.filter((id) => !exemptIds.has(id)).length;
    }

    const paid = plantillaResolved.period;
    const kpis: HrSummaryKpis = {
      plantilla: plantillaResolved.employees.length,
      employeesTotal: employees.count ?? 0,
      leavePending: leavePendingCount,
      resguardoPending: resguardoCount,
      scheduleDraft: draftWeeks,
      schedulePublished: schedulePublished.count ?? 0,
      payrollOpen: payrollOpen.count ?? 0,
      lastPaidLabel: paid?.label ?? null,
      lastPaidEnd: paid?.period_end ?? paid?.paid_at ?? null,
      currentWeekStart: weekStart,
      currentWeekPublished,
      leaveLowBalance: leaveLowCount,
      leaveLowThreshold: HR_LEAVE_LOW_THRESHOLD,
      leaveUpcoming: 0,
    };

    const alerts: HrSummaryAlert[] = [];
    if (leavePendingCount > 0) {
      alerts.push({
        id: 'leave-pending',
        severity: 'warn',
        message: `${leavePendingCount} solicitud(es) de vacaciones por aprobar`,
        go: 'vacaciones',
      });
    }

    try {
      const upcoming = await listLeaveUpcomingAlerts(sb, { limit: 40 });
      if (!upcoming.schemaMissing && upcoming.rows.length > 0) {
        kpis.leaveUpcoming = upcoming.rows.length;
        alerts.push(...buildLeaveUpcomingSummaryAlerts(upcoming.rows));
      }
    } catch {
      // Soft: no bloquear tablero
    }
    if (resguardoCount > 0) {
      alerts.push({
        id: 'resguardo-pending',
        severity: 'warn',
        message: `${resguardoCount} resguardo(s) pendiente(s)`,
        go: 'resguardos',
      });
    }
    if (!currentWeekPublished) {
      alerts.push({
        id: 'week-unpublished',
        severity: 'warn',
        message: `Semana del ${weekStart} sin horario publicado`,
        go: 'horarios',
      });
    }

    try {
      const nextWeek = await evaluateNextWeekScheduleAlert(sb);
      alerts.push(...buildNextWeekScheduleSummaryAlerts(nextWeek));
    } catch {
      // Soft
    }

    try {
      const { data: lastAtt } = await sb
        .from('hr_attendance_reports')
        .select('id, week_start, week_number, punch_count, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastAtt?.id) {
        const weekLabel =
          lastAtt.week_number != null
            ? `sem ${lastAtt.week_number}`
            : String(lastAtt.week_start).slice(0, 10);
        alerts.push({
          id: 'attendance-latest',
          severity: 'info',
          message: `Último reporte biométrico: ${weekLabel} (${lastAtt.punch_count} checadas)`,
          go: 'asistencia',
        });
      }
    } catch {
      // Schema opcional hr_attendance.sql
    }

    if (draftWeeks > 0) {
      alerts.push({
        id: 'schedule-draft',
        severity: 'info',
        message: `${draftWeeks} semana(s) en borrador (sin publicar)`,
        go: 'horarios',
      });
    }
    if (leaveLowCount > 0) {
      alerts.push({
        id: 'leave-low',
        severity: 'info',
        message: `${leaveLowCount} saldo(s) de vacaciones ≤ ${HR_LEAVE_LOW_THRESHOLD} día(s)`,
        go: 'vacaciones',
      });
    }

    try {
      const renewals = await listLeaveRenewalAlerts(sb, {
        includeAcknowledged: false,
        limit: 20,
      });
      if (!renewals.schemaMissing && renewals.alerts.length > 0) {
        alerts.push({
          id: 'leave-renewal',
          severity: 'info',
          message: `${renewals.alerts.length} renovación(es) de vacaciones por antigüedad`,
          go: 'vacaciones',
        });
      }
    } catch {
      // Schema opcional (hr_leave_accrual.sql)
    }

    return NextResponse.json({
      ready: !err,
      error: err?.message,
      kpis,
      alerts,
      note: 'Plantilla vigente = nómina conciliada ∪ última semana de horarios (turnos reales) + force_include − bajas.',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        error: e instanceof Error ? e.message : 'Error al cargar tablero',
        kpis: { ...emptyKpis, currentWeekStart: weekStart },
        alerts: [] as HrSummaryAlert[],
        note: 'Plantilla vigente = nómina conciliada ∪ última semana de horarios.',
      },
      { status: 200 }
    );
  }
}
