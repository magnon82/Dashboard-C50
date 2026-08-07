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
  dayTombolaFromRpt,
} from '@/app/lib/staff-rpt';
import { isTpvSchemaError, tpvSchemaHint } from '@/app/lib/tpv-api';
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
 * Suma semanal (lun–dom CDMX / Acumulado) de tómbola:
 * efectivo Infocaja − propinas TPV, por días con corte cerrado.
 *
 * Query: week? year? | from&to (YYYY-MM-DD)
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
  } else {
    weekNumber = acumuladoWeekForDate(from);
    year = Number(from.slice(0, 4));
  }

  if (from > to) {
    return NextResponse.json(
      { error: 'from debe ser ≤ to' },
      { status: 400 }
    );
  }

  // Semana en curso: no sumar días futuros (aún sin corte).
  const asOf = to > today ? today : to;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from(STAFF_RPT_TABLE)
      .select('*')
      .gte('rpt_date', from)
      .lte('rpt_date', asOf)
      .order('rpt_date', { ascending: true });

    if (error) {
      if (isTpvSchemaError(error.message)) {
        return NextResponse.json(
          {
            ready: false,
            week: weekNumber,
            year,
            from,
            to,
            asOf,
            total: 0,
            days: [],
            daysWithCorte: 0,
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

    const days: Array<{
      date: string;
      tombola: number;
      efectivo: number | null;
      propinas_tpv: number;
      source: 'formula' | 'depositado';
    }> = [];

    for (const raw of data || []) {
      const rpt = asStaffRptRow(raw as Record<string, unknown>);
      const day = dayTombolaFromRpt(rpt);
      days.push({
        date: rpt.rpt_date,
        tombola: day.amount,
        efectivo: day.efectivo,
        propinas_tpv: day.propinas_tpv,
        source: day.source,
      });
    }

    const total =
      Math.round(days.reduce((a, d) => a + d.tombola, 0) * 100) / 100;

    return NextResponse.json({
      ready: true,
      week: weekNumber,
      year,
      from,
      to,
      asOf,
      total,
      days,
      daysWithCorte: days.length,
      formula: 'efectivo Infocaja − propinas TPV (por día cerrado)',
    });
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
        days: [],
        daysWithCorte: 0,
        error: msg,
        hint: isTpvSchemaError(msg) ? tpvSchemaHint(msg) : undefined,
      },
      { status: 500 }
    );
  }
}
