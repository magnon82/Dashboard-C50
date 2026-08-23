/**
 * Conciliación INGRESO CRISTALERIA (flujo efectivo) vs 0.2% venta Infocaja.
 * Base: Venta Total diaria (efectivo + bancos, sin propina), agregada por semana Acumulado.
 */

import type { FinancialRecord } from '@/app/lib/ventas-semana';
import { acumuladoWeekForDate, parseIsoDate } from '@/app/lib/ventas-semana';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Regla operativa C50: 0.2% de venta (= (venta÷1,000)×$2 en flujo Excel). */
export const CRISTALERIA_INGRESO_PCT = 0.002;
export const CRISTALERIA_TOLERANCE_MXN = 5;
/** Tolerancia en puntos porcentuales (0.05 pp sobre 0.2%). */
export const CRISTALERIA_TOLERANCE_PP = 0.0005;

/** Equivalente Excel flujo: (venta/1000)×$2. */
export const CRISTALERIA_FLUJO_FACTOR = 2 / 1000;

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
  /** Abono debido = venta × 0.002 (0.2% — regla C50 / Excel flujo). */
  esperado2pct: number;
  /** Fórmula Excel (venta/1000×2); coincide con debido al 0.2%. */
  excelActual: number;
  /** abonoFlujo − debido (negativo = falta depositar). */
  delta: number;
  /** Faltante = esperado2pct − abonoFlujo (positivo = por cobrar). */
  faltante: number;
  pctReal: number | null;
  /** abonoFlujo / esperado2pct cuando esperado > 0. */
  pctCobrado: number | null;
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
 * Cruza abonos flujo «INGRESO CRISTALERIA» vs 0.2% de Venta Total Infocaja por semana.
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
      const excelActual = ventaTotal * CRISTALERIA_FLUJO_FACTOR;
      const delta = abonoFlujo - esperado2pct;
      const faltante = esperado2pct - abonoFlujo;
      const pctReal = ventaTotal > 0 ? abonoFlujo / ventaTotal : null;
      const pctCobrado =
        esperado2pct > 0 ? abonoFlujo / esperado2pct : null;
      return {
        year: y,
        week: w,
        label: weekLabel(y, w),
        ventaTotal,
        abonoFlujo,
        esperado2pct,
        excelActual,
        delta,
        faltante,
        pctReal,
        pctCobrado,
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
  'Regla C50: abono semanal = 0.2% de Venta Total Infocaja (efectivo + bancos, sin propina). ' +
  'En flujo Excel: (venta÷1,000)×$2.';

/** Pagina financial_records (Supabase limita a 1 000 filas por defecto). */
export async function fetchRecordsForCristaleriaConciliacion(
  sb: SupabaseClient,
  year: number
): Promise<FinancialRecord[]> {
  const pageSize = 1000;
  const out: FinancialRecord[] = [];
  const base = sb
    .from('financial_records')
    .select('id, date, type, category, amount, description, source_file')
    .gte('date', `${year - 1}-12-01`)
    .lte('date', `${year}-12-31`)
    .in('source_file', ['infocaja', 'flujo_efectivo_mov']);

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await base.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
