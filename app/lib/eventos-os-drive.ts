/**
 * Drive API — solo ingest de PDFs de Órdenes de servicio.
 * Consulta/descarga en producción va por Supabase Storage (eventos-os-docs).
 */

import path from 'path';
import {
  createDriveClient,
  friendlyDriveError,
  getGoogleDriveAuthStatus,
} from '@/app/lib/google-drive-auth';

const MIME_FOLDER = 'application/vnd.google-apps.folder';

export function getEventosOsDriveFolderId(): string {
  return process.env.EVENTOS_OS_DRIVE_FOLDER_ID?.trim() || '';
}

export function eventosOsDriveApiAvailable(): boolean {
  return (
    getGoogleDriveAuthStatus().configured &&
    Boolean(getEventosOsDriveFolderId())
  );
}

export function eventosOsDriveUnavailableHint(): string {
  const auth = getGoogleDriveAuthStatus();
  const folderId = getEventosOsDriveFolderId();
  if (!auth.configured) {
    return 'Configura GOOGLE_OAUTH_TOKEN_JSON o GCAL_CLIENT_EMAIL + GCAL_PRIVATE_KEY (scopes drive.readonly).';
  }
  if (!folderId) {
    return 'Define EVENTOS_OS_DRIVE_FOLDER_ID (carpeta «Ordenes de servicio» en Drive).';
  }
  return 'Drive API no disponible para ingest de OS.';
}

function escapeDriveQuery(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listChildren(
  parentId: string
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const drive = createDriveClient();
  const out: Array<{ id: string; name: string; mimeType: string }> = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      pageSize: 200,
      pageToken,
      fields: 'nextPageToken, files(id, name, mimeType)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

async function findChildFolder(
  parentId: string,
  folderName: string
): Promise<{ id: string; name: string } | null> {
  const wanted = folderName.trim().toLowerCase();
  const children = await listChildren(parentId);
  const hit = children.find(
    (c) =>
      c.mimeType === MIME_FOLDER && c.name.trim().toLowerCase() === wanted
  );
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * Resuelve fileId por rel_path tipo `2026/ORDEN DE SERVICIO 02.pdf`
 * (carpeta año bajo Ordenes de servicio + nombre exacto).
 */
export async function resolveOsDriveFileIdByRelPath(
  relPath: string
): Promise<{ fileId: string; name: string } | null> {
  const folderId = getEventosOsDriveFolderId();
  if (!folderId || !getGoogleDriveAuthStatus().configured) return null;

  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!norm.toLowerCase().endsWith('.pdf')) return null;
  const parts = norm.split('/').filter(Boolean);
  if (!parts.length) return null;

  const filename = parts[parts.length - 1];
  const yearSeg =
    parts.length >= 2 && /^\d{4}$/.test(parts[0]) ? parts[0] : null;

  const drive = createDriveClient();
  try {
    let parentId = folderId;
    if (yearSeg) {
      const yearFolder = await findChildFolder(parentId, yearSeg);
      if (!yearFolder) {
        // Fallback: búsqueda global por nombre exacto
        const res = await drive.files.list({
          q: `name = '${escapeDriveQuery(filename)}' and trashed = false`,
          pageSize: 10,
          fields: 'files(id, name, mimeType)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        const hit = (res.data.files || []).find(
          (f) =>
            f.id &&
            f.name === filename &&
            (f.mimeType === 'application/pdf' ||
              (f.name || '').toLowerCase().endsWith('.pdf'))
        );
        return hit?.id ? { fileId: hit.id, name: hit.name || filename } : null;
      }
      parentId = yearFolder.id;
    }

    const children = await listChildren(parentId);
    const file = children.find(
      (c) =>
        c.mimeType !== MIME_FOLDER &&
        c.name === filename &&
        c.name.toLowerCase().endsWith('.pdf')
    );
    if (file) return { fileId: file.id, name: file.name };

    // Nombre exacto en Drive (por si la carpeta año no coincide)
    const res = await drive.files.list({
      q: `name = '${escapeDriveQuery(filename)}' and trashed = false`,
      pageSize: 10,
      fields: 'files(id, name, mimeType)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const hit = (res.data.files || []).find(
      (f) => f.id && f.name === filename
    );
    return hit?.id ? { fileId: hit.id, name: hit.name || filename } : null;
  } catch (e) {
    throw new Error(friendlyDriveError(e));
  }
}

/** Descarga bytes de un PDF en Drive (ingest). */
export async function downloadOsDriveFileBuffer(
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const drive = createDriveClient();
  try {
    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    const name = meta.data.name || 'orden-de-servicio.pdf';
    const mime = meta.data.mimeType || 'application/pdf';
    const media = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    return {
      buffer: Buffer.from(media.data as ArrayBuffer),
      mimeType: mime.startsWith('application/') ? mime : 'application/pdf',
      name,
    };
  } catch (e) {
    throw new Error(friendlyDriveError(e));
  }
}

/** Ingest: resuelve rel_path y descarga buffer. */
export async function downloadOsPdfFromDriveByRelPath(
  relPath: string
): Promise<{
  buffer: Buffer;
  mimeType: string;
  name: string;
  driveFileId: string;
} | null> {
  const resolved = await resolveOsDriveFileIdByRelPath(relPath);
  if (!resolved) return null;
  const dl = await downloadOsDriveFileBuffer(resolved.fileId);
  return {
    ...dl,
    driveFileId: resolved.fileId,
    name: dl.name || path.basename(relPath),
  };
}
