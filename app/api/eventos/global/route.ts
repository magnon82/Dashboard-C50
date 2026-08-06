import { NextResponse } from 'next/server';
import { requireEventosSession } from '@/app/lib/eventos-api';
import { loadEventosGlobal } from '@/app/lib/eventos-global';
import { todayCdmxIso } from '@/app/lib/tpv-cortes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/eventos/global?year=2026 — pestaña Global (VENTA + VENTA EXTRA). */
export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const yearRaw = Number(url.searchParams.get('year') || '');
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100
      ? yearRaw
      : Number(todayCdmxIso().slice(0, 4));

  const payload = await loadEventosGlobal(year);
  return NextResponse.json(payload);
}
