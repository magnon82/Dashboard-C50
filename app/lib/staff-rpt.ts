import {
  buildDayCompleteness,
  computeNetoBanco,
  moneyMx,
  type TpvCorteUpload,
  type TpvDayCompleteness,
} from '@/app/lib/tpv-cortes';
import {
  EVENTOS_SERVICIO_ADMIN_PCT,
  EVENTOS_SERVICIO_PCT,
  EVENTOS_SERVICIO_STAFF_PCT,
} from '@/app/lib/eventos';

export const STAFF_RPT_TABLE = 'staff_rpt_diario';

/**
 * Tolerancia ($1) al conciliar efectivo recibido del corte vs Infocaja Efectivo.
 * El cierre NO depende de Infocaja (llega por correo después); la comparación es post-hoc.
 */
export const EFECTIVO_TOLERANCE_MXN = 1;

/** Desglose del 15% servicio sobre VENTA OS. */
export type EventoServicioSplit = {
  osVenta: number;
  /** 15% total facturado con propina. */
  servicioTotal: number;
  /** 12.5% → staff. */
  staffTip: number;
  /** 2.5% → tómbola (cargo administrativo / comisión TPV). */
  adminTombola: number;
};

export function splitEventoServicio(osVenta: number): EventoServicioSplit {
  const os = Math.round(Number(osVenta) * 100) / 100;
  const servicioTotal =
    Math.round(os * EVENTOS_SERVICIO_PCT * 100) / 100;
  const staffTip =
    Math.round(os * EVENTOS_SERVICIO_STAFF_PCT * 100) / 100;
  const adminTombola =
    Math.round(os * EVENTOS_SERVICIO_ADMIN_PCT * 100) / 100;
  return { osVenta: os, servicioTotal, staffTip, adminTombola };
}

/**
 * Desglose de propinas del corte.
 * - Propina TPV = solo WI (tickets de terminal); el servicio del evento no es TPV.
 * - Eventos 12.5% = pool staff sobre VENTA OS.
 * - Admin 2.5% = cargo a tómbola (no forma parte del pool staff).
 * - Total propinas (staff) = TPV WI + 12.5% eventos.
 */
export type CortePropinasBreakdown = {
  propinaTpvWi: number;
  staffTipEventos: number;
  adminTombola: number;
  servicioTotal: number;
  propinasTotal: number;
  osVenta: number;
};

export function cortePropinasBreakdown(
  propinaTpv: number | null | undefined,
  osVenta: number | null | undefined
): CortePropinasBreakdown {
  const propinaTpvWi =
    Math.round(Math.max(0, Number(propinaTpv) || 0) * 100) / 100;
  const split = splitEventoServicio(Number(osVenta) || 0);
  return {
    propinaTpvWi,
    staffTipEventos: split.staffTip,
    adminTombola: split.adminTombola,
    servicioTotal: split.servicioTotal,
    propinasTotal:
      Math.round((propinaTpvWi + split.staffTip) * 100) / 100,
    osVenta: split.osVenta,
  };
}

/** Total de propinas staff a persistir en `propinas` (TPV WI + 12.5% OS). */
export function totalPropinasStaff(
  propinaTpv: number | null | undefined,
  osVenta: number | null | undefined
): number {
  return cortePropinasBreakdown(propinaTpv, osVenta).propinasTotal;
}

/**
 * Infocaja suele clasificar el 15% de servicio del evento en Bancarias;
 * el TPV lo reporta en Propinas. Si Δ propinas ≈ +servicio y Δ bancarias ≈ −servicio,
 * no es diferencia operativa sino reclasificación.
 */
export function isEventoServicioClassificationGap(opts: {
  osVenta: number | null | undefined;
  /** corte.propina − Infocaja Propina */
  propinasDelta: number | null | undefined;
  /** (cobrado−propina) − Infocaja Bancarias */
  bancariasDelta: number | null | undefined;
  tolerance?: number;
}): boolean {
  const os = Number(opts.osVenta);
  if (!Number.isFinite(os) || os <= 0) return false;
  if (opts.propinasDelta == null || opts.bancariasDelta == null) return false;
  const { servicioTotal } = splitEventoServicio(os);
  if (servicioTotal <= 0) return false;
  const tol = opts.tolerance ?? EFECTIVO_TOLERANCE_MXN;
  return (
    Math.abs(opts.propinasDelta - servicioTotal) <= tol &&
    Math.abs(opts.bancariasDelta + servicioTotal) <= tol
  );
}

