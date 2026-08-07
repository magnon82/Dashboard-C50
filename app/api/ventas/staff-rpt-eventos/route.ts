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
  totalEventosAmount,
} from '@/app/lib/staff-rpt';
import { isTpvSchemaError, tpvSchemaHint } from '@/app/lib/tpv-api';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireViewer(): Promise<SessionUser | NextResponse> {
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
    canAccessAdmin(session) ||
    canAccessModule(session, 'ventas') ||
    canAccessModule(session, 'reportes-socios');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  return session;
}

function parseIso(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * GET /api/ventas/staff-rpt-eventos?from=&to=
 * Eventos por día desde staff_rpt_diario (OS + extra → eventos_amount).
 * Fallback cuando financial_records source_file=eventos no tiene el día.
 */
export async function GET(req: NextRequest) {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const from = parseIso(sp.get('from'));
  const to = parseIso(sp.get('to'));
  if (!from || !to) {
    return NextResponse.json(
      { error: 'Parámetros from y to (YYYY-MM-DD) requeridos' },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json(
      { error: 'from debe ser ≤ to' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from(STAFF_RPT_TABLE)
      .select(
        'rpt_date,eventos_amount,eventos_os_amount,eventos_extra_amount'
      )
      .gte('rpt_date', from)
      .lte('rpt_date', to)
      .order('rpt_date', { ascending: true });

    if (error) {
      if (isTpvSchemaError(error.message)) {
        return NextResponse.json(
          {
            ready: false,
            from,
            to,
            byDate: {} as Record<string, number>,
            schemaMissing: true,
            error:
              'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_corte_prod_fix.sql',
            hint: tpvSchemaHint(error.message),
          },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }

    const byDate: Record<string, number> = {};
    for (const raw of data || []) {
      const rpt = asStaffRptRow(raw as Record<string, unknown>);
      const amount = totalEventosAmount(
        rpt.eventos_os_amount,
        rpt.eventos_extra_amount
      );
      if (amount > 0) byDate[rpt.rpt_date] = amount;
    }

    return NextResponse.json({
      ready: true,
      from,
      to,
      byDate,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        from,
        to,
        byDate: {} as Record<string, number>,
        error: e instanceof Error ? e.message : 'Error al leer staff_rpt',
      },
      { status: 500 }
    );
  }
}
