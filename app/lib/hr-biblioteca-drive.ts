/**
 * Biblioteca RH vía Drive API cuando no hay File Stream.
 * Abre/lista bajo HR_DOCS_VIGENTE_DRIVE_FOLDER_ID (y opcionales perfiles/exámenes).
 */

import path from 'path';
import {
  createDriveClient,
  friendlyDriveError,
  getGoogleDriveAuthStatus,
} from '@/app/lib/google-drive-auth';
import {
  HR_DOCS_VIGENTE_DIR,
  HR_DOCS_VIGENTE_DRIVE_FOLDER_ID,
  hrDriveFolderUrl,
  type HrDocLink,
} from '@/app/lib/hr';
import {
  getHrRoot,
  previewModeForPath,
  type HrBrowseItem,
} from '@/app/lib/hr-biblioteca';
import { driveFileWebUrl } from '@/app/lib/local-fs';

const MIME_FOLDER = 'application/vnd.google-apps.folder';

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function getHrDocsVigenteDriveFolderId(): string {
  return (
    process.env.HR_DOCS_VIGENTE_DRIVE_FOLDER_ID?.trim() ||
    HR_DOCS_VIGENTE_DRIVE_FOLDER_ID ||
    ''
  );
}

export function getHrPerfilesDriveFolderId(): string {
  return process.env.HR_PERFILES_DRIVE_FOLDER_ID?.trim() || '';
}

export function getHrExamenesDriveFolderId(): string {
  return process.env.HR_EXAMENES_DRIVE_FOLDER_ID?.trim() || '';
}

export function bibliotecaDriveApiAvailable(): boolean {
  if (!getGoogleDriveAuthStatus().configured) return false;
  return Boolean(
    getHrDocsVigenteDriveFolderId() ||
      getHrPerfilesDriveFolderId() ||
      getHrExamenesDriveFolderId()
  );
}

/** Adjunta drive_url de carpetas conocidas si falta en el catálogo. */
export function attachDefaultDriveUrls<T extends HrDocLink>(docs: T[]): T[] {
  const vigenteId = getHrDocsVigenteDriveFolderId();
  const vigenteUrl = hrDriveFolderUrl(vigenteId);
  const perfilesUrl = hrDriveFolderUrl(getHrPerfilesDriveFolderId());
  const examenesUrl = hrDriveFolderUrl(getHrExamenesDriveFolderId());

  return docs.map((d) => {
    if (d.drive_url) return d;
    const lp = (d.local_path || '').replace(/\//g, '\\');
    const title = norm(d.title || '');
    if (
      vigenteUrl &&
      (lp.includes('Documentación vigente') ||
        title.includes('documentacion vigente') ||
        title.includes('politica') ||
        title.includes('reglamento') ||
        title.includes('manual'))
    ) {
      return { ...d, drive_url: vigenteUrl };
    }
    if (
      perfilesUrl &&
      (lp.includes('Perfiles por posición') || title.includes('perfiles'))
    ) {
      return { ...d, drive_url: perfilesUrl };
    }
    if (
      examenesUrl &&
      (lp.includes('Exámenes piso') ||
        lp.includes('Examenes piso') ||
        title.includes('examenes'))
    ) {
      return { ...d, drive_url: examenesUrl };
    }
    return d;
  });
}

function folderIdForLocalPath(localPath: string): string | null {
  const lp = localPath.replace(/\//g, '\\');
  if (lp.includes('Documentación vigente') || lp === HR_DOCS_VIGENTE_DIR) {
    return getHrDocsVigenteDriveFolderId() || null;
  }
  if (lp.includes('Perfiles por posición')) {
    return getHrPerfilesDriveFolderId() || null;
  }
  if (/Ex[aá]menes?\s+piso/i.test(lp)) {
    return getHrExamenesDriveFolderId() || null;
  }
  // Hijo de Documentación vigente
  const root = getHrRoot();
  try {
    const rel = path.relative(root, localPath);
    if (rel && !rel.startsWith('..') && /Documentaci[oó]n vigente/i.test(rel)) {
      return getHrDocsVigenteDriveFolderId() || null;
    }
  } catch {
    /* ignore */
  }
  return getHrDocsVigenteDriveFolderId() || null;
}

async function listChildren(parentId: string) {
  const drive = createDriveClient();
  const out: Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: string | null;
  }> = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      pageSize: 200,
      pageToken,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      out.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
      });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

