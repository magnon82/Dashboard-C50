import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import {
  LEAD_STAGES,
  canPlaceHold,
  defaultHoldUntil,
  type LeadStage,
} from '@/app/lib/eventos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_leads')
      .select('*, client:event_clients(*)')
      .order('updated_at', { ascending: false })
      .limit(300);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ leads: data || [], count: data?.length || 0 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al leer leads' },
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
    title?: string;
    client_id?: string | null;
    stage?: string;
    event_date?: string | null;
    pax?: number | null;
    estimated_amount?: number | null;
    notes?: string;
    place_hold?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const title = (body.title || '').trim();
  if (!title) {
    return NextResponse.json({ error: 'title es requerido' }, { status: 400 });
  }

  const stage = (body.stage || 'nuevo') as LeadStage;
  if (!LEAD_STAGES.includes(stage)) {
    return NextResponse.json({ error: 'stage inválido' }, { status: 400 });
  }

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
    const { data, error } = await sb
      .from('event_leads')
      .insert({
        title,
        client_id: body.client_id || null,
        stage,
        event_date: body.event_date || null,
        pax: body.pax ?? null,
        estimated_amount: body.estimated_amount ?? null,
        notes: (body.notes || '').trim() || null,
        owner_username: auth.username,
        hold_until,
        created_at: now,
        updated_at: now,
      })
      .select('*, client:event_clients(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ lead: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al crear lead' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  let body: {
    id?: string;
    stage?: string;
    title?: string;
    event_date?: string | null;
    pax?: number | null;
    estimated_amount?: number | null;
    notes?: string;
    place_hold?: boolean;
    extend_hold?: boolean;
    clear_hold?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id es requerido' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.stage) {
    if (!LEAD_STAGES.includes(body.stage as LeadStage)) {
      return NextResponse.json({ error: 'stage inválido' }, { status: 400 });
    }
    patch.stage = body.stage;
  }
  if (body.title !== undefined) patch.title = body.title.trim();
  if (body.event_date !== undefined) patch.event_date = body.event_date;
  if (body.pax !== undefined) patch.pax = body.pax;
  if (body.estimated_amount !== undefined) {
    patch.estimated_amount = body.estimated_amount;
  }
  if (body.notes !== undefined) patch.notes = body.notes;

  if (body.clear_hold) {
    patch.hold_until = null;
    patch.hold_extended_by = null;
  } else if (body.extend_hold) {
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Solo admin puede extender hold' },
        { status: 403 }
      );
    }
    patch.hold_until = defaultHoldUntil().toISOString();
    patch.hold_extended_by = auth.username;
  } else if (body.place_hold) {
    const eventDate =
      body.event_date !== undefined ? body.event_date : undefined;
    // Si no mandan fecha, validamos contra la existente después
    if (eventDate !== undefined && !canPlaceHold(eventDate)) {
      return NextResponse.json(
        {
          error:
            'No se puede poner hold: faltan menos de 15 días para el evento.',
        },
        { status: 400 }
      );
    }
    patch.hold_until = defaultHoldUntil().toISOString();
  }

  try {
    const sb = getServiceSupabase();

    if (body.place_hold && body.event_date === undefined) {
      const { data: cur } = await sb
        .from('event_leads')
        .select('event_date')
        .eq('id', body.id)
        .maybeSingle();
      if (!canPlaceHold(cur?.event_date || null)) {
        return NextResponse.json(
          {
            error:
              'No se puede poner hold: faltan menos de 15 días para el evento.',
          },
          { status: 400 }
        );
      }
    }

    const { data, error } = await sb
      .from('event_leads')
      .update(patch)
      .eq('id', body.id)
      .select('*, client:event_clients(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ lead: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar lead' },
      { status: 500 }
    );
  }
}
