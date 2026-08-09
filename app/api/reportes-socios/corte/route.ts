import { NextResponse } from 'next/server';
import { requireReportesSociosSession } from '@/app/lib/reportes-socios-api';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  type StaffRptRow,
} from '@/app/lib/staff-rpt';
import { isTpvSchemaError, tpvSchemaHint } from '@/app/lib/tpv-api';
import { shiftIsoDate, todayCdmxIso } from '@/app/lib/tpv-cortes';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type SociosCorteMode = 'yesterday' | 'latest' | 'none';

function summarizeRpt(rpt: StaffRptRow) {
  return {
    rpt_date: rpt.rpt_date,
    wi_amount: rpt.wi_amount,
    eventos_amount: rpt.eventos_amount,
    eventos_os_amount: rpt.eventos_os_amount,
    eventos_extra_amount: rpt.eventos_extra_amount,
    // Notas operativas del corte solo en Ventas/Cortes (no socios).
    updated_at: rpt.updated_at,
    updated_by: rpt.updated_by,
  };
}

/**
 * GET /api/reportes-socios/corte
 * Resumen del corte de ayer (CDMX) para socios; si no hay, el más reciente.
 */
export async function GET() {
  const auth = await requireReportesSociosSession();
  if (auth instanceof NextResponse) return auth;

  const yesterdayDate = shiftIsoDate(todayCdmxIso(), -1);

  try {
    const sb = getServiceSupabase();

    const { data: yesterdayRow, error: yesterdayErr } = await sb
      .from(STAFF_RPT_TABLE)
      .select('*')
      .eq('rpt_date', yesterdayDate)
      .maybeSingle();

    if (yesterdayErr) {
      if (isTpvSchemaError(yesterdayErr.message)) {
        return NextResponse.json(
          {
            ready: false,
            mode: 'none' as SociosCorteMode,
            yesterdayDate,
            date: null,
            isYesterday: false,
            corte: null,
            schemaMissing: true,
            error:
              'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_corte_prod_fix.sql',
            hint: tpvSchemaHint(yesterdayErr.message),
          },
          { status: 503 }
        );
      }
      throw new Error(yesterdayErr.message);
    }

    if (yesterdayRow) {
      const rpt = asStaffRptRow(yesterdayRow as Record<string, unknown>);
      return NextResponse.json({
        ready: true,
        mode: 'yesterday' as SociosCorteMode,
        yesterdayDate,
        date: rpt.rpt_date,
        isYesterday: true,
        corte: summarizeRpt(rpt),
      });
    }

    const { data: latestRows, error: latestErr } = await sb
      .from(STAFF_RPT_TABLE)
      .select('*')
      .order('rpt_date', { ascending: false })
      .limit(1);

    if (latestErr) {
      if (isTpvSchemaError(latestErr.message)) {
        return NextResponse.json(
          {
            ready: false,
            mode: 'none' as SociosCorteMode,
            yesterdayDate,
            date: null,
            isYesterday: false,
            corte: null,
            schemaMissing: true,
            error:
              'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_corte_prod_fix.sql',
            hint: tpvSchemaHint(latestErr.message),
          },
          { status: 503 }
        );
      }
      throw new Error(latestErr.message);
    }

    const latest = latestRows?.[0];
    if (!latest) {
      return NextResponse.json({
        ready: true,
        mode: 'none' as SociosCorteMode,
        yesterdayDate,
        date: null,
        isYesterday: false,
        corte: null,
      });
    }

    const rpt = asStaffRptRow(latest as Record<string, unknown>);
    return NextResponse.json({
      ready: true,
      mode: 'latest' as SociosCorteMode,
      yesterdayDate,
      date: rpt.rpt_date,
      isYesterday: false,
      corte: summarizeRpt(rpt),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar corte';
    return NextResponse.json(
      {
        ready: false,
        mode: 'none' as SociosCorteMode,
        yesterdayDate,
        date: null,
        isYesterday: false,
        corte: null,
        error: msg,
        hint: isTpvSchemaError(msg) ? tpvSchemaHint(msg) : undefined,
      },
      { status: 500 }
    );
  }
}
