/**
 * Vacaciones LFT (reforma 2023) — derecho por antigüedad cumplida + catch-up.
 *
 * Tabla (años cumplidos → días del periodo):
 *   1→12, 2→14, 3→16, 4→18, 5→20, 6–10→22, 11–15→24, 16–20→26, …
 * Tras el año 5: +2 días cada bloque de 5 años.
 *
 * Primer contacto: bootstrap sin apilar años históricos (conserva saldo nómina).
 * Aniversarios posteriores: suman el derecho del año cumplido al saldo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatAntiguedad, todayIsoCdmx } from '@/app/lib/hr';
import { hrSchemaMissing } from '@/app/lib/hr-api';

export type HrLeaveRenewalAlert = {
  id: string;
  employee_id: string;
  employee_name: string;
  puesto: string | null;
  anniversary_date: string;
  completed_years: number;
  previous_entitlement: number;
  new_entitlement: number;
  days_added: number;
  previous_remaining: number | null;
  new_remaining: number | null;
  created_at: string;
  acknowledged_at: string | null;
};

export type AccrualEmployee = {
  id: string;
  full_name: string;
  puesto?: string | null;
  fecha_ingreso: string | null;
};

export type AccrualRunResult = {
  ready: boolean;
  schemaMissing: boolean;
  bootstrapped: number;
  accrued: number;
  alertsCreated: number;
  message?: string;
};

/** Días de vacaciones LFT para N años de servicio ya cumplidos. */
export function lftVacationDays(completedYears: number): number {
  const n = Math.floor(completedYears);
  if (n < 1) return 0;
  if (n === 1) return 12;
  if (n === 2) return 14;
  if (n === 3) return 16;
  if (n === 4) return 18;
  if (n === 5) return 20;
  // 6–10: 22, 11–15: 24, 16–20: 26, …
  return 22 + 2 * Math.floor((n - 6) / 5);
}

