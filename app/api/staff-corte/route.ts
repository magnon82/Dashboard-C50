import { NextResponse } from 'next/server';
import { canAccessAdmin } from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';
import {
  assertStaffCorteWritableDate,
  isTpvSchemaError,
  requireVentasSession,
  tpvSchemaHint,
  tpvSchemaMissingResponse,
} from '@/app/lib/tpv-api';
import {
  adminCorteDateWindow,
  asTpvRow,
  defaultCorteDateCdmx,
  listAdminLookbackDates,
  staffCorteDateWindow,
} from '@/app/lib/tpv-cortes';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  buildBancosFromTpv,
  buildStaffCorteStatus,
  efectivoMismatch,
  efectivoTombolaMustMatch,
  parseMoneyInput,
  shortageCloseNote,
  sumInfocajaDay,
} from '@/app/lib/staff-rpt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadTpvUploads(
  sb: ReturnType<typeof getServiceSupabase>,
  corteDate: string
) {
  // No order by photo_kind: si la columna falta, select('*') aún puede responder.
  const { data, error } = await sb
    .from('tpv_corte_uploads')
    .select('*')
    .eq('corte_date', corteDate)
    .order('terminal_number', { ascending: true });
  if (error) {
    if (isTpvSchemaError(error.message)) {
      const err = new Error(error.message) as Error & { schemaMissing?: boolean };
      err.schemaMissing = true;
      throw err;
    }
    throw new Error(error.message);
  }
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
    if (isTpvSchemaError(error.message)) {
      return {
        rpt: null,
        rptError:
          'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_corte_prod_fix.sql',
        schemaMissing: true as const,
      };
    }
    return { rpt: null, rptError: error.message, schemaMissing: false as const };
  }
  return {
    rpt: data ? asStaffRptRow(data as Record<string, unknown>) : null,
    rptError: null as string | null,
    schemaMissing: false as const,
  };
}

type DayWindowSummary = {
  date: string;
  closeSaved: boolean;
  corteCompleto: boolean;
  terminalsReady: boolean;
  /** true si no se pudo leer (tabla TPV ausente, etc.) */
  unknown: boolean;
};

function summaryFromStatus(
  date: string,
  status: ReturnType<typeof buildStaffCorteStatus>,
  unknown = false
): DayWindowSummary {
  return {
    date,
    closeSaved: status.closeSaved,
    corteCompleto: status.corteCompleto,
    terminalsReady: status.terminalsReady,
    unknown,
  };
}

/** Resumen liviano (sin URLs firmadas) para Hoy / Ayer. */
async function loadDayWindowSummary(
  sb: ReturnType<typeof getServiceSupabase>,
  date: string
): Promise<DayWindowSummary> {
  try {
    const uploads = await loadTpvUploads(sb, date);
    const { rpt } = await loadRpt(sb, date);
    return summaryFromStatus(date, buildStaffCorteStatus(date, uploads, rpt));
  } catch {
    return {
      date,
      closeSaved: false,
      corteCompleto: false,
      terminalsReady: false,
      unknown: true,
    };
  }
}