/** Snapshot de montos vigentes del corte (para auditoría de ediciones). */
export type StaffRptValuesSnapshot = {
  wi_amount: number;
  eventos_amount: number;
  eventos_os_amount: number;
  eventos_extra_amount: number;
  propinas: number;
  efectivo_tombola: number;
  efectivo_contado: number | null;
  bancos_neto_tpv: number | null;
  bancos_cobrado_tpv: number | null;
  bancos_propina_tpv: number | null;
  notes: string | null;
};

export type StaffRptEditHistoryEntry = {
  edited_at: string;
  edited_by: string;
  previous: StaffRptValuesSnapshot;
};

export interface StaffRptRow {
  id: string;
  rpt_date: string;
  wi_amount: number;
  eventos_amount: number;
  /** Orden de servicio (Global · VENTA). */
  eventos_os_amount: number;
  /** Venta extra del evento (Global · VENTA EXTRA). */
  eventos_extra_amount: number;
  propinas: number;
  /** Efectivo depositado en tómbola (después de propinas). Captura manual. */
  efectivo_tombola: number;
  /**
   * Efectivo recibido del día (captura manual en cierre).
   * Se concilia después con Infocaja Efectivo cuando el reporte llega por correo.
   */
  efectivo_contado: number | null;
  efectivo_infocaja: number | null;
  bancos_neto_tpv: number | null;
  bancos_cobrado_tpv: number | null;
  bancos_propina_tpv: number | null;
  tpv_accounted: number;
  tpv_complete: boolean;
  notes: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** Ediciones admin previas (más reciente al final). */
  edit_history?: StaffRptEditHistoryEntry[];
}

export interface StaffRptTpvTerminalView {
  terminal: 1 | 2 | 3;
  state: 'missing' | 'partial' | 'photo' | 'unused';
  hasAmounts: boolean;
  hasVentaPhoto: boolean;
  hasPropinaPhoto: boolean;
  total_cobrado: number | null;
  propina: number | null;
  neto_banco: number | null;
}

export interface StaffRptBancosFromTpv {
  day: TpvDayCompleteness;
  terminals: StaffRptTpvTerminalView[];
  cobrado: number;
  propina: number;
  neto: number;
  /** 3/3 con ambas fotos o unused */
  complete: boolean;
  /** Todas las fotos tienen montos (venta→cobrado, propina→propina) */
  amountsReady: boolean;
  /** Puede guardar RPT: complete && amountsReady */
  canSaveRpt: boolean;
  blockers: string[];
}

export interface StaffRptInfocajaDay {
  efectivo: number;
  bancarias: number;
  propina: number;
  ventaTotal: number;
  hasEfectivo: boolean;
  hasAny: boolean;
}

export function asStaffRptRow(r: Record<string, unknown>): StaffRptRow {
  const os =
    r.eventos_os_amount == null ? null : Number(r.eventos_os_amount);
  const extra =
    r.eventos_extra_amount == null ? null : Number(r.eventos_extra_amount);
  const totalLegacy = Number(r.eventos_amount) || 0;
  const osAmount = os != null && Number.isFinite(os) ? os : 0;
  const extraAmount = extra != null && Number.isFinite(extra) ? extra : 0;
  // Filas antiguas sin desglose: todo el total cuenta como OS.
  const hasSplit = r.eventos_os_amount != null || r.eventos_extra_amount != null;
  return {
    id: String(r.id),
    rpt_date: String(r.rpt_date).slice(0, 10),
    wi_amount: Number(r.wi_amount) || 0,
    eventos_amount: totalLegacy,
    eventos_os_amount: hasSplit ? osAmount : totalLegacy,
    eventos_extra_amount: hasSplit ? extraAmount : 0,
    propinas: Number(r.propinas) || 0,
    efectivo_tombola: Number(r.efectivo_tombola) || 0,
    efectivo_contado:
      r.efectivo_contado == null ? null : Number(r.efectivo_contado),
    efectivo_infocaja:
      r.efectivo_infocaja == null ? null : Number(r.efectivo_infocaja),
    bancos_neto_tpv:
      r.bancos_neto_tpv == null ? null : Number(r.bancos_neto_tpv),
    bancos_cobrado_tpv:
      r.bancos_cobrado_tpv == null ? null : Number(r.bancos_cobrado_tpv),
    bancos_propina_tpv:
      r.bancos_propina_tpv == null ? null : Number(r.bancos_propina_tpv),
    tpv_accounted: Number(r.tpv_accounted) || 0,
    tpv_complete: Boolean(r.tpv_complete),
    notes: r.notes == null ? null : String(r.notes),
    created_by: String(r.created_by || ''),
    updated_by: r.updated_by == null ? null : String(r.updated_by),
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
    edit_history: parseEditHistory(r.edit_history),
  };
}