export async function listDriveFolderAsBrowseItems(
  folderId: string
): Promise<HrBrowseItem[]> {
  const children = await listChildren(folderId);
  return children
    .filter((c) => !/^(desktop\.ini|thumbs\.db)$/i.test(c.name))
    .map((c) => {
      const isFolder = c.mimeType === MIME_FOLDER;
      const kind = isFolder ? ('folder' as const) : ('file' as const);
      const ext = isFolder ? null : path.extname(c.name).toLowerCase() || null;
      const size = c.size != null && c.size !== '' ? Number(c.size) : null;
      const itemPath = isFolder
        ? `drive:folder:${c.id}`
        : `drive:file:${c.id}`;
      return {
        name: c.name,
        path: itemPath,
        kind,
        ext,
        sizeBytes: Number.isFinite(size) ? size : null,
        mtimeMs: null,
        preview: previewModeForPath(c.name, kind),
        openable: true,
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'es');
    });
}

/** Lista carpeta Drive mapeada desde path local o token `drive:folder:ID`. */
export async function browseBibliotecaDriveFolder(
  localPathOrToken: string
): Promise<{
  path: string;
  parent: string | null;
  items: HrBrowseItem[];
  driveUrl: string | null;
}> {
  const tokenMatch = /^drive:folder:(.+)$/.exec(localPathOrToken);
  const folderId = tokenMatch
    ? tokenMatch[1]
    : folderIdForLocalPath(localPathOrToken);
  if (!folderId) {
    throw new Error(
      'Sin folder ID de Drive para esta carpeta. Define HR_DOCS_VIGENTE_DRIVE_FOLDER_ID (u otros).'
    );
  }
  try {
    const items = await listDriveFolderAsBrowseItems(folderId);
    return {
      path: localPathOrToken,
      parent: null,
      items,
      driveUrl: hrDriveFolderUrl(folderId),
    };
  } catch (e) {
    throw new Error(friendlyDriveError(e));
  }
}

export async function downloadBibliotecaDriveByToken(
  token: string
): Promise<{ buffer: Buffer; mimeType: string; name: string } | null> {
  const fileMatch = /^drive:file:(.+)$/.exec(token);
  if (!fileMatch) return null;
  const fileId = fileMatch[1];
  const drive = createDriveClient();
  try {
    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    const name = meta.data.name || 'file';
    const mime = meta.data.mimeType || 'application/octet-stream';
    if (mime === 'application/vnd.google-apps.document') {
      const exported = await drive.files.export(
        { fileId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );
      return {
        buffer: Buffer.from(exported.data as ArrayBuffer),
        mimeType: 'application/pdf',
        name: name.replace(/\.[^.]+$/, '') + '.pdf',
      };
    }
    if (mime.startsWith('application/vnd.google-apps.')) {
      return null;
    }
    const media = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    return {
      buffer: Buffer.from(media.data as ArrayBuffer),
      mimeType: mime,
      name,
    };
  } catch (e) {
    throw new Error(friendlyDriveError(e));
  }
}

/** Busca archivo por basename bajo Documentación vigente (u otra carpeta). */
export async function findAndDownloadBibliotecaFile(
  localPath: string
): Promise<{
  buffer: Buffer;
  mimeType: string;
  name: string;
  driveUrl: string | null;
} | null> {
  const base = path.basename(localPath);
  if (!base) return null;
  const folderId = folderIdForLocalPath(localPath);
  if (!folderId || !getGoogleDriveAuthStatus().configured) return null;

  const drive = createDriveClient();
  const wanted = norm(base);
  try {
    // Búsqueda directa por nombre en Drive (más rápido que walk).
    const res = await drive.files.list({
      q: `name = '${base.replace(/'/g, "\\'")}' and trashed = false`,
      pageSize: 10,
      fields: 'files(id, name, mimeType, parents)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    let hit = (res.data.files || []).find((f) => f.id && norm(f.name || '') === wanted);
    if (!hit?.id) {
      // Walk 1 nivel
      const children = await listChildren(folderId);
      const child = children.find((c) => norm(c.name) === wanted);
      if (child) {
        hit = { id: child.id, name: child.name, mimeType: child.mimeType };
      }
    }
    if (!hit?.id) return null;

    const dl = await downloadBibliotecaDriveByToken(`drive:file:${hit.id}`);
    if (!dl) return null;
    return {
      ...dl,
      driveUrl: driveFileWebUrl(hit.id),
    };
  } catch (e) {
    throw new Error(friendlyDriveError(e));
  }
}
