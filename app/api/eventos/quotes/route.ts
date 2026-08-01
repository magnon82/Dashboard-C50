import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import {
  EVENTOS_QUOTE_LOCK_WITHIN_DAYS,
  EVENTOS_SERVICIO_PCT,
  canPlaceHold,
  computeQuoteTotals,
  defaultHoldUntil,
  isQuoteLockedByEventDate,
  quoteLockMessage,
  validatePaxAllocation,
  validateQuotePax,
  type QuoteLineInput,
} from '@/app/lib/eventos';
import { isPersistedMenuItemId } from '@/app/lib/eventos-menus-seed';
import { ensureLeadForQuote } from '@/app/lib/eventos-quote-lead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QuoteLineBody = QuoteLineInput & {
  category?: string;
  min_pax?: number | null;
  requires_food?: boolean;
  unit?: string | null;
  options?: Record<string, string> | null;
};

async function insertQuoteLines(
  sb: ReturnType<typeof getServiceSupabase>,
  quoteId: string,
  lines: QuoteLineBody[]
): Promise<string | null> {
  const lineRows = lines.map((l, idx) => ({
    quote_id: quoteId,
    menu_item_id: isPersistedMenuItemId(l.menu_item_id)
      ? l.menu_item_id
      : null,
    description: l.description,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    line_total:
      Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100,
    sort_order: idx,
    options: l.options && typeof l.options === 'object' ? l.options : {},
  }));

  const { error: lineErr } = await sb.from('event_quote_lines').insert(lineRows);
  if (!lineErr) return null;

  const missingOptions = /options|schema cache|column/i.test(lineErr.message);
  if (!missingOptions) return lineErr.message;

  const fallback = lineRows.map(({ options: _o, ...rest }) => rest);
  const { error: retryErr } = await sb.from('event_quote_lines').insert(fallback);
  return retryErr?.message || null;
}

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_quotes')
      .select('*, lines:event_quote_lines(*), client:event_clients(id, company_name)')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      // Tabla pendiente → empty state en UI, no 500
      return NextResponse.json({
        ready: false,
        quotes: [],
        error: error.message,
      });
    }

    const quotes = data || [];
    const quoteIds = quotes.map((q) => String(q.id));
    const osByQuote = new Map<string, string>();
    if (quoteIds.length) {
      try {
        const { data: orders } = await sb
          .from('event_service_orders')
          .select('id, quote_id')
          .in('quote_id', quoteIds);
        for (const o of orders || []) {
          if (o.quote_id) osByQuote.set(String(o.quote_id), String(o.id));
        }
      } catch {
        /* tabla OS aún no migrada */
      }
    }

    return NextResponse.json({
      ready: true,
      quotes: quotes.map((q) => ({
        ...q,
        service_order_id: osByQuote.get(String(q.id)) || null,
      })),
    });
  } catch (e) {
    return NextResponse.json({
      ready: false,
      quotes: [],
      error: e instanceof Error ? e.message : 'Error al leer cotizaciones',
    });
  }
}

