import { NextResponse } from 'next/server';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import {
  getServiceOrderById,
  updateServiceOrder,
} from '@/app/lib/eventos-service-order';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/eventos/os/[id] — detalle de OS digital
 */
export async function GET(_request: Request, ctx: RouteCtx) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { order, error, hint } = await getServiceOrderById(sb, id);
    if (!order) {
      return NextResponse.json(
        { error: error || 'OS no encontrada', hint },
        { status: error === 'OS no encontrada' ? 404 : 500 }
      );
    }
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al leer OS',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/eventos/os/[id]
 * Body: { status?, notes? }
 */
export async function PATCH(request: Request, ctx: RouteCtx) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  let body: { status?: string; notes?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.status === undefined && body.notes === undefined) {
    return NextResponse.json(
      { error: 'Indica status o notes' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const { order, error, hint } = await updateServiceOrder(sb, id, {
      status: body.status,
      notes: body.notes,
    });
    if (!order) {
      return NextResponse.json(
        { error: error || 'No se pudo actualizar', hint },
        { status: hint ? 503 : 400 }
      );
    }
    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al actualizar OS',
      },
      { status: 500 }
    );
  }
}
