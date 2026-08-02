import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireStaffOrRrhhSession,
  resolveLinkedEmployee,
} from '@/app/lib/hr-api';
import { todayIsoCdmx, type HrLeaveBalanceRow } from '@/app/lib/hr';
import {
  findNominaEnCursoPeriod,
  shortNominaWeekLabel,
  syncLeaveBalancesFromPeriod,
} from '@/app/lib/hr-payroll-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/leave-balances/mine
 * Saldo del colaborador vinculado a la sesión Staff (suite_username / email / nombre).
 */
export async function GET() {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const year = Number(todayIsoCdmx().slice(0, 4));

  try {
    const sb = getServiceSupabase();
    const linked = await resolveLinkedEmployee(sb, auth);

    if (!linked) {
      return NextResponse.json({
        ready: true,
        year,
        linkedEmployee: null,
        balance: null as HrLeaveBalanceRow | null,
        periodLabel: null,
        periodStatus: null,
        message:
          'Tu usuario no está vinculado a un colaborador. Pide a RH que asigne tu suite_username en Plantilla.',
      });
    }

    const period = await findNominaEnCursoPeriod(sb);
    let periodLabel: string | null = null;
    let periodStatus: string | null = null;
    if (period) {
      periodLabel = shortNominaWeekLabel(period.label) || period.label;
      periodStatus = period.status;
      try {
        await syncLeaveBalancesFromPeriod(sb, period.id, year);
      } catch {
        // Soft-sync best-effort
      }
    }

    const { data, error } = await sb
      .from('hr_leave_balances')
      .select(
        'employee_id, days_entitled, days_taken, days_remaining, source, updated_at'
      )
      .eq('year', year)
      .eq('employee_id', linked.id)
      .maybeSingle();

    if (error) {
      const missing = hrSchemaMissing(error.message);
      return NextResponse.json({
        ready: !missing,
        year,
        linkedEmployee: linked,
        balance: null as HrLeaveBalanceRow | null,
        periodLabel,
        periodStatus,
        message: missing
          ? 'Ejecuta supabase/hr_module.sql (hr_leave_balances) en Supabase.'
          : error.message,
        error: error.message,
      });
    }

    const bal = data as {
      employee_id: string;
      days_entitled: number | string | null;
      days_taken: number | string | null;
      days_remaining: number | string | null;
      source: string | null;
      updated_at: string | null;
    } | null;

    const balance: HrLeaveBalanceRow | null = bal
      ? {
          employee_id: String(bal.employee_id),
          full_name: linked.full_name,
          puesto: linked.puesto,
          area: linked.area,
          days_taken:
            bal.days_taken != null ? Number(bal.days_taken) : null,
          days_remaining:
            bal.days_remaining != null ? Number(bal.days_remaining) : null,
          days_entitled:
            bal.days_entitled != null ? Number(bal.days_entitled) : null,
          source: bal.source ?? null,
          updated_at: bal.updated_at ?? null,
        }
      : {
          employee_id: linked.id,
          full_name: linked.full_name,
          puesto: linked.puesto,
          area: linked.area,
          days_taken: null,
          days_remaining: null,
          days_entitled: null,
          source: null,
          updated_at: null,
        };

    return NextResponse.json({
      ready: true,
      year,
      linkedEmployee: linked,
      balance,
      periodLabel,
      periodStatus,
      message:
        bal == null
          ? periodLabel
            ? `Sin saldo en nómina ${periodLabel}. Consulta a RH.`
            : 'Aún no hay saldo de vacaciones cargado. Consulta a RH.'
          : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        year,
        linkedEmployee: null,
        balance: null,
        periodLabel: null,
        periodStatus: null,
        message: e instanceof Error ? e.message : 'Error al cargar saldo',
        error: e instanceof Error ? e.message : 'Error',
      },
      { status: 200 }
    );
  }
}
