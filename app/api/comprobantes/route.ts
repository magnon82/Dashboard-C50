import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createReadStream, existsSync } from 'fs';
import { access, readdir, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import { SOURCE_ESTADO_PDF_INDEX } from '@/app/lib/estados-cuenta';
import { getServiceSupabase } from '@/app/lib/users';
import { weekMondayIso } from '@/app/lib/ventas-semana';
import {
  clientSafeRoot,
  localDriveFsEnabled,
} from '@/app/lib/local-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ROOT = process.env.COMPROBANTES_PATH?.trim()
  || 'I:\\Mi unidad\\COMPROBANTES BANCARIOS';

const MONTHS: Record<string, number> = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

const PDF_NAME_RE =
  /^(mifel|bbva)[-_](.+?)[-_]?\$?([\d.,]+)\.pdf$/i;

/** Explicit calendar date in path/filename (ISO, compact, or DMY). */
const EXPLICIT_ISO_RE = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/;
const EXPLICIT_COMPACT_RE = /(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/;
const EXPLICIT_DMY_RE =
  /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})(?!\d)/;

/** IMSS / impuestos / instituciones de gobierno (filenames + búsqueda). */
const GOV_CONCEPTO_RE =
  /imss|infonavit|shcp|hacienda|impuesto|tesorer|secretaria|\bsat\b|\bisr\b|\biva\b|l[ií]nea\s*de\s*captura/i;

export function isGobiernoText(...parts: string[]): boolean {
  return GOV_CONCEPTO_RE.test(parts.filter(Boolean).join(' '));
}

/** Middle filename segment without bank/amount → readable Concepto. */
export function conceptoFromBody(body: string): string {
  let s = (body || '').trim();
  if (!s) return '';
  s = s.replace(/\(\d{2,4}\)/g, '');
  s = s.replace(/[-_]+/g, ' ');
  s = s.replace(/\bsem\s*(\d+)\b/gi, 'Sem $1');
  s = s.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2');
  s = s.replace(/([A-Za-zÁÉÍÓÚáéíóúñÑ])(\d)/g, '$1 $2');
  s = s.replace(/(\d)([A-Za-zÁÉÍÓÚáéíóúñÑ])/g, '$1 $2');
  s = s.replace(/\s+/g, ' ').trim();
  const replacements: [RegExp, string][] = [
    [/\bimss\b/gi, 'IMSS'],
    [/\binfonavit\b/gi, 'INFONAVIT'],
    [/\bshcp\b/gi, 'SHCP'],
    [/\bsat\b/gi, 'SAT'],
    [/\bisr\b/gi, 'ISR'],
    [/\biva\b/gi, 'IVA'],
    [/\bimpuestos?\b/gi, 'Impuestos'],
    [/\btesorer[ií]a\b/gi, 'Tesorería'],
    [/\bsecretar[ií]a\s+de\s+hacienda\b/gi, 'Secretaría de Hacienda'],
  ];
  for (const [pat, repl] of replacements) {
    s = s.replace(pat, repl);
  }
  return s;
}

export type ComprobanteItem = {
  filename: string;
  path: string;
  rel_path: string;
  bank: string;
  amount: number;
  date: string;
  year: number;
  month: number | null;
  week: number | null;
  vendor: string;
  body: string;
  /** Concepto legible del nombre (sin banco ni monto). */
  concepto: string;
  kind: 'comprobante' | 'estado';
  source: 'index' | 'scan';
  /** File mtime (ms since epoch) when known — best recency signal. */
  mtimeMs: number | null;
};

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

