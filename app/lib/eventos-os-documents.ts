/**
 * Órdenes de servicio PDF en BMS: tabla event_os_documents + Storage.
 */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const EVENTOS_OS_DOCS_BUCKET = 'eventos-os-docs';

export type EventOsDocStatus = 'index_only' | 'uploaded' | 'missing';
export type EventOsDocSource =
  | 'scan'
  | 'activity_seed'
  | 'drive'
  | 'manual';

export type EventOsDocumentRow = {
  id: string;
  rel_path: string;
  filename: string;
  folio: string | null;
  year: number | null;
  event_date: string | null;
  label: string | null;
  matched_client_name: string | null;
  client_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  checksum_sha256: string | null;
  source: EventOsDocSource;
  drive_file_id: string | null;
  status: EventOsDocStatus;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeOsRelPath(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

export function isMissingOsDocsTable(msg: string): boolean {
  return /does not exist|schema cache|relation .*event_os_documents|PGRST205/i.test(
    msg
  );
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Path estable en Storage: pdf/{year}/{filename} (dedupe por rel_path en DB). */
export function storagePathForOsRel(relPath: string): string {
  const norm = normalizeOsRelPath(relPath);
  const parts = norm.split('/').filter(Boolean);
  const filename = parts[parts.length - 1] || 'orden.pdf';
  const year =
    parts.length >= 2 && /^\d{4}$/.test(parts[0]) ? parts[0] : 'sin-anio';
  const safe = filename.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]+/gi, '_');
  return `pdf/${year}/${safe}`;
}

function mapRow(raw: Record<string, unknown>): EventOsDocumentRow {
  return {
    id: String(raw.id),
    rel_path: normalizeOsRelPath(String(raw.rel_path || '')),
    filename: String(raw.filename || ''),
    folio: (raw.folio as string | null) || null,
    year: raw.year != null ? Number(raw.year) : null,
    event_date: (raw.event_date as string | null) || null,
    label: (raw.label as string | null) || null,
    matched_client_name: (raw.matched_client_name as string | null) || null,
    client_id: (raw.client_id as string | null) || null,
    storage_path: (raw.storage_path as string | null) || null,
    mime_type: (raw.mime_type as string | null) || null,
    byte_size: raw.byte_size != null ? Number(raw.byte_size) : null,
    checksum_sha256: (raw.checksum_sha256 as string | null) || null,
    source: (String(raw.source || 'activity_seed') as EventOsDocSource) ||
      'activity_seed',
    drive_file_id: (raw.drive_file_id as string | null) || null,
    status: (String(raw.status || 'index_only') as EventOsDocStatus) ||
      'index_only',
    synced_at: (raw.synced_at as string | null) || null,
    created_at: String(raw.created_at || ''),
    updated_at: String(raw.updated_at || ''),
  };
}

export async function listOsDocumentsFromDb(
  sb: SupabaseClient,
  opts?: { year?: number; q?: string }
): Promise<{
  items: EventOsDocumentRow[];
  ready: boolean;
  error: string | null;
}> {
  try {
    let q = sb
      .from('event_os_documents')
      .select('*')
      .order('event_date', { ascending: false, nullsFirst: false })
      .limit(2000);

    if (opts?.year) {
      q = q.eq('year', opts.year);
    }

    const { data, error } = await q;
    if (error) {
      if (isMissingOsDocsTable(error.message)) {
        return {
          items: [],
          ready: false,
          error:
            'Tabla event_os_documents pendiente: ejecuta supabase/eventos_os_documents.sql',
        };
      }
      return { items: [], ready: false, error: error.message };
    }

    let items = (data || []).map((r) =>
      mapRow(r as Record<string, unknown>)
    );

    const needle = (opts?.q || '').trim().toLowerCase();
    if (needle) {
      items = items.filter((it) => {
        const hay = [
          it.filename,
          it.label,
          it.folio,
          it.matched_client_name,
          it.rel_path,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
    }

    return { items, ready: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al listar OS PDF';
    if (isMissingOsDocsTable(msg)) {
      return {
        items: [],
        ready: false,
        error:
          'Tabla event_os_documents pendiente: ejecuta supabase/eventos_os_documents.sql',
      };
    }
    return { items: [], ready: false, error: msg };
  }
}

export async function getOsDocumentById(
  sb: SupabaseClient,
  id: string
): Promise<EventOsDocumentRow | null> {
  const { data, error } = await sb
    .from('event_os_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function getOsDocumentByRelPath(
  sb: SupabaseClient,
  relPath: string
): Promise<EventOsDocumentRow | null> {
  const rel = normalizeOsRelPath(relPath);
  if (!rel) return null;
  const { data, error } = await sb
    .from('event_os_documents')
    .select('*')
    .eq('rel_path', rel)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function downloadOsDocFromStorage(
  sb: SupabaseClient,
  storagePath: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const dl = await sb.storage.from(EVENTOS_OS_DOCS_BUCKET).download(storagePath);
  if (dl.error || !dl.data) return null;
  const ab = await dl.data.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    mimeType: 'application/pdf',
  };
}

export type UpsertOsDocMeta = {
  rel_path: string;
  filename: string;
  folio?: string | null;
  year?: number | null;
  event_date?: string | null;
  label?: string | null;
  matched_client_name?: string | null;
  source?: EventOsDocSource;
};

export async function upsertOsDocumentMeta(
  sb: SupabaseClient,
  meta: UpsertOsDocMeta
): Promise<EventOsDocumentRow | null> {
  const rel = normalizeOsRelPath(meta.rel_path);
  if (!rel) return null;

  const payload = {
    rel_path: rel,
    filename: meta.filename || rel.split('/').pop() || 'orden.pdf',
    folio: meta.folio ?? null,
    year: meta.year ?? null,
    event_date: meta.event_date ?? null,
    label: meta.label ?? null,
    matched_client_name: meta.matched_client_name ?? null,
    source: meta.source || 'activity_seed',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('event_os_documents')
    .upsert(payload, { onConflict: 'rel_path' })
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function markOsDocumentUploaded(
  sb: SupabaseClient,
  opts: {
    rel_path: string;
    storage_path: string;
    mime_type: string;
    byte_size: number;
    checksum_sha256: string;
    drive_file_id?: string | null;
    source?: EventOsDocSource;
  }
): Promise<EventOsDocumentRow | null> {
  const rel = normalizeOsRelPath(opts.rel_path);
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('event_os_documents')
    .update({
      storage_path: opts.storage_path,
      mime_type: opts.mime_type,
      byte_size: opts.byte_size,
      checksum_sha256: opts.checksum_sha256,
      drive_file_id: opts.drive_file_id ?? null,
      source: opts.source || 'drive',
      status: 'uploaded',
      synced_at: now,
      updated_at: now,
    })
    .eq('rel_path', rel)
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function markOsDocumentMissing(
  sb: SupabaseClient,
  relPath: string
): Promise<void> {
  const rel = normalizeOsRelPath(relPath);
  const now = new Date().toISOString();
  await sb
    .from('event_os_documents')
    .update({
      status: 'missing',
      synced_at: now,
      updated_at: now,
    })
    .eq('rel_path', rel);
}

export async function uploadOsPdfToStorage(
  sb: SupabaseClient,
  relPath: string,
  buffer: Buffer,
  mimeType = 'application/pdf'
): Promise<{ storage_path: string; checksum: string; byte_size: number }> {
  const storagePath = storagePathForOsRel(relPath);
  const checksum = sha256Hex(buffer);
  const up = await sb.storage.from(EVENTOS_OS_DOCS_BUCKET).upload(
    storagePath,
    buffer,
    {
      contentType: mimeType || 'application/pdf',
      upsert: true,
    }
  );
  if (up.error) {
    throw new Error(up.error.message || 'Error al subir PDF a Storage');
  }
  return {
    storage_path: storagePath,
    checksum,
    byte_size: buffer.length,
  };
}