export function snapshotStaffRptValues(
  rpt: StaffRptRow
): StaffRptValuesSnapshot {
  return {
    wi_amount: rpt.wi_amount,
    eventos_amount: rpt.eventos_amount,
    eventos_os_amount: rpt.eventos_os_amount,
    eventos_extra_amount: rpt.eventos_extra_amount,
    propinas: rpt.propinas,
    efectivo_tombola: rpt.efectivo_tombola,
    efectivo_contado: rpt.efectivo_contado,
    bancos_neto_tpv: rpt.bancos_neto_tpv,
    bancos_cobrado_tpv: rpt.bancos_cobrado_tpv,
    bancos_propina_tpv: rpt.bancos_propina_tpv,
    notes: rpt.notes,
  };
}

function parseEditHistory(raw: unknown): StaffRptEditHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffRptEditHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const prev = rec.previous;
    if (!prev || typeof prev !== 'object') continue;
    const p = prev as Record<string, unknown>;
    out.push({
      edited_at: String(rec.edited_at || ''),
      edited_by: String(rec.edited_by || ''),
      previous: {
        wi_amount: Number(p.wi_amount) || 0,
        eventos_amount: Number(p.eventos_amount) || 0,
        eventos_os_amount: Number(p.eventos_os_amount) || 0,
        eventos_extra_amount: Number(p.eventos_extra_amount) || 0,
        propinas: Number(p.propinas) || 0,
        efectivo_tombola: Number(p.efectivo_tombola) || 0,
        efectivo_contado:
          p.efectivo_contado == null ? null : Number(p.efectivo_contado),
        bancos_neto_tpv:
          p.bancos_neto_tpv == null ? null : Number(p.bancos_neto_tpv),
        bancos_cobrado_tpv:
          p.bancos_cobrado_tpv == null ? null : Number(p.bancos_cobrado_tpv),
        bancos_propina_tpv:
          p.bancos_propina_tpv == null ? null : Number(p.bancos_propina_tpv),
        notes: p.notes == null ? null : String(p.notes),
      },
    });
  }
  return out;
}

/** Total eventos = OS (VENTA) + venta extra. */
export function totalEventosAmount(os: number, extra: number): number {
  return Math.round((Math.max(0, os) + Math.max(0, extra)) * 100) / 100;
}

function slotHasAmounts(
  state: string,
  venta: TpvCorteUpload | null,
  propinaUpload: TpvCorteUpload | null
): boolean {
  if (state === 'unused') return true;
  if (state !== 'photo') return false;
  const cobOk =
    venta?.total_cobrado != null && !Number.isNaN(Number(venta.total_cobrado));
  const tipOk =
    propinaUpload?.propina != null &&
    !Number.isNaN(Number(propinaUpload.propina));
  return cobOk && tipOk;
}

