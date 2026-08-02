/**
 * Biblioteca RH — rutas locales bajo I:\Mi unidad\RH, preview y listado.
 * Solo lectura; no toca nómina / horarios.
 */

import { existsSync } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { inflateRawSync } from 'zlib';
import {
  HR_DOC_CATEGORY_LABELS,
  type HrDocCategory,
  type HrDocLink,
} from '@/app/lib/hr';

const MI_UNIDAD = process.env.DRIVE_MI_UNIDAD_PATH?.trim() || 'I:\\Mi unidad';

export type HrDocKind = 'file' | 'folder' | 'missing' | 'unknown';

export type HrDocPreviewMode = 'pdf' | 'docx' | 'download' | 'folder' | 'none';

export type HrDocLinkEnriched = HrDocLink & {
  kind: HrDocKind;
  ext: string | null;
  exists: boolean;
  mtimeMs: number | null;
  sizeBytes: number | null;
  preview: HrDocPreviewMode;
  openable: boolean;
};

export type HrBrowseItem = {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  ext: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
  preview: HrDocPreviewMode;
  openable: boolean;
};

const SKIP_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  '.ds_store',
  '~$',
]);

const SKIP_EXT = new Set([
  '.gsheet',
  '.gdoc',
  '.gslides',
  '.gform',
  '.tmp',
  '.lnk',
  '.ini',
]);

const OPENABLE_EXT = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
]);

const INLINE_EXT = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
]);

const CATEGORY_ORDER: HrDocCategory[] = [
  'cultura',
  'manuales',
  'politicas',
  'perfiles',
  'examenes',
  'expedientes',
  'horarios',
  'nominas',
  'otro',
];

export function getHrRoot(): string {
  return process.env.HR_PATH?.trim() || path.join(MI_UNIDAD, 'RH');
}

export function hrRootExists(): boolean {
  return existsSync(getHrRoot());
}

/** Permite la raíz RH o cualquier ruta debajo. */
export function isUnderHrRoot(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(getHrRoot());
  if (resolved === rootResolved) return true;
  const rel = path.relative(rootResolved, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function hrDocCategoryOrder(): HrDocCategory[] {
  return [...CATEGORY_ORDER];
}

export function hrDocCategoryLabel(cat: string): string {
  return HR_DOC_CATEGORY_LABELS[cat as HrDocCategory] || cat;
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export function hrBibliotecaContentType(filePath: string): {
  contentType: string;
  inline: boolean;
} {
  const ext = path.extname(filePath).toLowerCase();
  return {
    contentType: contentTypeForExt(ext),
    inline: INLINE_EXT.has(ext),
  };
}

export function isHrBibliotecaOpenable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return OPENABLE_EXT.has(ext);
}

export function previewModeForPath(
  filePath: string,
  kind: HrDocKind
): HrDocPreviewMode {
  if (kind === 'folder') return 'folder';
  if (kind !== 'file') return 'none';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (OPENABLE_EXT.has(ext)) return 'download';
  return 'none';
}

async function probePath(localPath: string | null): Promise<{
  kind: HrDocKind;
  ext: string | null;
  exists: boolean;
  mtimeMs: number | null;
  sizeBytes: number | null;
}> {
  if (!localPath) {
    return {
      kind: 'unknown',
      ext: null,
      exists: false,
      mtimeMs: null,
      sizeBytes: null,
    };
  }
  try {
    const st = await stat(localPath);
    if (st.isDirectory()) {
      return {
        kind: 'folder',
        ext: null,
        exists: true,
        mtimeMs: st.mtimeMs,
        sizeBytes: null,
      };
    }
    if (st.isFile()) {
      const ext = path.extname(localPath).toLowerCase() || null;
      return {
        kind: 'file',
        ext,
        exists: true,
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
      };
    }
  } catch {
    /* missing */
  }
  const ext = path.extname(localPath).toLowerCase() || null;
  return {
    kind: 'missing',
    ext,
    exists: false,
    mtimeMs: null,
    sizeBytes: null,
  };
}

export async function enrichHrDocLink(
  doc: HrDocLink
): Promise<HrDocLinkEnriched> {
  const probe = await probePath(doc.local_path);
  const preview = previewModeForPath(doc.local_path || '', probe.kind);
  const openable =
    probe.exists &&
    ((probe.kind === 'file' &&
      Boolean(doc.local_path && isHrBibliotecaOpenable(doc.local_path))) ||
      probe.kind === 'folder');
  return {
    ...doc,
    ...probe,
    preview,
    openable,
  };
}

export async function enrichHrDocLinks(
  docs: HrDocLink[]
): Promise<HrDocLinkEnriched[]> {
  return Promise.all(docs.map((d) => enrichHrDocLink(d)));
}

function shouldSkipEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIP_NAMES.has(lower)) return true;
  if (name.startsWith('~$') || name.startsWith('.')) return true;
  const ext = path.extname(lower);
  if (SKIP_EXT.has(ext)) return true;
  return false;
}

