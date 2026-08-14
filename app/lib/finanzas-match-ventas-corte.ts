/**
 * Conciliación diaria Finanzas: venta Infocaja vs corte TPV / tómbola.
 * Epoch = TPV_CORTE_EPOCH (2026-08-01).
 *
 * Fórmulas (breve):
 * - Esperado tómbola = efectivo recibido − propinas TPV (puede ser negativo).
 * - Recuperación: si el saldo del día es < 0, se acumula déficit; días
 *   positivos primero cubren el déficit y el remanente es depósito neto.
 * - Match vs Infocaja (±\): efectivo, bancarias (cobrado TPV) y propina TPV.
 */

import {
  EFECTIVO_TOLERANCE_MXN,
  applyTombolaDeficitRecovery,
  expectedTombolaDeposit,
  isEventoServicioClassificationGap,
  type StaffRptInfocajaDay,
  type StaffRptRow,
} from '@/app/lib/staff-rpt';
import { TPV_CORTE_EPOCH } from '@/app/lib/tpv-cortes';
import { eachIsoDateInclusive } from '@/app/lib/staff-propinas';

export const MATCH_VENTAS_CORTE_EPOCH = TPV_CORTE_EPOCH;

export type MatchVentasCorteStatus =
  | 'ok'
  | 'faltante'
  | 'recuperacion'
  | 'mismatch'
  | 'sin_corte'
  | 'sin_infocaja'
  | 'pendiente';

export type MatchVentasCorteDay = {
  date: string;
  /** Infocaja Venta Total (si hay). */
  venta_reportada: number | null;
  info_efectivo: number | null;
  info_bancarias: number | null;
  info_propina: number | null;
  /** Cobrado TPV (venta tarjeta, sin tip en el modelo actual). */
  tarjetas: number | null;
  /** Efectivo recibido capturado en cierre. */
  efectivo_venta: number | null;
  propinas_tpv: number | null;
  /** Depósito físico en tómbola (post-tips); puede ser negativo. */
  tombola_depositada: number | null;
  /** efectivo_venta − propinas_tpv (o Infocaja − tips si no hay corte). */
  tombola_esperada: number | null;
  /** Parte del saldo positivo usada para cubrir déficit previo (≥ 0). */
  recovery: number;
  /** Déficit pendiente al cierre del día (≥ 0). */
  deficit_after: number;
  /** Remanente a entregar tras recuperación (≥ 0). */
  tombola_neta: number;
  /** Saldo del día usado en la cadena de recuperación (puede ser neg.). */
  saldo_efe: number | null;
  has_corte: boolean;
  has_infocaja: boolean;
  status: MatchVentasCorteStatus;
  /** Deltas corte − Infocaja (null si no comparable). */
  delta_efectivo: number | null;
  delta_bancarias: number | null;
  delta_propina: number | null;
  /** Reclasificación 15% servicio evento (no es error operativo). */
  servicio_gap: boolean;
};

export type MatchVentasCortePayload = {
  ready: boolean;
  year: number;
  month: number;
  from: string;
  to: string;
  asOf: string;
  epoch: string;
  /** Déficit arrastrado desde días anteriores al mes (desde epoch). */
  deficit_before: number;
  deficit_remaining: number;
  days: MatchVentasCorteDay[];
  counts: Record<MatchVentasCorteStatus, number>;
  formula: string;
  error?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, '0');
  const from = year + '-' + mm + '-01';
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const to = year + '-' + mm + '-' + String(lastDay).padStart(2, '0');
  return { from, to };
}

/** Mes válido para el match: ≥ agosto 2026. */
export function clampMatchMonth(
  year: number,
  month: number
): { year: number; month: number } {
  const y = Number.isFinite(year) ? Math.trunc(year) : 2026;
  const m = Number.isFinite(month) ? Math.trunc(month) : 8;
  if (y < 2026 || (y === 2026 && m < 8)) return { year: 2026, month: 8 };
  if (m < 1) return { year: y, month: 1 };
  if (m > 12) return { year: y, month: 12 };
  return { year: y, month: m };
}

export function matchMonthBounds(
  year: number,
  month: number
): { from: string; to: string } {
  const c = clampMatchMonth(year, month);
  const b = monthBounds(c.year, c.month);
  const from =
    b.from < MATCH_VENTAS_CORTE_EPOCH ? MATCH_VENTAS_CORTE_EPOCH : b.from;
  return { from, to: b.to };
}

