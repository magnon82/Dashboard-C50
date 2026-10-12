/**
 * GET /api/inventarios/costos?mes=Septiembre
 * Costo por venta guardado en Supabase (no lee Drive en cada visita).
 */
import { NextResponse } from 'next/server';
import { requireInventariosSession } from '@/app/lib/inventarios-api';
import { CostoMesError, loadCostosDashboard } from '@/app/lib/costos-venta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function costosError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes('importado') ||
    lower.includes('base de datos') ||
    lower.includes('no tiene costo')
  ) {
    return raw;
  }
  return 'No se pudo cargar el costo por venta guardado.';
}

export async function GET(req: Request) {
  const auth = await requireInventariosSession();
  if (auth instanceof NextResponse) return auth;

  const mes = new URL(req.url).searchParams.get('mes');
  try {
    const data = await loadCostosDashboard(mes);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof CostoMesError) {
      return NextResponse.json(
        { error: err.message, meses: err.meses },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: costosError(err) }, { status: 502 });
  }
}
