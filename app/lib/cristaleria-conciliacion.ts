/**
 * Conciliación INGRESO CRISTALERIA (flujo efectivo) vs 2% venta Infocaja.
 * Base: Venta Total diaria (efectivo + bancos, sin propina), agregada por semana Acumulado.
 */

import type { FinancialRecord } from '@/app/lib/ventas-semana';
import { acumuladoWeekForDate, parseIsoDate } from '@/app/lib/ventas-semana';

/** Regla operativa confirmada C50. */
export const CRISTALERIA_INGRESO_PCT = 0.02;
export const CRISTALERIA_TOLERANCE_MXN = 5;
/** Tolerancia en puntos porcentuales (0.5 pp). */
export const CRISTALERIA_TOLERANCE_PP = 0.005;

/** Fórmula errónea observada en FLUJO EFECTIVO Excel: (venta/1000)×$2 = 0.2%. */
export const CRISTALERIA_EXCEL_WRONG_FACTOR = 2 / 1000;

export type CristaleriaWeekStatus =
  | 'ok'
  | 'bajo'
  | 'sobre'
  | 'falta_abono'
  | 'abono_sin_venta';

export type CristaleriaWeekRow = {
  year: number;
  week: number;
  label: string;
  ventaTotal: number;
  abonoFlujo: number;
  esperado2pct: number;
  /** Lo que hoy registra la fórmula Excel (venta/1000×2). */
  excelActual: number;
  delta: number;
  pctReal: number | null;
  status: CristaleriaWeekStatus;
  abonoFecha: string | null;
  concepto: string | null;
};

export type CristaleriaConciliacionSummary = {
  year: number;
  pctRule: number;
  weeks: CristaleriaWeekRow[];
  totals: {
    ventaTotal: number;
    abonoFlujo: number;
    esperado2pct: number;
    excelActual: number;
    deltaVs2pct: number;
    pctReal: number | null;
  };
  counts: Record<CristaleriaWeekStatus, number>;
};

type FlujoPayload = {
  concepto?: string;
  descripcion?: string;
  columna?: string;
  week?: number | null;
  week_annual?: number | null;
  year?: number | null;
};

function parsePayload(desc: string | null | undefined): FlujoPayload {
  if (!desc?.trim()) return {};
  try {
    return JSON.parse(desc) as FlujoPayload;
  } catch {
    return {};
  }
}

function isoDateOnly(raw: string): string {
  const p = parseIsoDate(raw);
  return p?.key ?? raw.slice(0, 10);
}

