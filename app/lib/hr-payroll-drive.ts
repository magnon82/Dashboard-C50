/**
 * Nómina desde Google Drive (carpeta compartida RH).
 * Lista hojas de cálculo / xlsx, descarga o exporta, y reutiliza el parser xlsx.
 */

import { access } from 'fs/promises';
import {
  createDriveClient,
  getGoogleDriveAuthStatus,
} from '@/app/lib/google-drive-auth';
import {
  HR_BASE_DATOS_XLSX,
  HR_NOMINA_DRIVE_FOLDER_ID,
  type HrNominaSheetInfo,
  type HrPayrollLineInput,
} from '@/app/lib/hr-payroll';
import {
  importNominaSheet,
  listNominaSheets,
  parseBaseDatosPersonal,
  pickLatestNominaSheet,
  type BaseDatosRow,
} from '@/app/lib/hr-payroll-import';

const MIME_SHEETS = 'application/vnd.google-apps.spreadsheet';
const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_XLS = 'application/vnd.ms-excel';

export type HrDriveNominaFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
};

export type HrDrivePayrollProbe = {
  driveConfigured: boolean;
  driveConnected: boolean;
  driveFolderId: string;
  driveFiles: HrDriveNominaFile[];
  selectedFileId: string | null;
  selectedFileName: string | null;
  sheets: HrNominaSheetInfo[];
  suggestedSheet: string | null;
  baseDatosOk: boolean;
  note?: string;
  error?: string;
};

async function localPathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function getHrNominaDriveFolderId(): string {
  return (
    process.env.HR_NOMINA_DRIVE_FOLDER_ID?.trim() || HR_NOMINA_DRIVE_FOLDER_ID
  );
}

function isNominaMime(mime: string): boolean {
  return (
    mime === MIME_SHEETS ||
    mime === MIME_XLSX ||
    mime === MIME_XLS ||
    /\.xlsx?$/i.test(mime)
  );
}

export async function listNominaDriveFiles(
  folderId = getHrNominaDriveFolderId()
): Promise<HrDriveNominaFile[]> {
  const drive = createDriveClient();
  const q = [
    `'${folderId}' in parents`,
    'trashed = false',
    `(mimeType = '${MIME_SHEETS}' or mimeType = '${MIME_XLSX}' or mimeType = '${MIME_XLS}')`,
  ].join(' and ');

  const files: HrDriveNominaFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q,
      pageSize: 100,
      pageToken,
      orderBy: 'modifiedTime desc',
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      if (!f.id || !f.name || !f.mimeType) continue;
      if (!isNominaMime(f.mimeType) && !/\.xlsx?$/i.test(f.name)) continue;
      files.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime || null,
      });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  files.sort((a, b) => {
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return tb - ta;
  });

  return files;
}

/** Descarga xlsx nativo o exporta Google Sheet → xlsx. */
export async function downloadDriveNominaBuffer(
  fileId: string,
  mimeType?: string
): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  const drive = createDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true,
  });
  const name = meta.data.name || 'nomina.xlsx';
  const mime = mimeType || meta.data.mimeType || MIME_XLSX;

  if (mime === MIME_SHEETS) {
    const exported = await drive.files.export(
      { fileId, mimeType: MIME_XLSX },
      { responseType: 'arraybuffer' }
    );
    const data = exported.data as ArrayBuffer;
    return { buffer: Buffer.from(data), name, mimeType: mime };
  }

  const media = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const data = media.data as ArrayBuffer;
  return { buffer: Buffer.from(data), name, mimeType: mime };
}

export async function listSheetsFromDriveFile(
  fileId: string
): Promise<{
  file: HrDriveNominaFile;
  sheets: HrNominaSheetInfo[];
  buffer: Buffer;
}> {
  const { buffer, name, mimeType } = await downloadDriveNominaBuffer(fileId);
  const sheets = listNominaSheets(buffer);
  return {
    file: {
      id: fileId,
      name,
      mimeType,
      modifiedTime: null,
    },
    sheets,
    buffer,
  };
}

export async function importNominaFromDrive(
  fileId: string,
  sheetName: string
): Promise<{
  meta: HrNominaSheetInfo;
  lines: HrPayrollLineInput[];
  sourceLabel: string;
  fileName: string;
}> {
  const { buffer, name } = await downloadDriveNominaBuffer(fileId);
  let resolved = sheetName.trim();
  if (!resolved) {
    resolved = pickLatestNominaSheet(listNominaSheets(buffer))?.name || '';
  }
  if (!resolved) {
    throw new Error('No hay hoja SEM legible en el archivo de Drive');
  }
  const parsed = importNominaSheet(buffer, resolved);
  return {
    ...parsed,
    sourceLabel: `Drive:${name}#${resolved}`,
    fileName: name,
  };
}

