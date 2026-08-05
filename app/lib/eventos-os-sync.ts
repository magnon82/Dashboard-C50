/**
 * Sync OS PDF → event_os_documents + Storage.
 * Fuentes de bytes: File Stream local (prioridad) o Drive API (ingest).
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  downloadOsPdfFromDriveByRelPath,
  eventosOsDriveApiAvailable,
  eventosOsDriveUnavailableHint,
} from '@/app/lib/eventos-os-drive';
import {
  getOsDocumentByRelPath,
  isMissingOsDocsTable,
  markOsDocumentMissing,
  markOsDocumentUploaded,
  normalizeOsRelPath,
  uploadOsPdfToStorage,
  upsertOsDocumentMeta,
  type EventOsDocSource,
  type EventOsDocumentRow,
} from '@/app/lib/eventos-os-documents';
import {
  getEventosOsRoot,
  isUnderOsRoot,
  listEventOs,
  type EventOsItem,
} from '@/app/lib/eventos-os';
import { localDriveFsEnabled } from '@/app/lib/local-fs';

export type SyncOsPdfsResult = {
  ready: boolean;
  upserted: number;
  uploaded: number;
  skipped: number;
  missing: number;
  errors: string[];
  hint: string | null;
  message: string;
};

async function readLocalOsPdf(
  item: EventOsItem,
  root: string
): Promise<Buffer | null> {
  if (!localDriveFsEnabled()) return null;
  const candidates: string[] = [];
  if (item.path) candidates.push(item.path);
  if (item.rel_path) {
    candidates.push(path.join(root, ...normalizeOsRelPath(item.rel_path).split('/')));
  }
  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    if (!isUnderOsRoot(p, root)) continue;
    if (!p.toLowerCase().endsWith('.pdf')) continue;
    try {
      return await readFile(p);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function ingestOne(
  sb: SupabaseClient,
  item: EventOsItem,
  root: string,
  force: boolean
): Promise<'uploaded' | 'skipped' | 'missing' | 'error'> {
  const rel = normalizeOsRelPath(item.rel_path || '');
  if (!rel || !rel.toLowerCase().endsWith('.pdf')) return 'skipped';

  const existing = await getOsDocumentByRelPath(sb, rel);
  if (existing?.status === 'uploaded' && existing.storage_path && !force) {
    return 'skipped';
  }

  const meta = await upsertOsDocumentMeta(sb, {
    rel_path: rel,
    filename: item.filename || path.basename(rel),
    folio: item.folio,
    year: item.year,
    event_date: item.event_date,
    label: item.label,
    matched_client_name: item.matched_client_name || null,
    source: (item.source === 'scan' ? 'scan' : 'activity_seed') as EventOsDocSource,
  });
  if (!meta) return 'error';

  let buffer: Buffer | null = await readLocalOsPdf(item, root);
  let driveFileId: string | null = null;
  let source: EventOsDocSource =
    item.source === 'scan' ? 'scan' : 'activity_seed';

  if (!buffer && eventosOsDriveApiAvailable()) {
    try {
      const dl = await downloadOsPdfFromDriveByRelPath(rel);
      if (dl) {
        buffer = dl.buffer;
        driveFileId = dl.driveFileId;
        source = 'drive';
      }
    } catch {
      buffer = null;
    }
  }

  if (!buffer) {
    await markOsDocumentMissing(sb, rel);
    return 'missing';
  }

  try {
    const up = await uploadOsPdfToStorage(sb, rel, buffer, 'application/pdf');
    const marked = await markOsDocumentUploaded(sb, {
      rel_path: rel,
      storage_path: up.storage_path,
      mime_type: 'application/pdf',
      byte_size: up.byte_size,
      checksum_sha256: up.checksum,
      drive_file_id: driveFileId,
      source,
    });
    return marked ? 'uploaded' : 'error';
  } catch {
    return 'error';
  }
}

/**
 * Homogeniza índice (scan/seed) en DB y sube binarios faltantes a Storage.
 */
