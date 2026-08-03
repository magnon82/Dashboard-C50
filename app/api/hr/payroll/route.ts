import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import {
  canTransitionPayroll,
  isPayrollCadence,
  isPayrollStatus,
  normalizeDiasSemana,
  todayIsoCdmxPayroll,
  type HrPayrollCadence,
  type HrPayrollLineInput,
  type HrPayrollPeriod,
} from '@/app/lib/hr-payroll';
import {
  ensureQuincenaYear,
  mapPeriodRow,
  PERIOD_SELECT_LEGACY,
  PERIOD_SELECT_Q,
  seedQuincenaPeriodIfEmpty,
} from '@/app/lib/hr-payroll-quincena';
import {
  applyPaidSideEffects,
  replacePeriodLines,
} from '@/app/lib/hr-payroll-sync';
import { invalidatePlantillaCache } from '@/app/lib/hr-plantilla';
import type { HrPayrollStatus } from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERIOD_SELECT = PERIOD_SELECT_Q;

function mapPeriod(raw: Record<string, unknown>): HrPayrollPeriod {
  return mapPeriodRow(raw);
}

function cadenceMissing(msg: string | undefined): boolean {
  return /cadence|column .* does not exist|42703/i.test(String(msg || ''));
}

/**
 * GET /api/hr/payroll
 * Lista periodos (RH). ?id=uuid → periodo + líneas.
 * ?year=2026 filtra periodos del año.
 * ?cadence=semanal|quincenal (default semanal).
 * Solo módulo rrhh (nunca staff).
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const yearParam = url.searchParams.get('year');
  const year =
    yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
  const cadenceParam = url.searchParams.get('cadence');
  const cadence: HrPayrollCadence = isPayrollCadence(cadenceParam)
    ? cadenceParam
    : 'semanal';
  const ensure = url.searchParams.get('ensure') === '1';

  try {
    const sb = getServiceSupabase();

    if (id) {
      const LINES_SELECT =
        'id, period_id, employee_id, sueldo_diario, dias_trabajados, dias_semana, horas_extra, bonos, retenciones, importe_pagado, vacaciones_tomadas, vacaciones_restantes, puesto_snapshot, notes, hr_employees(full_name, area, fecha_ingreso)';
      const LINES_SELECT_LEGACY =
        'id, period_id, employee_id, sueldo_diario, dias_trabajados, horas_extra, bonos, retenciones, importe_pagado, vacaciones_tomadas, vacaciones_restantes, puesto_snapshot, notes, hr_employees(full_name, area, fecha_ingreso)';

      let periodRes = await sb
        .from('hr_payroll_periods')
        .select(PERIOD_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (periodRes.error && cadenceMissing(periodRes.error.message)) {
        periodRes = await sb
          .from('hr_payroll_periods')
          .select(PERIOD_SELECT_LEGACY)
          .eq('id', id)
          .maybeSingle();
      }

      if (periodRes.error) {
        const missing = hrSchemaMissing(periodRes.error.message);
        return NextResponse.json({
          ready: !missing,
          period: null,
          lines: [],
          message: missing
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : periodRes.error.message,
        });
      }
      if (!periodRes.data) {
        return NextResponse.json({ error: 'Periodo no encontrado' }, { status: 404 });
      }

      const periodMapped = mapPeriod(periodRes.data as Record<string, unknown>);
      if (periodMapped.cadence === 'quincenal') {
        const reseed = url.searchParams.get('reseed') === '1';
        await seedQuincenaPeriodIfEmpty(sb, id, {
          username: auth.username,
          force: reseed,
        });
      }

      const linesFirst = await sb
        .from('hr_payroll_lines')
        .select(LINES_SELECT)
        .eq('period_id', id)
        .order('importe_pagado', { ascending: false });

      const linesQuery =
        linesFirst.error &&
        /dias_semana/i.test(linesFirst.error.message || '')
          ? await sb
              .from('hr_payroll_lines')
              .select(LINES_SELECT_LEGACY)
              .eq('period_id', id)
              .order('importe_pagado', { ascending: false })
          : linesFirst;

      const { data: lines, error: lErr } = linesQuery;

      if (lErr) {
        return NextResponse.json({
          ready: false,
          period: periodMapped,
          lines: [],
          message: lErr.message,
        });
      }

      const mapped = (lines || []).map((raw) => {
        const r = raw as Record<string, unknown>;
        const emp = r.hr_employees as
          | { full_name?: string; area?: string; fecha_ingreso?: string | null }
          | null
          | undefined;
        const notes = r.notes != null ? String(r.notes) : null;
        const antMatch = notes?.match(/antigüedad:([^\s·]+)/i);
        return {
          id: String(r.id),
          period_id: String(r.period_id),
          employee_id: String(r.employee_id),
          sueldo_diario:
            r.sueldo_diario != null ? Number(r.sueldo_diario) : null,
          dias_trabajados: Number(r.dias_trabajados ?? 0),
          dias_semana: normalizeDiasSemana(r.dias_semana),
          horas_extra: Number(r.horas_extra ?? 0),
          bonos: Number(r.bonos ?? 0),
          retenciones: Number(r.retenciones ?? 0),
          importe_pagado: Number(r.importe_pagado ?? 0),
          vacaciones_tomadas:
            r.vacaciones_tomadas != null
              ? Number(r.vacaciones_tomadas)
              : null,
          vacaciones_restantes:
            r.vacaciones_restantes != null
              ? Number(r.vacaciones_restantes)
              : null,
          puesto_snapshot:
            r.puesto_snapshot != null ? String(r.puesto_snapshot) : null,
          notes,
          employee_name: emp?.full_name ?? null,
          employee_area: emp?.area ?? null,
          fecha_ingreso: emp?.fecha_ingreso
            ? String(emp.fecha_ingreso).slice(0, 10)
            : antMatch?.[1]?.slice(0, 10) || null,
        };
      });

      return NextResponse.json({
        ready: true,
        period: periodMapped,
        lines: mapped,
      });
    }

    if (cadence === 'quincenal') {
      if (year == null) {
        return NextResponse.json(
          { error: 'year requerido para quincenas' },
          { status: 400 }
        );
      }
      const ensured = await ensureQuincenaYear(sb, year, {
        username: auth.username,
      });
      if (!ensured.ready) {
        return NextResponse.json({
          ready: false,
          year,
          cadence: 'quincenal',
          periods: [] as HrPayrollPeriod[],
          message: ensured.message,
        });
      }

      const periods = ensured.periods;
      const ids = periods.map((p) => p.id);
      const counts = new Map<string, { n: number; total: number }>();
      if (ids.length > 0) {
        const { data: lines } = await sb
          .from('hr_payroll_lines')
          .select('period_id, importe_pagado')
          .in('period_id', ids);
        for (const row of lines || []) {
          const pid = String((row as { period_id: string }).period_id);
          const cur = counts.get(pid) || { n: 0, total: 0 };
          cur.n += 1;
          cur.total += Number(
            (row as { importe_pagado?: number }).importe_pagado ?? 0
          );
          counts.set(pid, cur);
        }
      }

      const withStats = periods.map((p) => ({
        ...p,
        line_count: counts.get(p.id)?.n ?? 0,
        total_pagado: counts.get(p.id)?.total ?? 0,
      }));

      return NextResponse.json({
        ready: true,
        year,
        cadence: 'quincenal' as const,
        periods: withStats,
        message: ensure ? ensured.message : undefined,
      });
    }

    let query = sb
      .from('hr_payroll_periods')
      .select(PERIOD_SELECT)
      .eq('cadence', 'semanal')
      .order('period_end', { ascending: false })
      .limit(year ? 80 : 80);

    if (year != null) {
      query = query
        .gte('period_start', `${year}-01-01`)
        .lte('period_start', `${year}-12-31`);
    }

    let { data, error } = await query;

    if (error && cadenceMissing(error.message)) {
      let legacy = sb
        .from('hr_payroll_periods')
        .select(PERIOD_SELECT_LEGACY)
        .order('period_end', { ascending: false })
        .limit(year ? 80 : 80);
      if (year != null) {
        legacy = legacy
          .gte('period_start', `${year}-01-01`)
          .lte('period_start', `${year}-12-31`);
      }
      const retry = await legacy;
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (error) {
      const missing = hrSchemaMissing(error.message);
      return NextResponse.json({
        ready: !missing,
        periods: [] as HrPayrollPeriod[],
        message: missing
          ? 'Ejecuta supabase/hr_module.sql en Supabase.'
          : error.message,
      });
    }

    const periods = (data || []).map((p) =>
      mapPeriod(p as Record<string, unknown>)
    );
    const ids = periods.map((p) => p.id);
    const counts = new Map<string, { n: number; total: number }>();
    if (ids.length > 0) {
      const { data: lines } = await sb
        .from('hr_payroll_lines')
        .select('period_id, importe_pagado')
        .in('period_id', ids);
      for (const row of lines || []) {
        const pid = String((row as { period_id: string }).period_id);
        const cur = counts.get(pid) || { n: 0, total: 0 };
        cur.n += 1;
        cur.total += Number(
          (row as { importe_pagado?: number }).importe_pagado ?? 0
        );
        counts.set(pid, cur);
      }
    }

    const withStats = periods.map((p) => ({
      ...p,
      line_count: counts.get(p.id)?.n ?? 0,
      total_pagado: counts.get(p.id)?.total ?? 0,
    }));

    const statusRank: Record<string, number> = {
      pagado: 3,
      cerrado: 2,
      borrador: 1,
    };
    const byStart = new Map<string, (typeof withStats)[number]>();
    for (const p of withStats) {
      const key = p.period_start;
      const prev = byStart.get(key);
      if (!prev) {
        byStart.set(key, p);
        continue;
      }
      const rp = statusRank[p.status] || 0;
      const rprev = statusRank[prev.status] || 0;
      const better =
        rp > rprev ||
        (rp === rprev && (p.line_count ?? 0) > (prev.line_count ?? 0));
      if (better) byStart.set(key, p);
    }
    const uniquePeriods = [...byStart.values()].sort(
      (a, b) =>
        b.period_end.localeCompare(a.period_end) ||
        b.period_start.localeCompare(a.period_start)
    );

    return NextResponse.json({
      ready: true,
      year: year ?? null,
      cadence: 'semanal' as const,
      periods: uniquePeriods,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        periods: [],
        message: e instanceof Error ? e.message : 'Error',
      },
      { status: 200 }
    );
  }
}

/**
 * POST /api/hr/payroll
 * Crea periodo (+ líneas opcionales).
 * Body: { label, period_start, period_end, status?, cadence?, notes?, source_file?, lines? }
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const label = String(body.label || '').trim();
  const period_start = String(body.period_start || '').slice(0, 10);
  const period_end = String(body.period_end || '').slice(0, 10);
  if (!label || !period_start || !period_end) {
    return NextResponse.json(
      { error: 'label, period_start y period_end son requeridos' },
      { status: 400 }
    );
  }
  if (period_end < period_start) {
    return NextResponse.json(
      { error: 'period_end debe ser ≥ period_start' },
      { status: 400 }
    );
  }

  const status: HrPayrollStatus = isPayrollStatus(body.status)
    ? body.status
    : 'borrador';
  const cadence: HrPayrollCadence = isPayrollCadence(body.cadence)
    ? body.cadence
    : 'semanal';

  try {
    const sb = getServiceSupabase();
    const insert: Record<string, unknown> = {
      label,
      period_start,
      period_end,
      status: status === 'pagado' ? 'borrador' : status,
      cadence,
      notes: body.notes != null ? String(body.notes) : null,
      source_file:
        body.source_file != null ? String(body.source_file) : null,
      created_by: auth.username,
      updated_by: auth.username,
    };

    let { data: period, error } = await sb
      .from('hr_payroll_periods')
      .insert(insert)
      .select(PERIOD_SELECT)
      .single();

    if (error && cadenceMissing(error.message)) {
      delete insert.cadence;
      const retry = await sb
        .from('hr_payroll_periods')
        .insert(insert)
        .select(PERIOD_SELECT_LEGACY)
        .single();
      period = retry.data as typeof period;
      error = retry.error;
      if (cadence === 'quincenal') {
        return NextResponse.json(
          {
            error:
              'Ejecuta supabase/hr_payroll_quincena.sql en Supabase para habilitar quincenas.',
          },
          { status: 503 }
        );
      }
    }

    if (error || !period) {
      const missing = hrSchemaMissing(error?.message);
      return NextResponse.json(
        {
          error: missing
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : error?.message || 'No se pudo crear',
        },
        { status: missing ? 503 : 500 }
      );
    }

    const periodId = String((period as { id: string }).id);
    let lineStats = {
      lineCount: 0,
      employeesCreated: 0,
      employeesUpdated: 0,
    };

    const lines = Array.isArray(body.lines)
      ? (body.lines as HrPayrollLineInput[])
      : [];
    if (lines.length > 0) {
      lineStats = await replacePeriodLines(sb, periodId, lines, 'manual');
    }

    let balancesSynced = 0;
    if (status === 'pagado') {
      const side = await applyPaidSideEffects(sb, periodId, body.paid_at as string | null);
      const { error: stErr } = await sb
        .from('hr_payroll_periods')
        .update({
          status: 'pagado',
          paid_at: side.paid_at,
          updated_by: auth.username,
          updated_at: new Date().toISOString(),
        })
        .eq('id', periodId);
      if (stErr) {
        return NextResponse.json({ error: stErr.message }, { status: 500 });
      }
      balancesSynced = side.balancesSynced;
      if (cadence === 'semanal') invalidatePlantillaCache();
    }

    const { data: refreshed } = await sb
      .from('hr_payroll_periods')
      .select(cadence === 'quincenal' ? PERIOD_SELECT : PERIOD_SELECT)
      .eq('id', periodId)
      .single();

    const mapped = mapPeriod((refreshed || period) as Record<string, unknown>);
    return NextResponse.json({
      ready: true,
      period: mapped,
      ...lineStats,
      balancesSynced,
      message:
        status === 'pagado'
          ? cadence === 'quincenal'
            ? 'Quincena creada y marcada pagada.'
            : 'Periodo creado y marcado pagado. La plantilla vigente une esta nómina con la última semana de horarios.'
          : cadence === 'quincenal'
            ? 'Quincena creada en borrador.'
            : 'Periodo creado en borrador.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/hr/payroll
 * Body: { id, status?, label?, period_start?, period_end?, paid_at?, notes?, lines? }
 * status: borrador → cerrado → pagado
 */
