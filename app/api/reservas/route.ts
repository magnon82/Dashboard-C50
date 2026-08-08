import { NextResponse } from 'next/server';
import { allowPublicQuoteRequest } from '@/app/lib/public-quote-rate-limit';
import {
  buildReservaWhatsAppMessage,
  buildWhatsAppHref,
  parseReservaBody,
  reservasBrand,
} from '@/app/lib/reservas';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/reservas
 * Público: valida → guarda en restaurant_reservations (si existe) → devuelve waHref.
 * Si falla el insert (tabla no migrada / DB), igual devuelve el enlace WhatsApp.
 */
export async function POST(request: Request) {
  if (!allowPublicQuoteRequest(request)) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes. Intenta en un minuto.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = parseReservaBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { data } = parsed;
  const brand = reservasBrand();
  const message = buildReservaWhatsAppMessage(data, brand);
  const waHref = buildWhatsAppHref(message);

  let saved = false;
  let id: string | null = null;
  let saveWarning: string | null = null;

  try {
    const sb = getServiceSupabase();
    const { data: row, error } = await sb
      .from('restaurant_reservations')
      .insert({
        nombre: data.nombre,
        personas: data.personas,
        telefono: data.telefono,
        fecha: data.fecha,
        hora: data.hora,
        motivo: data.motivo || null,
        alergias: data.alergias || null,
        notas: data.notas || null,
        brand,
        source: 'web',
        wa_opened: true,
        status: 'pendiente',
      })
      .select('id')
      .maybeSingle();

    if (error) {
      const missing = /restaurant_reservations|schema cache|relation/i.test(
        error.message
      );
      saveWarning = missing
        ? 'Falta migrar: ejecuta supabase/restaurant_reservations.sql'
        : error.message;
    } else {
      saved = true;
      id = row?.id ?? null;
    }
  } catch (e) {
    saveWarning =
      e instanceof Error ? e.message : 'No se pudo guardar el registro';
  }

  return NextResponse.json({
    ok: true,
    saved,
    id,
    waHref,
    confirmMessage:
      'Recibimos tu solicitud; te confirmamos en breve por WhatsApp.',
    ...(saveWarning ? { saveWarning } : {}),
  });
}