function lineDelta(
  corteVal: number | null | undefined,
  infoVal: number | null | undefined
): number | null {
  if (
    corteVal == null ||
    infoVal == null ||
    !Number.isFinite(Number(corteVal)) ||
    !Number.isFinite(Number(infoVal))
  ) {
    return null;
  }
  return round2(Number(corteVal) - Number(infoVal));
}

function withinTol(delta: number | null): boolean | null {
  if (delta == null) return null;
  return Math.abs(delta) <= EFECTIVO_TOLERANCE_MXN;
}

/**
 * Cadena de recuperación desde \seedFrom\ (inclusive, típicamente epoch)
 * hasta \sOf\. Devuelve filas solo del mes \[monthFrom, monthTo]\.
 */
export function buildMatchVentasCorteDays(opts: {
  monthFrom: string;
  monthTo: string;
  asOf: string;
  seedFrom?: string;
  rptByDate: Map<string, StaffRptRow>;
  infocajaByDate: Map<string, StaffRptInfocajaDay>;
}): {
  days: MatchVentasCorteDay[];
  deficit_before: number;
  deficit_remaining: number;
} {
  const seedFrom =
    opts.seedFrom && opts.seedFrom >= MATCH_VENTAS_CORTE_EPOCH
      ? opts.seedFrom
      : MATCH_VENTAS_CORTE_EPOCH;
  const chainEnd = opts.asOf < opts.monthTo ? opts.asOf : opts.monthTo;
  if (seedFrom > chainEnd) {
    return { days: [], deficit_before: 0, deficit_remaining: 0 };
  }

  type Raw = {
    date: string;
    venta_reportada: number | null;
    info_efectivo: number | null;
    info_bancarias: number | null;
    info_propina: number | null;
    tarjetas: number | null;
    efectivo_venta: number | null;
    propinas_tpv: number | null;
    tombola_depositada: number | null;
    tombola_esperada: number | null;
    /** Valor alimentado a applyTombolaDeficitRecovery. */
    saldo_chain: number;
    has_corte: boolean;
    has_infocaja: boolean;
    delta_efectivo: number | null;
    delta_bancarias: number | null;
    delta_propina: number | null;
    servicio_gap: boolean;
    in_month: boolean;
  };

  const raw: Raw[] = [];

  for (const date of eachIsoDateInclusive(seedFrom, chainEnd)) {
    const rpt = opts.rptByDate.get(date) ?? null;
    const info = opts.infocajaByDate.get(date) ?? null;
    const has_corte = rpt != null;
    const has_infocaja = Boolean(info?.hasAny);

    if (!has_corte && !has_infocaja) {
      // Día vacío: no alimenta la cadena (evita ceros fantasma).
      continue;
    }

    const propinas_tpv =
      rpt?.bancos_propina_tpv != null &&
      Number.isFinite(Number(rpt.bancos_propina_tpv))
        ? Math.max(0, round2(Number(rpt.bancos_propina_tpv)))
        : info != null && info.propina > 0
          ? round2(info.propina)
          : rpt != null
            ? Math.max(0, round2(Number(rpt.propinas) || 0))
            : null;

    const efectivo_venta =
      rpt?.efectivo_contado != null &&
      Number.isFinite(Number(rpt.efectivo_contado))
        ? round2(Number(rpt.efectivo_contado))
        : null;

    const info_efectivo =
      info != null && info.hasAny ? round2(info.efectivo) : null;
    const info_bancarias =
      info != null && info.hasAny ? round2(info.bancarias) : null;
    const info_propina =
      info != null && info.hasAny ? round2(info.propina) : null;
    const venta_reportada =
      info != null && info.ventaTotal > 0 ? round2(info.ventaTotal) : null;

    const tarjetas =
      rpt?.bancos_cobrado_tpv != null &&
      Number.isFinite(Number(rpt.bancos_cobrado_tpv))
        ? round2(Number(rpt.bancos_cobrado_tpv))
        : null;

    const tombola_depositada = has_corte
      ? round2(Number(rpt!.efectivo_tombola) || 0)
      : null;

    const tombola_esperada =
      expectedTombolaDeposit(
        efectivo_venta ?? info_efectivo,
        propinas_tpv ?? 0
      ) ?? null;

    // Recuperación sobre el depósito físico; si no hay corte, sobre esperado.
    const saldo_chain =
      tombola_depositada != null
        ? tombola_depositada
        : tombola_esperada != null
          ? tombola_esperada
          : 0;

    const delta_efectivo = lineDelta(efectivo_venta, info_efectivo);
    // Infocaja Bancarias = venta tarjeta sin propina ≈ cobrado TPV.
    const delta_bancarias = lineDelta(tarjetas, info_bancarias);
    const delta_propina = lineDelta(propinas_tpv, info_propina);

    const servicio_gap = isEventoServicioClassificationGap({
      osVenta: rpt?.eventos_os_amount,
      propinasDelta: delta_propina,
      bancariasDelta: delta_bancarias,
    });

    const in_month =
      date >= opts.monthFrom && date <= opts.monthTo && date <= opts.asOf;

    raw.push({
      date,
      venta_reportada,
      info_efectivo,
      info_bancarias,
      info_propina,
      tarjetas,
      efectivo_venta,
      propinas_tpv,
      tombola_depositada,
      tombola_esperada,
      saldo_chain,
      has_corte,
      has_infocaja,
      delta_efectivo,
      delta_bancarias,
      delta_propina,
      servicio_gap,
      in_month,
    });
  }

  const recovery = applyTombolaDeficitRecovery(raw.map((d) => d.saldo_chain));

  let deficit_before = 0;
  const monthDays: MatchVentasCorteDay[] = [];

  for (let i = 0; i < raw.length; i++) {
    const d = raw[i]!;
    const r = recovery[i]!;
    if (!d.in_month) {
      deficit_before = r.deficit_after;
      continue;
    }

    const status = resolveStatus({
      has_corte: d.has_corte,
      has_infocaja: d.has_infocaja,
      saldo_efe: r.saldo_efe,
      recovery: r.recovery,
      delta_efectivo: d.delta_efectivo,
      delta_bancarias: d.delta_bancarias,
      delta_propina: d.delta_propina,
      servicio_gap: d.servicio_gap,
    });

    monthDays.push({
      date: d.date,
      venta_reportada: d.venta_reportada,
      info_efectivo: d.info_efectivo,
      info_bancarias: d.info_bancarias,
      info_propina: d.info_propina,
      tarjetas: d.tarjetas,
      efectivo_venta: d.efectivo_venta,
      propinas_tpv: d.propinas_tpv,
      tombola_depositada: d.tombola_depositada,
      tombola_esperada: d.tombola_esperada,
      recovery: r.recovery,
      deficit_after: r.deficit_after,
      tombola_neta: r.tombola,
      saldo_efe: r.saldo_efe,
      has_corte: d.has_corte,
      has_infocaja: d.has_infocaja,
      status,
      delta_efectivo: d.delta_efectivo,
      delta_bancarias: d.delta_bancarias,
      delta_propina: d.delta_propina,
      servicio_gap: d.servicio_gap,
    });
  }

  const deficit_remaining =
    monthDays.length > 0
      ? monthDays[monthDays.length - 1]!.deficit_after
      : deficit_before;

  return { days: monthDays, deficit_before, deficit_remaining };
}

