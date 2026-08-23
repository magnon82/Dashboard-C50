import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessAdmin,
  canAccessModule,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
  parseMoneyInput,
  reconcileEfectivoRecibidoVsInfocaja,
  resolveDayTombola,
  resolveInfocajaEfectivo,
  snapshotStaffRptValues,
  sumInfocajaDay,
  totalEventosAmount,
  totalPropinasStaff,
  type DayTombolaResult,
  type StaffRptEditHistoryEntry,
  type StaffRptInfocajaDay,
  type StaffRptRow,
} from '@/app/lib/staff-rpt';
import { isTpvSchemaError, tpvSchemaHint } from '@/app/lib/tpv-api';
import {
  TPV_CORTE_EPOCH,
  computeNetoBanco,
  shiftIsoDate,
  todayCdmxIso,
} from '@/app/lib/tpv-cortes';
import {
  toCorteDetailItem,
  type CorteDetailItem,
} from '@/app/lib/ventas-semana';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type VentasCorteMode = 'date' | 'yesterday' | 'latest' | 'none';

async function requireVentasViewer(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  const ok =
    canAccessAdmin(session) || canAccessModule(session, 'ventas');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso a Ventas' }, { status: 403 });
  }
  return session;
}

function parseIso(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function summarizeRpt(rpt: StaffRptRow) {
  return {
    rpt_date: rpt.rpt_date,
    wi_amount: rpt.wi_amount,
    eventos_amount: rpt.eventos_amount,
    eventos_os_amount: rpt.eventos_os_amount,
    eventos_extra_amount: rpt.eventos_extra_amount,
    propinas: rpt.propinas,
    efectivo_tombola: rpt.efectivo_tombola,
    efectivo_contado: rpt.efectivo_contado,
    efectivo_infocaja: rpt.efectivo_infocaja,
    bancos_neto_tpv: rpt.bancos_neto_tpv,
    bancos_cobrado_tpv: rpt.bancos_cobrado_tpv,
    bancos_propina_tpv: rpt.bancos_propina_tpv,
    tpv_accounted: rpt.tpv_accounted,
    tpv_complete: rpt.tpv_complete,
    notes: rpt.notes,
    created_by: rpt.created_by,
    updated_by: rpt.updated_by,
    created_at: rpt.created_at,
    updated_at: rpt.updated_at,
    edit_history: rpt.edit_history ?? [],
  };
}

/** Línea de detalle sin `raw` (payload API más liviano). */
export type CorteCancDescLine = Omit<CorteDetailItem, 'raw'>;

type CorteCancDesc = {
  cancelacionesCount: number;
  cancelacionesAmount: number;
  descuentosCount: number;
  descuentosAmount: number;
  cancelaciones: CorteCancDescLine[];
  descuentos: CorteCancDescLine[];
};

function toApiLine(item: CorteDetailItem): CorteCancDescLine {
  const { raw: _raw, ...rest } = item;
  return rest;
}

/**
 * Conteos/montos + líneas Infocaja corte_caja (mismo origen que hub Ventas cancelaciones).
 */
async function loadCancDescForDate(date: string): Promise<CorteCancDesc> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .select('id, date, category, amount, description')
    .eq('source_file', 'corte_caja')
    .in('category', ['Corte Cancelacion', 'Corte Descuento'])
    .eq('date', date)
    .order('id', { ascending: true });

  if (error) throw new Error(error.message);

  let cancelacionesAmount = 0;
  let descuentosAmount = 0;
  const cancelaciones: CorteCancDescLine[] = [];
  const descuentos: CorteCancDescLine[] = [];

  for (const row of data || []) {
    const item = toCorteDetailItem({
      id: String(row.id),
      date: String(row.date),
      category: String(row.category),
      amount: Number(row.amount) || 0,
      description: row.description != null ? String(row.description) : '',
    });
    if (!item) continue;
    const line = toApiLine(item);
    if (item.kind === 'cancelacion') {
      cancelaciones.push(line);
      cancelacionesAmount += item.amount;
    } else {
      descuentos.push(line);
      descuentosAmount += item.amount;
    }
  }

  return {
    cancelacionesCount: cancelaciones.length,
    cancelacionesAmount: Math.round(cancelacionesAmount * 100) / 100,
    descuentosCount: descuentos.length,
    descuentosAmount: Math.round(descuentosAmount * 100) / 100,
    cancelaciones,
    descuentos,
  };
}

function emptyCancDesc(): CorteCancDesc {
  return {
    cancelacionesCount: 0,
    cancelacionesAmount: 0,
    descuentosCount: 0,
    descuentosAmount: 0,
    cancelaciones: [],
    descuentos: [],
  };
}

async function loadInfocajaForDate(date: string) {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .select('category, amount')
    .eq('source_file', 'infocaja')
    .eq('date', date);
  if (error) throw new Error(error.message);
  return sumInfocajaDay(data || []);
}

