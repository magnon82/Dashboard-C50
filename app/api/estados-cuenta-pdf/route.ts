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
import { SOURCE_ESTADO_CUENTA_PDF_INDEX } from '@/app/lib/estados-cuenta';
import { getServiceSupabase } from '@/app/lib/users';
import {
  clientSafeRoot,
  localDriveFsEnabled,
} from '@/app/lib/local-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PDFs de estados de cuenta bancarios (independiente de COMPROBANTES BANCARIOS). */
const DEFAULT_ROOT = process.env.BANCOS_ESTADOS_PATH?.trim()
  || 'I:\\Mi unidad\\Administración\\Bancos';

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

/** Typos / variants seen in Drive filenames (e.g. JUNIIO). */
const MONTH_ALIASES: Record<string, number> = {
  ...MONTHS,
  FEBRRERO: 2,
  FEBREROO: 2,
  MARSO: 3,
  ABRILL: 4,
  JUNIIO: 6,
  JUNIOO: 6,
  JUINIO: 6,
  JULIOO: 7,
  AGOSTOO: 8,
  SETIEMBRE: 9,
  SEPTEMBRE: 9,
  OCTUBREE: 10,
};

const MONTH_CANON = Object.keys(MONTHS);

const MONTH_SKIP_TOKENS = new Set([
  'BBVA',
  'MIFEL',
  'AMEX',
  'AMERICAN',
  'EXPRESS',
  'ESTADOS',
  'CUENTA',
  'ESTADO',
  'BANCOS',
  'C50',
  'PDF',
]);

export type EstadoCuentaPdfItem = {
  filename: string;
  path: string;
  rel_path: string;
  bank: string;
  date: string;
  year: number;
  month: number | null;
  day: number | null;
  source: 'index' | 'scan';
};

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

function detectBank(...parts: string[]): string {
  const u = parts.join(' ').toUpperCase();
  if (u.includes('AMEX') || u.includes('AMERICAN EXPRESS')) return 'AMEX';
  if (u.includes('BBVA')) return 'BBVA';
  if (u.includes('MIFEL')) return 'MIFEL';
  return '';
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Levenshtein distance for short month-token fuzzy match. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function monthFromToken(token: string): number | null {
  const plain = stripAccents(token.toUpperCase()).replace(/[^A-Z]/g, '');
  if (!plain || plain.length < 3 || MONTH_SKIP_TOKENS.has(plain)) return null;
  if (plain in MONTH_ALIASES) return MONTH_ALIASES[plain];
  let best: { name: string; dist: number } | null = null;
  for (const name of MONTH_CANON) {
    const dist = editDistance(plain, name);
    const maxLen = Math.max(plain.length, name.length);
    if (dist / maxLen > 0.28) continue;
    if (!best || dist < best.dist) best = { name, dist };
  }
  return best ? MONTHS[best.name] : null;
}

function parseMonthYearFromText(text: string): {
  month: number | null;
  year: number | null;
} {
  const upper = stripAccents(text.toUpperCase());
  let month: number | null = null;
  const aliases = Object.entries(MONTH_ALIASES).sort(
    (a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0])
  );
  for (const [label, num] of aliases) {
    if (upper.includes(label)) {
      month = num;
      break;
    }
  }
  if (month == null) {
    const tokens = upper.match(/[A-Z]{3,}/g) || [];
    for (const tok of tokens) {
      const m = monthFromToken(tok);
      if (m != null) {
        month = m;
        break;
      }
    }
  }
  const ym = upper.match(/(20\d{2})/);
  return { month, year: ym ? Number(ym[1]) : null };
}

function parseEstadoPdf(
  fullPath: string,
  yearHint: number | null
): EstadoCuentaPdfItem {
  const filename = path.basename(fullPath);
  const parent = path.basename(path.dirname(fullPath));
  const grand = path.basename(path.dirname(path.dirname(fullPath)));
  const fromName = parseMonthYearFromText(filename);
  const fromParent = parseMonthYearFromText(parent);
  const fromGrand = parseMonthYearFromText(grand);
  // Filename month/year wins when present.
  const year =
    fromName.year ||
    fromParent.year ||
    fromGrand.year ||
    yearHint ||
    0;
  const month =
    fromName.month != null
      ? fromName.month
      : fromParent.month ?? fromGrand.month ?? null;
  const bank = detectBank(filename, parent, grand, fullPath);
  const day = 1;
  return {
    filename,
    path: fullPath,
    rel_path: fullPath,
    bank,
    date:
      year && month != null
        ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        : `${year || 2000}-01-01`,
    year: year || 0,
    month,
    day: month != null ? day : null,
    source: 'scan',
  };
}

