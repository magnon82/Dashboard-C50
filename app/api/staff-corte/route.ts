import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireVentasSession } from '@/app/lib/tpv-api';
import {
  asTpvRow,
  defaultCorteDateCdmx,
} from '@/app/lib/tpv-cortes';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  buildBancosFromTpv,
  buildStaffCorteStatus,
  efectivoMismatch,
  efectivoTombolaMustMatch,
  parseMoneyInput,
  sumInfocajaDay,
} from '@/app/lib/staff-rpt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadTpvUploads(
  sb: ReturnType<typeof getServiceSupabase>,
  corteDate: string
) {
  const { data, error } = await sb
    .from('tpv_corte_uploads')
    .select('*')
    .eq('corte_date', corteDate)
    .order('terminal_number', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => asTpvRow(r as Record<string, unknown>));
}

async function attachSignedUrls(
  sb: ReturnType<typeof getServiceSupabase>,
  uploads: ReturnType<typeof asTpvRow>[]
) {
  await Promise.all(
    uploads.map(async (row) => {
      if (!row.storage_path) {
        row.image_url = null;
        return;
      }
      const { data: signed } = await sb.storage
        .from('tpv-cortes')
        .createSignedUrl(row.storage_path, 60 * 30);
      row.image_url = signed?.signedUrl || null;
    })
  );
}

async function loadInfocajaDay(
  sb: ReturnType<typeof getServiceSupabase>,
  date: string
) {
  const { data, error } = await sb
    .from('financial_records')
    .select('category, amount, date, source_file')
    .eq('source_file', 'infocaja')
    .eq('date', date);
  if (error) {
    return { infocaja: sumInfocajaDay([]), infocajaError: error.message };
  }
  return { infocaja: sumInfocajaDay(data || []), infocajaError: null as string | null };
}

async function loadRpt(
  sb: ReturnType<typeof getServiceSupabase>,
  date: string
) {
  const { data, error } = await sb
    .from(STAFF_RPT_TABLE)
    .select('*')
    .eq('rpt_date', date)
    .maybeSingle();
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) {
      return {
        rpt: null,
        rptError:
          'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_rpt_diario.sql',
      };
    }
    return { rpt: null, rptError: error.message };
  }
  return {
    rpt: data ? asStaffRptRow(data as Record<string, unknown>) : null,
    rptError: null as string | null,
  };
}