/** Bancos del RPT = suma de montos confirmados en fotos TPV del día (no tecleo en RPT). */
export function buildBancosFromTpv(
  uploads: TpvCorteUpload[],
  corteDate: string
): StaffRptBancosFromTpv {
  const day = buildDayCompleteness(uploads, corteDate);
  const terminals: StaffRptTpvTerminalView[] = day.slots.map((s) => {
    const venta = s.venta;
    const propinaUpload = s.propinaUpload;
    const cobrado =
      venta?.total_cobrado != null ? Number(venta.total_cobrado) : null;
    // Preferir propina de la foto de propinas; legacy: propina en la misma fila venta
    const propina =
      propinaUpload?.propina != null
        ? Number(propinaUpload.propina)
        : venta?.propina != null
          ? Number(venta.propina)
          : null;
    const neto = computeNetoBanco(cobrado, propina);
    return {
      terminal: s.terminal,
      state: s.state,
      hasAmounts: slotHasAmounts(s.state, venta, propinaUpload),
      hasVentaPhoto: Boolean(venta),
      hasPropinaPhoto: Boolean(propinaUpload),
      total_cobrado: s.state === 'photo' || s.state === 'partial' ? cobrado : null,
      propina: s.state === 'photo' || s.state === 'partial' ? propina : null,
      neto_banco: s.state === 'photo' ? neto : null,
    };
  });

  let cobrado = 0;
  let propina = 0;
  let neto = 0;
  for (const t of terminals) {
    if (t.state !== 'photo') continue;
    cobrado += t.total_cobrado ?? 0;
    propina += t.propina ?? 0;
    neto += t.neto_banco ?? 0;
  }
  cobrado = Math.round(cobrado * 100) / 100;
  propina = Math.round(propina * 100) / 100;
  neto = Math.round(neto * 100) / 100;

  const blockers: string[] = [];
  if (!day.complete) {
    const missing = day.missing.map((n) => `T${n}`).join(', ');
    blockers.push(
      `Faltan Cortes TPV (${missing}). Cada terminal necesita foto de venta + foto de propinas, o «no se usó».`
    );
  }
  const withoutAmounts = terminals.filter(
    (t) => t.state === 'photo' && !t.hasAmounts
  );
  if (withoutAmounts.length) {
    blockers.push(
      `Faltan montos leídos del ticket en: ${withoutAmounts
        .map((t) => `T${t.terminal}`)
        .join(', ')}. Confirma Total (Totalización) y Propina (Reporte) mirando las fotos.`
    );
  }

  const amountsReady = withoutAmounts.length === 0 && day.complete;
  return {
    day,
    terminals,
    cobrado,
    propina,
    neto,
    complete: day.complete,
    amountsReady,
    canSaveRpt: day.complete && amountsReady,
    blockers,
  };
}

/** Categorías de Venta Total en financial_records (ingest Gmail usa «Venta Total»). */
export function isInfocajaVentaTotalCategory(category: string): boolean {
  const cat = String(category || '').trim().toLowerCase();
  return cat === 'venta total' || cat === 'infocaja venta total';
}

export function sumInfocajaDay(
  rows: Array<{ category?: string | null; amount?: number | null }>
): StaffRptInfocajaDay {
  let efectivo = 0;
  let bancarias = 0;
  let propina = 0;
  let ventaTotal = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    const cat = String(r.category || '');
    if (cat === 'Infocaja Efectivo') efectivo += amt;
    else if (cat === 'Infocaja Bancarias') bancarias += amt;
    else if (cat === 'Infocaja Propina') propina += amt;
    else if (isInfocajaVentaTotalCategory(cat)) ventaTotal += amt;
  }
  return {
    efectivo: Math.round(efectivo * 100) / 100,
    bancarias: Math.round(bancarias * 100) / 100,
    propina: Math.round(propina * 100) / 100,
    ventaTotal: Math.round(ventaTotal * 100) / 100,
    hasEfectivo: efectivo > 0,
    hasAny: efectivo > 0 || bancarias > 0 || propina > 0 || ventaTotal > 0,
  };
}

/**
 * Saldo efe = efectivo recibido − propinas de terminales (TPV).
 * Las propinas de tarjeta se cubren con efectivo de caja; el saldo puede ser
 * **negativo** si el efectivo no alcanzó (no se recorta a 0).
 * En corte diario se usa como esperado a depositar; en Ventas semanal el
 * entregable físico «Tómbola» se calcula aparte con recuperación de déficit.
 */
export function expectedTombolaDeposit(
  efectivoRecibido: number | null | undefined,
  propinasTerminales: number | null | undefined
): number | null {
  if (efectivoRecibido == null || !Number.isFinite(Number(efectivoRecibido))) {
    return null;
  }
  const tips = Math.max(0, Number(propinasTerminales) || 0);
  return Math.round((Number(efectivoRecibido) - tips) * 100) / 100;
}

