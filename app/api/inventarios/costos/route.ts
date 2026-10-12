/**
 * GET /api/inventarios/costos?mes=Septiembre
 * Costo por venta de alimentos y bebidas (Sheets, pestaña del mes).
 */
import { NextResponse } from 'next/server';
import { requireInventariosSession } from '@/app/lib/inventarios-api';
import { CostoMesError, loadCostosDashboard } from '@/app/lib/costos-venta';
import { friendlyDriveError } from '@/app/lib/google-drive-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function costosError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('faltan credenciales') || lower.includes('pestañas de mes')) {
    return raw;
  }
  const friendly = friendlyDriveError(err);
  if (friendly.includes('carpeta RH')) {
    return 'No se pudo leer las hojas de costo por venta. Revisa que la cuenta de Google tenga acceso a esos Sheets.';
  }
  return friendly;
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
