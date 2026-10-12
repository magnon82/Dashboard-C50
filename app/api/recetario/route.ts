/**
 * GET /api/recetario?area=cocina|barra&mes=Septiembre
 * Lee la copia local del recetario. No consulta Drive.
 */
import { NextResponse } from 'next/server';
import { requireRecetarioSession } from '@/app/lib/recetario-api';
import { loadRecetario } from '@/app/lib/recetario';
import type { RecetaArea } from '@/app/lib/recetario-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const area = url.searchParams.get('area');
  if (area !== 'cocina' && area !== 'barra') {
    return NextResponse.json({ error: 'Área inválida' }, { status: 400 });
  }
  const auth = await requireRecetarioSession(area as RecetaArea);
  if (auth instanceof NextResponse) return auth;
  try {
    const data = await loadRecetario(area, url.searchParams.get('mes'));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'No se pudo cargar el recetario.' }, { status: 500 });
  }
}