export type TombolaDaySource = 'formula' | 'depositado' | 'infocaja';

export type DayTombolaResult = {
  /** Saldo efe del día (efectivo − propinas TPV); puede ser negativo. */
  amount: number;
  source: TombolaDaySource;
  efectivo: number | null;
  propinas_tpv: number;
};

/** Día tras aplicar recuperación de déficit → efectivo a entregar en tómbola. */
export type TombolaRecoveryDay = {
  saldo_efe: number;
  /** Efectivo a entregar ese día (≥ 0). */
  tombola: number;
  /** Parte del saldo positivo usada para recuperar déficit previo. */
  recovery: number;
  /** Déficit pendiente al cierre del día (≥ 0). */
  deficit_after: number;
};

/**
 * Recupera déficits de Saldo efe antes de entregar a tómbola.
 *
 * - saldoEfe &lt; 0 → tómbola 0; se acumula deuda (propinas de tarjeta pagadas
 *   con efectivo que hay que recuperar).
 * - saldoEfe &gt; 0 → primero paga deuda; el remanente es tómbola del día.
 *
 * Ej.: D1 = −500 → tómbola 0, déficit 500; D2 = +1000 → recovery 500,
 * tómbola 500, déficit 0.
 */
export function applyTombolaDeficitRecovery(
  saldoEfeByDay: readonly number[]
): TombolaRecoveryDay[] {
  let deficit = 0;
  return saldoEfeByDay.map((raw) => {
    const saldo_efe = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(saldo_efe)) {
      return { saldo_efe: 0, tombola: 0, recovery: 0, deficit_after: deficit };
    }
    if (saldo_efe < 0) {
      deficit = Math.round((deficit - saldo_efe) * 100) / 100;
      return {
        saldo_efe,
        tombola: 0,
        recovery: 0,
        deficit_after: deficit,
      };
    }
    const recovery = Math.min(saldo_efe, deficit);
    const tombola = Math.round((saldo_efe - recovery) * 100) / 100;
    deficit = Math.round((deficit - recovery) * 100) / 100;
    return { saldo_efe, tombola, recovery, deficit_after: deficit };
  });
}

/**
 * Tómbola del día desde un corte cerrado:
 * **Efectivo recibido − Propina TPV** (puede ser negativo si no alcanzó).
 * El depósito físico (`efectivo_tombola`) queda como captura operativa aparte.
 */
export function dayTombolaFromRpt(rpt: StaffRptRow): DayTombolaResult {
  const tips = Math.max(
    0,
    Number(rpt.bancos_propina_tpv ?? rpt.propinas) || 0
  );
  const recibido =
    rpt.efectivo_contado != null && Number.isFinite(Number(rpt.efectivo_contado))
      ? Number(rpt.efectivo_contado)
      : null;
  const fromRecibido = expectedTombolaDeposit(recibido, tips);
  if (fromRecibido != null) {
    return {
      amount: fromRecibido,
      source: 'formula',
      efectivo: recibido,
      propinas_tpv: tips,
    };
  }
  const fromInfocaja = expectedTombolaDeposit(rpt.efectivo_infocaja, tips);
  if (fromInfocaja != null) {
    return {
      amount: fromInfocaja,
      source: 'formula',
      efectivo: Number(rpt.efectivo_infocaja),
      propinas_tpv: tips,
    };
  }
  // Último recurso: depósito capturado en el cierre.
  if (rpt.efectivo_tombola != null && Number.isFinite(Number(rpt.efectivo_tombola))) {
    return {
      amount: Math.round(Number(rpt.efectivo_tombola) * 100) / 100,
      source: 'depositado',
      efectivo: null,
      propinas_tpv: tips,
    };
  }
  return {
    amount: 0,
    source: 'formula',
    efectivo: null,
    propinas_tpv: tips,
  };
}

/**
 * Tómbola del día con o sin corte cerrado.
 * Preferencia: efectivo recibido (corte) − propinas TPV;
 * si no hay cierre, Infocaja Efectivo − propinas.
 */
