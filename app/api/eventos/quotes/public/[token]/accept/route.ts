import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  QUOTE_PAYMENT_METHOD_LABELS,
  getBbvaTransferDetails,
  isQuotePaymentMethod,
  type QuotePaymentMethod,
} from '@/app/lib/eventos-quote-payment';
import { allowPublicQuoteRequest } from '@/app/lib/public-quote-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ token: string }> };

const MISSING_ACCEPT_COLS =
  /accepted_at|payment_method|client_accept_note|schema cache|column/i;

/**
 * POST /api/eventos/quotes/public/[token]/accept
 * Aceptación pública (sin sesión): status → aceptada + método de pago.
 */
export async function POST(request: Request, ctx: RouteCtx) {
  if (!allowPublicQuoteRequest(request)) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta en un minuto.' },
      { status: 429 }
    );
  }

  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw || '').trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'Enlace inválido' }, { status: 400 });
  }

  let body: {
    payment_method?: string;
    client_note?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!isQuotePaymentMethod(body.payment_method)) {
    return NextResponse.json(
      {
        error:
          'Elige un método de pago válido: efectivo_restaurante, tarjeta_terminal, tarjeta_link o transferencia_bbva',
      },
      { status: 400 }
    );
  }
  const payment_method: QuotePaymentMethod = body.payment_method;

  const client_note =
    typeof body.client_note === 'string'
      ? body.client_note.trim().slice(0, 500) || null
      : null;

  try {
    const sb = getServiceSupabase();
    const { data: quote, error } = await sb
      .from('event_quotes')
      .select(
        'id, status, accepted_at, payment_method, payment_link_url, quote_number, client_accept_note, lead_id'
      )
      .eq('public_token', token)
      .maybeSingle();

    if (error) {
      const missing = /public_token|schema cache|column/i.test(error.message);
      return NextResponse.json(
        {
          error: missing
            ? 'Falta migrar public_token. Ejecuta supabase/eventos_quote_public_token.sql'
            : error.message,
        },
        { status: missing ? 503 : 500 }
      );
    }

    if (!quote) {
      return NextResponse.json(
        { error: 'Cotización no encontrada o enlace vencido' },
        { status: 404 }
      );
    }

    const status = String(quote.status || '');
    if (status === 'rechazada' || status === 'vencida') {
      return NextResponse.json(
        {
          error:
            status === 'rechazada'
              ? 'Esta cotización fue rechazada y ya no se puede aceptar'
              : 'Esta cotización está vencida',
        },
        { status: 409 }
      );
    }

    if (status === 'aceptada' && quote.accepted_at) {
      return NextResponse.json({
        ok: true,
        already_accepted: true,
        status: 'aceptada',
        accepted_at: quote.accepted_at,
        payment_method: quote.payment_method,
        payment_method_label: quote.payment_method
          ? QUOTE_PAYMENT_METHOD_LABELS[
              quote.payment_method as QuotePaymentMethod
            ] || quote.payment_method
          : null,
        payment_link_url: quote.payment_link_url || null,
        bbva: getBbvaTransferDetails(),
        message: 'Esta cotización ya fue aceptada',
      });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await sb
      .from('event_quotes')
      .update({
        status: 'aceptada',
        accepted_at: now,
        payment_method,
        client_accept_note: client_note,
        updated_at: now,
      })
      .eq('id', quote.id)
      .select(
        'id, quote_number, status, accepted_at, payment_method, client_accept_note, payment_link_url'
      )
      .single();

    if (updErr) {
      if (MISSING_ACCEPT_COLS.test(updErr.message)) {
        return NextResponse.json(
          {
            error:
              'Falta migrar columnas de aceptación. Ejecuta supabase/eventos_quote_accept.sql',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Lead → negociacion (ganado lo marca staff al generar OS)
    if (quote.lead_id) {
      try {
        await sb
          .from('event_leads')
          .update({ stage: 'negociacion', updated_at: now })
          .eq('id', quote.lead_id)
          .in('stage', ['nuevo', 'contactado', 'cotizado']);
      } catch {
        /* lead opcional */
      }
    }

    return NextResponse.json({
      ok: true,
      already_accepted: false,
      status: updated?.status || 'aceptada',
      accepted_at: updated?.accepted_at || now,
      payment_method: updated?.payment_method || payment_method,
      payment_method_label: QUOTE_PAYMENT_METHOD_LABELS[payment_method],
      payment_link_url: updated?.payment_link_url || null,
      client_accept_note: updated?.client_accept_note || client_note,
      bbva: getBbvaTransferDetails(),
      message:
        'Cotización aceptada. Gracias — el equipo de Eventos te contactará.',
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : 'Error al aceptar la cotización',
      },
      { status: 500 }
    );
  }
}