export async function syncEventOsPdfs(
  sb: SupabaseClient,
  opts?: {
    limit?: number;
    force?: boolean;
    year?: number;
    q?: string;
    /** Solo metadata, sin bajar/subir bytes */
    metaOnly?: boolean;
  }
): Promise<SyncOsPdfsResult> {
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 200);
  const force = Boolean(opts?.force);
  const errors: string[] = [];

  // Probe tabla
  const probe = await sb.from('event_os_documents').select('id').limit(1);
  if (probe.error && isMissingOsDocsTable(probe.error.message)) {
    return {
      ready: false,
      upserted: 0,
      uploaded: 0,
      skipped: 0,
      missing: 0,
      errors: [probe.error.message],
      hint: 'Ejecuta supabase/eventos_os_documents.sql en Supabase SQL Editor.',
      message: 'Tabla event_os_documents no existe aún.',
    };
  }

  let listed: EventOsItem[] = [];
  try {
    const res = await listEventOs({
      year: opts?.year,
      q: opts?.q,
    });
    listed = res.items.filter((it) =>
      (it.filename || it.rel_path || '').toLowerCase().endsWith('.pdf')
    );
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'Error al listar OS PDF');
  }

  const root = getEventosOsRoot();
  let upserted = 0;
  let uploaded = 0;
  let skipped = 0;
  let missing = 0;
  let processed = 0;

  for (const item of listed) {
    if (processed >= limit) break;
    const rel = normalizeOsRelPath(item.rel_path || '');
    if (!rel) continue;

    if (opts?.metaOnly) {
      const row = await upsertOsDocumentMeta(sb, {
        rel_path: rel,
        filename: item.filename || path.basename(rel),
        folio: item.folio,
        year: item.year,
        event_date: item.event_date,
        label: item.label,
        matched_client_name: item.matched_client_name || null,
        source: item.source === 'scan' ? 'scan' : 'activity_seed',
      });
      if (row) upserted += 1;
      processed += 1;
      continue;
    }

    processed += 1;
    const result = await ingestOne(sb, item, root, force);
    if (result === 'uploaded') {
      uploaded += 1;
      upserted += 1;
    } else if (result === 'skipped') {
      skipped += 1;
    } else if (result === 'missing') {
      missing += 1;
      upserted += 1;
    } else {
      errors.push(`No se pudo subir: ${rel}`);
    }
  }

  const canIngest =
    localDriveFsEnabled() || eventosOsDriveApiAvailable();
  let hint: string | null = null;
  if (!canIngest && uploaded === 0 && missing > 0) {
    hint = localDriveFsEnabled()
      ? null
      : eventosOsDriveUnavailableHint();
  }

  const message = [
    `Índice ${upserted || listed.length} · subidos ${uploaded} · omitidos ${skipped} · faltantes ${missing}`,
    processed < listed.length
      ? `(lote ${processed}/${listed.length}; vuelve a sincronizar)`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    ready: true,
    upserted,
    uploaded,
    skipped,
    missing,
    errors: errors.slice(0, 8),
    hint,
    message,
  };
}

/** Backfill on-demand de un rel_path (open); persiste en Storage y devuelve la fila. */
export async function ensureOsPdfInStorage(
  sb: SupabaseClient,
  relPath: string,
  opts?: { localPath?: string | null }
): Promise<EventOsDocumentRow | null> {
  const rel = normalizeOsRelPath(relPath);
  if (!rel || !rel.toLowerCase().endsWith('.pdf')) return null;

  const existing = await getOsDocumentByRelPath(sb, rel);
  if (existing?.status === 'uploaded' && existing.storage_path) {
    return existing;
  }

  const filename = path.basename(rel);
  await upsertOsDocumentMeta(sb, {
    rel_path: rel,
    filename,
    year: /^\d{4}\//.test(rel) ? Number(rel.slice(0, 4)) : null,
    source: 'activity_seed',
  });

  const root = getEventosOsRoot();
  const fakeItem: EventOsItem = {
    id: `ensure:${rel}`,
    filename,
    path: opts?.localPath || '',
    rel_path: rel,
    label: null,
    folio: null,
    year: /^\d{4}\//.test(rel) ? Number(rel.slice(0, 4)) : null,
    event_date: null,
    activity_date: null,
    mtimeMs: 0,
    source: 'activity_seed',
  };

  const result = await ingestOne(sb, fakeItem, root, true);
  if (result !== 'uploaded') return null;
  return getOsDocumentByRelPath(sb, rel);
}
