import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireRrhhSession } from '@/app/lib/hr-api';
import {
  HR_LEAVE_LOW_THRESHOLD,
  todayIsoCdmx,
  type HrSummaryAlert,
  type HrSummaryKpis,
} from '@/app/lib/hr';
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
      leaveLow,
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
        .select('id', { count: 'exact', head: true })
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
      leaveLow.error?.message?.includes('does not exist') ||
      leaveLow.error?.code === '42P01';

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
    const leaveLowCount = leaveBalMissing ? 0 : (leaveLow.count ?? 0);

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