export function resolveDayTombola(input: {
  rpt?: StaffRptRow | null;
  infocaja?: StaffRptInfocajaDay | null;
}): DayTombolaResult | null {
  const rpt = input.rpt ?? null;
  const info = input.infocaja ?? null;

  const tipsFromTpv =
    rpt?.bancos_propina_tpv != null
      ? Math.max(0, Number(rpt.bancos_propina_tpv) || 0)
      : null;
  const tipsFromInfocaja =
    info != null ? Math.max(0, Number(info.propina) || 0) : null;
  const tips =
    tipsFromTpv != null
      ? tipsFromTpv
      : tipsFromInfocaja != null
        ? tipsFromInfocaja
        : Math.max(0, Number(rpt?.propinas) || 0);

  const recibidoCorte =
    rpt?.efectivo_contado != null &&
    Number.isFinite(Number(rpt.efectivo_contado))
      ? Number(rpt.efectivo_contado)
      : null;
  const fromRecibido = expectedTombolaDeposit(recibidoCorte, tips);
  if (fromRecibido != null) {
    return {
      amount: fromRecibido,
      source: 'formula',
      efectivo: recibidoCorte,
      propinas_tpv: tips,
    };
  }

  const efectivoLive =
    info != null && info.hasAny ? info.efectivo : null;
  const efectivoSnap =
    rpt?.efectivo_infocaja != null &&
    Number.isFinite(Number(rpt.efectivo_infocaja))
      ? Number(rpt.efectivo_infocaja)
      : null;
  const efectivo = efectivoLive ?? efectivoSnap;

  const expected = expectedTombolaDeposit(efectivo, tips);
  if (expected != null) {
    return {
      amount: expected,
      source: efectivoLive != null && rpt == null ? 'infocaja' : 'formula',
      efectivo,
      propinas_tpv: tips,
    };
  }

  if (rpt) return dayTombolaFromRpt(rpt);
  return null;
}

export type EfectivoInfocajaReconcile = {
  /** Ambos montos presentes y |delta| > tolerancia. */
  mismatch: boolean;
  /** Ambos montos presentes y |delta| ≤ tolerancia. */
  match: boolean;
  /** true si ya hay Infocaja Efectivo para la fecha. */
  hasInfocaja: boolean;
  /** true si el corte tiene efectivo recibido capturado. */
  hasRecibido: boolean;
  recibido: number | null;
  infocaja: number | null;
  delta: number | null;
  message: string | null;
  /**
   * @deprecated Alias de mismatch (compat UI antigua que usaba belowInfocaja).
   * Ya no significa «tómbola &lt; Infocaja − tips».
   */
  belowInfocaja: boolean;
  /** @deprecated Usar `infocaja` — era el esperado tómbola (Infocaja − tips). */
  expected: number | null;
};

/**
 * Conciliación post-hoc: efectivo recibido del corte vs Infocaja Efectivo.
 * No bloquea el cierre (Infocaja suele llegar por correo después).
 */
export function reconcileEfectivoRecibidoVsInfocaja(
  recibido: number | null | undefined,
  infocajaEfectivo: number | null | undefined
): EfectivoInfocajaReconcile {
  const hasRecibido =
    recibido != null && Number.isFinite(Number(recibido)) && Number(recibido) >= 0;
  const hasInfocaja =
    infocajaEfectivo != null &&
    Number.isFinite(Number(infocajaEfectivo));
  const r = hasRecibido ? Math.round(Number(recibido) * 100) / 100 : null;
  const i = hasInfocaja
    ? Math.round(Number(infocajaEfectivo) * 100) / 100
    : null;

  if (r == null || i == null) {
    return {
      mismatch: false,
      match: false,
      hasInfocaja,
      hasRecibido,
      recibido: r,
      infocaja: i,
      delta: null,
      message: hasInfocaja
        ? null
        : hasRecibido
          ? 'Infocaja aún no disponible; la conciliación se hará cuando llegue el reporte del día.'
          : null,
      belowInfocaja: false,
      expected: i,
    };
  }

  const delta = Math.round((r - i) * 100) / 100;
  const match = Math.abs(delta) <= EFECTIVO_TOLERANCE_MXN;
  if (match) {
    return {
      mismatch: false,
      match: true,
      hasInfocaja: true,
      hasRecibido: true,
      recibido: r,
      infocaja: i,
      delta,
      message: `Efectivo recibido del corte (${moneyMx(r)}) coincide con Infocaja (${moneyMx(i)}).`,
      belowInfocaja: false,
      expected: i,
    };
  }

  const message = `Efectivo recibido del corte (${moneyMx(r)}) no coincide con Infocaja Efectivo (${moneyMx(i)}). Diferencia ${moneyMx(delta)}.`;
  return {
    mismatch: true,
    match: false,
    hasInfocaja: true,
    hasRecibido: true,
    recibido: r,
    infocaja: i,
    delta,
    message,
    belowInfocaja: true,
    expected: i,
  };
}