/** Recorre Administración\Bancos buscando PDFs bajo "Estados de cuenta" o años. */
async function walkEstadoPdfs(
  root: string,
  years: number[] | null
): Promise<EstadoCuentaPdfItem[]> {
  const out: EstadoCuentaPdfItem[] = [];
  if (!existsSync(root)) return out;

  async function walk(dir: string, yearHint: number | null) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const yFromName = /^20\d{2}$/.test(ent.name)
          ? Number(ent.name)
          : parseMonthYearFromText(ent.name).year;
        await walk(full, yFromName || yearHint);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.pdf')) {
        // Skip guides / non-statement docs at bank root
        const u = ent.name.toUpperCase();
        if (
          u.includes('GUÍA') ||
          u.includes('GUIA') ||
          u.includes('OPERATIVA') ||
          u.includes('ADMINISTRACIÓN CORPORATIVA') ||
          u.includes('ADMINISTRACION CORPORATIVA') ||
          u.includes('PAGARÉ') ||
          u.includes('PAGARE') ||
          u.includes('CARTA') ||
          u.includes('SOLICITUD') ||
          u.includes('INE ')
        ) {
          continue;
        }
        const item = parseEstadoPdf(full, yearHint);
        if (years && item.year && !years.includes(item.year)) continue;
        out.push(item);
      }
    }
  }

  // Prefer Mifel\Estados de cuenta (main archive); also scan root for other PDFs
  const estadosRoot = path.join(root, 'Mifel', 'Estados de cuenta');
  if (existsSync(estadosRoot)) {
    await walk(estadosRoot, null);
  } else {
    await walk(root, null);
  }
  return out;
}

