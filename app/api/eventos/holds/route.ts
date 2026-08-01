import { NextResponse } from 'next/server';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import { createCalendarHold } from '@/app/lib/eventos-gcal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/eventos/holds
 * Stub Fase 2: hold 72 h hábiles → Google Calendar compartido.
 * Sin GCAL_CALENDAR_ID responde error amigable (requires_GCAL_CALENDAR_ID).
 */
export async function POST(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  let body: {
    title?: string;
    event_date?: string | null;
    client?: string | null;
    lead_id?: string | null;
    quote_id?: string | null;
    hold_until?: string | null;
    notes?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const title = String(body.title || '').trim();
  if (!title) {
    return NextResponse.json(
      { error: 'Indica un título para el hold en calendario.' },
      { status: 400 }
    );
  }

  const result = await createCalendarHold({
    title,
    event_date: body.event_date || null,
    client: body.client || null,
    lead_id: body.lead_id || null,
    quote_id: body.quote_id || null,
    hold_until: body.hold_until || null,
    notes: body.notes || null,
  });

  const status = result.error === 'hold_too_close' ? 400 : 200;
  return NextResponse.json(result, { status });
}