/** GET /api/staff-corte?date=YYYY-MM-DD&recent=1 */
export async function GET(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const date =
    url.searchParams.get('date')?.slice(0, 10) || defaultCorteDateCdmx();
  const wantRecent = url.searchParams.get('recent') === '1';
  const { opDay, prevDay } = staffCorteDateWindow();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const uploads = await loadTpvUploads(sb, date);
    await attachSignedUrls(sb, uploads);
    const { rpt, rptError, schemaMissing: rptSchemaMissing } = await loadRpt(
      sb,
      date
    );
    const { infocaja, infocajaError } = await loadInfocajaDay(sb, date);
    const status = buildStaffCorteStatus(date, uploads, rpt);
    const bancos = status.bancos;

    const selectedSummary = summaryFromStatus(date, status);
    const [opSummary, prevSummary] = await Promise.all([
      date === opDay
        ? Promise.resolve(selectedSummary)
        : loadDayWindowSummary(sb, opDay),
      date === prevDay
        ? Promise.resolve(selectedSummary)
        : loadDayWindowSummary(sb, prevDay),
    ]);

    let recent: ReturnType<typeof asStaffRptRow>[] = [];
    if (wantRecent) {
      const { data: recentRows, error: recentErr } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .order('rpt_date', { ascending: false })
        .limit(10);
      if (!recentErr) {
        recent = (recentRows || []).map((r) =>
          asStaffRptRow(r as Record<string, unknown>)
        );
      }
    }

    const cashCheck = efectivoMismatch(
      rpt?.efectivo_contado ?? null,
      infocaja.hasEfectivo ? infocaja.efectivo : null
    );

    const isMaster = canAccessAdmin(auth);
    let adminLookback:
      | {
          minDate: string;
          maxDate: string;
          days: DayWindowSummary[];
        }
      | undefined;
    if (isMaster) {
      const win = adminCorteDateWindow();
      const lookbackDates = listAdminLookbackDates();
      const daySummaries = await Promise.all(
        lookbackDates.map((d) =>
          d === date
            ? Promise.resolve(selectedSummary)
            : d === opDay
              ? Promise.resolve(opSummary)
              : d === prevDay
                ? Promise.resolve(prevSummary)
                : loadDayWindowSummary(sb, d)
        )
      );
      adminLookback = {
        minDate: win.minDate,
        maxDate: win.maxDate,
        days: daySummaries,
      };
    }

    return NextResponse.json({
      date,
      defaultDate: opDay,
      staffPrevDate: prevDay,
      dateWindow: {
        opDay,
        prevDay,
        op: opSummary,
        prev: prevSummary,
      },
      adminLookback: adminLookback || null,
      isMasterAdmin: isMaster,
      uploads,
      bancos,
      infocaja,
      infocajaError,
      rpt,
      rptError,
      schemaMissing: rptSchemaMissing || undefined,
      status,
      cashCheck,
      recent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar corte';
    const schemaMissing =
      (e as { schemaMissing?: boolean })?.schemaMissing ||
      isTpvSchemaError(msg);
    if (schemaMissing) {
      return tpvSchemaMissingResponse(msg, {
        defaultDate: opDay,
        staffPrevDate: prevDay,
      });
    }
    return NextResponse.json(
      {
        error: msg,
        hint: tpvSchemaHint(msg),
        defaultDate: opDay,
        staffPrevDate: prevDay,
        dateWindow: {
          opDay,
          prevDay,
          op: {
            date: opDay,
            closeSaved: false,
            corteCompleto: false,
            terminalsReady: false,
            unknown: true,
          },
          prev: {
            date: prevDay,
            closeSaved: false,
            corteCompleto: false,
            terminalsReady: false,
            unknown: true,
          },
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/staff-corte — Cerrar / actualizar cierre del día (upsert 1 fila).
 * Body JSON: { date?, wi_amount, eventos_amount, efectivo_tombola?,
 *              efectivo_contado, notes?, acknowledge_shortage? }
 * Bancos y propinas se toman de TPV (obligatorio día completo + montos).
 * efectivo_contado obligatorio (= tómbola). Si tómbola < Infocaja: warning;
 * se permite cerrar solo con acknowledge_shortage=true (faltante real).
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
    const dateGate = assertStaffCorteWritableDate(auth, date);
    if (dateGate) return dateGate;

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
        { error: 'Indica el efectivo en tómbola (obligatorio)' },
        { status: 400 }
      );
    }

    /** Un solo monto UI «Efectivo en Tómbola» → ambas columnas. */
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
              'El efectivo en tómbola debe coincidir en contado y tómbola.',
            ],
          },
          { status: 400 }
        );
      }
    }
    const tombola = efectivoContado;

    const notesRaw = body.notes;
    let notes =
      notesRaw == null || String(notesRaw).trim() === ''
        ? null
        : String(notesRaw).trim().slice(0, 2000);

    const acknowledgeShortage =
      body.acknowledge_shortage === true ||
      body.acknowledge_shortage === 'true' ||
      body.acknowledge_shortage === 1;

    const sb = getServiceSupabase();
    let uploads;
    try {
      uploads = await loadTpvUploads(sb, date);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isTpvSchemaError(msg)) {
        return tpvSchemaMissingResponse(msg);
      }
      throw e;
    }
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

    // Regla ops: tómbola < Infocaja = warning + cierre con confirmación explícita.
    // No hard-blockear faltantes reales (p. ej. $259 vs $5,817).
    if (cashCheck.belowInfocaja && !acknowledgeShortage) {
      return NextResponse.json(
        {
          error:
            cashCheck.message ||
            'Efectivo en tómbola menor que Infocaja. Confirma el faltante para cerrar.',
          cashCheck,
          requiresShortageAck: true,
          blockers: [
            'Confirma el faltante de efectivo (tómbola < Infocaja) para poder cerrar.',
          ],
        },
        { status: 409 }
      );
    }

    if (cashCheck.belowInfocaja && acknowledgeShortage) {
      const auto = shortageCloseNote(
        efectivoContado,
        infocaja.efectivo
      );
      notes = notes ? `${notes}\n${auto}`.slice(0, 2000) : auto;
    } else {
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

    const { data: existing, error: existErr } = await sb
      .from(STAFF_RPT_TABLE)
      .select('id, created_by')
      .eq('rpt_date', date)
      .maybeSingle();

    if (existErr && isTpvSchemaError(existErr.message)) {
      return tpvSchemaMissingResponse(existErr.message);
    }

    let saved;
    if (existing?.id) {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .update(row)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) {
        if (isTpvSchemaError(error.message)) {
          return tpvSchemaMissingResponse(error.message);
        }
        return NextResponse.json(
          {
            error: error.message,
            hint: tpvSchemaHint(error.message),
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
        if (isTpvSchemaError(error.message)) {
          return tpvSchemaMissingResponse(error.message);
        }
        return NextResponse.json(
          {
            error: error.message,
            hint: tpvSchemaHint(error.message),
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
      warning: cashCheck.belowInfocaja ? cashCheck.message : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cerrar corte';
    if (isTpvSchemaError(msg)) {
      return tpvSchemaMissingResponse(msg);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
