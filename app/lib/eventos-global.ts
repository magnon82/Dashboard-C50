/**
 * Pestaña Global de EVENTOS C50 {año} (Sheets) — VENTA + VENTA EXTRA.
 * Misma fuente que ingest_eventos.py; usada para control de comisiones
 * de vendedores. No reemplaza el ingest a financial_records.
 */

import {
  createDriveClient,
  createSheetsClient,
} from '@/app/lib/google-drive-auth';

export type EventosGlobalRow = {
  evento: string;
  venta: number;
  ventaExtra: number;
  total: number;
  fecha: string | null;
  rawFecha: string | null;
};

export type EventosGlobalPayload = {
  year: number;
  sheetId: string | null;
  sheetName: string | null;
  tab: string | null;
  rows: EventosGlobalRow[];
  source: 'sheets' | 'empty';
  error?: string;
};

const MESES_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function parseMoney(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value)
    .trim()
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '');
  if (!s || s === '-' || s.startsWith('#')) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseSpanishDate(text: unknown): string | null {
  if (text == null) return null;
  if (typeof text === 'string') {
    const s = text.trim().toLowerCase();
    if (!s) return null;
    const m = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/.exec(s);
    if (m) {
      const day = Number(m[1]);
      const month = MESES_ES[m[2]];
      const year = Number(m[3]);
      if (month && day && year) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    for (const fmt of [/^(\d{4})-(\d{2})-(\d{2})/, /^(\d{1,2})\/(\d{1,2})\/(\d{4})/]) {
      const mm = fmt.exec(s);
      if (mm && fmt.source.startsWith('^(\\d{4})')) {
        return `${mm[1]}-${mm[2]}-${mm[3]}`;
      }
    }
  }
  return null;
}

export function parseEventosGlobalRows(
  rows: unknown[][]
): EventosGlobalRow[] {
  const out: EventosGlobalRow[] = [];
  let started = false;
  for (const row of rows) {
    if (!row?.length) continue;
    const header = String(row[0] ?? '')
      .trim()
      .toUpperCase();
    const fechaHeader =
      row.length > 8 &&
      String(row[8] ?? '')
        .trim()
        .toUpperCase()
        .startsWith('FECHA');
    if (header === 'EVENTO' || fechaHeader) {
      started = true;
      continue;
    }
    if (!started) continue;
    const evento = String(row[0] ?? '').trim();
    if (!evento) continue;
    const venta = parseMoney(row[3]);
    const ventaExtra = parseMoney(row[4]);
    const total = Math.round((venta + ventaExtra) * 100) / 100;
    if (total <= 0) continue;
    const rawFecha = row[8] == null ? null : String(row[8]);
    out.push({
      evento,
      venta,
      ventaExtra,
      total,
      fecha: parseSpanishDate(row[8]),
      rawFecha,
    });
  }
  return out;
}

async function findEventosSheetId(year: number): Promise<{
  id: string;
  name: string;
} | null> {
  const drive = createDriveClient();
  const q = `name = 'EVENTOS C50 ${year}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res = await drive.files.list({
    q,
    pageSize: 1,
    fields: 'files(id,name)',
  });
  const f = res.data.files?.[0];
  if (!f?.id) return null;
  return { id: f.id, name: f.name || `EVENTOS C50 ${year}` };
}

export async function loadEventosGlobal(
  year: number
): Promise<EventosGlobalPayload> {
  try {
    const found = await findEventosSheetId(year);
    if (!found) {
      return {
        year,
        sheetId: null,
        sheetName: null,
        tab: null,
        rows: [],
        source: 'empty',
        error: `No se encontró el Sheet «EVENTOS C50 ${year}» en Drive.`,
      };
    }
    const sheets = createSheetsClient();
    for (const tab of ['Global', 'GLOBAL'] as const) {
      try {
        const result = await sheets.spreadsheets.values.get({
          spreadsheetId: found.id,
          range: `'${tab}'!A1:Z500`,
        });
        const values = (result.data.values || []) as unknown[][];
        if (!values.length) continue;
        return {
          year,
          sheetId: found.id,
          sheetName: found.name,
          tab,
          rows: parseEventosGlobalRows(values),
          source: 'sheets',
        };
      } catch {
        continue;
      }
    }
    return {
      year,
      sheetId: found.id,
      sheetName: found.name,
      tab: null,
      rows: [],
      source: 'empty',
      error: 'El Sheet existe pero no tiene pestaña Global.',
    };
  } catch (e) {
    return {
      year,
      sheetId: null,
      sheetName: null,
      tab: null,
      rows: [],
      source: 'empty',
      error: e instanceof Error ? e.message : 'No se pudo leer Global',
    };
  }
}
