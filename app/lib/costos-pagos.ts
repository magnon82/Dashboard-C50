/**
 * Costo vs pagos ejercidos (hoja GLOBAL de COSTO X SEMANA).
 * El tablero lee Supabase. Google solo se consulta al importar.
 */
import { getServiceSupabase } from '@/app/lib/users';
import {
  COSTOS_ANIO,
  COSTOS_MESES,
  CostoMesError,
  canonicalMonthName,
  readSheetCells,
} from '@/app/lib/costos-venta';

export const COSTOS_PAGOS_SHEET_ID = '1fC6Gu2-bIfXfbA-0YdfMeF5usMfjNJL59Gd0O36X6GY';
const COSTOS_PAGOS_TAB = 'GLOBAL';
const COSTOS_PAGOS_SOURCE = 'costos_pagos';

export type LineaPago = {
  venta: number;
  pago: number;
  costoPct: number | null;
};

export type SemanaPago = {
  semana: number;
  ventaAlimentos: number;
  compraCocina: number;
  costoCocina: number | null;
  ventaBebidas: number;
  compraBarra: number;
  costoBarra: number | null;
  eventos: number;
  ventaTotal: number;
  compraDirecta: number;
  costoDirecto: number | null;
  compraTotal: number;
  costoGlobal: number | null;
};

export type MesPagos = {
  mes: string;
  metaPct: number;
  cocina: LineaPago;
  barra: LineaPago;
  directo: LineaPago;
  global: LineaPago;
  indirecto: { pago: number; costoPct: number | null };
  semanas: SemanaPago[];
};

export type CostosPagosDashboard = MesPagos & { meses: string[] };

