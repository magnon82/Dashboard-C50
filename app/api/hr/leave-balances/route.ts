import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { hrSchemaMissing, requireRrhhSession } from '@/app/lib/hr-api';
import { todayIsoCdmx, type HrLeaveBalanceRow } from '@/app/lib/hr';
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
 * Soft-sync desde la nómina en curso (borrador → cerrado → último con VAC).
 */
export async function GET() {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const year = Number(todayIsoCdmx().slice(0, 4));

  try {
    const sb = getServiceSupabase();
    // Nómina en curso en paralelo con plantilla (cache); seed solo si aún vacía.
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
        synced: 0,
        message:
          'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.',
        source: plantilla.source,
        periodLabel: null,
        periodStatus: null,
      });
    }

    const employees = plantilla.employees;
    const ids = employees.map((e) => e.id);

    let balanceMap = new Map<string, BalanceDb>();
    let synced = 0;
    let periodLabel: string | null = null;
    let periodStatus: string | null = null;

    if (period) {
      periodLabel = shortNominaWeekLabel(period.label) || period.label;
      periodStatus = period.status;
      try {
        synced = await syncLeaveBalancesFromPeriod(sb, period.id, year);
      } catch {
        // Soft-sync best-effort; la UI sigue con lo que haya.
      }
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
          synced: 0,
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
          bal?.days_entitled != null ? Number(bal.days_entitled) : null,
        source: bal?.source ?? null,
        updated_at: bal?.updated_at ?? null,
      };
    });

    return NextResponse.json({
      ready: true,
      year,
      employees: rows,
      count: rows.length,
      synced,
      source: plantilla.source,
      periodLabel,
      periodStatus,
      message:
        rows.length === 0
          ? plantilla.seedMessage ||
            'Abre Nómina (cierra/paga) o importa horarios con turnos reales'
          : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        year,
        employees: [] as HrLeaveBalanceRow[],
        synced: 0,
        message: e instanceof Error ? e.message : 'Error al cargar saldos',
        error: e instanceof Error ? e.message : 'Error',
        periodLabel: null,
        periodStatus: null,
      },
      { status: 200 }
    );
  }
}