/** Extrae # semana del concepto «INGRESO CRISTALERIA SEM #12». */
export function parseCristaleriaWeekFromConcepto(concepto: string): number | null {
  const n = concepto.toUpperCase();
  const m = n.match(/SEM(?:ANA)?\s*#?\s*(\d{1,2})\b/);
  if (!m) return null;
  const w = Number(m[1]);
  return Number.isFinite(w) && w >= 0 ? w : null;
}

function isCristaleriaIngreso(record: FinancialRecord): boolean {
  if (record.source_file !== 'flujo_efectivo_mov' || record.type !== 'income') {
    return false;
  }
  const p = parsePayload(record.description);
  const concepto = String(
    p.concepto || p.descripcion || record.description || ''
  ).toUpperCase();
  return concepto.includes('CRISTALER');
}

function weekKey(year: number, week: number): string {
  return `${year}-${week}`;
}

function weekLabel(year: number, week: number): string {
  return `S${String(week).padStart(2, '0')}/${year}`;
}

function classifyWeek(opts: {
  venta: number;
  abono: number;
  esperado: number;
}): CristaleriaWeekStatus {
  const { venta, abono, esperado } = opts;
  if (venta <= 0 && abono > 0) return 'abono_sin_venta';
  if (venta > 0 && abono <= 0) return 'falta_abono';
  if (venta <= 0) return 'falta_abono';
  const delta = abono - esperado;
  const pctReal = abono / venta;
  const ok =
    Math.abs(delta) <= CRISTALERIA_TOLERANCE_MXN ||
    Math.abs(pctReal - CRISTALERIA_INGRESO_PCT) <= CRISTALERIA_TOLERANCE_PP;
  if (ok) return 'ok';
  return delta > 0 ? 'sobre' : 'bajo';
}

/**
 * Cruza abonos flujo «INGRESO CRISTALERIA» vs 2% de Venta Total Infocaja por semana.
 */
export function buildCristaleriaConciliacion(
  records: FinancialRecord[],
  year: number
): CristaleriaConciliacionSummary {
  const ventaByWeek = new Map<string, number>();

  for (const r of records) {
    if (r.source_file !== 'infocaja' || r.category !== 'Venta Total') continue;
    const d = isoDateOnly(r.date);
    const p = parseIsoDate(d);
    if (!p || p.y !== year) continue;
    const w = acumuladoWeekForDate(d);
    const k = weekKey(p.y, w);
    ventaByWeek.set(k, (ventaByWeek.get(k) || 0) + (Number(r.amount) || 0));
  }

  type AbonoMeta = { amount: number; date: string; concepto: string };
  const abonoByWeek = new Map<string, AbonoMeta>();

  for (const r of records) {
    if (!isCristaleriaIngreso(r)) continue;
    const p = parsePayload(r.description);
    const concepto = String(p.concepto || p.descripcion || '').trim();
    const wFromConcept = parseCristaleriaWeekFromConcepto(concepto);
    const w =
      wFromConcept ??
      p.week_annual ??
      p.week ??
      acumuladoWeekForDate(isoDateOnly(r.date));
    const y = p.year ?? Number(isoDateOnly(r.date).slice(0, 4)) ?? year;
    const k = weekKey(y, w);
    const amt = Number(r.amount) || 0;
    const prev = abonoByWeek.get(k);
    abonoByWeek.set(k, {
      amount: (prev?.amount || 0) + amt,
      date: prev?.date ?? isoDateOnly(r.date),
      concepto: prev?.concepto || concepto,
    });
  }

  const keys = new Set([...ventaByWeek.keys(), ...abonoByWeek.keys()]);
  const weeks: CristaleriaWeekRow[] = [...keys]
    .map((k) => {
      const [yStr, wStr] = k.split('-');
      const y = Number(yStr);
      const w = Number(wStr);
      const ventaTotal = ventaByWeek.get(k) || 0;
      const meta = abonoByWeek.get(k);
      const abonoFlujo = meta?.amount || 0;
      const esperado2pct = ventaTotal * CRISTALERIA_INGRESO_PCT;
      const excelActual = (ventaTotal / 1000) * 2;
      const delta = abonoFlujo - esperado2pct;
      const pctReal = ventaTotal > 0 ? abonoFlujo / ventaTotal : null;
      return {
        year: y,
        week: w,
        label: weekLabel(y, w),
        ventaTotal,
        abonoFlujo,
        esperado2pct,
        excelActual,
        delta,
        pctReal,
        status: classifyWeek({ venta: ventaTotal, abono: abonoFlujo, esperado: esperado2pct }),
        abonoFecha: meta?.date ?? null,
        concepto: meta?.concepto ?? null,
      };
    })
    .filter((r) => r.year === year && (r.ventaTotal > 0 || r.abonoFlujo > 0))
    .sort((a, b) => a.week - b.week || a.year - b.year);

  const counts: CristaleriaConciliacionSummary['counts'] = {
    ok: 0,
    bajo: 0,
    sobre: 0,
    falta_abono: 0,
    abono_sin_venta: 0,
  };
  for (const row of weeks) counts[row.status] += 1;

  const ventaTotal = weeks.reduce((s, r) => s + r.ventaTotal, 0);
  const abonoFlujo = weeks.reduce((s, r) => s + r.abonoFlujo, 0);
  const esperado2pct = ventaTotal * CRISTALERIA_INGRESO_PCT;
  const excelActual = weeks.reduce((s, r) => s + r.excelActual, 0);

  return {
    year,
    pctRule: CRISTALERIA_INGRESO_PCT,
    weeks,
    totals: {
      ventaTotal,
      abonoFlujo,
      esperado2pct,
      excelActual,
      deltaVs2pct: abonoFlujo - esperado2pct,
      pctReal: ventaTotal > 0 ? abonoFlujo / ventaTotal : null,
    },
    counts,
  };
}

export const CRISTALERIA_FORMULA_BLURB =
  'Regla C50: abono semanal = 2% × suma Venta Total Infocaja (efectivo + bancos, sin propina). ' +
  'El Excel de flujo hoy aplica (venta÷1,000)×$2 ≈ 0.2% — un décimo de lo debido.';
