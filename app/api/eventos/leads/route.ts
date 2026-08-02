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
import {
  isFollowUpStepId,
  looksLikeSeguimientoImportNotes,
  normalizeFollowUpDone,
  suggestNextFollowUpAt,
  type FollowUpStepId,
} from '@/app/lib/eventos-follow-up';
import { createServiceOrderFromLead } from '@/app/lib/eventos-service-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Marca imports Seguimiento aunque la columna source falte, sea null,
 * o haya quedado en default `manual` tras el patch SQL.
 */
function normalizeLeadSource(row: {
  source?: string | null;
  notes?: string | null;
}): string | null {
  const notes = typeof row.notes === 'string' ? row.notes : '';
  const raw = typeof row.source === 'string' ? row.source.trim() : '';
  const src = raw.toLowerCase();
  if (
    src === 'sheets' ||
    src === 'seguimiento' ||
    src === 'sheet' ||
    src === 'import'
  ) {
    return src === 'sheet' || src === 'seguimiento' ? 'sheets' : src;
  }
  if (looksLikeSeguimientoImportNotes(notes)) return 'sheets';
  return raw || null;
}

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    // * incluye source, created_at, event_date, notes (cutoff de alertas).
    const { data, error } = await sb
      .from('event_leads')
      .select('*, client:event_clients(*)')
      .order('updated_at', { ascending: false })
      .limit(300);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const leads = (data || []).map((row) => {
      const source = normalizeLeadSource(row);
      return source === row.source ? row : { ...row, source };
    });

    return NextResponse.json({ leads, count: leads.length });
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
    celebration?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
    client_id?: string | null;
    stage?: string;
    event_date?: string | null;
    pax?: number | null;
    estimated_amount?: number | null;
    notes?: string | null;
    place_hold?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const celebration = trimOrNull(body.celebration);
  const title =
    trimOrNull(body.title) || celebration || '';
  if (!title) {
    return NextResponse.json(
      { error: 'Indica qué celebran (o un título del evento).' },
      { status: 400 }
    );
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
        celebration: celebration || title,
        contact_name: trimOrNull(body.contact_name),
        phone: trimOrNull(body.phone),
        email: trimOrNull(body.email),
        company: trimOrNull(body.company),
        client_id: body.client_id || null,
        stage,
        event_date: body.event_date || null,
        pax: body.pax ?? null,
        estimated_amount: body.estimated_amount ?? null,
        notes: trimOrNull(body.notes),
        owner_username: auth.username,
        hold_until,
        source: 'manual',
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
    celebration?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
    client_id?: string | null;
    event_date?: string | null;
    pax?: number | null;
    estimated_amount?: number | null;
    notes?: string | null;
    place_hold?: boolean;
    extend_hold?: boolean;
    clear_hold?: boolean;
    follow_up_done?: string[] | null;
    next_follow_up_at?: string | null;
    /** Si true y se manda follow_up_done, recalcula next_follow_up_at (salvo que venga explícito). */
    auto_next_follow_up?: boolean;
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
  if (body.celebration !== undefined) {
    const celebration = trimOrNull(body.celebration);
    patch.celebration = celebration;
    // Si no mandan title explícito, alinear título con celebración
    if (body.title === undefined && celebration) {
      patch.title = celebration;
    }
  }
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) {
      return NextResponse.json({ error: 'title no puede quedar vacío' }, { status: 400 });
    }
    patch.title = t;
  }
  if (body.contact_name !== undefined) {
    patch.contact_name = trimOrNull(body.contact_name);
  }
  if (body.phone !== undefined) patch.phone = trimOrNull(body.phone);
  if (body.email !== undefined) patch.email = trimOrNull(body.email);
  if (body.company !== undefined) patch.company = trimOrNull(body.company);
  if (body.client_id !== undefined) patch.client_id = body.client_id || null;
  if (body.event_date !== undefined) patch.event_date = body.event_date;
  if (body.pax !== undefined) patch.pax = body.pax;
  if (body.estimated_amount !== undefined) {
    patch.estimated_amount = body.estimated_amount;
  }
  if (body.notes !== undefined) patch.notes = trimOrNull(body.notes);

  let followUpDonePatch: FollowUpStepId[] | undefined;
  if (body.follow_up_done !== undefined) {
    if (body.follow_up_done != null && !Array.isArray(body.follow_up_done)) {
      return NextResponse.json(
        { error: 'follow_up_done debe ser un arreglo' },
        { status: 400 }
      );
    }
    const raw = body.follow_up_done || [];
    for (const id of raw) {
      if (!isFollowUpStepId(id)) {
        return NextResponse.json(
          { error: `Paso de seguimiento inválido: ${String(id)}` },
          { status: 400 }
        );
      }
    }
    followUpDonePatch = normalizeFollowUpDone(raw);
    patch.follow_up_done = followUpDonePatch;
  }

  if (body.next_follow_up_at !== undefined) {
    if (body.next_follow_up_at === null || body.next_follow_up_at === '') {
      patch.next_follow_up_at = null;
    } else {
      const d = new Date(body.next_follow_up_at);
      if (!Number.isFinite(d.getTime())) {
        return NextResponse.json(
          { error: 'next_follow_up_at inválida' },
          { status: 400 }
        );
      }
      patch.next_follow_up_at = d.toISOString();
    }
  }

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

    // Recalcular próxima fecha si el vendedor avanzó el checklist
    if (
      followUpDonePatch &&
      body.next_follow_up_at === undefined &&
      body.auto_next_follow_up !== false
    ) {
      const { data: cur } = await sb
        .from('event_leads')
        .select('created_at, stage, client_id')
        .eq('id', body.id)
        .maybeSingle();
      if (cur) {
        const stage = (patch.stage as LeadStage) || (cur.stage as LeadStage);
        const clientId =
          body.client_id !== undefined
            ? body.client_id || null
            : (cur.client_id as string | null);
        patch.next_follow_up_at = suggestNextFollowUpAt(
          { created_at: cur.created_at, stage, client_id: clientId },
          followUpDonePatch
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

    // Lead ganado → OS digital desde cotización vinculada (si existe)
    let service_order = null;
    let os_error: string | null = null;
    let os_hint: string | null = null;
    if (body.stage === 'ganado') {
      const osResult = await createServiceOrderFromLead(sb, {
        leadId: body.id,
        ownerUsername: auth.username,
      });
      service_order = osResult.order;
      os_error = osResult.error || null;
      os_hint = osResult.hint || null;
    }

    return NextResponse.json({
      lead: data,
      service_order,
      service_order_id: service_order?.id || null,
      os_error,
      os_hint,
      href: service_order ? `/eventos/os/${service_order.id}` : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar lead' },
      { status: 500 }
    );
  }
}
