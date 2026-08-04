import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';
import { ensureQuoteFolio } from '@/app/lib/eventos-quote-folio';
import { createServiceOrderFromQuote } from '@/app/lib/eventos-service-order';
import {
  buildCotizacionDocFromQuoteRow,
  ensureQuotePublicToken,
  publicQuotePath,
} from '@/app/lib/eventos-quote-public';

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
        '*, lines:event_quote_lines(*), client:event_clients(id, company_name, contact_name, phone, email)'
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

    const folio = await ensureQuoteFolio(
      sb,
      id,
      (data as { quote_number?: string | null }).quote_number
    );
    if (folio && folio !== data.quote_number) {
      (data as { quote_number?: string | null }).quote_number = folio;
    }

    const doc: CotizacionDoc = buildCotizacionDocFromQuoteRow(data);

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

    const public_token = await ensureQuotePublicToken(
      sb,
      id,
      (data as { public_token?: string | null }).public_token
    );
    const public_path = public_token ? publicQuotePath(public_token) : null;

    return NextResponse.json({
      doc,
      quote: data,
      service_order_id,
      public_token,
      public_path,
    });
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
    payment_link_url?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (
    !body.status &&
    body.generate_os == null &&
    body.payment_link_url === undefined
  ) {
    return NextResponse.json(
      { error: 'Indica status, generate_os o payment_link_url' },
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

    const patch: Record<string, unknown> = { updated_at: now };
    if (body.status) patch.status = body.status;
    if (body.payment_link_url !== undefined) {
      const url =
        typeof body.payment_link_url === 'string'
          ? body.payment_link_url.trim()
          : '';
      patch.payment_link_url = url || null;
    }

    if (body.status || body.payment_link_url !== undefined) {
      const { data, error } = await sb
        .from('event_quotes')
        .update(patch)
        .eq('id', id)
        .select(
          '*, lines:event_quote_lines(*), client:event_clients(id, company_name)'
        )
        .single();
      if (error) {
        const missingLink = /payment_link_url|schema cache|column/i.test(
          error.message
        );
        return NextResponse.json(
          {
            error: missingLink
              ? 'Falta migrar payment_link_url. Ejecuta supabase/eventos_quote_accept.sql'
              : error.message,
          },
          { status: missingLink ? 503 : 500 }
        );
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
