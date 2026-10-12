/**
 * GET /api/calidad/comentarios?year=&month=&mesero=&tono=malo|regular|positivo|sin
 * Comentarios más recientes del tono pedido, más el conteo de los cuatro tonos.
 */
import { NextResponse } from 'next/server';
import { calidadQueryError, requireCalidadSession } from '@/app/lib/calidad-api';
import {
  calidadFiltroFromSearch,
  loadCalidadComentarios,
  parseCalidadTono,
} from '@/app/lib/calidad-encuestas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireCalidadSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  try {
    const data = await loadCalidadComentarios(
      calidadFiltroFromSearch(url),
      parseCalidadTono(url.searchParams.get('tono'))
    );
    return NextResponse.json(data);
  } catch (err) {
    const mapped = calidadQueryError(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
