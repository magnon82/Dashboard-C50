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
  encodePerdidaLegacyNotes,
  ensureQuotePublicToken,
  hydrateQuotePerdidaFields,
  publicQuotePath,
  regenerateQuotePublicToken,
  revokeQuotePublicToken,
} from '@/app/lib/eventos-quote-public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUOTE_STATUSES = [
  'borrador',
  'enviada',
  'aceptada',
  'rechazada',
  'vencida',
  'perdida',
] as const;

const QUOTE_OS_BLOCKED_STATUSES = new Set([
  'perdida',
  'rechazada',
  'vencida',
]);

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
 * Body: { status, perdida_note?, generate_os?, payment_link_url?, regenerate_public_token?, revoke_public_token? }
 * Si status=aceptada (o generate_os=true), crea/actualiza OS digital.
 * Si status=perdida, exige perdida_note y no genera OS.
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
    perdida_note?: string | null;
    generate_os?: boolean;
    payment_link_url?: string | null;
    regenerate_public_token?: boolean;
    revoke_public_token?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.regenerate_public_token === true) {
    try {
      const sb = getServiceSupabase();
      const token = await regenerateQuotePublicToken(sb, id);
      if (!token) {
        return NextResponse.json(
          {
            error:
              'No se pudo regenerar el enlace. Ejecuta supabase/eventos_quote_public_token.sql',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        public_token: token,
        public_path: publicQuotePath(token),
      });
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error ? e.message : 'Error al regenerar enlace público',
        },
        { status: 500 }
      );
    }
  }

  if (body.revoke_public_token === true) {
    try {
      const sb = getServiceSupabase();
      const result = await revokeQuotePublicToken(sb, id);
      if (!result.ok) {
        return NextResponse.json(
          {
            error: result.missingColumn
              ? 'Falta migrar public_token. Ejecuta supabase/eventos_quote_public_token.sql'
              : 'No se pudo desactivar el enlace',
          },
          { status: result.missingColumn ? 503 : 500 }
        );
      }
      return NextResponse.json({
        public_token: null,
        public_path: null,
        revoked: true,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error ? e.message : 'Error al desactivar enlace público',
        },
        { status: 500 }
      );
    }
  }

  if (
    !body.status &&
    body.generate_os == null &&
    body.payment_link_url === undefined
  ) {
    return NextResponse.json(
      {
        error:
          'Indica status, generate_os, payment_link_url, regenerate_public_token o revoke_public_token',
      },
      { status: 400 }
    );
  }

  if (
    body.status &&
    !QUOTE_STATUSES.includes(body.status as (typeof QUOTE_STATUSES)[number])
  ) {
    return NextResponse.json({ error: 'status inválido' }, { status: 400 });
  }

  const perdidaNote =
    typeof body.perdida_note === 'string' ? body.perdida_note.trim() : '';
  if (body.status === 'perdida' && !perdidaNote) {
    return NextResponse.json(
      { error: 'Indica una nota al cerrar como perdida' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const now = new Date().toISOString();
    let quote: Record<string, unknown> | null = null;

    if (body.status === 'perdida' || body.generate_os === true || body.status === 'aceptada') {
      const { data: current, error: curErr } = await sb
        .from('event_quotes')
        .select('id, status, lead_id')
        .eq('id', id)
        .maybeSingle();
      if (curErr) {
        return NextResponse.json({ error: curErr.message }, { status: 500 });
      }
      if (!current) {
        return NextResponse.json(
          { error: 'Cotización no encontrada' },
          { status: 404 }
        );
      }
      const curStatus = String(current.status || '');
      if (body.status === 'perdida') {
        if (curStatus === 'aceptada') {
          return NextResponse.json(
            {
              error:
                'No se puede marcar como perdida una cotización ya aceptada',
            },
            { status: 409 }
          );
        }
        if (curStatus === 'perdida') {
          return NextResponse.json(
            { error: 'Esta cotización ya está marcada como perdida' },
            { status: 409 }
          );
        }
        const { data: osRow } = await sb
          .from('event_service_orders')
          .select('id')
          .eq('quote_id', id)
          .maybeSingle();
        if (osRow?.id) {
          return NextResponse.json(
            {
              error:
                'No se puede marcar como perdida: ya tiene orden de servicio',
            },
            { status: 409 }
          );
        }
      }
      if (
        (body.generate_os === true || body.status === 'aceptada') &&
        QUOTE_OS_BLOCKED_STATUSES.has(curStatus)
      ) {
        return NextResponse.json(
          {
            error:
              curStatus === 'perdida'
                ? 'No se puede generar OS de una cotización perdida'
                : `No se puede generar OS de una cotización ${curStatus}`,
          },
          { status: 409 }
        );
      }
    }

    const patch: Record<string, unknown> = { updated_at: now };
    if (body.status && body.status !== 'perdida') patch.status = body.status;

    /** ¿Existen columnas perdida_*? Si no, usamos fallback legacy sin intentar el UPDATE roto. */
    let perdidaSchemaReady = false;
    if (body.status === 'perdida') {
      const probe = await sb
        .from('event_quotes')
        .select('perdida_note')
        .limit(1);
      perdidaSchemaReady = !probe.error;
      if (perdidaSchemaReady) {
        patch.status = 'perdida';
        patch.perdida_note = perdidaNote;
        patch.perdida_at = now;
      }
    }

    if (body.payment_link_url !== undefined) {
      const url =
        typeof body.payment_link_url === 'string'
          ? body.payment_link_url.trim()
          : '';
      patch.payment_link_url = url || null;
    }

    // Cierre perdido sin migración: rechazada + marcador en notes (UI hidrata a perdida).
    if (body.status === 'perdida' && !perdidaSchemaReady) {
      const { data: curRow } = await sb
        .from('event_quotes')
        .select('id, notes, lead_id')
        .eq('id', id)
        .maybeSingle();
      const legacyNotes = encodePerdidaLegacyNotes(
        now,
        perdidaNote,
        (curRow as { notes?: string | null } | null)?.notes
      );
      const { data: fbData, error: fbErr } = await sb
        .from('event_quotes')
        .update({
          status: 'rechazada',
          notes: legacyNotes,
          updated_at: now,
        })
        .eq('id', id)
        .select(
          '*, lines:event_quote_lines(*), client:event_clients(id, company_name)'
        )
        .single();
      if (fbErr || !fbData) {
        return NextResponse.json(
          {
            error: fbErr?.message || 'No se pudo cerrar como perdida',
            code: fbErr?.code || null,
          },
          { status: 500 }
        );
      }
      quote = hydrateQuotePerdidaFields(
        fbData as Record<string, unknown>
      ) as unknown as Record<string, unknown>;
      const leadId = (fbData as { lead_id?: string | null }).lead_id || null;
      if (leadId) {
        await sb
          .from('event_leads')
          .update({ stage: 'perdido', updated_at: now })
          .eq('id', leadId)
          .neq('stage', 'ganado');
      }
    } else if (body.status || body.payment_link_url !== undefined) {
      const { data, error } = await sb
        .from('event_quotes')
        .update(patch)
        .eq('id', id)
        .select(
          '*, lines:event_quote_lines(*), client:event_clients(id, company_name)'
        )
        .single();
      if (error) {
        const missingPerdida =
          /perdida_note|perdida_at|status|schema cache|column|check constraint|23514|42703/i.test(
            `${error.code || ''} ${error.message || ''}`
          );
        const missingLink = /payment_link_url|schema cache|column/i.test(
          error.message
        );
        return NextResponse.json(
          {
            error: missingLink
              ? 'Falta migrar payment_link_url. Ejecuta supabase/eventos_quote_accept.sql'
              : error.message,
            detail: error.message,
            code: error.code || null,
          },
          { status: missingLink ? 503 : 500 }
        );
      }
      quote = data;

      if (body.status === 'perdida') {
        const leadId = (data as { lead_id?: string | null }).lead_id || null;
        if (leadId) {
          await sb
            .from('event_leads')
            .update({ stage: 'perdido', updated_at: now })
            .eq('id', leadId)
            .neq('stage', 'ganado');
        }
      }
    }

    const shouldOs =
      body.status !== 'perdida' &&
      (body.generate_os === true || body.status === 'aceptada');

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
