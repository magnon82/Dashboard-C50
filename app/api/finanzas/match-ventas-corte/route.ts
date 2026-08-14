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
  sumInfocajaDay,
  type StaffRptInfocajaDay,
  type StaffRptRow,
} from '@/app/lib/staff-rpt';
import { isTpvSchemaError, tpvSchemaHint } from '@/app/lib/tpv-api';
import { todayCdmxIso } from '@/app/lib/tpv-cortes';
import { getServiceSupabase } from '@/app/lib/users';
import {
  MATCH_FORMULA_BLURB,
  MATCH_VENTAS_CORTE_EPOCH,
  buildMatchVentasCorteDays,
  clampMatchMonth,
  countStatuses,
  emptyStatusCounts,
  matchMonthBounds,
  type MatchVentasCortePayload,
} from '@/app/lib/finanzas-match-ventas-corte';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireFinanzasViewer(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesion invalida' }, { status: 401 });
  }
  const ok =
    canAccessAdmin(session) ||
    canAccessModule(session, 'finanzas') ||
    canAccessModule(session, 'ventas');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso a Finanzas' }, { status: 403 });
  }
  return session;
}

/**
 * GET /api/finanzas/match-ventas-corte?year=2026&month=8
 *
 * Dia a dia (desde 2026-08-01): Infocaja vs corte TPV / tombola,
 * con deficit de propinas > efectivo arrastrado hasta recuperarlo.
 */
export async function GET(req: NextRequest) {
  const auth = await requireFinanzasViewer();
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const today = todayCdmxIso();
  const rawYear = Number(sp.get('year')) || Number(today.slice(0, 4));
  const rawMonth = Number(sp.get('month')) || Number(today.slice(5, 7));
  const { year, month } = clampMatchMonth(rawYear, rawMonth);
  const { from, to } = matchMonthBounds(year, month);
  const asOf = to > today ? today : to;

  const empty = (error?: string): MatchVentasCortePayload => ({
    ready: !error,
    year,
    month,
    from,
    to,
    asOf,
    epoch: MATCH_VENTAS_CORTE_EPOCH,
    deficit_before: 0,
    deficit_remaining: 0,
    days: [],
    counts: emptyStatusCounts(),
    formula: MATCH_FORMULA_BLURB,
    error,
  });

  try {
    const sb = getServiceSupabase();
    const rptByDate = new Map<string, StaffRptRow>();
    const infocajaByDate = new Map<string, StaffRptInfocajaDay>();
    let rptErr: string | null = null;
    let finErr: string | null = null;
    let schemaMissing = false;

    try {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .gte('rpt_date', MATCH_VENTAS_CORTE_EPOCH)
        .lte('rpt_date', asOf)
        .order('rpt_date', { ascending: true });

      if (error) {
        if (isTpvSchemaError(error.message)) {
          schemaMissing = true;
          rptErr = 'Falta staff_rpt_diario';
        } else {
          rptErr = error.message;
        }
      } else {
        for (const raw of data || []) {
          const rpt = asStaffRptRow(raw as Record<string, unknown>);
          rptByDate.set(rpt.rpt_date, rpt);
        }
      }
    } catch (e) {
      rptErr = e instanceof Error ? e.message : 'Error leyendo cortes';
    }

    try {
      const { data: finRows, error: finError } = await sb
        .from('financial_records')
        .select('date, category, amount, source_file')
        .eq('source_file', 'infocaja')
        .gte('date', MATCH_VENTAS_CORTE_EPOCH)
        .lte('date', asOf);

      if (finError) {
        finErr = finError.message;
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
      finErr = e instanceof Error ? e.message : 'Error leyendo Infocaja';
    }

    if (schemaMissing && infocajaByDate.size === 0) {
      return NextResponse.json(
        {
          ...empty(
            'Falta staff_rpt_diario y no hay Infocaja. Ejecuta supabase/staff_corte_prod_fix.sql'
          ),
          hint: tpvSchemaHint(rptErr || ''),
        },
        { status: 500 }
      );
    }

    if (rptErr && !schemaMissing && infocajaByDate.size === 0) {
      return NextResponse.json(empty(rptErr), { status: 500 });
    }
    if (finErr && rptByDate.size === 0) {
      return NextResponse.json(empty(finErr), { status: 500 });
    }

    const built = buildMatchVentasCorteDays({
      monthFrom: from,
      monthTo: to,
      asOf,
      seedFrom: MATCH_VENTAS_CORTE_EPOCH,
      rptByDate,
      infocajaByDate,
    });

    const payload: MatchVentasCortePayload = {
      ready: true,
      year,
      month,
      from,
      to,
      asOf,
      epoch: MATCH_VENTAS_CORTE_EPOCH,
      deficit_before: built.deficit_before,
      deficit_remaining: built.deficit_remaining,
      days: built.days,
      counts: countStatuses(built.days),
      formula: MATCH_FORMULA_BLURB,
    };

    return NextResponse.json({
      ...payload,
      rptError: rptErr,
      financialError: finErr,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar match';
    return NextResponse.json(
      {
        ...empty(msg),
        hint: isTpvSchemaError(msg) ? tpvSchemaHint(msg) : undefined,
      },
      { status: 500 }
    );
  }
}
