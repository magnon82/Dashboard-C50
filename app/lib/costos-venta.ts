/**
 * Costo por venta (cocina + barra).
 * El tablero lee lo guardado en Supabase. Google Sheets solo se usa al importar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { createSheetsClient } from '@/app/lib/google-drive-auth';
import { getServiceSupabase } from '@/app/lib/users';

export const COSTOS_FOOD_SHEET_ID = '1x_kzoXEFvAavWGyBnWYDdely6Epx9WPLgYdNjhOCeDE';
export const COSTOS_DRINK_SHEET_ID = '1MCWAI7ozvUpawXxspT5wl4yd4HYhGFhOg0bpX0OcABM';

const CACHE_MS = 5 * 60 * 1000;
const ESTRATEGICO_COSTO_MAX = 25;
const ESTRATEGICO_UNIDADES_MIN = 10;
const TOP_N = 5;

export const COSTOS_MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export type CostoProducto = {
  producto: string;
  grupo: string;
  unidades: number;
  venta: number;
  costoPct: number | null;
  utilidad: number;
};

export type CostoLado = {
  aviso: string | null;
  kpis: {
    venta: number;
    costo: number;
    costoPct: number | null;
    utilidad: number;
    productos: number;
  };
  topUnidades: CostoProducto[];
  topRentabilidad: CostoProducto[];
  estrategicos: CostoProducto[];
};

export type CostosDashboard = {
  mes: string;
  meses: string[];
  alimentos: CostoLado;
  bebidas: CostoLado;
};

type CacheEntry<T> = { at: number; value: T };

const tabCache = new Map<string, CacheEntry<Map<string, string>>>();
const valueCache = new Map<string, CacheEntry<string[][]>>();

type SheetsClient = ReturnType<typeof createSheetsClient>;

let sheetsClientPromise: Promise<SheetsClient> | null = null;

function authFailure(err: unknown): boolean {
  const anyErr = err as {
    message?: string;
    errors?: { message?: string; reason?: string }[];
    response?: { data?: { error?: string | { message?: string } } };
  };
  const apiError = anyErr?.response?.data?.error;
  const apiMessage = typeof apiError === 'string' ? apiError : apiError?.message;
  const extra = (anyErr?.errors || [])
    .map((item) => `${item.reason || ''} ${item.message || ''}`)
    .join(' ');
  const lower = `${anyErr?.message || ''} ${apiMessage || ''} ${extra}`.toLowerCase();
  return (
    lower.includes('unauthorized_client') ||
    lower.includes('invalid_grant') ||
    lower.includes('invalid_client') ||
    lower.includes('faltan credenciales')
  );
}

/** Si el OAuth del servidor no puede refrescar, en local sirve ingestor/token.json. */
function sheetsFromIngestorToken(): SheetsClient | null {
  try {
    const tokenPath = path.join(process.cwd(), 'ingestor', 'token.json');
    if (!fs.existsSync(tokenPath)) return null;
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as {
      client_id?: string;
      client_secret?: string;
      refresh_token?: string;
      access_token?: string;
      expiry_date?: number;
    };
    let clientId = token.client_id || '';
    let clientSecret = token.client_secret || '';
    const credPath = path.join(process.cwd(), 'ingestor', 'credentials.json');
    if ((!clientId || !clientSecret) && fs.existsSync(credPath)) {
      const cred = JSON.parse(fs.readFileSync(credPath, 'utf8')) as {
        installed?: { client_id?: string; client_secret?: string };
        web?: { client_id?: string; client_secret?: string };
      };
      const installed = cred.installed || cred.web;
      clientId = clientId || installed?.client_id || '';
      clientSecret = clientSecret || installed?.client_secret || '';
    }
    if (!token.refresh_token || !clientId) return null;
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret || undefined);
    oauth2.setCredentials({
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expiry_date: token.expiry_date,
    });
    return google.sheets({ version: 'v4', auth: oauth2 });
  } catch {
    return null;
  }
}

async function sheetsClient(): Promise<SheetsClient> {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const fallback = () => {
        const fileClient = sheetsFromIngestorToken();
        if (!fileClient) {
          throw new Error(
            'Faltan credenciales Google para leer el costo por venta.'
          );
        }
        return fileClient;
      };
      let primary: SheetsClient;
      try {
        primary = createSheetsClient();
      } catch (err) {
        if (!authFailure(err)) throw err;
        return fallback();
      }
      try {
        await primary.spreadsheets.get({
          spreadsheetId: COSTOS_FOOD_SHEET_ID,
          fields: 'properties.title',
        });
        return primary;
      } catch (err) {
        if (!authFailure(err)) throw err;
        return fallback();
      }
    })().catch((err) => {
      sheetsClientPromise = null;
      throw err;
    });
  }
  return sheetsClientPromise;
}