export async function POST(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  let body: {
    client_id?: string | null;
    lead_id?: string | null;
    event_date?: string | null;
    pax?: number;
    celebration?: string | null;
    notes?: string;
    /** Contacto de envío: actualiza event_clients antes de crear el lead */
    phone?: string | null;
    email?: string | null;
    contact_name?: string | null;
    apply_servicio?: boolean;
    place_hold?: boolean;
    lines?: QuoteLineBody[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const clientId =
    typeof body.client_id === 'string' ? body.client_id.trim() : '';
  if (!clientId) {
    return NextResponse.json(
      { error: 'Selecciona un cliente para la cotización' },
      { status: 400 }
    );
  }

  const lines = (body.lines || []).filter(
    (l) => l.description && Number(l.quantity) > 0
  );
  if (!lines.length) {
    return NextResponse.json(
      { error: 'Agrega al menos una línea a la cotización' },
      { status: 400 }
    );
  }

  const pax = Number(body.pax || 10);
  if (!Number.isFinite(pax) || pax < 1) {
    return NextResponse.json({ error: 'pax inválido' }, { status: 400 });
  }

  const paxErr = validateQuotePax(
    pax,
    lines.map((l) => ({
      category: l.category,
      requiresFood: l.requires_food,
      min_pax: l.min_pax,
    }))
  );
  if (paxErr) {
    return NextResponse.json({ error: paxErr }, { status: 400 });
  }

  const allocErr = validatePaxAllocation(
    pax,
    lines.map((l) => ({
      quantity: Number(l.quantity),
      unit: l.unit || 'persona',
      category: l.category,
    }))
  );
  if (allocErr) {
    return NextResponse.json({ error: allocErr }, { status: 400 });
  }

  if (isQuoteLockedByEventDate(body.event_date || null)) {
    return NextResponse.json(
      {
        error:
          quoteLockMessage(body.event_date || null) ||
          `Sin cambios: faltan ${EVENTOS_QUOTE_LOCK_WITHIN_DAYS} días o menos para el evento.`,
      },
      { status: 400 }
    );
  }

  const applyServicio = body.apply_servicio !== false;
  const totals = computeQuoteTotals(lines, applyServicio, EVENTOS_SERVICIO_PCT);
  const celebration = (body.celebration || '').trim() || null;
  const notes = (body.notes || '').trim() || null;

  let hold_until: string | null = null;
  if (body.place_hold) {
    if (!canPlaceHold(body.event_date || null)) {
      return NextResponse.json(
        {
          error:
            'No se puede poner hold: faltan menos de 15 días para el evento.',
        },
        { status: 400 }
      );
    }
    hold_until = defaultHoldUntil().toISOString();
  }

  try {
    const sb = getServiceSupabase();
    const now = new Date().toISOString();

    // Cotizador puede sobreescribir contacto/tel/correo del cliente (sin schema en event_quotes)
    const patchPhone = body.phone !== undefined;
    const patchEmail = body.email !== undefined;
    const patchContact = body.contact_name !== undefined;
    if (patchPhone || patchEmail || patchContact) {
      const clientPatch: Record<string, string | null> = { updated_at: now };
      if (patchPhone) {
        clientPatch.phone =
          typeof body.phone === 'string' ? body.phone.trim() || null : null;
      }
      if (patchEmail) {
        clientPatch.email =
          typeof body.email === 'string' ? body.email.trim() || null : null;
      }
      if (patchContact) {
        clientPatch.contact_name =
          typeof body.contact_name === 'string'
            ? body.contact_name.trim() || null
            : null;
      }
      const { error: clientUpdErr } = await sb
        .from('event_clients')
        .update(clientPatch)
        .eq('id', clientId);
      if (clientUpdErr) {
        return NextResponse.json(
          { error: `No se pudo actualizar contacto del cliente: ${clientUpdErr.message}` },
          { status: 500 }
        );
      }
    }

    const quoteNumber = `EVT-${now.slice(0, 10).replace(/-/g, '')}-${Math.floor(
      Math.random() * 900 + 100
    )}`;

    const baseRow = {
      quote_number: quoteNumber,
      client_id: clientId,
      lead_id: body.lead_id || null,
      status: 'borrador' as const,
      event_date: body.event_date || null,
      pax,
      celebration,
      subtotal: totals.subtotal,
      servicio_pct: totals.servicioPct,
      servicio_amount: totals.servicioAmount,
      total: totals.total,
      apply_servicio: totals.applyServicio,
      owner_username: auth.username,
      notes,
      hold_until,
      created_at: now,
      updated_at: now,
    };

    let quote: Record<string, unknown> | null = null;
    let insertError: { message: string } | null = null;

    {
      const { data, error } = await sb
        .from('event_quotes')
        .insert(baseRow)
        .select('*')
        .single();
      quote = data;
      insertError = error;
    }

    // DB sin columna celebration → reintentar sin ella
    if (insertError && /celebration/i.test(insertError.message)) {
      const { celebration: _c, ...withoutCelebration } = baseRow;
      const notesFallback = [celebration ? `Celebración: ${celebration}` : '', notes]
        .filter(Boolean)
        .join('\n') || null;
      const { data, error } = await sb
        .from('event_quotes')
        .insert({ ...withoutCelebration, notes: notesFallback })
        .select('*')
        .single();
      quote = data;
      insertError = error;
    }

    if (insertError || !quote) {
      const msg = insertError?.message || 'No se pudo crear cotización';
      const missing =
        /does not exist|schema cache|relation .*event_quotes/i.test(msg);
      return NextResponse.json(
        {
          error: msg,
          ready: false,
          hint: missing
            ? 'Ejecuta supabase/eventos_module.sql en el SQL Editor de Supabase.'
            : undefined,
        },
        { status: 500 }
      );
    }

    const quoteId = String(quote.id);
    const lineErr = await insertQuoteLines(sb, quoteId, lines);
    if (lineErr) {
      return NextResponse.json(
        { error: lineErr, quote },
        { status: 500 }
      );
    }

    // Lead CRM automático (form «Nuevo lead») + quote.lead_id; dedup por lead_id / cliente+fecha
    const leadResult = await ensureLeadForQuote(sb, {
      quoteId,
      existingLeadId: (quote.lead_id as string | null) || body.lead_id || null,
      clientId,
      eventDate: body.event_date || null,
      pax,
      celebration,
      notes,
      holdUntil: hold_until,
      total: totals.total,
      ownerUsername: auth.username,
      quoteNumber,
    });

    if (leadResult.leadId) {
      quote = { ...quote, lead_id: leadResult.leadId };
    }

    const { data: full } = await sb
      .from('event_quotes')
      .select('*, lines:event_quote_lines(*)')
      .eq('id', quoteId)
      .single();

    return NextResponse.json(
      {
        quote: full || quote,
        lead_id: leadResult.leadId,
        lead_created: leadResult.leadCreated,
        lead_error: leadResult.error || null,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar cotización' },
      { status: 500 }
    );
  }
}
