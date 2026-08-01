import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireVentasSession } from '@/app/lib/tpv-api';
import {
  TPV_STORAGE_BUCKET,
  asTpvRow,
  computeNetoBanco,
  type TpvCorteStatus,
} from '@/app/lib/tpv-cortes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

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
    if (upload.storage_path) {
      const { data: signed } = await sb.storage
        .from(TPV_STORAGE_BUCKET)
        .createSignedUrl(upload.storage_path, 60 * 30);
      upload.image_url = signed?.signedUrl || null;
    }

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
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if ('notes' in body) {
      const v = body.notes;
      patch.notes = v == null || String(v).trim() === '' ? null : String(v).trim();
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
    } else if ('total_cobrado' in body || 'propina' in body) {
      const cob =
        'total_cobrado' in body
          ? (patch.total_cobrado as number | null)
          : undefined;
      const tip =
        'propina' in body ? (patch.propina as number | null) : undefined;
      if (cob !== undefined) {
        patch.neto_banco = computeNetoBanco(cob, tip === undefined ? null : tip);
      }
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

    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('tpv_corte_uploads')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    }

    const upload = asTpvRow(data as Record<string, unknown>);
    if (upload.storage_path) {
      const { data: signed } = await sb.storage
        .from(TPV_STORAGE_BUCKET)
        .createSignedUrl(upload.storage_path, 60 * 30);
      upload.image_url = signed?.signedUrl || null;
    }

    return NextResponse.json({ upload });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar' },
      { status: 500 }
    );
  }
}