/** Lectura puntual para importar. El tablero no llama esto en cada visita. */
export async function readSheetCells(
  spreadsheetId: string,
  range: string
): Promise<unknown[][]> {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (res.data.values || []) as unknown[][];
}

function strip(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalMonthName(raw: string): string | null {
  const n = strip(raw);
  return COSTOS_MESES.find((m) => strip(m) === n) ?? null;
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw == null) return null;
  const t = String(raw).replace(/\$/g, '').replace(/%/g, '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parsePct(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const n = parseNumber(s);
  if (n == null) return null;
  if (!s.includes('%') && n > 0 && n <= 1) return n * 100;
  return n;
}

function cell(row: string[], index: number): string {
  if (index < 0 || index >= row.length) return '';
  return row[index] ?? '';
}

function findHeaderIndex(rows: string[][]): number {
  const limit = Math.min(rows.length, 8);
  for (let i = 0; i < limit; i++) {
    const headers = rows[i].map(strip);
    if (
      headers.some(
        (h) => h === 'nomproducto' || h === 'productos' || h === 'producto'
      )
    ) {
      return i;
    }
  }
  return -1;
}

type Cols = {
  producto: number;
  grupo: number;
  precio: number;
  unidades: number;
  venta: number;
  costoTotal: number;
  costoPct: number;
  utilidad: number;
};

function mapColumns(header: string[]): Cols | null {
  const h = header.map(strip);
  const producto = h.findIndex(
    (x) => x === 'nomproducto' || x === 'productos' || x === 'producto'
  );
  if (producto < 0) return null;
  return {
    producto,
    grupo: h.findIndex((x) => x === 'grupo'),
    precio: h.findIndex((x) => x === 'precio'),
    unidades: h.findIndex((x) => x === 'unidades'),
    venta: h.findIndex((x) => x === 'total venta'),
    costoTotal: h.findIndex((x) => x === 'total costo'),
    costoPct: h.findIndex(
      (x) => x === '% de costo' || x === '%' || x.includes('de costo')
    ),
    utilidad: h.findIndex((x) => x.includes('rentabilidad')),
  };
}

const SKIP_NAMES = new Set(['total', 'totales', 'suma']);

type ParsedRow = CostoProducto & { costoTotal: number };

function toProducto(row: ParsedRow): CostoProducto {
  return {
    producto: row.producto,
    grupo: row.grupo,
    unidades: row.unidades,
    venta: row.venta,
    costoPct: row.costoPct,
    utilidad: row.utilidad,
  };
}

/** Filas vendibles de una pestaña (encabezados de cocina o de barra). */
export function parseCostoRows(values: string[][]): ParsedRow[] {
  const headerAt = findHeaderIndex(values);
  if (headerAt < 0) return [];
  const cols = mapColumns(values[headerAt]);
  if (!cols || cols.unidades < 0 || cols.venta < 0) return [];

  const out: ParsedRow[] = [];
  for (const row of values.slice(headerAt + 1)) {
    const producto = cell(row, cols.producto).trim();
    if (!producto || SKIP_NAMES.has(strip(producto))) continue;
    const unidades = parseNumber(cell(row, cols.unidades));
    const venta = parseNumber(cell(row, cols.venta));
    const precio =
      cols.precio >= 0 ? parseNumber(cell(row, cols.precio)) : null;
    if (unidades == null || venta == null) continue;
    if (unidades <= 0 || venta <= 0) continue;
    if (precio != null && precio <= 0) continue;

    const costoPct = cols.costoPct >= 0 ? parsePct(cell(row, cols.costoPct)) : null;
    let costoTotal =
      cols.costoTotal >= 0 ? parseNumber(cell(row, cols.costoTotal)) : null;
    if (costoTotal == null && costoPct != null) {
      costoTotal = (venta * costoPct) / 100;
    }
    if (costoTotal == null) costoTotal = 0;
    let utilidad =
      cols.utilidad >= 0 ? parseNumber(cell(row, cols.utilidad)) : null;
    if (utilidad == null) utilidad = venta - costoTotal;

    out.push({
      producto,
      grupo: cols.grupo >= 0 ? cell(row, cols.grupo).trim() : '',
      unidades,
      venta,
      costoPct,
      utilidad,
      costoTotal,
    });
  }
  return out;
}

function emptyKpis(): CostoLado['kpis'] {
  return { venta: 0, costo: 0, costoPct: null, utilidad: 0, productos: 0 };
}

export function rankCostoProductos(rows: ParsedRow[]): CostoLado {
  const venta = rows.reduce((s, r) => s + r.venta, 0);
  const utilidad = rows.reduce((s, r) => s + r.utilidad, 0);
  const costo = rows.reduce((s, r) => s + r.costoTotal, 0);
  const byUnidades = [...rows].sort(
    (a, b) => b.unidades - a.unidades || b.venta - a.venta
  );
  const byUtilidad = [...rows].sort(
    (a, b) => b.utilidad - a.utilidad || b.unidades - a.unidades
  );
  const estrategicos = byUtilidad.filter(
    (r) =>
      r.costoPct != null &&
      r.costoPct <= ESTRATEGICO_COSTO_MAX &&
      r.unidades >= ESTRATEGICO_UNIDADES_MIN
  );
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    aviso: rows.length ? null : 'Sin ventas en este mes.',
    kpis: {
      venta: round2(venta),
      costo: round2(costo),
      costoPct: venta > 0 ? round2((costo / venta) * 100) : null,
      utilidad: round2(utilidad),
      productos: rows.length,
    },
    topUnidades: byUnidades.slice(0, TOP_N).map(toProducto),
    topRentabilidad: byUtilidad.slice(0, TOP_N).map(toProducto),
    estrategicos: estrategicos.slice(0, TOP_N).map(toProducto),
  };
}

