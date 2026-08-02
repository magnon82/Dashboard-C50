import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireVentasSession } from '@/app/lib/tpv-api';
import { defaultCorteDateCdmx } from '@/app/lib/tpv-cortes';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  isInfocajaVentaTotalCategory,
} from '@/app/lib/staff-rpt';
import {
  eachIsoDateInclusive,
  isEventosSalesCategory,
  resolveTipSalesDay,
  type TipSalesDaySource,
  type TipSalesRangeResult,
} from '@/app/lib/staff-propinas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/staff-propinas?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Ventas WI / Eventos del periodo para la calculadora de propinas.
 * Prioridad por día: staff_rpt (corte con montos) → Infocaja Venta Total + Eventos.
 * Si falta staff_rpt_diario, no falla: sigue con financial_records (Infocaja).
 */
export async function GET(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const today = defaultCorteDateCdmx();
  let from = (url.searchParams.get('from') || today).slice(0, 10);
  let to = (url.searchParams.get('to') || from).slice(0, 10);

  if (!ISO.test(from) || !ISO.test(to)) {
    return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
  }
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  try {
    const sb = getServiceSupabase();
    const dates = eachIsoDateInclusive(from, to);

    const rptByDate = new Map<string, { wi: number; eventos: number }>();
    let rptErrMsg: string | null = null;

    // Corte RPT es opcional para propinas — nunca abortar el lookup de Infocaja.
    try {
      const { data: rptRows, error: rptError } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .gte('rpt_date', from)
        .lte('rpt_date', to);

      if (rptError) {
        if (/relation|does not exist|schema cache/i.test(rptError.message)) {
          rptErrMsg =
            'Falta la tabla staff_rpt_diario (opcional para propinas si hay Infocaja)';
        } else {
          rptErrMsg = rptError.message;
        }
      } else {
        for (const raw of rptRows || []) {
          const row = asStaffRptRow(raw as Record<string, unknown>);
          rptByDate.set(row.rpt_date, {
            wi: row.wi_amount,
            eventos: row.eventos_amount,
          });
        }
      }
    } catch (e) {
      rptErrMsg =
        e instanceof Error
          ? e.message
          : 'No se pudo leer staff_rpt_diario (se intenta Infocaja)';
    }

    const infocajaTotalByDate = new Map<string, number>();
    const eventosByDate = new Map<string, number>();
    let finErrMsg: string | null = null;

    try {
      const { data: finRows, error: finError } = await sb
        .from('financial_records')
        .select('date, category, amount, source_file')
        .in('source_file', ['infocaja', 'eventos'])
        .gte('date', from)
        .lte('date', to);

      if (finError) {
        finErrMsg = finError.message;
      } else {
        for (const r of finRows || []) {
          const date = String((r as { date?: string }).date || '').slice(0, 10);
          if (!date) continue;
          const amt = Number((r as { amount?: number }).amount) || 0;
          const source = String(
            (r as { source_file?: string }).source_file || ''
          );
          const cat = String((r as { category?: string }).category || '');
          if (source === 'infocaja' && isInfocajaVentaTotalCategory(cat)) {
            infocajaTotalByDate.set(
              date,
              Math.round(((infocajaTotalByDate.get(date) || 0) + amt) * 100) /
                100
            );
          } else if (source === 'eventos' && isEventosSalesCategory(cat)) {
            eventosByDate.set(
              date,
              Math.round(((eventosByDate.get(date) || 0) + amt) * 100) / 100
            );
          }
        }
      }
    } catch (e) {
      finErrMsg =
        e instanceof Error
          ? e.message
          : 'No se pudieron leer ventas Infocaja / Eventos';
    }

    const days = dates.map((date) => {
      const rpt = rptByDate.get(date) ?? null;
      const ventaTotal = infocajaTotalByDate.get(date);
      const eventosFin = eventosByDate.get(date);
      return resolveTipSalesDay(date, {
        rpt,
        infocajaVentaTotal: ventaTotal ?? null,
        eventosFinancial: eventosFin ?? null,
      });
    });

    const ventasWi =
      Math.round(days.reduce((s, d) => s + d.ventasWi, 0) * 100) / 100;
    const ventasEventos =
      Math.round(days.reduce((s, d) => s + d.ventasEventos, 0) * 100) / 100;
    const daysWithData = days.filter((d) => d.source !== 'ninguno').length;

    const sourceCounts: Record<TipSalesDaySource, number> = {
      corte: 0,
      sistema: 0,
      ninguno: 0,
    };
    for (const d of days) sourceCounts[d.source] += 1;

    let primarySource: TipSalesDaySource | 'mixto' = 'ninguno';
    if (sourceCounts.corte && sourceCounts.sistema) primarySource = 'mixto';
    else if (sourceCounts.corte) primarySource = 'corte';
    else if (sourceCounts.sistema) primarySource = 'sistema';

    const result: TipSalesRangeResult = {
      from,
      to,
      today,
      ventasWi,
      ventasEventos,
      daysWithData,
      dayCount: days.length,
      primarySource,
      sourceCounts,
      days,
      rptError: rptErrMsg,
      financialError: finErrMsg,
    };

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : 'Error al cargar ventas de propinas',
      },
      { status: 500 }
    );
  }
}
