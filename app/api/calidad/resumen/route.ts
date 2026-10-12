/**
 * GET /api/calidad/resumen?year=&month=&mesero=
 * Agregados de encuestas. year vacío = todo el histórico.
 */
import { NextResponse } from 'next/server';
import { calidadQueryError, requireCalidadSession } from '@/app/lib/calidad-api';
import { calidadFiltroFromSearch, loadCalidadResumen } from '@/app/lib/calidad-encuestas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireCalidadSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const data = await loadCalidadResumen(calidadFiltroFromSearch(new URL(req.url)));
    return NextResponse.json(data);
  } catch (err) {
    const mapped = calidadQueryError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