/**
 * @deprecated Preferir `reconcileEfectivoRecibidoVsInfocaja`.
 * Firma antigua: (contado/tombola, efectivo Infocaja, propinas) → ahora ignora propinas
 * y compara recibido vs Infocaja.
 */
export function efectivoMismatch(
  contado: number | null | undefined,
  efectivoRecibido: number | null | undefined,
  _propinasTerminales: number | null | undefined = 0
): EfectivoInfocajaReconcile {
  // Firma legacy: 2º arg era Infocaja; 1º era tómbola/contado.
  // Nueva semántica: 1º = recibido del corte, 2º = Infocaja.
  return reconcileEfectivoRecibidoVsInfocaja(contado, efectivoRecibido);
}

/** @deprecated Ya no se usa en cierre (Infocaja post-hoc). */
export function shortageCloseNote(
  contado: number,
  efectivoRecibido: number,
  propinasTerminales: number = 0
): string {
  const expected =
    expectedTombolaDeposit(efectivoRecibido, propinasTerminales) ??
    efectivoRecibido;
  const delta = Math.round((contado - expected) * 100) / 100;
  const faltante = Math.abs(delta);
  const tips = Math.max(0, Number(propinasTerminales) || 0);
  return `[Faltante efectivo] Tómbola ${moneyMx(contado)} < esperado ${moneyMx(expected)} (Infocaja ${moneyMx(efectivoRecibido)} − propinas TPV ${moneyMx(tips)}; faltan ${moneyMx(faltante)}). Confirmado al cerrar.`;
}

/**
 * @deprecated Contado (recibido) y tómbola son montos distintos; ya no deben forzarse iguales.
 */
export function efectivoTombolaMustMatch(
  contado: number,
  tombola: number
): { ok: true } | { ok: false; message: string } {
  const c = Math.round(Number(contado) * 100) / 100;
  const t = Math.round(Number(tombola) * 100) / 100;
  if (c === t) return { ok: true };
  return {
    ok: false,
    message: `El efectivo en tómbola no coincide (${moneyMx(c)} vs ${moneyMx(t)}).`,
  };
}

export function parseMoneyInput(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Estado del Corte del día unificado (terminales + cierre RPT). */
export interface StaffCorteStatus {
  rptDate: string;
  bancos: StaffRptBancosFromTpv;
  rpt: StaffRptRow | null;
  /** Terminales 3/3 + montos leídos del ticket */
  terminalsReady: boolean;
  /** Ya hay fila de cierre guardada */
  closeSaved: boolean;
  /** Corte completo = terminales listos + cierre guardado */
  corteCompleto: boolean;
  nextStep: 'terminals' | 'close' | 'done';
}

export function buildStaffCorteStatus(
  rptDate: string,
  uploads: TpvCorteUpload[],
  rpt: StaffRptRow | null
): StaffCorteStatus {
  const bancos = buildBancosFromTpv(uploads, rptDate);
  const terminalsReady = bancos.canSaveRpt;
  const closeSaved = Boolean(rpt);
  const corteCompleto = terminalsReady && closeSaved;
  let nextStep: StaffCorteStatus['nextStep'] = 'terminals';
  if (terminalsReady && !closeSaved) nextStep = 'close';
  if (corteCompleto) nextStep = 'done';
  return {
    rptDate,
    bancos,
    rpt,
    terminalsReady,
    closeSaved,
    corteCompleto,
    nextStep,
  };
}

export { moneyMx };