/** Best calendar date from path/filename (explicit day > SemN Monday > folder month). */
function dateFromPathAndName(
  fullPath: string,
  filename: string,
  yearHint: number,
  folderMonth: number | null,
  week: number | null
): { date: string; year: number; month: number | null } {
  const hay = `${fullPath} ${filename}`;
  const iso = EXPLICIT_ISO_RE.exec(hay);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (isValidYmd(y, m, d)) {
      return {
        date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        year: y,
        month: m,
      };
    }
  }
  const dmy = EXPLICIT_DMY_RE.exec(hay);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (isValidYmd(y, m, d)) {
      return {
        date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        year: y,
        month: m,
      };
    }
  }
  const compact = EXPLICIT_COMPACT_RE.exec(hay);
  if (compact) {
    const y = Number(compact[1]);
    const m = Number(compact[2]);
    const d = Number(compact[3]);
    if (isValidYmd(y, m, d)) {
      return {
        date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        year: y,
        month: m,
      };
    }
  }
  if (week != null && week >= 1 && week <= 53 && yearHint >= 2000) {
    const monday = weekMondayIso(yearHint, week);
    const [y, m] = monday.split('-').map(Number);
    return { date: monday, year: y || yearHint, month: m || folderMonth };
  }
  const month = folderMonth;
  return {
    date: `${yearHint}-${String(month || 1).padStart(2, '0')}-01`,
    year: yearHint,
    month,
  };
}

/** Newest → oldest: mtime, then calendar date, then filename. */
export function sortComprobantesByRecency(items: ComprobanteItem[]): void {
  items.sort((a, b) => {
    const ma = a.mtimeMs ?? 0;
    const mb = b.mtimeMs ?? 0;
    if (ma !== mb) return mb - ma;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.filename.localeCompare(b.filename, 'es');
  });
}

async function requireSession(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  return session;
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw || '{}')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function inferKind(filename: string, folderHint = ''): 'comprobante' | 'estado' {
  const u = `${filename} ${folderHint}`.toUpperCase();
  if (u.includes('ESTADO DE CUENTA') || u.includes('ESTADO_DE_CUENTA')) {
    return 'estado';
  }
  return 'comprobante';
}

function parseMonthFolder(name: string): { month: number | null; year: number | null } {
  const upper = name.toUpperCase();
  let month: number | null = null;
  for (const [label, num] of Object.entries(MONTHS)) {
    if (upper.includes(label)) {
      month = num;
      break;
    }
  }
  const ym = upper.match(/(20\d{2})/);
  return { month, year: ym ? Number(ym[1]) : null };
}

function parsePdfName(
  fullPath: string,
  yearHint: number,
  mtimeMs: number | null = null
): ComprobanteItem | null {
  const filename = path.basename(fullPath);
  const parent = path.basename(path.dirname(fullPath));
  const { month: folderMonth, year: folderYear } = parseMonthFolder(parent);
  const year = folderYear || yearHint;
  const kind = inferKind(filename, parent);

  const m = PDF_NAME_RE.exec(filename);
  if (!m) {
    // Still index estado PDFs / odd names / gov receipts under year/month folders
    if (
      kind === 'estado' ||
      isGobiernoText(filename) ||
      filename.toLowerCase().endsWith('.pdf')
    ) {
      const fallbackBody = filename.replace(/\.pdf$/i, '');
      const amtM = fallbackBody.match(/\$?\s*([\d.,]+)\s*$/);
      const amount = amtM
        ? Number(String(amtM[1] || '0').replace(/,/g, '')) || 0
        : 0;
      const weekM = fallbackBody.match(/Sem\s*(\d+)/i);
      const week = weekM ? Number(weekM[1]) : null;
      const resolved = dateFromPathAndName(
        fullPath,
        filename,
        year,
        folderMonth,
        week
      );
      return {
        filename,
        path: fullPath,
        rel_path: fullPath,
        bank: filename.toUpperCase().includes('BBVA')
          ? 'BBVA'
          : filename.toUpperCase().includes('MIFEL')
            ? 'MIFEL'
            : '',
        amount,
        date: resolved.date,
        year: resolved.year,
        month: resolved.month,
        week,
        vendor: '',
        body: fallbackBody,
        concepto: conceptoFromBody(fallbackBody),
        kind,
        source: 'scan',
        mtimeMs,
      };
    }
    return null;
  }

  const bank = String(m[1] || '').toUpperCase();
  const body = String(m[2] || '');
  const amount = Number(String(m[3] || '0').replace(/,/g, '')) || 0;
  const weekM = body.match(/Sem\s*(\d+)/i);
  const week = weekM ? Number(weekM[1]) : null;
  const vendor = body.split('-')[0]?.trim() || '';
  const resolved = dateFromPathAndName(
    fullPath,
    filename,
    year,
    folderMonth,
    week
  );
  return {
    filename,
    path: fullPath,
    rel_path: fullPath,
    bank,
    amount,
    date: resolved.date,
    year: resolved.year,
    month: resolved.month,
    week,
    vendor,
    body,
    concepto: conceptoFromBody(body),
    kind,
    source: 'scan',
    mtimeMs,
  };
}

