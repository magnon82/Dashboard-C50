import {
  buildDayCompleteness,
  computeNetoBanco,
  moneyMx,
  type TpvCorteUpload,
  type TpvDayCompleteness,
} from '@/app/lib/tpv-cortes';

export const STAFF_RPT_TABLE = 'staff_rpt_diario';

/** Tolerancia $ (legacy; el cierre bloquea si contado < Infocaja, sin tolerancia). */
export const EFECTIVO_TOLERANCE_MXN = 1;

export interface StaffRptRow {
  id: string;
  rpt_date: string;
  wi_amount: number;
  eventos_amount: number;
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
  state: 'missing' | 'photo' | 'unused';
  hasAmounts: boolean;
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
  /** 3/3 foto o unused */
  complete: boolean;
  /** Todas las fotos tienen total_cobrado (unused no requiere montos) */
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
  return {
    id: String(r.id),
    rpt_date: String(r.rpt_date).slice(0, 10),
    wi_amount: Number(r.wi_amount) || 0,
    eventos_amount: Number(r.eventos_amount) || 0,
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

function slotHasAmounts(upload: TpvCorteUpload | null, state: string): boolean {
  if (state === 'unused') return true;
  if (state !== 'photo' || !upload) return false;
  return upload.total_cobrado != null && !Number.isNaN(Number(upload.total_cobrado));
}

/** Bancos del RPT = suma de montos confirmados en fotos TPV del día (no tecleo en RPT). */
export function buildBancosFromTpv(
  uploads: TpvCorteUpload[],
  corteDate: string
): StaffRptBancosFromTpv {
  const day = buildDayCompleteness(uploads, corteDate);
  const terminals: StaffRptTpvTerminalView[] = day.slots.map((s) => {
    const u = s.upload;
    const cobrado = u?.total_cobrado != null ? Number(u.total_cobrado) : null;
    const propina = u?.propina != null ? Number(u.propina) : null;
    // Siempre derivar: neto_banco = cobrado + propinas (no confiar en neto guardado viejo).
    const neto = computeNetoBanco(cobrado, propina);
    return {
      terminal: s.terminal,
      state: s.state,
      hasAmounts: slotHasAmounts(u, s.state),
      total_cobrado: s.state === 'photo' ? cobrado : null,
      propina: s.state === 'photo' ? propina : null,
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
      `Faltan Cortes TPV (${missing}). Completa foto o «no se usó» en las 3 terminales.`
    );
  }
  const withoutAmounts = terminals.filter(
    (t) => t.state === 'photo' && !t.hasAmounts
  );
  if (withoutAmounts.length) {
    blockers.push(
      `Faltan montos leídos del ticket en: ${withoutAmounts
        .map((t) => `T${t.terminal}`)
        .join(', ')}. Ábrelos en Cortes TPV y confirma Total + Propina mirando la foto.`
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
    else if (cat === 'Infocaja Venta Total') ventaTotal += amt;
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
 * Alerta / bloqueo cuando efectivo contado es estrictamente menor que Infocaja.
 * Si falta contado o Infocaja (null), no hay alerta.
 */
export function efectivoMismatch(
  contado: number | null | undefined,
  infocaja: number | null | undefined
): {
  mismatch: boolean;
  belowInfocaja: boolean;
  delta: number | null;
  message: string | null;
} {
  if (contado == null || infocaja == null) {
    return {
      mismatch: false,
      belowInfocaja: false,
      delta: null,
      message: null,
    };
  }
  const delta = Math.round((Number(contado) - Number(infocaja)) * 100) / 100;
  if (delta >= 0) {
    return {
      mismatch: false,
      belowInfocaja: false,
      delta,
      message: null,
    };
  }
  const faltante = Math.abs(delta);
  const message = `Efectivo contado (${moneyMx(contado)}) es menor que Infocaja (${moneyMx(infocaja)}). Faltan ${moneyMx(faltante)}. Corrige el conteo antes de cerrar.`;
  return {
    mismatch: true,
    belowInfocaja: true,
    delta,
    message,
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