export async function listHrFolder(
  folderPath: string
): Promise<{ path: string; parent: string | null; items: HrBrowseItem[] }> {
  if (!isUnderHrRoot(folderPath)) {
    throw new Error('Ruta fuera de la biblioteca RH');
  }
  const st = await stat(folderPath);
  if (!st.isDirectory()) {
    throw new Error('No es una carpeta');
  }

  const root = path.resolve(getHrRoot());
  const resolved = path.resolve(folderPath);
  const parent =
    resolved === root ? null : path.dirname(resolved);

  const entries = await readdir(folderPath, { withFileTypes: true });
  const items: HrBrowseItem[] = [];

  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) continue;
    const full = path.join(folderPath, entry.name);
    if (!isUnderHrRoot(full)) continue;

    if (entry.isDirectory()) {
      let mtimeMs: number | null = null;
      try {
        mtimeMs = (await stat(full)).mtimeMs;
      } catch {
        /* ignore */
      }
      items.push({
        name: entry.name,
        path: full,
        kind: 'folder',
        ext: null,
        sizeBytes: null,
        mtimeMs,
        preview: 'folder',
        openable: true,
      });
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase() || null;
    if (ext && SKIP_EXT.has(ext)) continue;
    if (ext && !OPENABLE_EXT.has(ext)) continue;

    let sizeBytes: number | null = null;
    let mtimeMs: number | null = null;
    try {
      const s = await stat(full);
      sizeBytes = s.size;
      mtimeMs = s.mtimeMs;
    } catch {
      /* ignore */
    }

    const preview = previewModeForPath(full, 'file');
    items.push({
      name: entry.name,
      path: full,
      kind: 'file',
      ext,
      sizeBytes,
      mtimeMs,
      preview,
      openable: isHrBibliotecaOpenable(full),
    });
  }

  items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  });

  return { path: folderPath, parent, items };
}

function stripXmlToText(xml: string): string {
  let s = xml
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:tab\s*\/>/gi, '\t')
    .replace(/<w:br\s*\/>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

/**
 * Extrae texto plano de un .docx (ZIP → word/document.xml) sin dependencias.
 * Usa el directorio central; solo store (0) o deflate (8).
 */
export async function extractDocxPlainText(
  filePath: string,
  maxChars = 12_000
): Promise<{ text: string; truncated: boolean } | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.docx') return null;

  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch {
    return null;
  }

  if (buf.length > 8 * 1024 * 1024) {
    // Evitar cargar docs enormes en preview
    return null;
  }

  // End of central directory (busca firma hacia atrás)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdEnd = cdOffset + cdSize;
  if (cdOffset >= buf.length || cdEnd > buf.length) return null;

  const target = 'word/document.xml';
  let xml: string | null = null;
  let pos = cdOffset;

  while (pos + 46 <= cdEnd) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeader = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    if (name !== target) continue;
    if (localHeader + 30 > buf.length) break;

    const localNameLen = buf.readUInt16LE(localHeader + 26);
    const localExtraLen = buf.readUInt16LE(localHeader + 28);
    const dataStart = localHeader + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) break;

    const raw = buf.subarray(dataStart, dataEnd);
    try {
      const inflated =
        method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
      if (inflated) xml = inflated.toString('utf8');
    } catch {
      return null;
    }
    break;
  }

  if (!xml) return null;
  const text = stripXmlToText(xml);
  if (!text) return { text: '', truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars).trimEnd() + '…', truncated: true };
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMtime(mtimeMs: number | null | undefined): string | null {
  if (!mtimeMs) return null;
  try {
    return new Date(mtimeMs).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}