type SnapshotPayload = MesPagos & { anio: number };

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function moneyCell(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return roundMoney(raw);
  if (raw == null) return 0;
  const text = String(raw).replace(/\$/g, '').replace(/,/g, '').trim();
  if (!text || text.includes('DIV')) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

function pctCell(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  if (typeof raw === 'string' && raw.toUpperCase().includes('DIV')) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/%/g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return Math.round(pct * 100) / 100;
}

function label(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function weekNumber(raw: unknown): number | null {
  const match = String(raw ?? '').trim().match(/^semana\s*(\d+)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

function linea(row: unknown[] | undefined): LineaPago {
  return {
    venta: moneyCell(row?.[14]),
    pago: moneyCell(row?.[15]),
    costoPct: pctCell(row?.[16]),
  };
}

function semanaFrom(row: unknown[]): SemanaPago | null {
  const semana = weekNumber(row[0]);
  if (!semana) return null;
  const parsed: SemanaPago = {
    semana,
    ventaAlimentos: moneyCell(row[1]),
    compraCocina: moneyCell(row[2]),
    costoCocina: pctCell(row[3]),
    ventaBebidas: moneyCell(row[4]),
    compraBarra: moneyCell(row[5]),
    costoBarra: pctCell(row[6]),
    eventos: moneyCell(row[7]),
    ventaTotal: moneyCell(row[8]),
    compraDirecta: moneyCell(row[9]),
    costoDirecto: pctCell(row[10]),
    compraTotal: moneyCell(row[11]),
    costoGlobal: pctCell(row[12]),
  };
  const active = [
    parsed.ventaAlimentos,
    parsed.compraCocina,
    parsed.ventaBebidas,
    parsed.compraBarra,
    parsed.eventos,
    parsed.ventaTotal,
    parsed.compraDirecta,
    parsed.compraTotal,
  ].some((n) => Math.abs(n) > 0.004);
  return active ? parsed : null;
}

function monthActive(mes: MesPagos): boolean {
  return [mes.cocina, mes.barra, mes.directo, mes.global].some(
    (row) => Math.abs(row.venta) > 0.004 || Math.abs(row.pago) > 0.004
  );
}

export function parseCostosPagosGrid(rows: unknown[][]): MesPagos[] {
  const header = rows[1] || [];
  const metaPct = pctCell(header[13]) ?? 35;
  const semanasPorMes = new Map<string, SemanaPago[]>();
  let mesActual: string | null = null;

  for (const row of rows.slice(2)) {
    const marcado = canonicalMonthName(String(row?.[13] ?? ''));
    if (marcado) mesActual = marcado;
    const semana = semanaFrom(row || []);
    if (!semana || !mesActual) continue;
    const list = semanasPorMes.get(mesActual) || [];
    list.push(semana);
    semanasPorMes.set(mesActual, list);
  }

  const meses: MesPagos[] = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i] || [];
    const mes = canonicalMonthName(String(row[13] ?? ''));
    if (!mes) continue;
    let start = i;
    if (label(row[17]) !== 'cocina') {
      const offset = [1, 2, 3].find((step) => label(rows[i + step]?.[17]) === 'cocina');
      if (offset == null) continue;
      start = i + offset;
    }
    const cocinaRow = rows[start];
    const barraRow = rows[start + 1];
    const directoRow = rows[start + 2];
    const globalRow = rows[start + 3];
    if (label(barraRow?.[17]) !== 'barra') continue;
    if (label(directoRow?.[17]) !== 'directo') continue;
    if (label(globalRow?.[17]) !== 'global') continue;

    const cocina = linea(cocinaRow);
    const barra = linea(barraRow);
    const directo = linea(directoRow);
    const global = linea(globalRow);
    const indirectoPago = roundMoney(global.pago - directo.pago);
    const payload: MesPagos = {
      mes,
      metaPct,
      cocina,
      barra,
      directo,
      global,
      indirecto: {
        pago: indirectoPago,
        costoPct: pctCell(globalRow?.[18]) ?? (global.venta > 0 ? roundMoney((indirectoPago / global.venta) * 100) : null),
      },
      semanas: semanasPorMes.get(mes) || [],
    };
    if (monthActive(payload)) meses.push(payload);
  }

  const orden = new Map<string, number>(COSTOS_MESES.map((mes, index) => [mes, index]));
  meses.sort((a, b) => (orden.get(a.mes) ?? 99) - (orden.get(b.mes) ?? 99));
  return meses.map((mes) => ({ ...mes, metaPct }));
}

function monthDate(anio: number, mes: string): string {
  const index = COSTOS_MESES.findIndex((name) => name === mes);
  const month = String(Math.max(index, 0) + 1).padStart(2, '0');
  return `${anio}-${month}-01`;
}

function parseSnapshot(description: string | null): SnapshotPayload | null {
  if (!description) return null;
  try {
    const payload = JSON.parse(description) as SnapshotPayload;
    if (!payload?.mes || !payload.cocina || !payload.global || !Array.isArray(payload.semanas)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function loadCostosPagos(mesParam: string | null): Promise<CostosPagosDashboard> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .select('description')
    .eq('source_file', COSTOS_PAGOS_SOURCE);
  if (error) throw new Error('No se pudo leer el costo vs pagos guardado.');

  const snapshots = (data || [])
    .map((row) => parseSnapshot((row as { description?: string }).description || null))
    .filter((row): row is SnapshotPayload => Boolean(row));
  const presentes = new Set(snapshots.map((row) => row.mes));
  const meses: string[] = COSTOS_MESES.filter((mes) => presentes.has(mes));
  if (!meses.length) throw new Error('El costo vs pagos todavía no está importado.');

  let mes: string;
  const requested = (mesParam || '').trim();
  if (requested) {
    const canon = canonicalMonthName(requested);
    if (!canon || !meses.includes(canon)) {
      throw new CostoMesError(
        canon ? `${canon} todavía no tiene costo vs pagos.` : `Mes no disponible: ${requested}`,
        [...meses]
      );
    }
    mes = canon;
  } else {
    mes = meses[meses.length - 1];
  }

  const snapshot = snapshots.find((row) => row.mes === mes);
  if (!snapshot) throw new Error('El costo vs pagos todavía no está importado.');
  return { ...snapshot, mes, meses };
}

export async function syncCostosPagosFromSheets(
  anio = COSTOS_ANIO
): Promise<{ meses: string[]; semanas: number }> {
  const rows = await readSheetCells(
    COSTOS_PAGOS_SHEET_ID,
    `'${COSTOS_PAGOS_TAB}'!A1:T80`
  );
  const parsed = parseCostosPagosGrid(rows);
  const sb = getServiceSupabase();
  const records = parsed.map((mes) => ({
    date: monthDate(anio, mes.mes),
    type: 'expense',
    category: 'global',
    amount: 0,
    description: JSON.stringify({ ...mes, anio } satisfies SnapshotPayload),
    source_file: COSTOS_PAGOS_SOURCE,
  }));

  const { error: delError } = await sb
    .from('financial_records')
    .delete()
    .eq('source_file', COSTOS_PAGOS_SOURCE);
  if (delError) throw new Error(delError.message);
  if (records.length) {
    const { error: insError } = await sb.from('financial_records').insert(records);
    if (insError) throw new Error(insError.message);
  }

  return {
    meses: parsed.map((mes) => mes.mes),
    semanas: parsed.reduce((sum, mes) => sum + mes.semanas.length, 0),
  };
}
