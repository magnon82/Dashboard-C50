import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import {
  isLeaveExemptEmployee,
  todayIsoCdmx,
  type HrLeaveBalanceRow,
} from '@/app/lib/hr';
import {
  acknowledgeLeaveRenewalAlert,
  leavePolicyFields,
  listLeaveRenewalAlerts,
  runLeaveAccrualCatchUp,
  type HrLeaveRenewalAlert,
} from '@/app/lib/hr-leave-accrual';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';
import {
  findNominaEnCursoPeriod,
  shortNominaWeekLabel,
  syncLeaveBalancesFromPeriod,
} from '@/app/lib/hr-payroll-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BalanceDb = {
  employee_id: string;
  days_entitled: number | string;
  days_taken: number | string;
  days_remaining: number | string;
  source: string;
  updated_at: string;
};

/**
 * GET /api/hr/leave-balances
 * Plantilla vigente + saldos hr_leave_balances (año CDMX).
 * Soft-sync nómina → catch-up LFT por aniversario → alertas de renovación.
 */
export async function GET() {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const asOf = todayIsoCdmx();
  const year = Number(asOf.slice(0, 4));

  try {
    const sb = getServiceSupabase();
    const periodP = findNominaEnCursoPeriod(sb);
    let plantilla = await resolvePlantillaVigente(sb, { allowSeed: false });
    if (plantilla.employees.length === 0 && plantilla.seedCode !== 'schema_missing') {
      plantilla = await resolvePlantillaVigente(sb, {
        allowSeed: true,
        username: auth.username,
      });
    }
    const period = await periodP;

    if (plantilla.seedCode === 'schema_missing') {
      return NextResponse.json({
        ready: false,
        year,
        employees: [] as HrLeaveBalanceRow[],
        renewals: [] as HrLeaveRenewalAlert[],
        synced: 0,
        accrued: 0,
        message:
          'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.',
        source: plantilla.source,
        periodLabel: null,
        periodStatus: null,
      });
    }

    const employees = plantilla.employees.filter(
      (e) => !isLeaveExemptEmployee(e)
    );
    const ids = employees.map((e) => e.id);

    let balanceMap = new Map<string, BalanceDb>();
    let synced = 0;
    let accrued = 0;
    let periodLabel: string | null = null;
    let periodStatus: string | null = null;
    let accrualMessage: string | null = null;

    if (period) {
      periodLabel = shortNominaWeekLabel(period.label) || period.label;
      periodStatus = period.status;
      try {
        synced = await syncLeaveBalancesFromPeriod(sb, period.id, year);
      } catch {
        // Soft-sync best-effort; la UI sigue con lo que haya.
      }
    }

    // Catch-up LFT: aniversarios desde last_accrued_years (idempotente).
    try {
      const run = await runLeaveAccrualCatchUp(sb, employees, { year, asOf });
      accrued = run.accrued + run.bootstrapped;
      if (run.schemaMissing) {
        accrualMessage = run.message || null;
      }
    } catch {
      // Schema o red: no bloquear saldos.
    }

    if (ids.length > 0) {
      const { data, error } = await sb
        .from('hr_leave_balances')
        .select(
          'employee_id, days_entitled, days_taken, days_remaining, source, updated_at'
        )
        .eq('year', year)
        .in('employee_id', ids);

      if (error) {
        const missing = hrSchemaMissing(error.message);
        return NextResponse.json({
          ready: !missing,
          year,
          employees: [] as HrLeaveBalanceRow[],
          renewals: [] as HrLeaveRenewalAlert[],
          synced: 0,
          accrued: 0,
          message: missing
            ? 'Ejecuta supabase/hr_module.sql (hr_leave_balances) en Supabase.'
            : error.message,
          source: plantilla.source,
          periodLabel,
          periodStatus,
          error: error.message,
        });
      }

      for (const raw of data || []) {
        const row = raw as BalanceDb;
        balanceMap.set(String(row.employee_id), row);
      }
    }

    const rows: HrLeaveBalanceRow[] = employees.map((e) => {
      const bal = balanceMap.get(e.id);
      const policy = leavePolicyFields(e.fecha_ingreso, asOf);
      return {
        employee_id: e.id,
        full_name: e.full_name,
        puesto: e.puesto ?? null,
        area: e.area ?? null,
        days_taken:
          bal?.days_taken != null ? Number(bal.days_taken) : null,
        days_remaining:
          bal?.days_remaining != null ? Number(bal.days_remaining) : null,
        days_entitled:
          bal?.days_entitled != null
            ? Number(bal.days_entitled)
            : policy.policy_entitlement || null,
        source: bal?.source ?? null,
        updated_at: bal?.updated_at ?? null,
        fecha_ingreso: policy.fecha_ingreso,
        completed_years: policy.completed_years,
        policy_entitlement: policy.policy_entitlement,
        antiguedad_label: policy.antiguedad_label,
      };
    });

    const renewalsRes = await listLeaveRenewalAlerts(sb, {
      employeeIds: ids.length ? ids : undefined,
      includeAcknowledged: false,
      limit: 40,
    });

    return NextResponse.json({
      ready: true,
      year,
      employees: rows,
      renewals: renewalsRes.alerts,
      count: rows.length,
      synced,
      accrued,
      source: plantilla.source,
      periodLabel,
      periodStatus,
      message:
        rows.length === 0
          ? plantilla.seedMessage ||
            'Abre Nómina (cierra/paga) o importa horarios con turnos reales'
          : accrualMessage,
      accrualNote: accrualMessage,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        year,
        employees: [] as HrLeaveBalanceRow[],
        renewals: [] as HrLeaveRenewalAlert[],
        synced: 0,
        accrued: 0,
        message: e instanceof Error ? e.message : 'Error al cargar saldos',
        error: e instanceof Error ? e.message : 'Error',
        periodLabel: null,
        periodStatus: null,
      },
      { status: 200 }
    );
  }
}

/**
 * PATCH /api/hr/leave-balances
 * Body: { acknowledgeAlertId: string } — marca alerta de renovación como vista.
 */
export async function PATCH(req: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  let body: { acknowledgeAlertId?: string };
  try {
    body = (await req.json()) as { acknowledgeAlertId?: string };
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const alertId = String(body.acknowledgeAlertId || '').trim();
  if (!alertId) {
    return NextResponse.json(
      { error: 'acknowledgeAlertId requerido' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const res = await acknowledgeLeaveRenewalAlert(sb, alertId);
    if (!res.ok) {
      return NextResponse.json(
        {
          error: res.message || 'No se pudo marcar la alerta',
          schemaMissing: res.schemaMissing,
          message: res.schemaMissing
            ? 'Ejecuta supabase/hr_leave_accrual.sql en Supabase.'
            : res.message,
        },
        { status: res.schemaMissing ? 200 : 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
