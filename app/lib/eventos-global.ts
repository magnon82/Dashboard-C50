/**
 * Pestaña Global de EVENTOS C50 {año} (Sheets) — VENTA + VENTA EXTRA.
 * Misma fuente que ingest_eventos.py; usada para control de comisiones
 * de vendedores. No reemplaza el ingest a financial_records.
 *
 * En producción: Sheets (OAuth o service account) → si falla, filas ya
 * ingeridas en financial_records (source_file=eventos).
 */

import { google } from 'googleapis';
import {
  createGoogleDriveAuth,
  createGoogleDriveJwtAuth,
  friendlyDriveError,
  getGoogleDriveAuthStatus,
} from '@/app/lib/google-drive-auth';
import { getServiceSupabase } from '@/app/lib/users';

/** googleapis duplica OAuth2Client/JWT en deps anidadas; auth se tipa laxo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleApiAuth = any;

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
  source: 'sheets' | 'financial_records' | 'empty';
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
    for (const fmt of [
      /^(\d{4})-(\d{2})-(\d{2})/,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    ]) {
      const mm = fmt.exec(s);
      if (mm && fmt.source.startsWith('^(\\d{4})')) {
        return `${mm[1]}-${mm[2]}-${mm[3]}`;
      }
    }
  }
  return null;
}

export function parseEventosGlobalRows(rows: unknown[][]): EventosGlobalRow[] {
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

/** Descripción ingest: `Nombre · EVENTOS C50 2026 · VENTA 1,234.00 + EXTRA 50.00` */
export function parseEventosIngestDescription(description: string): {
  evento: string;
  venta: number;
  ventaExtra: number;
} {
  const desc = String(description || '').trim();
  const ventaMatch =
    /VENTA\s+([\d,]+\.?\d*)\s*\+\s*EXTRA\s+([\d,]+\.?\d*)/i.exec(desc);
  const venta = ventaMatch ? parseMoney(ventaMatch[1]) : 0;
  const ventaExtra = ventaMatch ? parseMoney(ventaMatch[2]) : 0;
  const evento = (desc.split(/\s·\s/)[0] || desc || 'Evento').trim();
  return { evento, venta, ventaExtra };
}

async function findEventosSheetId(
  year: number,
  auth: GoogleApiAuth
): Promise<{ id: string; name: string } | null> {
  const drive = google.drive({ version: 'v3', auth });
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

async function loadEventosGlobalFromSheetsWithAuth(
  year: number,
  auth: GoogleApiAuth
): Promise<EventosGlobalPayload> {
  const found = await findEventosSheetId(year, auth);
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
  const sheets = google.sheets({ version: 'v4', auth });
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
}

async function loadEventosGlobalFromFinancialRecords(
  year: number
): Promise<EventosGlobalPayload> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('financial_records')
      .select('date, amount, description')
      .eq('source_file', 'eventos')
      .eq('category', 'Eventos')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: true })
      .limit(2000);

    if (error) {
      return {
        year,
        sheetId: null,
        sheetName: null,
        tab: null,
        rows: [],
        source: 'empty',
        error: error.message,
      };
    }

    const rows: EventosGlobalRow[] = [];
    for (const raw of data || []) {
      const amount = Number(raw.amount) || 0;
      if (amount <= 0) continue;
      const parsed = parseEventosIngestDescription(String(raw.description || ''));
      let venta = parsed.venta;
      let ventaExtra = parsed.ventaExtra;
      const parsedTotal = Math.round((venta + ventaExtra) * 100) / 100;
      if (parsedTotal <= 0 || Math.abs(parsedTotal - amount) > 0.05) {
        venta = Math.round(amount * 100) / 100;
        ventaExtra = 0;
      }
      const total = Math.round((venta + ventaExtra) * 100) / 100;
      const fecha =
        typeof raw.date === 'string' ? raw.date.slice(0, 10) : null;
      rows.push({
        evento: parsed.evento,
        venta,
        ventaExtra,
        total,
        fecha,
        rawFecha: fecha,
      });
    }

    return {
      year,
      sheetId: null,
      sheetName: `financial_records · eventos ${year}`,
      tab: null,
      rows,
      source: rows.length ? 'financial_records' : 'empty',
      error: rows.length
        ? undefined
        : `Sin filas de eventos ingeridas en financial_records para ${year}.`,
    };
  } catch (e) {
    return {
      year,
      sheetId: null,
      sheetName: null,
      tab: null,
      rows: [],
      source: 'empty',
      error:
        e instanceof Error ? e.message : 'No se pudo leer financial_records',
    };
  }
}

function listAuthAttempts(): Array<{
  label: string;
  auth: () => GoogleApiAuth;
}> {
  const status = getGoogleDriveAuthStatus();
  const attempts: Array<{
    label: string;
    auth: () => GoogleApiAuth;
  }> = [];
  if (status.mode === 'oauth') {
    attempts.push({ label: 'oauth', auth: () => createGoogleDriveAuth() });
    if (createGoogleDriveJwtAuth()) {
      attempts.push({
        label: 'service_account',
        auth: () => createGoogleDriveJwtAuth()!,
      });
    }
  } else if (status.mode === 'service_account') {
    attempts.push({
      label: 'service_account',
      auth: () => createGoogleDriveAuth(),
    });
  }
  return attempts;
}

export async function loadEventosGlobal(
  year: number
): Promise<EventosGlobalPayload> {
  const attempts = listAuthAttempts();
  const sheetErrors: string[] = [];

  for (const attempt of attempts) {
    try {
      const payload = await loadEventosGlobalFromSheetsWithAuth(
        year,
        attempt.auth()
      );
      if (payload.source === 'sheets') return payload;
      if (payload.sheetId) return payload;
      if (payload.error) sheetErrors.push(payload.error);
    } catch (e) {
      sheetErrors.push(friendlyDriveError(e));
    }
  }

  const fallback = await loadEventosGlobalFromFinancialRecords(year);
  if (fallback.rows.length) {
    const sheetsHint =
      sheetErrors[0] ||
      (attempts.length
        ? 'No se pudo leer el Sheet Global en vivo.'
        : getGoogleDriveAuthStatus().message);
    return {
      ...fallback,
      error: `${sheetsHint} Mostrando datos ingeridos (financial_records). Corre ingest_eventos.py para actualizar.`,
    };
  }

  return {
    year,
    sheetId: null,
    sheetName: null,
    tab: null,
    rows: [],
    source: 'empty',
    error:
      sheetErrors[0] ||
      fallback.error ||
      'No hay Global en Sheets ni filas eventos en financial_records.',
  };
}