function emptyLado(aviso: string): CostoLado {
  return {
    aviso,
    kpis: emptyKpis(),
    topUnidades: [],
    topRentabilidad: [],
    estrategicos: [],
  };
}

async function monthTabs(spreadsheetId: string): Promise<Map<string, string>> {
  const hit = tabCache.get(spreadsheetId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const sheets = await sheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });
  const tabs = new Map<string, string>();
  for (const sheet of meta.data.sheets || []) {
    const title = sheet.properties?.title || '';
    const month = canonicalMonthName(title);
    if (month) tabs.set(month, title);
  }
  tabCache.set(spreadsheetId, { at: Date.now(), value: tabs });
  return tabs;
}

async function readMonth(
  spreadsheetId: string,
  actualTitle: string,
  month: string
): Promise<string[][]> {
  const key = `${spreadsheetId}:${month}`;
  const hit = valueCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const sheets = await sheetsClient();
  const range = `'${actualTitle.replace(/'/g, "''")}'!A1:Z1500`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = (res.data.values || []).map((row) =>
    (row || []).map((cellValue) => String(cellValue ?? ''))
  );
  valueCache.set(key, { at: Date.now(), value: rows });
  return rows;
}

export const COSTOS_ANIO = 2026;

export class CostoMesError extends Error {
  status = 400;
  meses: string[];

  constructor(message: string, meses: string[]) {
    super(message);
    this.meses = meses;
  }
}

const COSTOS_SOURCE = 'costos_venta';

