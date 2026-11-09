/**
 * Archivo de fotos TPV > N días: Storage → Drive (admin@) → borrar Storage.
 * Metadata permanece en tpv_corte_uploads para historial Master.
 */

import { Readable } from 'stream';
import { getServiceSupabase } from '@/app/lib/users';
import {
  createDriveWriteClient,
  getGoogleDriveWriteStatus,
  tpvArchiveFolderId,
} from '@/app/lib/google-drive-write';
import {
  TPV_ARCHIVE_AFTER_DAYS,
  TPV_STORAGE_BUCKET,
  asTpvRow,
  shiftIsoDate,
  todayCdmxIso,
  type TpvCorteUpload,
} from '@/app/lib/tpv-cortes';

export type TpvArchiveResult = {
  ok: boolean;
  cutoffDate: string;
  candidates: number;
  archived: number;
  skipped: number;
  errors: string[];
  bytesFreed: number;
  driveStatus: string;
};

function cutoffDateCdmx(days = TPV_ARCHIVE_AFTER_DAYS): string {
  return shiftIsoDate(todayCdmxIso(), -days);
}

/** Adjunta image_url (Storage firmado o Drive) a filas. */
export async function attachTpvImageUrls(
  rows: TpvCorteUpload[]
): Promise<void> {
  const sb = getServiceSupabase();
  await Promise.all(
    rows.map(async (row) => {
      if (row.archive_status === 'drive' && row.drive_web_view_link) {
        row.image_url = row.drive_web_view_link;
        return;
      }
      if (!row.storage_path) {
        row.image_url = null;
        return;
      }
      const { data: signed } = await sb.storage
        .from(TPV_STORAGE_BUCKET)
        .createSignedUrl(row.storage_path, 60 * 30);
      row.image_url = signed?.signedUrl || null;
    })
  );
}

