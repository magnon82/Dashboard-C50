import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import {
  EVENTOS_SERVICIO_PCT,
  type QuoteLineOptions,
} from '@/app/lib/eventos';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';
import { createServiceOrderFromQuote } from '@/app/lib/eventos-service-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUOTE_STATUSES = [
  'borrador',
  'enviada',
  'aceptada',
  'rechazada',
  'vencida',
] as const;

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

    let service_order_id: string | null = null;
    try {
      const { data: os } = await sb
        .from('event_service_orders')
        .select('id')
        .eq('quote_id', id)
        .maybeSingle();
      service_order_id = os?.id ? String(os.id) : null;
    } catch {
      service_order_id = null;
    }

    return NextResponse.json({ doc, quote: data, service_order_id });
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

/**
 * PATCH /api/eventos/quotes/[id]
 * Body: { status, generate_os? }
 * Si status=aceptada (o generate_os=true), crea/actualiza OS digital.
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

  let body: {
    status?: string;
    generate_os?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.status && body.generate_os == null) {
    return NextResponse.json(
      { error: 'Indica status o generate_os' },
      { status: 400 }
    );
  }

  if (
    body.status &&
    !QUOTE_STATUSES.includes(body.status as (typeof QUOTE_STATUSES)[number])
  ) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const now = new Date().toISOString();
    let quote: Record<string, unknown> | null = null;

    if (body.status) {
      const { data, error } = await sb
        .from('event_quotes')
        .update({ status: body.status, updated_at: now })
        .eq('id', id)
        .select(
          '*, lines:event_quote_lines(*), client:event_clients(id, company_name)'
        )
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      quote = data;
    }

    const shouldOs =
      body.generate_os === true || body.status === 'aceptada';

    if (!shouldOs) {
      return NextResponse.json({ quote, service_order: null });
    }

    const osResult = await createServiceOrderFromQuote(sb, {
      quoteId: id,
      ownerUsername: auth.username,
      markQuoteAccepted: true,
      markLeadGanado: true,
    });

    if (!osResult.order) {
      return NextResponse.json(
        {
          quote,
          error: osResult.error || 'No se pudo generar OS',
          hint: osResult.hint,
          service_order: null,
        },
        { status: osResult.hint ? 503 : 400 }
      );
    }

    return NextResponse.json({
      quote,
      service_order: osResult.order,
      service_order_id: osResult.order.id,
      created: osResult.created,
      href: `/eventos/os/${osResult.order.id}`,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al actualizar cotización',
      },
      { status: 500 }
    );
  }
}
