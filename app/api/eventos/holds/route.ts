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
 * Hold 72 h hábiles → Google Calendar (SA + opcional GCAL_IMPERSONATE_USER / DWD).
 * Sin GCAL_* responde error amigable; 403/401 típico = falta DWD o ACL.
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

  const badClient =
    result.error === 'hold_too_close' ||
    result.error === 'requires_event_date';
  const status = badClient ? 400 : result.ok ? 200 : 502;
  return NextResponse.json(result, { status });
}
