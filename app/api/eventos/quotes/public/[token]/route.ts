import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { ensureQuoteFolio } from '@/app/lib/eventos-quote-folio';
import { buildCotizacionDocFromQuoteRow } from '@/app/lib/eventos-quote-public';
import {
  QUOTE_PAYMENT_METHOD_LABELS,
  getBbvaTransferDetails,
  type QuotePaymentMethod,
} from '@/app/lib/eventos-quote-payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ token: string }> };

/** Supabase tipa joins 1:1 como array; normalizamos a objeto. */
function normalizeClientJoin(row: Record<string, unknown>) {
  const client = row.client;
  if (Array.isArray(client)) {
    row.client = client[0] || null;
  }
  return row;
}

/**
 * GET /api/eventos/quotes/public/[token]
 * Lectura pública (sin sesión) de una cotización por token opaco.
 */
export async function GET(_request: Request, ctx: RouteCtx) {
  const { token: raw } = await ctx.params;
  const token = decodeURIComponent(raw || '').trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'Enlace inválido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_quotes')
      .select(
        'id, quote_number, status, celebration, event_date, pax, notes, apply_servicio, servicio_pct, hold_until, created_at, updated_at, accepted_at, payment_method, client_accept_note, payment_link_url, lines:event_quote_lines(description, quantity, unit_price, options, sort_order), client:event_clients(company_name, contact_name, phone, email)'
      )
      .eq('public_token', token)
      .maybeSingle();

    if (error) {
      const missingToken = /public_token|schema cache|column/i.test(
        error.message
      );
      // Columnas de aceptación aún no migradas → reintentar sin ellas
      const missingAccept =
        /accepted_at|payment_method|client_accept_note|payment_link_url/i.test(
          error.message
        );
      if (missingAccept && !missingToken) {
        const retry = await sb
          .from('event_quotes')
          .select(
            'id, quote_number, status, celebration, event_date, pax, notes, apply_servicio, servicio_pct, hold_until, created_at, updated_at, lines:event_quote_lines(description, quantity, unit_price, options, sort_order), client:event_clients(company_name, contact_name, phone, email)'
          )
          .eq('public_token', token)
          .maybeSingle();
        if (retry.error) {
          return NextResponse.json(
            { error: retry.error.message },
            { status: 500 }
          );
        }
        if (!retry.data) {
          return NextResponse.json(
            { error: 'Cotización no encontrada o enlace vencido' },
            { status: 404 }
          );
        }
        const folio = await ensureQuoteFolio(
          sb,
          String(retry.data.id),
          retry.data.quote_number
        );
        if (folio) {
          (retry.data as { quote_number?: string | null }).quote_number = folio;
        }
        const doc = buildCotizacionDocFromQuoteRow(
          normalizeClientJoin({ ...retry.data }) as Parameters<
            typeof buildCotizacionDocFromQuoteRow
          >[0]
        );
        return NextResponse.json({
          doc,
          can_accept: doc.status !== 'rechazada' && doc.status !== 'vencida',
          accepted: false,
          payment_method_label: null,
          bbva: getBbvaTransferDetails(),
          migration_hint:
            'Ejecuta supabase/eventos_quote_accept.sql para habilitar aceptación online',
        });
      }

      return NextResponse.json(
        {
          error: missingToken
            ? 'Falta migrar public_token. Ejecuta supabase/eventos_quote_public_token.sql'
            : error.message,
        },
        { status: missingToken ? 503 : 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Cotización no encontrada o enlace vencido' },
        { status: 404 }
      );
    }

    const folio = await ensureQuoteFolio(
      sb,
      String(data.id),
      data.quote_number
    );
    if (folio) {
      (data as { quote_number?: string | null }).quote_number = folio;
    }

    const doc = buildCotizacionDocFromQuoteRow(
      normalizeClientJoin({ ...data }) as Parameters<
        typeof buildCotizacionDocFromQuoteRow
      >[0]
    );
    const accepted =
      doc.status === 'aceptada' && Boolean(doc.accepted_at || doc.payment_method);
    const pm = doc.payment_method as QuotePaymentMethod | null | undefined;
    const payment_method_label =
      pm && QUOTE_PAYMENT_METHOD_LABELS[pm]
        ? QUOTE_PAYMENT_METHOD_LABELS[pm]
        : pm || null;

    return NextResponse.json({
      doc,
      can_accept:
        doc.status !== 'rechazada' &&
        doc.status !== 'vencida' &&
        !accepted,
      accepted,
      payment_method_label,
      bbva: getBbvaTransferDetails(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : 'Error al leer cotización pública',
      },
      { status: 500 }
    );
  }
}
