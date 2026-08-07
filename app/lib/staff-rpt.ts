import {
  buildDayCompleteness,
  computeNetoBanco,
  moneyMx,
  type TpvCorteUpload,
  type TpvDayCompleteness,
} from '@/app/lib/tpv-cortes';

export const STAFF_RPT_TABLE = 'staff_rpt_diario';

/**
 * Tolerancia histórica ($1). El cierre ya NO hard-bloquea si tómbola < esperado
 * (Infocaja − propinas TPV): es alerta operativa + cierre con acknowledge_shortage.
 */
export const EFECTIVO_TOLERANCE_MXN = 1;

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
  efectivo_tombola: number;
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
  };
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
 * Depósito en tómbola = efectivo recibido − propinas de terminales (TPV).
 * Las propinas de tarjeta se cubren con efectivo de caja; lo que queda es lo
 * que se deposita en la tómbola.
 */
export function expectedTombolaDeposit(
  efectivoRecibido: number | null | undefined,
  propinasTerminales: number | null | undefined
): number | null {
  if (efectivoRecibido == null || !Number.isFinite(Number(efectivoRecibido))) {
    return null;
  }
  const tips = Math.max(0, Number(propinasTerminales) || 0);
  return Math.max(
    0,
    Math.round((Number(efectivoRecibido) - tips) * 100) / 100
  );
}

/**
 * Tómbola del día desde un corte cerrado: Infocaja efectivo − propinas TPV.
 * Si falta Infocaja, usa el monto depositado (contado / tómbola).
 */
export function dayTombolaFromRpt(rpt: StaffRptRow): {
  amount: number;
  source: 'formula' | 'depositado';
  efectivo: number | null;
  propinas_tpv: number;
} {
  const tips = Math.max(
    0,
    Number(rpt.bancos_propina_tpv ?? rpt.propinas) || 0
  );
  const expected = expectedTombolaDeposit(rpt.efectivo_infocaja, tips);
  if (expected != null) {
    return {
      amount: expected,
      source: 'formula',
      efectivo: Number(rpt.efectivo_infocaja),
      propinas_tpv: tips,
    };
  }
  const depositado =
    rpt.efectivo_contado != null && Number.isFinite(rpt.efectivo_contado)
      ? Math.max(0, Math.round(Number(rpt.efectivo_contado) * 100) / 100)
      : Math.max(0, Math.round(Number(rpt.efectivo_tombola) * 100) / 100);
  return {
    amount: depositado,
    source: 'depositado',
    efectivo: null,
    propinas_tpv: tips,
  };
}

/**
 * Alerta cuando el efectivo en tómbola es menor que lo esperado:
 * Infocaja Efectivo − propinas TPV. WARNING (no hard-block): un faltante real
 * puede cerrarse con acknowledge_shortage + nota.
 */
export function efectivoMismatch(
  contado: number | null | undefined,
  efectivoRecibido: number | null | undefined,
  propinasTerminales: number | null | undefined = 0
): {
  mismatch: boolean;
  belowInfocaja: boolean;
  expected: number | null;
  delta: number | null;
  message: string | null;
} {
  const expected = expectedTombolaDeposit(
    efectivoRecibido,
    propinasTerminales
  );
  if (contado == null || expected == null) {
    return {
      mismatch: false,
      belowInfocaja: false,
      expected,
      delta: null,
      message: null,
    };
  }
  const delta = Math.round((Number(contado) - expected) * 100) / 100;
  if (delta >= 0) {
    return {
      mismatch: false,
      belowInfocaja: false,
      expected,
      delta,
      message: null,
    };
  }
  const faltante = Math.abs(delta);
  const tips = Math.max(0, Number(propinasTerminales) || 0);
  const message = `Efectivo en tómbola (${moneyMx(contado)}) es menor que lo esperado (${moneyMx(expected)} = Infocaja ${moneyMx(efectivoRecibido)} − propinas TPV ${moneyMx(tips)}). Faltan ${moneyMx(faltante)}. Confirma el faltante para poder cerrar.`;
  return {
    mismatch: true,
    belowInfocaja: true,
    expected,
    delta,
    message,
  };
}

/** Nota automática al cerrar con faltante (tómbola < efectivo − propinas). */
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
 * Regla de piso: efectivo_contado y efectivo_tombola deben coincidir
 * (un solo monto capturado como «Efectivo en Tómbola»).
 * Centavos redondeados (parseMoneyInput).
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