function num(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

type SnapshotPayload = {
  anio: number;
  mes: string;
  linea: 'alimentos' | 'bebidas';
  productos: Array<{
    producto: string;
    grupo: string;
    unidades: number;
    venta: number;
    costoTotal: number;
    costoPct: number | null;
    utilidad: number;
  }>;
};

function monthDate(anio: number, mes: string): string {
  const index = COSTOS_MESES.findIndex((name) => name === mes);
  const month = String(Math.max(index, 0) + 1).padStart(2, '0');
  return `${anio}-${month}-01`;
}

function ladoFromPayload(payload: SnapshotPayload | null): CostoLado {
  const parsed: ParsedRow[] = (payload?.productos || []).map((row) => ({
    producto: row.producto,
    grupo: row.grupo || '',
    unidades: num(row.unidades),
    venta: num(row.venta),
    costoTotal: num(row.costoTotal),
    costoPct: row.costoPct == null ? null : num(row.costoPct),
    utilidad: num(row.utilidad),
  }));
  if (!parsed.length) return emptyLado('Sin ventas en este mes.');
  return rankCostoProductos(parsed);
}

function parseSnapshot(description: string | null): SnapshotPayload | null {
  if (!description) return null;
  try {
    const payload = JSON.parse(description) as SnapshotPayload;
    if (!payload?.mes || !payload.linea || !Array.isArray(payload.productos)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Tablero desde la base. No consulta Drive. */
export async function loadCostosDashboard(
  mesParam: string | null
): Promise<CostosDashboard> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .select('description')
    .eq('source_file', COSTOS_SOURCE);
  if (error) {
    throw new Error('No se pudo leer el costo por venta guardado.');
  }

  const snapshots = (data || [])
    .map((row) => parseSnapshot((row as { description?: string }).description || null))
    .filter((row): row is SnapshotPayload => Boolean(row));
  const presentes = new Set(snapshots.map((row) => row.mes));
  const meses: string[] = COSTOS_MESES.filter((mes) => presentes.has(mes));
  if (!meses.length) {
    throw new Error('El costo por venta todavía no está importado.');
  }

  let mes: string;
  const requested = (mesParam || '').trim();
  if (requested) {
    const canon = canonicalMonthName(requested);
    if (!canon || !meses.includes(canon)) {
      throw new CostoMesError(
        canon
          ? `${canon} todavía no tiene costo por venta.`
          : `Mes no disponible: ${requested}`,
        [...meses]
      );
    }
    mes = canon;
  } else {
    mes = meses[meses.length - 1];
  }

  const alimentos =
    snapshots.find((row) => row.mes === mes && row.linea === 'alimentos') || null;
  const bebidas =
    snapshots.find((row) => row.mes === mes && row.linea === 'bebidas') || null;

  return {
    mes,
    meses: [...meses],
    alimentos: ladoFromPayload(alimentos),
    bebidas: ladoFromPayload(bebidas),
  };
}

function dedupeRows(rows: ParsedRow[]): ParsedRow[] {
  const map = new Map<string, ParsedRow>();
  for (const row of rows) {
    const key = `${row.producto}\0${row.grupo}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    prev.unidades += row.unidades;
    prev.venta += row.venta;
    prev.costoTotal += row.costoTotal;
    prev.utilidad += row.utilidad;
    prev.costoPct =
      prev.venta > 0 ? (prev.costoTotal / prev.venta) * 100 : prev.costoPct;
  }
  return [...map.values()];
}

/**
 * Lee las hojas de cocina y barra y reemplaza en la base los meses con ventas.
 * Los meses vacíos (pestaña sin productos) no se tocan.
 */
export async function syncCostosVentaFromSheets(
  anio = COSTOS_ANIO
): Promise<{ meses: string[]; filas: number }> {
  const [foodTabs, drinkTabs] = await Promise.all([
    monthTabs(COSTOS_FOOD_SHEET_ID),
    monthTabs(COSTOS_DRINK_SHEET_ID),
  ]);
  const mesesTab = COSTOS_MESES.filter(
    (mes) => foodTabs.has(mes) || drinkTabs.has(mes)
  );
  const sb = getServiceSupabase();
  const records: Array<{
    date: string;
    type: string;
    category: string;
    amount: number;
    description: string;
    source_file: string;
  }> = [];

  for (const mes of mesesTab) {
    const lados: Array<['alimentos' | 'bebidas', string | undefined, string]> = [
      ['alimentos', foodTabs.get(mes), COSTOS_FOOD_SHEET_ID],
      ['bebidas', drinkTabs.get(mes), COSTOS_DRINK_SHEET_ID],
    ];
    for (const [linea, title, sheetId] of lados) {
      const parsed = title
        ? dedupeRows(parseCostoRows(await readMonth(sheetId, title, mes)))
        : [];
      if (!parsed.length) continue;
      const payload: SnapshotPayload = {
        anio,
        mes,
        linea,
        productos: parsed.map((row) => ({
          producto: row.producto,
          grupo: row.grupo,
          unidades: row.unidades,
          venta: row.venta,
          costoTotal: row.costoTotal,
          costoPct: row.costoPct,
          utilidad: row.utilidad,
        })),
      };
      records.push({
        date: monthDate(anio, mes),
        type: 'expense',
        category: linea,
        amount: 0,
        description: JSON.stringify(payload),
        source_file: COSTOS_SOURCE,
      });
    }
  }

  const { error: delError } = await sb
    .from('financial_records')
    .delete()
    .eq('source_file', COSTOS_SOURCE);
  if (delError) throw new Error(delError.message);

  if (records.length) {
    const { error: insError } = await sb.from('financial_records').insert(records);
    if (insError) throw new Error(insError.message);
  }

  return {
    meses: [...new Set(records.map((row) => {
      const payload = parseSnapshot(row.description);
      return payload?.mes || '';
    }).filter(Boolean))],
    filas: records.reduce((sum, row) => {
      const payload = parseSnapshot(row.description);
      return sum + (payload?.productos.length || 0);
    }, 0),
  };
}