async function ensureYearMonthFolder(
  drive: ReturnType<typeof createDriveWriteClient>,
  parentId: string,
  year: string,
  month: string
): Promise<string> {
  const yearName = year;
  const monthName = `${year}-${month}`;

  async function findOrCreate(name: string, parent: string): Promise<string> {
    const q = [
      `'${parent}' in parents`,
      `name = '${name.replace(/'/g, "\\'")}'`,
      'mimeType = \'application/vnd.google-apps.folder\'',
      'trashed = false',
    ].join(' and ');
    const listed = await drive.files.list({
      q,
      fields: 'files(id,name)',
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const existing = listed.data.files?.[0]?.id;
    if (existing) return existing;
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parent],
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    if (!created.data.id) throw new Error(`No se pudo crear carpeta ${name}`);
    return created.data.id;
  }

  const yearId = await findOrCreate(yearName, parentId);
  return findOrCreate(monthName, yearId);
}

/**
 * Mueve a Drive fotos hot con corte_date < hoy−60d y borra de Storage.
 * dryRun: solo cuenta candidatos.
 */
export async function archiveOldTpvPhotos(opts?: {
  dryRun?: boolean;
  limit?: number;
  olderThanDays?: number;
}): Promise<TpvArchiveResult> {
  const days = opts?.olderThanDays ?? TPV_ARCHIVE_AFTER_DAYS;
  const cutoff = cutoffDateCdmx(days);
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 80));
  const writeStatus = getGoogleDriveWriteStatus();
  const folderId = tpvArchiveFolderId();
  const errors: string[] = [];

  if (!writeStatus.configured) {
    return {
      ok: false,
      cutoffDate: cutoff,
      candidates: 0,
      archived: 0,
      skipped: 0,
      errors: [writeStatus.message],
      bytesFreed: 0,
      driveStatus: writeStatus.message,
    };
  }
  if (!folderId) {
    return {
      ok: false,
      cutoffDate: cutoff,
      candidates: 0,
      archived: 0,
      skipped: 0,
      errors: [
        'Falta TPV_ARCHIVE_DRIVE_FOLDER_ID (carpeta en Drive de admin@carranza50.com.mx).',
      ],
      bytesFreed: 0,
      driveStatus: writeStatus.message,
    };
  }

  const sb = getServiceSupabase();
  const { data: raw, error } = await sb
    .from('tpv_corte_uploads')
    .select('*')
    .eq('entry_kind', 'photo')
    .eq('archive_status', 'hot')
    .lt('corte_date', cutoff)
    .not('storage_path', 'is', null)
    .order('corte_date', { ascending: true })
    .limit(limit);

  if (error) {
    // Columna archive_status ausente → hay que correr SQL
    return {
      ok: false,
      cutoffDate: cutoff,
      candidates: 0,
      archived: 0,
      skipped: 0,
      errors: [
        error.message.includes('archive_status')
          ? 'Falta schema: ejecuta supabase/tpv_cortes_archive.sql en SQL Editor.'
          : error.message,
      ],
      bytesFreed: 0,
      driveStatus: writeStatus.message,
    };
  }

  const rows = (raw || []).map((r) => asTpvRow(r as Record<string, unknown>));
  if (opts?.dryRun) {
    const bytes = rows.reduce((s, r) => s + (r.byte_size || 0), 0);
    return {
      ok: true,
      cutoffDate: cutoff,
      candidates: rows.length,
      archived: 0,
      skipped: 0,
      errors: [],
      bytesFreed: bytes,
      driveStatus: writeStatus.message,
    };
  }

  let drive: ReturnType<typeof createDriveWriteClient>;
  try {
    drive = createDriveWriteClient();
  } catch (e) {
    return {
      ok: false,
      cutoffDate: cutoff,
      candidates: rows.length,
      archived: 0,
      skipped: 0,
      errors: [e instanceof Error ? e.message : 'No se pudo autenticar Drive'],
      bytesFreed: 0,
      driveStatus: writeStatus.message,
    };
  }

  let archived = 0;
  let skipped = 0;
  let bytesFreed = 0;
  const folderCache = new Map<string, string>();

  for (const row of rows) {
    if (!row.storage_path) {
      skipped += 1;
      continue;
    }
    try {
      const [y, m] = row.corte_date.split('-');
      const cacheKey = `${y}-${m}`;
      let destFolder = folderCache.get(cacheKey);
      if (!destFolder) {
        destFolder = await ensureYearMonthFolder(drive, folderId, y!, m!);
        folderCache.set(cacheKey, destFolder);
      }

      const dl = await sb.storage
        .from(TPV_STORAGE_BUCKET)
        .download(row.storage_path);
      if (dl.error || !dl.data) {
        errors.push(`${row.id}: download ${dl.error?.message || 'vacío'}`);
        skipped += 1;
        continue;
      }
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const ext =
        row.mime_type?.includes('png')
          ? 'png'
          : row.mime_type?.includes('webp')
            ? 'webp'
            : 'jpg';
      const name = `${row.corte_date}_T${row.terminal_number}_${row.photo_kind || 'foto'}_${row.id.slice(0, 8)}.${ext}`;

      const created = await drive.files.create({
        requestBody: {
          name,
          parents: [destFolder],
          description: `Cortes TPV archivo · ${row.corte_date} · T${row.terminal_number} · ${row.photo_kind}`,
        },
        media: {
          mimeType: row.mime_type || 'image/jpeg',
          body: Readable.from(buf),
        },
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      });

      const fileId = created.data.id;
      const webLink = created.data.webViewLink || null;
      if (!fileId) {
        errors.push(`${row.id}: Drive no devolvió id`);
        skipped += 1;
        continue;
      }

      const now = new Date().toISOString();
      const { error: upErr } = await sb
        .from('tpv_corte_uploads')
        .update({
          archive_status: 'drive',
          drive_file_id: fileId,
          drive_web_view_link: webLink,
          archived_at: now,
          storage_path: null,
          updated_at: now,
        })
        .eq('id', row.id);

      if (upErr) {
        errors.push(`${row.id}: update DB ${upErr.message}`);
        skipped += 1;
        continue;
      }

      await sb.storage.from(TPV_STORAGE_BUCKET).remove([row.storage_path]);
      archived += 1;
      bytesFreed += row.byte_size || buf.length;
    } catch (e) {
      errors.push(
        `${row.id}: ${e instanceof Error ? e.message : String(e)}`
      );
      skipped += 1;
    }
  }

  return {
    ok: errors.length === 0,
    cutoffDate: cutoff,
    candidates: rows.length,
    archived,
    skipped,
    errors: errors.slice(0, 20),
    bytesFreed,
    driveStatus: writeStatus.message,
  };
}
