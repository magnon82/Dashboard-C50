/**
 * PATCH /api/recetario/ficha
 * Guarda textos de la ficha en Supabase. No escribe en Drive.
 */
import { NextResponse } from 'next/server';
import { requireRecetarioSession } from '@/app/lib/recetario-api';
import { saveFicha } from '@/app/lib/recetario';
import type { Ficha, RecetaArea } from '@/app/lib/recetario-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    area?: RecetaArea;
    sku?: string;
    ficha?: Partial<Ficha>;
  } | null;
  if (!body || (body.area !== 'cocina' && body.area !== 'barra') || !body.sku) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
  }
  const auth = await requireRecetarioSession(body.area);
  if (auth instanceof NextResponse) return auth;
  const saved = await saveFicha(body.sku, body.ficha || {});
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 503 });
  return NextResponse.json({ ok: true });
}