/** GET /api/staff-corte?date=YYYY-MM-DD&recent=1 */
export async function GET(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const date =
    url.searchParams.get('date')?.slice(0, 10) || defaultCorteDateCdmx();
  const wantRecent = url.searchParams.get('recent') === '1';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const uploads = await loadTpvUploads(sb, date);
    await attachSignedUrls(sb, uploads);
    const { rpt, rptError } = await loadRpt(sb, date);
    const { infocaja, infocajaError } = await loadInfocajaDay(sb, date);
    const status = buildStaffCorteStatus(date, uploads, rpt);
    const bancos = status.bancos;

    let recent: ReturnType<typeof asStaffRptRow>[] = [];
    if (wantRecent) {
      const { data: recentRows } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .order('rpt_date', { ascending: false })
        .limit(10);
      recent = (recentRows || []).map((r) =>
        asStaffRptRow(r as Record<string, unknown>)
      );
    }

    const cashCheck = efectivoMismatch(
      rpt?.efectivo_contado ?? null,
      infocaja.hasEfectivo ? infocaja.efectivo : null
    );

    return NextResponse.json({
      date,
      defaultDate: defaultCorteDateCdmx(),
      uploads,
      bancos,
      infocaja,
      infocajaError,
      rpt,
      rptError,
      status,
      cashCheck,
      recent,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al cargar corte',
        hint: '¿Ejecutaste supabase/tpv_cortes.sql y staff_rpt_diario.sql?',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/staff-corte — Cerrar / actualizar cierre del día (upsert 1 fila).
 * Body JSON: { date?, wi_amount, eventos_amount, efectivo_tombola?,
 *              efectivo_contado, notes? }
 * Bancos y propinas se toman de TPV (obligatorio día completo + montos).
 * efectivo_contado es obligatorio (= tómbola); si se envía tómbola, debe coincidir.
 * Si hay Infocaja Efectivo, contado no puede ser menor.
 */
export async function PUT(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const date =
      String(body.date || body.rpt_date || '').slice(0, 10) ||
      defaultCorteDateCdmx();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
    }

    const wi = parseMoneyInput(body.wi_amount);
    const eventos = parseMoneyInput(body.eventos_amount);
    if (wi == null || wi < 0) {
      return NextResponse.json(
        { error: 'Indica el monto WI (puede ser 0)' },
        { status: 400 }
      );
    }
    if (eventos == null || eventos < 0) {
      return NextResponse.json(
        { error: 'Indica Eventos (0 si no hubo)' },
        { status: 400 }
      );
    }

    const efectivoContado = parseMoneyInput(body.efectivo_contado);
    if (efectivoContado == null || efectivoContado < 0) {
      return NextResponse.json(
        { error: 'Indica el efectivo contado (obligatorio)' },
        { status: 400 }
      );
    }

    /** Fuente de verdad: contado. Tómbola = mismo monto (depósito). */
    const tombolaRaw = parseMoneyInput(body.efectivo_tombola);
    if (tombolaRaw != null && tombolaRaw < 0) {
      return NextResponse.json(
        { error: 'El efectivo en tómbola no puede ser negativo' },
        { status: 400 }
      );
    }
    if (tombolaRaw != null) {
      const match = efectivoTombolaMustMatch(efectivoContado, tombolaRaw);
      if (!match.ok) {
        return NextResponse.json(
          {
            error: match.message,
            blockers: [
              'El efectivo contado debe ser el mismo depositado en tómbola.',
            ],
          },
          { status: 400 }
        );
      }
    }
    const tombola = efectivoContado;

    const notesRaw = body.notes;
    const notes =
      notesRaw == null || String(notesRaw).trim() === ''
        ? null
        : String(notesRaw).trim().slice(0, 2000);

    const sb = getServiceSupabase();
    const uploads = await loadTpvUploads(sb, date);
    const bancos = buildBancosFromTpv(uploads, date);

    if (!bancos.canSaveRpt) {
      return NextResponse.json(
        {
          error: 'No se puede cerrar el corte todavía',
          blockers: bancos.blockers,
          bancos,
        },
        { status: 409 }
      );
    }

    const { infocaja } = await loadInfocajaDay(sb, date);
    const cashCheck = efectivoMismatch(
      efectivoContado,
      infocaja.hasEfectivo ? infocaja.efectivo : null
    );
    if (cashCheck.belowInfocaja) {
      return NextResponse.json(
        {
          error: cashCheck.message || 'Efectivo contado menor que Infocaja',
          cashCheck,
          blockers: [
            'El efectivo contado no puede ser menor que el efectivo de Infocaja.',
          ],
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const row = {
      rpt_date: date,
      wi_amount: wi,
      eventos_amount: eventos,
      propinas: bancos.propina,
      efectivo_tombola: tombola,
      efectivo_contado: efectivoContado,
      efectivo_infocaja: infocaja.hasEfectivo ? infocaja.efectivo : null,
      bancos_neto_tpv: bancos.neto,
      bancos_cobrado_tpv: bancos.cobrado,
      bancos_propina_tpv: bancos.propina,
      tpv_accounted: bancos.day.accounted,
      tpv_complete: bancos.complete,
      notes,
      updated_by: auth.username,
      updated_at: now,
    };

    const { data: existing } = await sb
      .from(STAFF_RPT_TABLE)
      .select('id, created_by')
      .eq('rpt_date', date)
      .maybeSingle();

    let saved;
    if (existing?.id) {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .update(row)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) {
        return NextResponse.json(
          {
            error: error.message,
            hint: '¿Ejecutaste supabase/staff_rpt_diario.sql?',
          },
          { status: 500 }
        );
      }
      saved = data;
    } else {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .insert({
          ...row,
          id: crypto.randomUUID(),
          created_by: auth.username,
          created_at: now,
        })
        .select('*')
        .single();
      if (error) {
        return NextResponse.json(
          {
            error: error.message,
            hint: '¿Ejecutaste supabase/staff_rpt_diario.sql?',
          },
          { status: 500 }
        );
      }
      saved = data;
    }

    const rpt = asStaffRptRow(saved as Record<string, unknown>);
    const status = buildStaffCorteStatus(date, uploads, rpt);

    return NextResponse.json({
      ok: true,
      rpt,
      status,
      bancos,
      infocaja,
      cashCheck,
      warning: null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al cerrar corte' },
      { status: 500 }
    );
  }
}