/**
 * GET /api/ventas/corte
 * Reporte completo de un corte diario (staff_rpt_diario + cancelaciones/descuentos).
 * Tómbola: depósito capturado en el corte; sin cierre → Infocaja − propinas.
 * Conciliación: efectivo recibido (corte) vs Infocaja Efectivo (live).
 *
 * Query: date? (YYYY-MM-DD). Sin date → ayer CDMX; si no hay, el más reciente.
 */
export async function GET(req: NextRequest) {
  const auth = await requireVentasViewer();
  if (auth instanceof NextResponse) return auth;

  const yesterdayDate = shiftIsoDate(todayCdmxIso(), -1);
  const requestedDate = parseIso(req.nextUrl.searchParams.get('date'));

  try {
    const sb = getServiceSupabase();

    async function loadRptByDate(date: string): Promise<StaffRptRow | null> {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .eq('rpt_date', date)
        .maybeSingle();
      if (error) {
        if (isTpvSchemaError(error.message)) {
          const err = new Error(error.message);
          (err as Error & { schemaMissing?: boolean }).schemaMissing = true;
          throw err;
        }
        throw new Error(error.message);
      }
      if (!data) return null;
      return asStaffRptRow(data as Record<string, unknown>);
    }

    async function loadLatestRpt(): Promise<StaffRptRow | null> {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .order('rpt_date', { ascending: false })
        .limit(1);
      if (error) {
        if (isTpvSchemaError(error.message)) {
          const err = new Error(error.message);
          (err as Error & { schemaMissing?: boolean }).schemaMissing = true;
          throw err;
        }
        throw new Error(error.message);
      }
      const row = data?.[0];
      if (!row) return null;
      return asStaffRptRow(row as Record<string, unknown>);
    }

    /** Fechas con corte cerrado, antiguas → recientes (navegación ← →). */
    async function loadAvailableCorteDates(): Promise<string[]> {
      const { data, error } = await sb
        .from(STAFF_RPT_TABLE)
        .select('rpt_date')
        .order('rpt_date', { ascending: true });
      if (error) {
        if (isTpvSchemaError(error.message)) {
          const err = new Error(error.message);
          (err as Error & { schemaMissing?: boolean }).schemaMissing = true;
          throw err;
        }
        throw new Error(error.message);
      }
      const out: string[] = [];
      const seen = new Set<string>();
      for (const row of data || []) {
        const d = String((row as { rpt_date?: string }).rpt_date || '').slice(
          0,
          10
        );
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || seen.has(d)) continue;
        seen.add(d);
        out.push(d);
      }
      return out;
    }

    const availableDates = await loadAvailableCorteDates();
    const latestCorteDate =
      availableDates.length > 0
        ? availableDates[availableDates.length - 1]
        : null;

    let mode: VentasCorteMode = 'none';
    let rpt: StaffRptRow | null = null;
    let statsDate: string | null = null;

    if (requestedDate) {
      mode = 'date';
      rpt = await loadRptByDate(requestedDate);
      statsDate = requestedDate;
    } else {
      rpt = await loadRptByDate(yesterdayDate);
      if (rpt) {
        mode = 'yesterday';
        statsDate = rpt.rpt_date;
      } else {
        rpt = await loadLatestRpt();
        if (rpt) {
          mode = 'latest';
          statsDate = rpt.rpt_date;
        } else {
          // Sin cortes: aún mostrar tómbola de ayer desde Infocaja.
          statsDate = yesterdayDate;
          mode = 'yesterday';
        }
      }
    }

    const cancDesc = statsDate
      ? await loadCancDescForDate(statsDate)
      : emptyCancDesc();

    let tombola: DayTombolaResult | null = null;
    let cashCheck = reconcileEfectivoRecibidoVsInfocaja(null, null);
    let liveInfocaja: StaffRptInfocajaDay | null = null;
    let liveInfocajaEfectivo: number | null = null;
    if (statsDate) {
      try {
        const infocaja = await loadInfocajaForDate(statsDate);
        liveInfocaja = infocaja.hasAny ? infocaja : null;
        liveInfocajaEfectivo = resolveInfocajaEfectivo(infocaja);
        tombola = resolveDayTombola({ rpt, infocaja });
        cashCheck = reconcileEfectivoRecibidoVsInfocaja(
          rpt?.efectivo_contado ?? null,
          liveInfocajaEfectivo
        );
      } catch {
        tombola = rpt ? resolveDayTombola({ rpt, infocaja: null }) : null;
        liveInfocajaEfectivo = rpt?.efectivo_infocaja ?? null;
        cashCheck = reconcileEfectivoRecibidoVsInfocaja(
          rpt?.efectivo_contado ?? null,
          liveInfocajaEfectivo
        );
      }
    }

    const corteSummary = rpt
      ? {
          ...summarizeRpt(rpt),
          // Prefer live Infocaja for post-hoc reconcile when snapshot was null at close.
          efectivo_infocaja:
            liveInfocajaEfectivo ?? rpt.efectivo_infocaja,
        }
      : null;

    return NextResponse.json({
      ready: true,
      mode,
      requestedDate,
      yesterdayDate,
      todayDate: todayCdmxIso(),
      date: statsDate,
      isYesterday: statsDate === yesterdayDate,
      hasCorte: Boolean(rpt),
      /** Master puede editar montos de un corte cerrado (PATCH). */
      canEditAdmin: canAccessAdmin(auth),
      /** Fechas con corte cerrado (asc). Máximo = último realizado. */
      availableDates,
      latestCorteDate,
      corte: corteSummary,
      tombola,
      /** Reporte Infocaja del correo (Gmail) para la fecha del corte. */
      infocaja: liveInfocaja,
      /** Conciliación efectivo recibido (corte) vs Infocaja Efectivo. */
      cashCheck,
      cancDesc,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar corte';
    const schemaMissing = Boolean(
      (e as Error & { schemaMissing?: boolean })?.schemaMissing
    );
    const todayDate = todayCdmxIso();
    if (schemaMissing || isTpvSchemaError(msg)) {
      return NextResponse.json(
        {
          ready: false,
          mode: 'none' as VentasCorteMode,
          requestedDate,
          yesterdayDate,
          todayDate,
          date: null,
          isYesterday: false,
          hasCorte: false,
          availableDates: [],
          latestCorteDate: null,
          corte: null,
          tombola: null,
          infocaja: null,
          cashCheck: null,
          cancDesc: emptyCancDesc(),
          schemaMissing: true,
          error:
            'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_corte_prod_fix.sql',
          hint: tpvSchemaHint(msg),
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        ready: false,
        mode: 'none' as VentasCorteMode,
        requestedDate,
        yesterdayDate,
        todayDate,
        date: null,
        isYesterday: false,
        hasCorte: false,
        availableDates: [],
        latestCorteDate: null,
        corte: null,
        tombola: null,
        infocaja: null,
        cashCheck: null,
        cancDesc: emptyCancDesc(),
        error: msg,
        hint: isTpvSchemaError(msg) ? tpvSchemaHint(msg) : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/ventas/corte — Master edita un corte cerrado.
 * Conserva valores previos en edit_history y actualiza todos los montos vigentes.
 * Body: { date, wi_amount, eventos_os_amount, eventos_extra_amount,
 *         efectivo_contado, efectivo_tombola, bancos_cobrado_tpv,
 *         bancos_propina_tpv, notes? }
 * Bancos neto = cobrado + propina; propinas snapshot = propina TPV.
 */
export async function PATCH(request: Request) {
  const auth = await requireVentasViewer();
  if (auth instanceof NextResponse) return auth;
  if (!canAccessAdmin(auth)) {
    return NextResponse.json(
      { error: 'Solo Master puede editar cortes cerrados' },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const date = String(body.date || body.rpt_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
    }
    if (date < TPV_CORTE_EPOCH) {
      return NextResponse.json(
        {
          error: `Solo se editan cortes desde ${TPV_CORTE_EPOCH}`,
          min_date: TPV_CORTE_EPOCH,
        },
        { status: 403 }
      );
    }

    const wi = parseMoneyInput(body.wi_amount);
    if (wi == null || wi < 0) {
      return NextResponse.json(
        { error: 'Indica el monto WI (puede ser 0)' },
        { status: 400 }
      );
    }

    const osRaw = parseMoneyInput(body.eventos_os_amount ?? 0);
    const extraRaw = parseMoneyInput(body.eventos_extra_amount ?? 0);
    if (osRaw == null || osRaw < 0) {
      return NextResponse.json(
        { error: 'Indica el monto OS de eventos (puede ser 0)' },
        { status: 400 }
      );
    }
    if (extraRaw == null || extraRaw < 0) {
      return NextResponse.json(
        { error: 'Indica la venta extra de eventos (0 si no hubo)' },
        { status: 400 }
      );
    }
    const eventosOs = osRaw;
    const eventosExtra = extraRaw;
    const eventos = totalEventosAmount(eventosOs, eventosExtra);

    const efectivoRecibido = parseMoneyInput(body.efectivo_contado);
    if (efectivoRecibido == null || efectivoRecibido < 0) {
      return NextResponse.json(
        { error: 'Indica el efectivo recibido (obligatorio)' },
        { status: 400 }
      );
    }

    // Admin puede corregir tómbola negativa / déficit (permite < 0).
    const tombola = parseMoneyInput(body.efectivo_tombola);
    if (tombola == null) {
      return NextResponse.json(
        { error: 'Indica el efectivo en tómbola' },
        { status: 400 }
      );
    }

    const cobrado = parseMoneyInput(body.bancos_cobrado_tpv);
    if (cobrado == null || cobrado < 0) {
      return NextResponse.json(
        { error: 'Indica bancos cobrado TPV (puede ser 0)' },
        { status: 400 }
      );
    }
    const propinaTpv = parseMoneyInput(body.bancos_propina_tpv);
    if (propinaTpv == null || propinaTpv < 0) {
      return NextResponse.json(
        { error: 'Indica propina TPV (puede ser 0)' },
        { status: 400 }
      );
    }
    const neto = computeNetoBanco(cobrado, propinaTpv);

    const notesRaw = body.notes;
    const notes =
      notesRaw == null || String(notesRaw).trim() === ''
        ? null
        : String(notesRaw).trim().slice(0, 2000);

    const sb = getServiceSupabase();
    const { data: existing, error: existErr } = await sb
      .from(STAFF_RPT_TABLE)
      .select('*')
      .eq('rpt_date', date)
      .maybeSingle();

    if (existErr) {
      if (isTpvSchemaError(existErr.message)) {
        return NextResponse.json(
          {
            error: existErr.message,
            hint: tpvSchemaHint(existErr.message),
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: existErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json(
        {
          error:
            'No hay corte cerrado para esa fecha. Usa Staff → Corte del día para crear uno nuevo.',
        },
        { status: 404 }
      );
    }

    const current = asStaffRptRow(existing as Record<string, unknown>);
    const now = new Date().toISOString();
    const historyEntry: StaffRptEditHistoryEntry = {
      edited_at: now,
      edited_by: auth.username,
      previous: snapshotStaffRptValues(current),
    };
    const prevHistory = current.edit_history ?? [];
    const edit_history = [...prevHistory, historyEntry].slice(-40);

    const patch = {
      wi_amount: wi,
      eventos_amount: eventos,
      eventos_os_amount: eventosOs,
      eventos_extra_amount: eventosExtra,
      // Total staff = Propina TPV (WI) + 12.5% eventos; admin 2.5% no entra.
      propinas: totalPropinasStaff(propinaTpv, eventosOs),
      efectivo_tombola: tombola,
      efectivo_contado: efectivoRecibido,
      bancos_cobrado_tpv: cobrado,
      bancos_propina_tpv: propinaTpv,
      bancos_neto_tpv: neto,
      notes,
      updated_by: auth.username,
      updated_at: now,
      edit_history,
    };

    let historyColumnMissing = false;
    let { data: saved, error: updErr } = await sb
      .from(STAFF_RPT_TABLE)
      .update(patch)
      .eq('id', current.id)
      .select('*')
      .single();

    // Columna edit_history aún no aplicada → guardar sin historial.
    if (
      updErr &&
      /edit_history|schema cache|Could not find|42703/i.test(updErr.message)
    ) {
      historyColumnMissing = true;
      const { edit_history: _omit, ...withoutHistory } = patch;
      void _omit;
      const retry = await sb
        .from(STAFF_RPT_TABLE)
        .update(withoutHistory)
        .eq('id', current.id)
        .select('*')
        .single();
      saved = retry.data;
      updErr = retry.error;
    }

    if (updErr || !saved) {
      if (updErr && isTpvSchemaError(updErr.message)) {
        return NextResponse.json(
          {
            error: updErr.message,
            hint: tpvSchemaHint(updErr.message),
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: updErr?.message || 'No se pudo guardar' },
        { status: 500 }
      );
    }

    const rpt = asStaffRptRow(saved as Record<string, unknown>);
    // Preferir historial recién armado si la columna aún no vuelve en select.
    if (!rpt.edit_history?.length && edit_history.length) {
      rpt.edit_history = edit_history;
    }

    let liveInfocaja: StaffRptInfocajaDay | null = null;
    try {
      const info = await loadInfocajaForDate(date);
      liveInfocaja = info.hasAny ? info : null;
    } catch {
      liveInfocaja = null;
    }
    const cashCheck = reconcileEfectivoRecibidoVsInfocaja(
      rpt.efectivo_contado,
      resolveInfocajaEfectivo(liveInfocaja) ?? rpt.efectivo_infocaja
    );

    return NextResponse.json({
      ok: true,
      canEditAdmin: true,
      date,
      corte: {
        ...summarizeRpt(rpt),
        efectivo_infocaja:
          resolveInfocajaEfectivo(liveInfocaja) ?? rpt.efectivo_infocaja,
      },
      previous: historyEntry.previous,
      cashCheck,
      infocaja: liveInfocaja,
      hint: historyColumnMissing
        ? 'Guardado. Para historial persistente ejecuta supabase/staff_rpt_edit_history.sql'
        : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al editar corte';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
