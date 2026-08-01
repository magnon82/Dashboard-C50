import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireEventosSession } from '@/app/lib/eventos-api';
import {
  EVENTOS_SERVICIO_PCT,
  type QuoteLineOptions,
} from '@/app/lib/eventos';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: RouteCtx) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_quotes')
      .select(
        '*, lines:event_quote_lines(*), client:event_clients(id, company_name, contact_name)'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message, ready: false },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Cotización no encontrada' },
        { status: 404 }
      );
    }

    const client = data.client as {
      company_name?: string;
      contact_name?: string | null;
    } | null;

    const lines = (
      (data.lines as Array<{
        description: string;
        quantity: number;
        unit_price: number;
        options?: QuoteLineOptions | null;
        sort_order?: number;
      }>) || []
    )
      .slice()
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      .map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        options: (l.options || {}) as QuoteLineOptions,
      }));

    const doc: CotizacionDoc = {
      quote_number: data.quote_number || null,
      status: data.status || null,
      client_name: client?.company_name || null,
      contact_name: client?.contact_name || null,
      celebration: data.celebration || null,
      event_date: data.event_date || null,
      pax: Number(data.pax || 0),
      notes: data.notes || null,
      apply_servicio: data.apply_servicio !== false,
      servicio_pct: Number(data.servicio_pct ?? EVENTOS_SERVICIO_PCT),
      hold_until: data.hold_until || null,
      lines,
      issued_at: data.created_at || data.updated_at || null,
    };

    return NextResponse.json({ doc, quote: data });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : 'Error al leer cotización',
      },
      { status: 500 }
    );
  }
}
