import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  assertWritableCorteDate,
  requireVentasSession,
  tpvSchemaHint,
} from '@/app/lib/tpv-api';
import {
  TPV_STORAGE_BUCKET,
  asTpvRow,
  buildDayCompleteness,
  computeNetoBanco,
  type TpvCorteStatus,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function attachSignedUrl(
  sb: ReturnType<typeof getServiceSupabase>,
  upload: ReturnType<typeof asTpvRow>
) {
  if (!upload.storage_path) {
    upload.image_url = null;
    return;
  }
  const { data: signed } = await sb.storage
    .from(TPV_STORAGE_BUCKET)
    .createSignedUrl(upload.storage_path, 60 * 30);
  upload.image_url = signed?.signedUrl || null;
}

/** Tras editar montos: recalcula neto en venta+propina de la misma terminal. */
async function reconcilePairNeto(
  sb: ReturnType<typeof getServiceSupabase>,
  corteDate: string,
  terminal: TpvTerminalNumber
) {
  const { data } = await sb
    .from('tpv_corte_uploads')
    .select('*')
    .eq('corte_date', corteDate)
    .eq('terminal_number', terminal)
    .eq('entry_kind', 'photo');

  if (!data?.length) return;
  const rows = data.map((r) => asTpvRow(r as Record<string, unknown>));
  const venta = rows.find((r) => r.photo_kind === 'venta') || null;
  const propinaRow = rows.find((r) => r.photo_kind === 'propina') || null;
  if (!venta) return;

  const tip =
    propinaRow?.propina != null
      ? Number(propinaRow.propina)
      : venta.propina != null
        ? Number(venta.propina)
        : null;
  const neto = computeNetoBanco(venta.total_cobrado, tip);
  if (neto == null) return;

  const now = new Date().toISOString();
  await sb
    .from('tpv_corte_uploads')
    .update({ neto_banco: neto, updated_at: now })
    .eq('id', venta.id);
  if (propinaRow) {
    await sb
      .from('tpv_corte_uploads')
      .update({ neto_banco: neto, updated_at: now })
      .eq('id', propinaRow.id);
  }
}

export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('tpv_corte_uploads')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    const upload = asTpvRow(data as Record<string, unknown>);
    await attachSignedUrl(sb, upload);

    return NextResponse.json({ upload });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/** PATCH: montos, status, notes */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data: existing, error: loadErr } = await sb
      .from('tpv_corte_uploads')
      .select('corte_date')
      .eq('id', id)
      .maybeSingle();
    if (loadErr) {
      return NextResponse.json(
        { error: loadErr.message, hint: tpvSchemaHint(loadErr.message) },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }
    const dateGate = assertWritableCorteDate(
      auth,
      String(existing.corte_date).slice(0, 10)
    );
    if (dateGate) return dateGate;

    const body = (await request.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if ('notes' in body) {
      const v = body.notes;
      patch.notes =
        v == null || String(v).trim() === '' ? null : String(v).trim();
    }
    if ('total_cobrado' in body) {
      patch.total_cobrado =
        body.total_cobrado == null || body.total_cobrado === ''
          ? null
          : Number(body.total_cobrado);
    }
    if ('propina' in body) {
      patch.propina =
        body.propina == null || body.propina === ''
          ? null
          : Number(body.propina);
    }
    if ('neto_banco' in body) {
      patch.neto_banco =
        body.neto_banco == null || body.neto_banco === ''
          ? null
          : Number(body.neto_banco);
    }

    if ('status' in body) {
      const st = String(body.status) as TpvCorteStatus;
      if (
        !['pending', 'parsed', 'verified', 'rejected', 'unused'].includes(st)
      ) {
        return NextResponse.json({ error: 'Status inválido' }, { status: 400 });
      }
      patch.status = st;
      if (st === 'verified') {
        patch.verified_by = auth.username;
        patch.verified_at = new Date().toISOString();
      }
      if (st === 'pending' || st === 'rejected') {
        patch.verified_by = null;
        patch.verified_at = null;
      }
    } else if (
      ('total_cobrado' in body || 'propina' in body || 'neto_banco' in body) &&
      !('status' in body)
    ) {
      patch.status = 'parsed';
    }

    if ('ocr_text' in body) {
      patch.ocr_text =
        body.ocr_text == null ? null : String(body.ocr_text).slice(0, 8000);
    }

    const { data, error } = await sb
      .from('tpv_corte_uploads')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message, hint: tpvSchemaHint(error.message) },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    let upload = asTpvRow(data as Record<string, unknown>);

    // Recalcular neto con la pareja venta/propina del día
    if ('total_cobrado' in body || 'propina' in body || 'neto_banco' in body) {
      await reconcilePairNeto(sb, upload.corte_date, upload.terminal_number);
      const { data: refreshed } = await sb
        .from('tpv_corte_uploads')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (refreshed) {
        upload = asTpvRow(refreshed as Record<string, unknown>);
      }
    }

    await attachSignedUrl(sb, upload);

    const { data: dayRows } = await sb
      .from('tpv_corte_uploads')
      .select('*')
      .eq('corte_date', upload.corte_date);
    const day = buildDayCompleteness(
      (dayRows || []).map((r) => asTpvRow(r as Record<string, unknown>)),
      upload.corte_date
    );

    return NextResponse.json({ upload, day });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar' },
      { status: 500 }
    );
  }
}

/** DELETE: elimina foto o marca unused (fila + archivo en storage). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('tpv_corte_uploads')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    const upload = asTpvRow(data as Record<string, unknown>);
    const dateGate = assertWritableCorteDate(auth, upload.corte_date);
    if (dateGate) return dateGate;

    if (upload.storage_path) {
      await sb.storage.from(TPV_STORAGE_BUCKET).remove([upload.storage_path]);
    }

    const { error: delErr } = await sb
      .from('tpv_corte_uploads')
      .delete()
      .eq('id', id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const { data: dayRows } = await sb
      .from('tpv_corte_uploads')
      .select('*')
      .eq('corte_date', upload.corte_date);
    const day = buildDayCompleteness(
      (dayRows || []).map((r) => asTpvRow(r as Record<string, unknown>)),
      upload.corte_date
    );

    return NextResponse.json({
      ok: true,
      deleted: { id: upload.id, corte_date: upload.corte_date },
      day,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al eliminar' },
      { status: 500 }
    );
  }
}