export async function PATCH(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = String(body.id || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    let findRes = await sb
      .from('hr_payroll_periods')
      .select(PERIOD_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (findRes.error && cadenceMissing(findRes.error.message)) {
      findRes = await sb
        .from('hr_payroll_periods')
        .select(PERIOD_SELECT_LEGACY)
        .eq('id', id)
        .maybeSingle();
    }

    const { data: current, error: findErr } = findRes;

    if (findErr || !current) {
      return NextResponse.json(
        { error: findErr?.message || 'Periodo no encontrado' },
        { status: findErr ? 500 : 404 }
      );
    }

    const cur = mapPeriod(current as Record<string, unknown>);
    const isQuincena = cur.cadence === 'quincenal';
    const patch: Record<string, unknown> = {
      updated_by: auth.username,
      updated_at: new Date().toISOString(),
    };

    if (body.label != null) patch.label = String(body.label).trim();
    if (body.period_start != null) {
      patch.period_start = String(body.period_start).slice(0, 10);
    }
    if (body.period_end != null) {
      patch.period_end = String(body.period_end).slice(0, 10);
    }
    if (body.notes !== undefined) {
      patch.notes = body.notes == null ? null : String(body.notes);
    }
    if (body.source_file !== undefined) {
      patch.source_file =
        body.source_file == null ? null : String(body.source_file);
    }

    let balancesSynced = 0;
    if (body.status != null) {
      if (!isPayrollStatus(body.status)) {
        return NextResponse.json({ error: 'status inválido' }, { status: 400 });
      }
      if (!canTransitionPayroll(cur.status, body.status)) {
        return NextResponse.json(
          {
            error: `No se puede pasar de ${cur.status} a ${body.status}`,
          },
          { status: 400 }
        );
      }
      patch.status = body.status;
      if (body.status === 'pagado') {
        const side = await applyPaidSideEffects(
          sb,
          id,
          body.paid_at != null
            ? String(body.paid_at).slice(0, 10)
            : cur.paid_at
        );
        patch.paid_at = side.paid_at;
        balancesSynced = side.balancesSynced;
      } else if (cur.status === 'pagado') {
        // Reabrir (dejar de ser pagado): limpia paid_at
        patch.paid_at = null;
      }
    } else if (body.paid_at != null && cur.status === 'pagado') {
      patch.paid_at = String(body.paid_at).slice(0, 10) || todayIsoCdmxPayroll();
    }

    const { error: upErr } = await sb
      .from('hr_payroll_periods')
      .update(patch)
      .eq('id', id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    let lineStats = {
      lineCount: undefined as number | undefined,
      employeesCreated: undefined as number | undefined,
      employeesUpdated: undefined as number | undefined,
    };
    if (Array.isArray(body.lines)) {
      const stats = await replacePeriodLines(
        sb,
        id,
        body.lines as HrPayrollLineInput[],
        'manual'
      );
      lineStats = {
        lineCount: stats.lineCount,
        employeesCreated: stats.employeesCreated,
        employeesUpdated: stats.employeesUpdated,
      };
      // Si ya estaba pagado y reescribieron líneas, re-sync saldos
      const newStatus = (patch.status as HrPayrollStatus) || cur.status;
      if (newStatus === 'pagado') {
        const side = await applyPaidSideEffects(
          sb,
          id,
          (patch.paid_at as string) || cur.paid_at
        );
        balancesSynced = side.balancesSynced;
      }
    }

    let refreshedRes = await sb
      .from('hr_payroll_periods')
      .select(PERIOD_SELECT)
      .eq('id', id)
      .single();
    if (refreshedRes.error && cadenceMissing(refreshedRes.error.message)) {
      refreshedRes = await sb
        .from('hr_payroll_periods')
        .select(PERIOD_SELECT_LEGACY)
        .eq('id', id)
        .single();
    }

    const period = mapPeriod(
      (refreshedRes.data || current) as Record<string, unknown>
    );
    if (!isQuincena && (body.status != null || Array.isArray(body.lines))) {
      invalidatePlantillaCache();
    }
    return NextResponse.json({
      ready: true,
      period,
      balancesSynced,
      ...lineStats,
      message:
        period.status === 'pagado'
          ? isQuincena
            ? `Quincena marcada pagada (${period.paid_at}).`
            : `Marcado pagado (${period.paid_at}). Plantilla vigente = esta nómina + force_include − force_exclude.`
          : isQuincena
            ? `Quincena actualizada (${period.status}).`
            : `Periodo actualizado (${period.status}).`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