async function walkPdfs(
  root: string,
  years: number[] | null
): Promise<ComprobanteItem[]> {
  const out: ComprobanteItem[] = [];
  if (!existsSync(root)) return out;

  const yearDirs = (await readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^20\d{2}$/.test(d.name))
    .map((d) => d.name)
    .filter((y) => !years || years.includes(Number(y)))
    .sort();

  async function walk(dir: string, yearHint: number) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, yearHint);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.pdf')) {
        let mtimeMs: number | null = null;
        try {
          const st = await stat(full);
          mtimeMs = st.mtimeMs;
        } catch {
          mtimeMs = null;
        }
        const item = parsePdfName(full, yearHint, mtimeMs);
        if (item) out.push(item);
      }
    }
  }

  for (const y of yearDirs) {
    await walk(path.join(root, y), Number(y));
  }
  return out;
}

async function loadFromIndex(): Promise<{
  items: ComprobanteItem[];
  indexedAt: string | null;
}> {
  const sb = getServiceSupabase();
  const all: ComprobanteItem[] = [];
  let indexedAt: string | null = null;
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('financial_records')
      .select('date,amount,description,category,source_file,created_at')
      .eq('source_file', SOURCE_ESTADO_PDF_INDEX)
      .order('date', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      const created = String(row.created_at || '');
      if (created && (!indexedAt || created > indexedAt)) indexedAt = created;
      const d = parseJson(row.description);
      const filename = String(d.filename || '');
      const rel = String(d.rel_path || '');
      if (!filename && !rel) continue;
      const body = String(d.body || '');
      const storedConcepto = String(d.concepto || '').trim();
      const week = d.week != null ? Number(d.week) : null;
      const rowDate = String(row.date || '').slice(0, 10);
      const [rowY, rowM] = rowDate.split('-').map(Number);
      const yearHint = rowY || Number(d.year) || 0;
      const folderMonth =
        d.month != null && Number(d.month) >= 1
          ? Number(d.month)
          : rowM || null;
      const resolved = dateFromPathAndName(
        rel || filename,
        filename || path.basename(rel),
        yearHint || new Date().getFullYear(),
        folderMonth,
        week
      );
      // Prefer path/Sem-resolved day over bare month-start index date.
      const useResolved =
        resolved.date.slice(8, 10) !== '01' ||
        !rowDate ||
        rowDate.slice(8, 10) === '01';
      const date = useResolved ? resolved.date : rowDate;
      const mtimeRaw = d.mtime_ms ?? d.mtimeMs;
      const mtimeMs =
        mtimeRaw != null && Number.isFinite(Number(mtimeRaw))
          ? Number(mtimeRaw)
          : null;
      all.push({
        filename: filename || path.basename(rel),
        path: rel,
        rel_path: rel,
        bank: String(d.bank || ''),
        amount: Number(d.amount ?? row.amount) || 0,
        date,
        year: resolved.year || rowY || 0,
        month: resolved.month ?? folderMonth,
        week,
        vendor: String(d.vendor || ''),
        body,
        concepto: storedConcepto || conceptoFromBody(body),
        kind: inferKind(filename || rel),
        source: 'index',
        mtimeMs,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { items: all, indexedAt };
}

function isUnderRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function filterItems(
  items: ComprobanteItem[],
  opts: {
    year?: number;
    month?: number;
    day?: number;
    bank?: string;
    q?: string;
    kind?: string;
  }
): ComprobanteItem[] {
  const bank = (opts.bank || 'all').toUpperCase();
  const kind = (opts.kind || 'all').toLowerCase();
  const q = (opts.q || '').trim().toLowerCase();
  return items.filter((it) => {
    if (opts.year && it.year !== opts.year) return false;
    if (opts.month && it.month !== opts.month) return false;
    if (opts.day) {
      const d = Number(String(it.date || '').slice(8, 10));
      if (d !== opts.day) return false;
    }
    if (bank !== 'ALL' && it.bank.toUpperCase() !== bank) return false;
    if (kind !== 'all' && it.kind !== kind) return false;
    if (q) {
      const hay = [
        it.concepto,
        it.vendor,
        it.body,
        it.filename,
        it.date,
        it.bank,
        it.path,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** GET /api/comprobantes — lista índice o escaneo local.
 *  Query: year, month, bank, q, kind, scan=1, open=<path> (sirve PDF)
 */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';
  const root = DEFAULT_ROOT;

  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    if (!isUnderRoot(decoded, root)) {
      return NextResponse.json(
        { error: 'Ruta fuera del directorio de comprobantes' },
        { status: 403 }
      );
    }
    try {
      await access(decoded);
      const st = await stat(decoded);
      if (!st.isFile() || !decoded.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ error: 'No es un PDF' }, { status: 400 });
      }
      const stream = createReadStream(decoded);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return new NextResponse(webStream, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(decoded))}"`,
          'Cache-Control': 'private, max-age=120',
        },
      });
    } catch {
      return NextResponse.json(
        {
          error: 'Archivo no legible en este servidor',
          ...(localDriveFsEnabled() ? { path: decoded } : {}),
        },
        { status: 404 }
      );
    }
  }

  const year = Number(url.searchParams.get('year') || 0) || undefined;
  const month = Number(url.searchParams.get('month') || 0) || undefined;
  const day = Number(url.searchParams.get('day') || 0) || undefined;
  const bank = url.searchParams.get('bank') || 'all';
  const q = url.searchParams.get('q') || '';
  const kind = url.searchParams.get('kind') || 'all';
  const forceScan = url.searchParams.get('scan') === '1';
  const preferIndex = url.searchParams.get('index') === '1';
  const yearsParam = url.searchParams.get('years');
  const years = yearsParam
    ? yearsParam
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => n >= 2000)
    : year
      ? [year]
      : null;

  try {
    const localFs = localDriveFsEnabled();
    const rootExists = localFs && existsSync(root);
    let items: ComprobanteItem[] = [];
    let source: 'index' | 'scan' | 'index+scan' = 'index';
    let indexedAt: string | null = null;

    // Local disk is complete (~hundreds/year). A sparse Supabase index was
    // preferred before and capped the UI at a handful of month-start rows.
    if (preferIndex && !forceScan) {
      try {
        const loaded = await loadFromIndex();
        items = loaded.items;
        indexedAt = loaded.indexedAt;
      } catch {
        items = [];
      }
      source = 'index';
      if (!items.length && rootExists) {
        items = await walkPdfs(root, years);
        source = 'scan';
      }
    } else if (forceScan || rootExists) {
      const scanned = await walkPdfs(root, years);
      if (scanned.length) {
        items = scanned;
        source = 'scan';
      } else {
        try {
          const loaded = await loadFromIndex();
          items = loaded.items;
          indexedAt = loaded.indexedAt;
          source = 'index';
        } catch {
          items = [];
        }
      }
    } else {
      try {
        const loaded = await loadFromIndex();
        items = loaded.items;
        indexedAt = loaded.indexedAt;
      } catch {
        items = [];
      }
      source = 'index';
    }

    const filtered = filterItems(items, { year, month, day, bank, q, kind });
    sortComprobantesByRecency(filtered);

    const itemsOut = localFs
      ? filtered
      : filtered.map((it) => ({
          ...it,
          path: '',
          rel_path: '',
        }));

    return NextResponse.json({
      items: itemsOut,
      count: itemsOut.length,
      source,
      indexedAt,
      root: clientSafeRoot(root),
      rootExists,
      localFsEnabled: localFs,
      canOpenFiles: rootExists,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al listar comprobantes',
      },
      { status: 500 }
    );
  }
}