async function loadFromIndex(): Promise<EstadoCuentaPdfItem[]> {
  const sb = getServiceSupabase();
  const all: EstadoCuentaPdfItem[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('financial_records')
      .select('date,amount,description,category,source_file')
      .eq('source_file', SOURCE_ESTADO_CUENTA_PDF_INDEX)
      .order('date', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      const d = parseJson(row.description);
      const filename = String(d.filename || '');
      const rel = String(d.rel_path || '');
      if (!filename && !rel) continue;
      const storedDate = String(row.date || '').slice(0, 10);
      const [yStored, mStored, dayStored] = storedDate.split('-').map(Number);
      const fromName = parseMonthYearFromText(filename || path.basename(rel));
      const year =
        fromName.year ||
        (typeof d.year === 'number' ? d.year : 0) ||
        yStored ||
        0;
      // Filename month wins over folder-inferred / stored date (fixes JUNIIO→January).
      let month: number | null = fromName.month;
      if (month == null && typeof d.month === 'number') month = d.month;
      if (month == null && 'month' in d && d.month == null) {
        month = null;
      } else if (month == null) {
        month = mStored || null;
      }
      const day = month != null ? dayStored || 1 : null;
      const date =
        year && month != null
          ? `${year}-${String(month).padStart(2, '0')}-${String(day || 1).padStart(2, '0')}`
          : storedDate;
      all.push({
        filename: filename || path.basename(rel),
        path: rel,
        rel_path: rel,
        bank: String(d.bank || ''),
        date,
        year: year || 0,
        month,
        day,
        source: 'index',
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function isUnderRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Normalize basename for fuzzy compare (JUNIIO ↔ JUNIO). */
function normalizePdfBasename(name: string): string {
  return stripAccents(name.toUpperCase()).replace(/[^A-Z0-9]/g, '');
}

/**
 * Resolve a PDF path under root. If the indexed path is missing (e.g. typo
 * fix JUNIIO→JUNIO on disk), pick the closest PDF in the same folder.
 */
async function resolveReadablePdf(
  requestedPath: string,
  root: string
): Promise<string | null> {
  if (!isUnderRoot(requestedPath, root)) return null;

  try {
    await access(requestedPath);
    const st = await stat(requestedPath);
    if (st.isFile() && requestedPath.toLowerCase().endsWith('.pdf')) {
      return requestedPath;
    }
  } catch {
    // fall through to same-folder fuzzy match
  }

  const dir = path.dirname(requestedPath);
  const wanted = path.basename(requestedPath);
  if (!wanted.toLowerCase().endsWith('.pdf')) return null;
  if (!existsSync(dir)) return null;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  const pdfs = entries.filter((e) => e.toLowerCase().endsWith('.pdf'));
  const exactCi = pdfs.find((e) => e.toLowerCase() === wanted.toLowerCase());
  if (exactCi) {
    const full = path.join(dir, exactCi);
    return isUnderRoot(full, root) ? full : null;
  }

  const wantedNorm = normalizePdfBasename(wanted);
  let best: { name: string; dist: number } | null = null;
  for (const name of pdfs) {
    const nameNorm = normalizePdfBasename(name);
    const dist = editDistance(wantedNorm, nameNorm);
    const maxLen = Math.max(wantedNorm.length, nameNorm.length, 1);
    // Allow small typos (JUNIIO vs JUNIO = 1); reject unrelated names.
    if (dist > 3 || dist / maxLen > 0.2) continue;
    if (!best || dist < best.dist) best = { name, dist };
  }
  if (!best) return null;
  const full = path.join(dir, best.name);
  return isUnderRoot(full, root) ? full : null;
}

function filterItems(
  items: EstadoCuentaPdfItem[],
  opts: {
    year?: number;
    month?: number;
    day?: number;
    bank?: string;
    q?: string;
  }
): EstadoCuentaPdfItem[] {
  const bank = (opts.bank || 'all').toUpperCase();
  const q = (opts.q || '').trim().toLowerCase();
  return items.filter((it) => {
    if (opts.year && it.year !== opts.year) return false;
    if (opts.month && it.month !== opts.month) return false;
    if (opts.day) {
      const d = it.day ?? Number(String(it.date || '').slice(8, 10));
      if (d !== opts.day) return false;
    }
    if (bank !== 'ALL' && it.bank.toUpperCase() !== bank) return false;
    if (q) {
      const hay = [it.filename, it.date, it.bank, it.path]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** GET /api/estados-cuenta-pdf — índice de PDFs en Administración\Bancos.
 *  Query: year, month, day, bank, q, scan=1, open=<path>
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
        { error: 'Ruta fuera del directorio de estados de cuenta' },
        { status: 403 }
      );
    }
    try {
      const resolved = await resolveReadablePdf(decoded, root);
      if (!resolved) {
        return NextResponse.json(
          {
            error: 'Archivo no legible en este servidor',
            ...(localDriveFsEnabled() ? { path: decoded } : {}),
          },
          { status: 404 }
        );
      }
      const stream = createReadStream(resolved);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return new NextResponse(webStream, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(resolved))}"`,
          'Cache-Control': 'private, max-age=120',
          ...(resolved !== decoded && localDriveFsEnabled()
            ? { 'X-Resolved-Path': encodeURIComponent(resolved) }
            : {}),
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
  const forceScan = url.searchParams.get('scan') === '1';
  const yearsParam = url.searchParams.get('years');
  const years = yearsParam
    ? yearsParam
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => n >= 2000)
    : null;

  try {
    let items: EstadoCuentaPdfItem[] = [];
    let source: 'index' | 'scan' = 'index';
    const localFs = localDriveFsEnabled();
    const rootExists = localFs && existsSync(root);

    if (!forceScan) {
      try {
        items = await loadFromIndex();
      } catch {
        items = [];
      }
    }

    if ((forceScan && rootExists) || items.length === 0) {
      if (rootExists) {
        items = await walkEstadoPdfs(root, years);
        source = 'scan';
      } else if (!items.length) {
        try {
          items = await loadFromIndex();
          source = 'index';
        } catch {
          items = [];
        }
      }
    }

    const filtered = filterItems(items, { year, month, day, bank, q });
    filtered.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.filename.localeCompare(b.filename, 'es');
    });

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
      root: clientSafeRoot(root),
      rootExists,
      localFsEnabled: localFs,
      canOpenFiles: rootExists,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : 'Error al listar estados de cuenta PDF',
      },
      { status: 500 }
    );
  }
}
