import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessAdmin,
  canAccessModule,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  applyTombolaDeficitRecovery,
  resolveDayTombola,
  sumInfocajaDay,
  type StaffRptInfocajaDay,
  type StaffRptRow,
  type TombolaDaySource,
} from '@/app/lib/staff-rpt';
import { isTpvSchemaError, tpvSchemaHint } from '@/app/lib/tpv-api';
import { eachIsoDateInclusive } from '@/app/lib/staff-propinas';
import {
  acumuladoWeekForDate,
  sundayOfWeek,
  todayMexicoIso,
  weekMondayIso,
} from '@/app/lib/ventas-semana';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireVentasViewer(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  const ok =
    canAccessAdmin(session) || canAccessModule(session, 'ventas');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso a Ventas' }, { status: 403 });
  }
  return session;
}

function parseIso(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * GET /api/ventas/tombola-semana
 * Semana lun–dom (CDMX / Acumulado):
 * - Saldo efe = efectivo Infocaja − propinas tarjeta (puede ser negativo)
 * - Tómbola = efectivo a entregar tras recuperar déficits de días previos
 *
 * Query: week? year? | from&to (YYYY-MM-DD) | latest=1 (última semana con datos)
 */
export async function GET(req: NextRequest) {
  const auth = await requireVentasViewer();
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const today = todayMexicoIso();
  let from = parseIso(sp.get('from'));
  let to = parseIso(sp.get('to'));
  let weekNumber: number | null = null;
  let year: number | null = null;
  const wantLatest = sp.get('latest') === '1' || sp.get('latest') === 'true';

  if (wantLatest && (!from || !to)) {
    const latest = await resolveLatestTombolaWeek(today);
    if (latest) {
      from = latest.from;
      to = latest.to;
      weekNumber = latest.week;
      year = latest.year;
    }
  }

  if (!from || !to) {
    const todayWeek = acumuladoWeekForDate(today);
    const y = Number(sp.get('year')) || Number(today.slice(0, 4));
    const w = Number(sp.get('week')) || todayWeek;
    if (!Number.isFinite(w) || w < 1 || w > 53) {
      return NextResponse.json(
        { error: 'Parámetro week inválido (1–53)' },
        { status: 400 }
      );
    }
    weekNumber = w;
    year = y;
    from = weekMondayIso(y, w);
    to = sundayOfWeek(from);
  } else if (weekNumber == null) {
    weekNumber = acumuladoWeekForDate(from);
    year = Number(from.slice(0, 4));
  }

  if (from > to) {
    return NextResponse.json(
      { error: 'from debe ser ≤ to' },
      { status: 400 }
    );
  }

  // Semana en curso: no sumar días futuros.
  const asOf = to > today ? today : to;

  try {
    const payload = await buildTombolaWeekPayload({
      from,
      to,
      asOf,
      weekNumber,
      year,
    });

    // Pedido explícito de semana vacía → si fallback=last, saltar a última con datos.
    const fallbackLast =
      sp.get('fallback') === 'last' || sp.get('fallback') === '1';
    if (
      fallbackLast &&
      !wantLatest &&
      payload.ready &&
      (payload.daysWithData ?? 0) === 0
    ) {
      const latest = await resolveLatestTombolaWeek(today);
      if (
        latest &&
        (latest.from !== from || latest.to !== to)
      ) {
        const asOfLatest = latest.to > today ? today : latest.to;
        const fallbackPayload = await buildTombolaWeekPayload({
          from: latest.from,
          to: latest.to,
          asOf: asOfLatest,
          weekNumber: latest.week,
          year: latest.year,
        });
        return NextResponse.json({
          ...fallbackPayload,
          fellBackToLatest: true,
        });
      }
    }

    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar tómbola';
    return NextResponse.json(
      {
        ready: false,
        week: weekNumber,
        year,
        from,
        to,
        asOf,
        total: 0,
        total_saldo_efe: 0,
        deficit_remaining: 0,
        days: [],
        daysWithCorte: 0,
        daysWithData: 0,
        error: msg,
        hint: isTpvSchemaError(msg) ? tpvSchemaHint(msg) : undefined,
      },
      { status: 500 }
    );
  }
}

async function resolveLatestTombolaWeek(today: string): Promise<{
  from: string;
  to: string;
  week: number;
  year: number;
} | null> {
  try {
    const sb = getServiceSupabase();
    let lastDate: string | null = null;

    const { data: fin } = await sb
      .from('financial_records')
      .select('date')
      .eq('source_file', 'infocaja')
      .lte('date', today)
      .order('date', { ascending: false })
      .limit(1);
    const finDate = fin?.[0]?.date
      ? String(fin[0].date).slice(0, 10)
      : null;
    if (finDate) lastDate = finDate;

    try {
      const { data: rpt } = await sb
        .from(STAFF_RPT_TABLE)
        .select('rpt_date')
        .lte('rpt_date', today)
        .order('rpt_date', { ascending: false })
        .limit(1);
      const rptDate = rpt?.[0]?.rpt_date
        ? String(rpt[0].rpt_date).slice(0, 10)
        : null;
      if (rptDate && (!lastDate || rptDate > lastDate)) lastDate = rptDate;
    } catch {
      /* staff_rpt opcional */
    }

    if (!lastDate || !/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) return null;
    const week = acumuladoWeekForDate(lastDate);
    const year = Number(lastDate.slice(0, 4));
    if (!week || week < 1) return null;
    const from = weekMondayIso(year, week);
    const to = sundayOfWeek(from);
    return { from, to, week, year };
  } catch {
    return null;
  }
}

async function buildTombolaWeekPayload(opts: {
  from: string;
  to: string;
  asOf: string;
  weekNumber: number | null;
  year: number | null;
}) {
  const { from, to, asOf, weekNumber, year } = opts;
  const sb = getServiceSupabase();
  const rptByDate = new Map<string, StaffRptRow>();
  let schemaMissing = false;
  let rptErrMsg: string | null = null;

  try {
    const { data, error } = await sb
      .from(STAFF_RPT_TABLE)
      .select('*')
      .gte('rpt_date', from)
      .lte('rpt_date', asOf)
      .order('rpt_date', { ascending: true });

    if (error) {
      if (isTpvSchemaError(error.message)) {
        schemaMissing = true;
        rptErrMsg =
          'Falta la tabla staff_rpt_diario (opcional si hay Infocaja)';
      } else {
        rptErrMsg = error.message;
      }
    } else {
      for (const raw of data || []) {
        const rpt = asStaffRptRow(raw as Record<string, unknown>);
        rptByDate.set(rpt.rpt_date, rpt);
      }
    }
  } catch (e) {
    rptErrMsg =
      e instanceof Error
        ? e.message
        : 'No se pudo leer staff_rpt_diario (se intenta Infocaja)';
  }

  const infocajaByDate = new Map<string, StaffRptInfocajaDay>();
  let finErrMsg: string | null = null;

  try {
    const { data: finRows, error: finError } = await sb
      .from('financial_records')
      .select('date, category, amount, source_file')
      .eq('source_file', 'infocaja')
      .gte('date', from)
      .lte('date', asOf);

    if (finError) {
      finErrMsg = finError.message;
    } else {
      const rowsByDate = new Map<
        string,
        Array<{ category?: string | null; amount?: number | null }>
      >();
      for (const r of finRows || []) {
        const date = String((r as { date?: string }).date || '').slice(0, 10);
        if (!date) continue;
        const list = rowsByDate.get(date) || [];
        list.push({
          category: (r as { category?: string | null }).category,
          amount: (r as { amount?: number | null }).amount,
        });
        rowsByDate.set(date, list);
      }
      for (const [date, rows] of rowsByDate) {
        infocajaByDate.set(date, sumInfocajaDay(rows));
      }
    }
  } catch (e) {
    finErrMsg =
      e instanceof Error
        ? e.message
        : 'No se pudieron leer ventas Infocaja';
  }

  if (schemaMissing && infocajaByDate.size === 0 && finErrMsg) {
    return {
      ready: false,
      week: weekNumber,
      year,
      from,
      to,
      asOf,
      total: 0,
      total_saldo_efe: 0,
      deficit_remaining: 0,
      days: [] as unknown[],
      daysWithCorte: 0,
      daysWithData: 0,
      schemaMissing: true,
      error:
        'Falta la tabla staff_rpt_diario y no hay Infocaja. Ejecuta supabase/staff_corte_prod_fix.sql',
      hint: tpvSchemaHint(rptErrMsg || ''),
    };
  }

  if (rptErrMsg && !schemaMissing && infocajaByDate.size === 0) {
    throw new Error(rptErrMsg);
  }
  if (finErrMsg && rptByDate.size === 0) {
    throw new Error(finErrMsg);
  }

  const rawDays: Array<{
    date: string;
    saldo_efe: number;
    efectivo: number | null;
    propinas_tpv: number;
    source: TombolaDaySource;
    has_corte: boolean;
  }> = [];

  for (const date of eachIsoDateInclusive(from, asOf)) {
    const rpt = rptByDate.get(date) ?? null;
    const info = infocajaByDate.get(date) ?? null;
    const day = resolveDayTombola({ rpt, infocaja: info });
    if (!day) continue;
    rawDays.push({
      date,
      saldo_efe: day.amount,
      efectivo: day.efectivo,
      propinas_tpv: day.propinas_tpv,
      source: day.source,
      has_corte: rpt != null,
    });
  }

  const recovery = applyTombolaDeficitRecovery(
    rawDays.map((d) => d.saldo_efe)
  );

  const days = rawDays.map((d, i) => {
    const r = recovery[i]!;
    return {
      date: d.date,
      saldo_efe: r.saldo_efe,
      tombola: r.tombola,
      recovery: r.recovery,
      deficit_after: r.deficit_after,
      efectivo: d.efectivo,
      propinas_tpv: d.propinas_tpv,
      source: d.source,
      has_corte: d.has_corte,
    };
  });

  const total =
    Math.round(days.reduce((a, d) => a + d.tombola, 0) * 100) / 100;
  const total_saldo_efe =
    Math.round(days.reduce((a, d) => a + d.saldo_efe, 0) * 100) / 100;
  const deficit_remaining =
    days.length > 0 ? days[days.length - 1]!.deficit_after : 0;
  const daysWithCorte = days.filter((d) => d.has_corte).length;

  return {
    ready: true,
    week: weekNumber,
    year,
    from,
    to,
    asOf,
    total,
    total_saldo_efe,
    deficit_remaining,
    days,
    daysWithCorte,
    daysWithData: days.length,
    formula:
      'Saldo efe = Infocaja − propinas TPV; Tómbola = remanente tras recuperar déficits previos',
    rptError: rptErrMsg,
    financialError: finErrMsg,
  };
}
