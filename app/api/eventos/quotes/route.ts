import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import {
  EVENTOS_SERVICIO_PCT,
  canPlaceHold,
  computeQuoteTotals,
  defaultHoldUntil,
  type QuoteLineInput,
} from '@/app/lib/eventos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ quotes: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al leer cotizaciones' },
      { status: 500 }
    );
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
    notes?: string;
    apply_servicio?: boolean;
    place_hold?: boolean;
    lines?: QuoteLineInput[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
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

  const applyServicio = body.apply_servicio !== false;
  const totals = computeQuoteTotals(lines, applyServicio, EVENTOS_SERVICIO_PCT);

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
    const quoteNumber = `EVT-${now.slice(0, 10).replace(/-/g, '')}-${Math.floor(
      Math.random() * 900 + 100
    )}`;

    const { data: quote, error } = await sb
      .from('event_quotes')
      .insert({
        quote_number: quoteNumber,
        client_id: body.client_id || null,
        lead_id: body.lead_id || null,
        status: 'borrador',
        event_date: body.event_date || null,
        pax,
        subtotal: totals.subtotal,
        servicio_pct: totals.servicioPct,
        servicio_amount: totals.servicioAmount,
        total: totals.total,
        apply_servicio: totals.applyServicio,
        owner_username: auth.username,
        notes: (body.notes || '').trim() || null,
        hold_until,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error || !quote) {
      return NextResponse.json(
        { error: error?.message || 'No se pudo crear cotización' },
        { status: 500 }
      );
    }

    const lineRows = lines.map((l, idx) => ({
      quote_id: quote.id,
      menu_item_id: l.menu_item_id || null,
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      line_total: Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100,
      sort_order: idx,
    }));

    const { error: lineErr } = await sb.from('event_quote_lines').insert(lineRows);
    if (lineErr) {
      return NextResponse.json(
        { error: lineErr.message, quote },
        { status: 500 }
      );
    }

    const { data: full } = await sb
      .from('event_quotes')
      .select('*, lines:event_quote_lines(*)')
      .eq('id', quote.id)
      .single();

    return NextResponse.json({ quote: full || quote }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar cotización' },
      { status: 500 }
    );
  }
}
