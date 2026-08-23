import { NextResponse } from 'next/server';
import { canAccessAdmin, canClosePendingCortes } from '@/app/lib/auth';
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
  computeNetoBanco,
  defaultCorteDateCdmx,
  listAdminLookbackDates,
  staffCorteDateWindow,
} from '@/app/lib/tpv-cortes';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  buildBancosFromTpv,
  buildStaffCorteStatus,
  parseMoneyInput,
  reconcileEfectivoRecibidoVsInfocaja,
  resolveInfocajaEfectivo,
  sumInfocajaDay,
  totalEventosAmount,
  totalPropinasStaff,
} from '@/app/lib/staff-rpt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventoDelDia = {
  id: string;
  label: string;
  os_number: string | null;
  /** Total con servicio (doc OS). */
  total: number | null;
  /**
   * Venta Global (sin servicio 15%): OS `subtotal`.
   * Null for financial-only rows.
   */
  venta: number | null;
  source: 'os_digital' | 'financial';
};

type EventosDelDiaPayload = {
  hasEvent: boolean;
  /** True when at least one digital OS exists for the day. */
  hasDigitalOs: boolean;
  /**
   * Suggested Global VENTA for corte:
   * - digital OS present → sum of OS subtotals
   * - otherwise → 0 (no inventar importes; staff puede editar)
   */
  suggestedOsAmount: number;
  /** Short label for UI (client / OS numbers). */
  suggestedOsLabel: string | null;
  items: EventoDelDia[];
};

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadEventosDelDia(
  sb: ReturnType<typeof getServiceSupabase>,
  date: string
): Promise<EventosDelDiaPayload> {
  const items: EventoDelDia[] = [];
  let suggestedOsSum = 0;
  let digitalOsCount = 0;
  const labelParts: string[] = [];

  const { data: osRows } = await sb
    .from('event_service_orders')
    .select(
      'id, os_number, client_name, celebration, subtotal, total, event_date'
    )
    .eq('event_date', date)
    .limit(20);

  for (const r of osRows || []) {
    const name =
      String((r as { client_name?: string }).client_name || '').trim() ||
      String((r as { celebration?: string }).celebration || '').trim() ||
      'Evento';
    const subtotalRaw = (r as { subtotal?: number | null }).subtotal;
    const venta =
      subtotalRaw == null || !Number.isFinite(Number(subtotalRaw))
        ? null
        : roundMoney2(Number(subtotalRaw));
    const totalRaw = (r as { total?: number | null }).total;
    const total =
      totalRaw == null || !Number.isFinite(Number(totalRaw))
        ? null
        : roundMoney2(Number(totalRaw));
    const osNumber = (r as { os_number?: string | null }).os_number
      ? String((r as { os_number: string }).os_number)
      : null;
    items.push({
      id: String((r as { id: string }).id),
      label: name,
      os_number: osNumber,
      total,
      venta,
      source: 'os_digital',
    });
    digitalOsCount += 1;
    if (venta != null) suggestedOsSum = roundMoney2(suggestedOsSum + venta);
    labelParts.push(osNumber ? `${name} (OS ${osNumber})` : name);
  }

  const { data: finRows } = await sb
    .from('financial_records')
    .select('id, amount, description')
    .eq('source_file', 'eventos')
    .eq('date', date)
    .limit(20);

  for (const r of finRows || []) {
    const desc = String((r as { description?: string }).description || '').trim();
    const label = desc.split('·')[0]?.trim() || 'Evento (Global)';
    items.push({
      id: String((r as { id: string }).id),
      label,
      os_number: null,
      total:
        (r as { amount?: number | null }).amount == null
          ? null
          : Number((r as { amount: number }).amount),
      venta: null,
      source: 'financial',
    });
  }

  const hasDigitalOs = digitalOsCount > 0;
  return {
    hasEvent: items.length > 0,
    hasDigitalOs,
    // Sin OS digital: sugerir $0 (editable; alerta en UI si capturan otro monto).
    suggestedOsAmount: hasDigitalOs ? suggestedOsSum : 0,
    suggestedOsLabel: hasDigitalOs
      ? labelParts.slice(0, 3).join(' · ') || null
      : null,
    items,
  };
}

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

    // Conciliación post-hoc: efectivo recibido (corte) vs Infocaja Efectivo.
    const cashCheck = reconcileEfectivoRecibidoVsInfocaja(
      rpt?.efectivo_contado ?? null,
      resolveInfocajaEfectivo(infocaja)
    );

    const canPending = canClosePendingCortes(auth);
    let adminLookback:
      | {
          minDate: string;
          maxDate: string;
          days: DayWindowSummary[];
        }
      | undefined;
    if (canPending) {
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

    const eventosDelDia = await loadEventosDelDia(sb, date);

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
      isMasterAdmin: canAccessAdmin(auth),
      canClosePendingCortes: canPending,
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
      eventosDelDia,
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
 * Body JSON: { date?, wi_amount, eventos_os_amount?, eventos_extra_amount?,
 *              eventos_amount? (legacy), efectivo_contado (recibido),
 *              efectivo_tombola (después de propinas), notes?,
 *              admin_offline? (Master o palomita Cortes pendientes: sin TPV completo),
 *              bancos_cobrado_tpv?, bancos_propina_tpv? (solo offline) }
 * Con evento: OS + venta extra (como Global). Total = OS + extra → eventos_amount.
 * Bancos/propinas = TPV (o manual si admin_offline sin TPV). Infocaja no bloquea.
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
    if (wi == null || wi < 0) {
      return NextResponse.json(
        { error: 'Indica el monto WI (puede ser 0)' },
        { status: 400 }
      );
    }

    const hasOsField =
      body.eventos_os_amount != null && String(body.eventos_os_amount) !== '';
    const hasExtraField =
      body.eventos_extra_amount != null &&
      String(body.eventos_extra_amount) !== '';
    let eventosOs = 0;
    let eventosExtra = 0;
    let eventos = 0;

    if (hasOsField || hasExtraField) {
      const osRaw = parseMoneyInput(body.eventos_os_amount ?? 0);
      const extraRaw = parseMoneyInput(body.eventos_extra_amount ?? 0);
      if (osRaw == null || osRaw < 0) {
        return NextResponse.json(
          { error: 'Indica el monto de la orden de servicio (puede ser 0)' },
          { status: 400 }
        );
      }
      if (extraRaw == null || extraRaw < 0) {
        return NextResponse.json(
          { error: 'Indica la venta extra del evento (0 si no hubo)' },
          { status: 400 }
        );
      }
      eventosOs = osRaw;
      eventosExtra = extraRaw;
      eventos = totalEventosAmount(eventosOs, eventosExtra);
    } else {
      const legacy = parseMoneyInput(body.eventos_amount);
      if (legacy == null || legacy < 0) {
        return NextResponse.json(
          { error: 'Indica Eventos (0 si no hubo)' },
          { status: 400 }
        );
      }
      eventos = legacy;
      eventosOs = legacy;
      eventosExtra = 0;
    }

    /** Efectivo recibido del día (manual; se concilia luego vs Infocaja). */
    const efectivoRecibido = parseMoneyInput(body.efectivo_contado);
    if (efectivoRecibido == null || efectivoRecibido < 0) {
      return NextResponse.json(
        { error: 'Indica el efectivo recibido (obligatorio)' },
        { status: 400 }
      );
    }

    /** Efectivo en tómbola después de propinas (manual). */
    const tombola = parseMoneyInput(body.efectivo_tombola);
    const adminOffline =
      canClosePendingCortes(auth) &&
      (body.admin_offline === true ||
        body.admin_offline === '1' ||
        body.admin_offline === 1);
    if (tombola == null || (!adminOffline && tombola < 0)) {
      return NextResponse.json(
        { error: 'Indica el efectivo en tómbola después de propinas (obligatorio)' },
        { status: 400 }
      );
    }

    const notesRaw = body.notes;
    const notes =
      notesRaw == null || String(notesRaw).trim() === ''
        ? null
        : String(notesRaw).trim().slice(0, 2000);

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

    if (!bancos.canSaveRpt && !adminOffline) {
      return NextResponse.json(
        {
          error: 'No se puede cerrar el corte todavía',
          blockers: bancos.blockers,
          bancos,
        },
        { status: 409 }
      );
    }

    /** Offline Master: montos TPV opcionales en body; si no, snapshot TPV o 0. */
    let cobrado = bancos.cobrado;
    let propina = bancos.propina;
    let neto = bancos.neto;
    if (adminOffline && !bancos.canSaveRpt) {
      const cobIn = parseMoneyInput(body.bancos_cobrado_tpv);
      const tipIn = parseMoneyInput(body.bancos_propina_tpv);
      if (cobIn != null && cobIn >= 0) cobrado = cobIn;
      else if (!bancos.complete) cobrado = 0;
      if (tipIn != null && tipIn >= 0) propina = tipIn;
      else if (!bancos.complete) propina = 0;
      const netoCalc = computeNetoBanco(cobrado, propina);
      neto = netoCalc ?? Math.round((cobrado + propina) * 100) / 100;
    }

    const { infocaja } = await loadInfocajaDay(sb, date);
    // Informativo: no bloquea el cierre si Infocaja falta o no coincide.
    const cashCheck = reconcileEfectivoRecibidoVsInfocaja(
      efectivoRecibido,
      resolveInfocajaEfectivo(infocaja)
    );

    const now = new Date().toISOString();
    const row = {
      rpt_date: date,
      wi_amount: wi,
      eventos_amount: eventos,
      eventos_os_amount: eventosOs,
      eventos_extra_amount: eventosExtra,
      // Total staff = Propina TPV (WI) + 12.5% OS; el 2.5% admin no entra al pool.
      propinas: totalPropinasStaff(propina, eventosOs),
      efectivo_tombola: tombola,
      efectivo_contado: efectivoRecibido,
      efectivo_infocaja: resolveInfocajaEfectivo(infocaja),
      bancos_neto_tpv: neto,
      bancos_cobrado_tpv: cobrado,
      bancos_propina_tpv: propina,
      tpv_accounted: bancos.day.accounted,
      tpv_complete: bancos.complete,
      notes:
        adminOffline && !bancos.canSaveRpt
          ? (() => {
              const tag = 'Cierre offline (sin TPV completo).';
              if (notes?.includes(tag)) return notes;
              return (
                [notes, tag].filter(Boolean).join(' ').slice(0, 2000) || null
              );
            })()
          : notes,
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
      warning: cashCheck.mismatch ? cashCheck.message : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cerrar corte';
    if (isTpvSchemaError(msg)) {
      return tpvSchemaMissingResponse(msg);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
