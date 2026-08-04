/**
 * Expedientes RH vía Google Drive API (sin File Stream / I:\).
 * Lista y descarga PDFs bajo HR_EXPEDIENTES_DRIVE_FOLDER_ID → Storage.
 */

import {
  createDriveClient,
  friendlyDriveError,
  getGoogleDriveAuthStatus,
} from '@/app/lib/google-drive-auth';
import { HR_EXPEDIENTES_DRIVE_FOLDER_ID } from '@/app/lib/hr';
import {
  canonicalHrEmployeeName,
  folderBasenameFromPath,
  matchPerson,
} from '@/app/lib/hr-person-match';
import { getServiceSupabase } from '@/app/lib/users';

const MIME_FOLDER = 'application/vnd.google-apps.folder';

export type HrDriveListedFile = {
  /** Nombre del archivo. */
  name: string;
  /**
   * Ruta sintética con segmentos de carpeta (p. ej. `drive:/Contrato/x.pdf`)
   * para que clasificadores de Contrato/Gastos médicos sigan funcionando.
   */
  path: string;
  sizeBytes: number | null;
  fileId: string;
  mimeType: string;
};

export function getHrExpedientesDriveFolderId(): string {
  return (
    process.env.HR_EXPEDIENTES_DRIVE_FOLDER_ID?.trim() ||
    HR_EXPEDIENTES_DRIVE_FOLDER_ID ||
    ''
  );
}

/** True si hay credenciales Google + folder ID de expedientes. */
export function expedienteDriveApiAvailable(): boolean {
  const folderId = getHrExpedientesDriveFolderId();
  if (!folderId) return false;
  return getGoogleDriveAuthStatus().configured;
}

export function expedienteDriveUnavailableHint(): string {
  const auth = getGoogleDriveAuthStatus();
  const folderId = getHrExpedientesDriveFolderId();
  if (!auth.configured) {
    return 'Configura GOOGLE_OAUTH_TOKEN_JSON o GCAL_CLIENT_EMAIL + GCAL_PRIVATE_KEY (scopes drive.readonly).';
  }
  if (!folderId) {
    return 'Define HR_EXPEDIENTES_DRIVE_FOLDER_ID (carpeta «Expedientes personal C50» en Drive).';
  }
  return 'Drive API no disponible.';
}

async function listDriveChildren(
  parentId: string
): Promise<
  Array<{
    id: string;
    name: string;
    mimeType: string;
    size: string | null | undefined;
  }>
> {
  const drive = createDriveClient();
  const out: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: string | null | undefined;
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

/** Busca subcarpeta por nombre (case/acento flexible). */
async function findChildFolder(
  parentId: string,
  wantedNames: string[]
): Promise<{ id: string; name: string } | null> {
  const children = await listDriveChildren(parentId);
  const norms = wantedNames.map((n) =>
    n
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  );
  for (const c of children) {
    if (c.mimeType !== MIME_FOLDER) continue;
    const n = c.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    if (norms.includes(n)) return { id: c.id, name: c.name };
  }
  return null;
}

/**
 * Lista archivos bajo una carpeta Drive (hasta 3 niveles), con path sintético.
 */
export async function listDriveFilesRecursive(
  folderId: string,
  relPrefix = 'drive:',
  depth = 0
): Promise<HrDriveListedFile[]> {
  const children = await listDriveChildren(folderId);
  const files: HrDriveListedFile[] = [];
  for (const c of children) {
    if (c.mimeType === MIME_FOLDER) {
      if (depth >= 3) continue;
      const nested = await listDriveFilesRecursive(
        c.id,
        `${relPrefix}/${c.name}`,
        depth + 1
      );
      files.push(...nested);
      continue;
    }
    // Google Docs exportables → se tratan por nombre; binarios nativos OK.
    const size =
      c.size != null && c.size !== '' ? Number(c.size) : null;
    files.push({
      name: c.name,
      path: `${relPrefix}/${c.name}`,
      sizeBytes: Number.isFinite(size) ? size : null,
      fileId: c.id,
      mimeType: c.mimeType,
    });
  }
  return files;
}

export async function downloadDriveFileBuffer(
  fileId: string,
  mimeType?: string
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const drive = createDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });
  const name = meta.data.name || 'file';
  const mime = mimeType || meta.data.mimeType || 'application/octet-stream';

  // Docs/Sheets nativos: exportar PDF si hace falta (expedientes suelen ser PDF/imagen).
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

  const media = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return {
    buffer: Buffer.from(media.data as ArrayBuffer),
    mimeType: mime,
    name,
  };
}

/**
 * Resuelve carpeta Drive del empleado bajo Altas/Bajas (por basename o nombre).
 * Persiste drive_folder_path si faltaba (path lógico, no I:\).
 */
export async function resolveExpedienteDriveFolder(opts: {
  employeeId: string;
  fullName: string;
  driveFolderPath?: string | null;
  syncName?: boolean;
}): Promise<{ folderId: string; folderName: string; logicalPath: string } | null> {
  const rootId = getHrExpedientesDriveFolderId();
  if (!rootId || !getGoogleDriveAuthStatus().configured) return null;

  const existing = (opts.driveFolderPath || '').trim();
  const basename =
    folderBasenameFromPath(existing) ||
    String(opts.fullName || '').replace(/\s+/g, ' ').trim();
  if (!basename) return null;

  try {
    const buckets: Array<{ kind: 'altas' | 'bajas'; folder: { id: string; name: string } }> =
      [];
    for (const wanted of [
      { kind: 'altas' as const, names: ['Altas', 'ALTAS', 'alta'] },
      { kind: 'bajas' as const, names: ['Bajas', 'BAJAS', 'baja'] },
    ]) {
      const hit = await findChildFolder(rootId, wanted.names);
      if (hit) buckets.push({ kind: wanted.kind, folder: hit });
    }
    // Si no hay Altas/Bajas, buscar directo en la raíz.
    if (!buckets.length) {
      buckets.push({
        kind: 'altas',
        folder: { id: rootId, name: 'Expedientes' },
      });
    }

    const candidate = {
      id: opts.employeeId,
      full_name: opts.fullName,
      aliases: [basename].filter(Boolean),
    };

    for (const bucket of buckets) {
      const children = await listDriveChildren(bucket.folder.id);
      for (const c of children) {
        if (c.mimeType !== MIME_FOLDER) continue;
        const m = matchPerson(c.name, [candidate]);
        if (
          m.employeeId === opts.employeeId &&
          (m.autoLink ||
            m.confidence === 'exact' ||
            m.confidence === 'high')
        ) {
          const logicalPath =
            existing ||
            `Drive:/RH/Expedientes personal C50/${bucket.folder.name}/${c.name}`;
          const syncName = opts.syncName !== false;
          try {
            const sb = getServiceSupabase();
            const patch: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            };
            if (!existing) patch.drive_folder_path = logicalPath;
            if (syncName) {
              const canonical = canonicalHrEmployeeName(c.name, opts.fullName);
              const cur = String(opts.fullName || '')
                .replace(/\s+/g, ' ')
                .trim();
              if (canonical && canonical !== cur) patch.full_name = canonical;
            }
            if (Object.keys(patch).length > 1) {
              await sb
                .from('hr_employees')
                .update(patch)
                .eq('id', opts.employeeId);
            }
          } catch {
            /* best-effort */
          }
          return {
            folderId: c.id,
            folderName: c.name,
            logicalPath,
          };
        }
      }
    }
  } catch (e) {
    throw new Error(friendlyDriveError(e));
  }
  return null;
}