async function tryParseBaseDatosFromDrive(): Promise<BaseDatosRow[] | null> {
  const folderId = getHrNominaDriveFolderId();
  try {
    const drive = createDriveClient();
    // Buscar en la carpeta de nóminas y, si no, por nombre en Drive
    const queries = [
      `'${folderId}' in parents and trashed = false and name contains 'BASE DATOS'`,
      `trashed = false and name contains 'BASE DATOS PERSONAL' and (mimeType = '${MIME_SHEETS}' or mimeType = '${MIME_XLSX}')`,
    ];
    for (const q of queries) {
      const res = await drive.files.list({
        q,
        pageSize: 5,
        orderBy: 'modifiedTime desc',
        fields: 'files(id, name, mimeType)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const hit = (res.data.files || []).find((f) => f.id);
      if (!hit?.id) continue;
      const { buffer } = await downloadDriveNominaBuffer(
        hit.id,
        hit.mimeType || undefined
      );
      return parseBaseDatosPersonal(buffer);
    }
  } catch {
    return null;
  }
  return null;
}

/** BASE DATOS: Drive si hay, si no archivo local silencioso (sin exponer ruta). */
export async function loadBaseDatosRows(
  filePathOrBuffer?: string | Buffer
): Promise<{ rows: BaseDatosRow[]; source: 'drive' | 'local' | 'upload' }> {
  if (filePathOrBuffer != null && typeof filePathOrBuffer !== 'string') {
    return { rows: parseBaseDatosPersonal(filePathOrBuffer), source: 'upload' };
  }
  if (typeof filePathOrBuffer === 'string' && filePathOrBuffer.trim()) {
    // Solo si el caller pasó un path explícito (API interna); no se muestra en UI.
    try {
      return {
        rows: parseBaseDatosPersonal(filePathOrBuffer),
        source: 'local',
      };
    } catch {
      /* fall through */
    }
  }

  const fromDrive = await tryParseBaseDatosFromDrive();
  if (fromDrive?.length) {
    return { rows: fromDrive, source: 'drive' };
  }

  if (await localPathExists(HR_BASE_DATOS_XLSX)) {
    return {
      rows: parseBaseDatosPersonal(HR_BASE_DATOS_XLSX),
      source: 'local',
    };
  }

  throw new Error(
    'No se encontró BASE DATOS PERSONAL. Súbela a la carpeta de Nóminas en Drive o usa captura manual.'
  );
}

export async function probeBaseDatosAvailable(): Promise<boolean> {
  try {
    const { rows } = await loadBaseDatosRows();
    return rows.length > 0;
  } catch {
    return localPathExists(HR_BASE_DATOS_XLSX);
  }
}

export async function probeDrivePayrollSources(
  preferredFileId?: string | null
): Promise<HrDrivePayrollProbe> {
  const folderId = getHrNominaDriveFolderId();
  const auth = getGoogleDriveAuthStatus();
  const baseDatosOk = await probeBaseDatosAvailable();

  if (!auth.configured) {
    return {
      driveConfigured: false,
      driveConnected: false,
      driveFolderId: folderId,
      driveFiles: [],
      selectedFileId: null,
      selectedFileName: null,
      sheets: [],
      suggestedSheet: null,
      baseDatosOk,
    };
  }

  try {
    const driveFiles = await listNominaDriveFiles(folderId);
    let selected =
      driveFiles.find((f) => f.id === preferredFileId) || driveFiles[0] || null;

    let sheets: HrNominaSheetInfo[] = [];
    if (selected) {
      try {
        const listed = await listSheetsFromDriveFile(selected.id);
        sheets = listed.sheets;
        selected = {
          ...selected,
          name: listed.file.name || selected.name,
        };
      } catch {
        sheets = [];
      }
    }

    const suggested = pickLatestNominaSheet(sheets);

    return {
      driveConfigured: true,
      driveConnected: true,
      driveFolderId: folderId,
      driveFiles,
      selectedFileId: selected?.id ?? null,
      selectedFileName: selected?.name ?? null,
      sheets,
      suggestedSheet: suggested?.name ?? null,
      baseDatosOk,
    };
  } catch {
    // Credenciales / red: lista vacía, sin mensaje al cliente.
    return {
      driveConfigured: true,
      driveConnected: false,
      driveFolderId: folderId,
      driveFiles: [],
      selectedFileId: null,
      selectedFileName: null,
      sheets: [],
      suggestedSheet: null,
      baseDatosOk,
    };
  }
}

export function formatDriveFileLabel(f: HrDriveNominaFile): string {
  if (!f.modifiedTime) return f.name;
  try {
    const d = new Date(f.modifiedTime);
    const label = d.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return `${f.name} · ${label}`;
  } catch {
    return f.name;
  }
}