/** Años de servicio cumplidos (aniversarios) a la fecha asOf (ISO CDMX). */
export function completedYearsOfService(
  fechaIngreso: string | null | undefined,
  asOf: string = todayIsoCdmx()
): number {
  if (!fechaIngreso) return 0;
  const start = new Date(`${fechaIngreso.slice(0, 10)}T12:00:00`);
  const end = new Date(`${asOf.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;

  let years = end.getFullYear() - start.getFullYear();
  const mdEnd = end.getMonth() * 100 + end.getDate();
  const mdStart = start.getMonth() * 100 + start.getDate();
  if (mdEnd < mdStart) years -= 1;
  return Math.max(0, years);
}

/** Fecha ISO del N-ésimo aniversario (ingreso + N años). */
export function anniversaryDateIso(
  fechaIngreso: string,
  completedYears: number
): string {
  const d = new Date(`${fechaIngreso.slice(0, 10)}T12:00:00`);
  d.setFullYear(d.getFullYear() + completedYears);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function numOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Evalúa aniversarios pendientes y actualiza saldos + alertas.
 * Idempotente: no vuelve a otorgar años ya en hr_leave_accrual_state.
 */
export async function runLeaveAccrualCatchUp(
  sb: SupabaseClient,
  employees: AccrualEmployee[],
  opts?: { year?: number; asOf?: string }
): Promise<AccrualRunResult> {
  const asOf = opts?.asOf ?? todayIsoCdmx();
  const year = opts?.year ?? Number(asOf.slice(0, 4));
  const eligible = employees.filter((e) => e.fecha_ingreso);

  if (eligible.length === 0) {
    return {
      ready: true,
      schemaMissing: false,
      bootstrapped: 0,
      accrued: 0,
      alertsCreated: 0,
    };
  }

  const ids = eligible.map((e) => e.id);

  const stateRes = await sb
    .from('hr_leave_accrual_state')
    .select('employee_id, last_accrued_years, last_accrual_date')
    .in('employee_id', ids);

  if (stateRes.error) {
    const missing = hrSchemaMissing(stateRes.error.message);
    return {
      ready: !missing,
      schemaMissing: missing,
      bootstrapped: 0,
      accrued: 0,
      alertsCreated: 0,
      message: missing
        ? 'Ejecuta supabase/hr_leave_accrual.sql en Supabase.'
        : stateRes.error.message,
    };
  }

  const balRes = await sb
    .from('hr_leave_balances')
    .select(
      'employee_id, days_entitled, days_taken, days_remaining, source'
    )
    .eq('year', year)
    .in('employee_id', ids);

  if (balRes.error && hrSchemaMissing(balRes.error.message)) {
    return {
      ready: false,
      schemaMissing: true,
      bootstrapped: 0,
      accrued: 0,
      alertsCreated: 0,
      message: 'Ejecuta supabase/hr_module.sql (hr_leave_balances) en Supabase.',
    };
  }

  const stateMap = new Map<
    string,
    { last_accrued_years: number; last_accrual_date: string | null }
  >();
  for (const raw of stateRes.data || []) {
    const row = raw as {
      employee_id: string;
      last_accrued_years: number;
      last_accrual_date: string | null;
    };
    stateMap.set(String(row.employee_id), {
      last_accrued_years: Number(row.last_accrued_years) || 0,
      last_accrual_date: row.last_accrual_date,
    });
  }

  const balMap = new Map<
    string,
    {
      days_entitled: number;
      days_taken: number;
      days_remaining: number;
      source: string;
    }
  >();
  for (const raw of balRes.data || []) {
    const row = raw as {
      employee_id: string;
      days_entitled: number | string;
      days_taken: number | string;
      days_remaining: number | string;
      source: string;
    };
    balMap.set(String(row.employee_id), {
      days_entitled: numOr(row.days_entitled, 0),
      days_taken: numOr(row.days_taken, 0),
      days_remaining: numOr(row.days_remaining, 0),
      source: row.source || 'manual',
    });
  }

  let bootstrapped = 0;
  let accrued = 0;
  let alertsCreated = 0;
  const nowIso = new Date().toISOString();

  for (const emp of eligible) {
    const ingreso = emp.fecha_ingreso!.slice(0, 10);
    const completed = completedYearsOfService(ingreso, asOf);
    const state = stateMap.get(emp.id);

    // Primera vez: anclar al presente sin apilar derechos históricos.
    if (!state) {
      const { error } = await sb.from('hr_leave_accrual_state').upsert(
        {
          employee_id: emp.id,
          last_accrued_years: completed,
          last_accrual_date:
            completed >= 1 ? anniversaryDateIso(ingreso, completed) : null,
          updated_at: nowIso,
        },
        { onConflict: 'employee_id' }
      );
      if (!error) {
        bootstrapped += 1;
        stateMap.set(emp.id, {
          last_accrued_years: completed,
          last_accrual_date:
            completed >= 1 ? anniversaryDateIso(ingreso, completed) : null,
        });
        const policy = lftVacationDays(completed);
        const bal = balMap.get(emp.id);
        if (bal && policy > 0 && bal.source !== 'policy') {
          await sb.from('hr_leave_balances').upsert(
            {
              employee_id: emp.id,
              year,
              days_entitled: policy,
              days_taken: bal.days_taken,
              days_remaining: bal.days_remaining,
              source: bal.source,
              updated_at: nowIso,
            },
            { onConflict: 'employee_id,year' }
          );
        } else if (!bal && policy > 0) {
          await sb.from('hr_leave_balances').upsert(
            {
              employee_id: emp.id,
              year,
              days_entitled: policy,
              days_taken: 0,
              days_remaining: policy,
              source: 'policy',
              updated_at: nowIso,
            },
            { onConflict: 'employee_id,year' }
          );
          balMap.set(emp.id, {
            days_entitled: policy,
            days_taken: 0,
            days_remaining: policy,
            source: 'policy',
          });
        }
      }
      continue;
    }

    if (completed <= state.last_accrued_years) continue;

    let prevEntitled = lftVacationDays(state.last_accrued_years);
    let remaining = balMap.get(emp.id)?.days_remaining ?? 0;
    const taken = balMap.get(emp.id)?.days_taken ?? 0;
    let lastDate = state.last_accrual_date;

    for (let y = state.last_accrued_years + 1; y <= completed; y++) {
      const daysAdded = lftVacationDays(y);
      const newEntitled = daysAdded;
      const prevRemaining = remaining;
      remaining = Math.round((remaining + daysAdded) * 100) / 100;
      const anniv = anniversaryDateIso(ingreso, y);

      const { data: alertRow, error: alertErr } = await sb
        .from('hr_leave_renewal_alerts')
        .upsert(
          {
            employee_id: emp.id,
            anniversary_date: anniv,
            completed_years: y,
            previous_entitlement: prevEntitled,
            new_entitlement: newEntitled,
            days_added: daysAdded,
            previous_remaining: prevRemaining,
            new_remaining: remaining,
          },
          { onConflict: 'employee_id,completed_years' }
        )
        .select('id')
        .maybeSingle();

      if (!alertErr && alertRow) alertsCreated += 1;

      prevEntitled = newEntitled;
      lastDate = anniv;
    }

    const finalEntitled = lftVacationDays(completed);
    const { error: balErr } = await sb.from('hr_leave_balances').upsert(
      {
        employee_id: emp.id,
        year,
        days_entitled: finalEntitled,
        days_taken: taken,
        days_remaining: remaining,
        source: 'policy',
        updated_at: nowIso,
      },
      { onConflict: 'employee_id,year' }
    );

    const { error: stErr } = await sb.from('hr_leave_accrual_state').upsert(
      {
        employee_id: emp.id,
        last_accrued_years: completed,
        last_accrual_date: lastDate,
        updated_at: nowIso,
      },
      { onConflict: 'employee_id' }
    );

    if (!balErr && !stErr) {
      accrued += 1;
      balMap.set(emp.id, {
        days_entitled: finalEntitled,
        days_taken: taken,
        days_remaining: remaining,
        source: 'policy',
      });
    }
  }

  return {
    ready: true,
    schemaMissing: false,
    bootstrapped,
    accrued,
    alertsCreated,
  };
}

/** Lista alertas de renovación (abiertas primero). */
export async function listLeaveRenewalAlerts(
  sb: SupabaseClient,
  opts?: {
    employeeIds?: string[];
    includeAcknowledged?: boolean;
    limit?: number;
  }
): Promise<{
  alerts: HrLeaveRenewalAlert[];
  schemaMissing: boolean;
  message?: string;
}> {
  let q = sb
    .from('hr_leave_renewal_alerts')
    .select(
      'id, employee_id, anniversary_date, completed_years, previous_entitlement, new_entitlement, days_added, previous_remaining, new_remaining, created_at, acknowledged_at'
    )
    .order('anniversary_date', { ascending: false })
    .limit(opts?.limit ?? 50);

  if (!opts?.includeAcknowledged) {
    q = q.is('acknowledged_at', null);
  }
  if (opts?.employeeIds?.length) {
    q = q.in('employee_id', opts.employeeIds);
  }

  const { data, error } = await q;
  if (error) {
    const missing = hrSchemaMissing(error.message);
    return {
      alerts: [],
      schemaMissing: missing,
      message: missing
        ? 'Ejecuta supabase/hr_leave_accrual.sql en Supabase.'
        : error.message,
    };
  }

  const rows = (data || []) as Array<{
    id: string;
    employee_id: string;
    anniversary_date: string;
    completed_years: number;
    previous_entitlement: number | string;
    new_entitlement: number | string;
    days_added: number | string;
    previous_remaining: number | string | null;
    new_remaining: number | string | null;
    created_at: string;
    acknowledged_at: string | null;
  }>;

  if (rows.length === 0) {
    return { alerts: [], schemaMissing: false };
  }

  const ids = [...new Set(rows.map((r) => String(r.employee_id)))];
  const { data: emps } = await sb
    .from('hr_employees')
    .select('id, full_name, puesto')
    .in('id', ids);

  const nameMap = new Map<
    string,
    { full_name: string; puesto: string | null }
  >();
  for (const e of emps || []) {
    const row = e as { id: string; full_name: string; puesto: string | null };
    nameMap.set(String(row.id), {
      full_name: row.full_name,
      puesto: row.puesto,
    });
  }

  const alerts: HrLeaveRenewalAlert[] = rows.map((r) => {
    const emp = nameMap.get(String(r.employee_id));
    return {
      id: String(r.id),
      employee_id: String(r.employee_id),
      employee_name: emp?.full_name ?? '—',
      puesto: emp?.puesto ?? null,
      anniversary_date: String(r.anniversary_date).slice(0, 10),
      completed_years: Number(r.completed_years),
      previous_entitlement: numOr(r.previous_entitlement, 0),
      new_entitlement: numOr(r.new_entitlement, 0),
      days_added: numOr(r.days_added, 0),
      previous_remaining:
        r.previous_remaining != null ? numOr(r.previous_remaining, 0) : null,
      new_remaining:
        r.new_remaining != null ? numOr(r.new_remaining, 0) : null,
      created_at: r.created_at,
      acknowledged_at: r.acknowledged_at,
    };
  });

  return { alerts, schemaMissing: false };
}

export async function acknowledgeLeaveRenewalAlert(
  sb: SupabaseClient,
  alertId: string
): Promise<{ ok: boolean; message?: string; schemaMissing?: boolean }> {
  const { error } = await sb
    .from('hr_leave_renewal_alerts')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', alertId)
    .is('acknowledged_at', null);

  if (error) {
    return {
      ok: false,
      schemaMissing: hrSchemaMissing(error.message),
      message: error.message,
    };
  }
  return { ok: true };
}

/** Campos de UI derivados de ingreso + LFT (sin tocar BD). */
export function leavePolicyFields(
  fechaIngreso: string | null | undefined,
  asOf: string = todayIsoCdmx()
): {
  fecha_ingreso: string | null;
  completed_years: number;
  policy_entitlement: number;
  antiguedad_label: string;
} {
  const fi = fechaIngreso?.slice(0, 10) || null;
  const completed = completedYearsOfService(fi, asOf);
  return {
    fecha_ingreso: fi,
    completed_years: completed,
    policy_entitlement: lftVacationDays(completed),
    antiguedad_label: formatAntiguedad(fi, asOf),
  };
}
