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
  CRISTALERIA_FORMULA_BLURB,
  buildCristaleriaConciliacion,
  fetchRecordsForCristaleriaConciliacion,
} from '@/app/lib/cristaleria-conciliacion';
import type { FinancialRecord } from '@/app/lib/ventas-semana';
import { getServiceSupabase } from '@/app/lib/users';

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
 * GET /api/finanzas/cristaleria-conciliacion?year=2026
 */
export async function GET(request: NextRequest) {
  const auth = await requireFinanzasViewer();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: 'year inválido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const records = await fetchRecordsForCristaleriaConciliacion(sb, year);
    const summary = buildCristaleriaConciliacion(records as FinancialRecord[], year);

    return NextResponse.json({
      ...summary,
      formula: CRISTALERIA_FORMULA_BLURB,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