function resolveStatus(opts: {
  has_corte: boolean;
  has_infocaja: boolean;
  saldo_efe: number;
  recovery: number;
  delta_efectivo: number | null;
  delta_bancarias: number | null;
  delta_propina: number | null;
  servicio_gap: boolean;
}): MatchVentasCorteStatus {
  if (!opts.has_corte && !opts.has_infocaja) return 'pendiente';
  if (!opts.has_corte) return 'sin_corte';
  if (!opts.has_infocaja) return 'sin_infocaja';

  const efeOk = withinTol(opts.delta_efectivo);
  const banOk = withinTol(opts.delta_bancarias);
  const tipOk = withinTol(opts.delta_propina);

  const hardMismatch =
    efeOk === false ||
    (!opts.servicio_gap && (banOk === false || tipOk === false));

  if (hardMismatch) return 'mismatch';

  if (opts.saldo_efe < -EFECTIVO_TOLERANCE_MXN) return 'faltante';
  if (opts.recovery > EFECTIVO_TOLERANCE_MXN) return 'recuperacion';
  return 'ok';
}

export function emptyStatusCounts(): Record<MatchVentasCorteStatus, number> {
  return {
    ok: 0,
    faltante: 0,
    recuperacion: 0,
    mismatch: 0,
    sin_corte: 0,
    sin_infocaja: 0,
    pendiente: 0,
  };
}

export function countStatuses(
  days: readonly MatchVentasCorteDay[]
): Record<MatchVentasCorteStatus, number> {
  const c = emptyStatusCounts();
  for (const d of days) c[d.status] += 1;
  return c;
}

export const MATCH_FORMULA_BLURB =
  'Tómbola esperada = efectivo − propinas TPV; negativos acumulan déficit hasta cubrirlos con efectivo de días siguientes. Match Infocaja ±$1.';
