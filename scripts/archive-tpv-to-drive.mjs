/**
 * Archiva fotos TPV >60 días: Supabase Storage → Drive (admin@) → borra Storage.
 * Uso: node scripts/archive-tpv-to-drive.mjs
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      GCAL_CLIENT_EMAIL, GCAL_PRIVATE_KEY, GCAL_IMPERSONATE_USER (o admin@),
 *      TPV_ARCHIVE_DRIVE_FOLDER_ID
 * Opcional: TPV_ARCHIVE_DRY_RUN=true, TPV_ARCHIVE_LIMIT=80
 */
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const BUCKET = 'tpv-cortes';
const AFTER_DAYS = 60;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_IMPERSONATE = 'admin@carranza50.com.mx';

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

function normalizeKey(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/^"|"$/g, '')
    .trim();
}

function todayCdmx() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return dt.toISOString().slice(0, 10);
}

loadEnv();

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const folderId = (process.env.TPV_ARCHIVE_DRIVE_FOLDER_ID || '').trim();
const dryRun = String(process.env.TPV_ARCHIVE_DRY_RUN || 'false').toLowerCase() === 'true';
const limit = Math.min(
  200,
  Math.max(1, Number(process.env.TPV_ARCHIVE_LIMIT || 80) || 80)
);
const impersonate = (
  process.env.TPV_ARCHIVE_IMPERSONATE_USER ||
  process.env.GCAL_IMPERSONATE_USER ||
  DEFAULT_IMPERSONATE
)
  .trim()
  .toLowerCase();

if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!folderId) {
  console.error('Falta TPV_ARCHIVE_DRIVE_FOLDER_ID');
  process.exit(1);
}

const cutoff = shiftIso(todayCdmx(), -AFTER_DAYS);
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await sb
  .from('tpv_corte_uploads')
  .select(
    'id,corte_date,terminal_number,photo_kind,storage_path,mime_type,byte_size,archive_status'
  )
  .eq('entry_kind', 'photo')
  .eq('archive_status', 'hot')
  .lt('corte_date', cutoff)
  .not('storage_path', 'is', null)
  .order('corte_date', { ascending: true })
  .limit(limit);

if (error) {
  console.error(
    error.message.includes('archive_status')
      ? 'Ejecuta supabase/tpv_cortes_archive.sql en SQL Editor.'
      : error.message
  );
  process.exit(1);
}

const list = rows || [];
const bytes = list.reduce((s, r) => s + (Number(r.byte_size) || 0), 0);
console.log(
  JSON.stringify(
    {
      cutoff,
      candidates: list.length,
      approx_mb: +(bytes / 1024 / 1024).toFixed(2),
      dryRun,
      impersonate,
    },
    null,
    2
  )
);

if (dryRun || list.length === 0) {
  process.exit(0);
}

const clientEmail = (process.env.GCAL_CLIENT_EMAIL || '').trim();
const privateKey = normalizeKey(process.env.GCAL_PRIVATE_KEY);
if (!clientEmail || !privateKey) {
  console.error('Faltan GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY');
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: clientEmail,
  key: privateKey,
  scopes: [DRIVE_SCOPE],
  subject: impersonate,
});
const drive = google.drive({ version: 'v3', auth });

async function findOrCreateFolder(name, parent) {
  const q = [
    `'${parent}' in parents`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ');
  const listed = await drive.files.list({
    q,
    fields: 'files(id)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (listed.data.files?.[0]?.id) return listed.data.files[0].id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parent],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

const folderCache = new Map();
let archived = 0;
let failed = 0;

for (const row of list) {
  try {
    const [y, m] = String(row.corte_date).split('-');
    const keyYm = `${y}-${m}`;
    let dest = folderCache.get(keyYm);
    if (!dest) {
      const yearId = await findOrCreateFolder(y, folderId);
      dest = await findOrCreateFolder(`${y}-${m}`, yearId);
      folderCache.set(keyYm, dest);
    }

    const dl = await sb.storage.from(BUCKET).download(row.storage_path);
    if (dl.error || !dl.data) throw new Error(dl.error?.message || 'download vacío');
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const ext = String(row.mime_type || '').includes('png') ? 'png' : 'jpg';
    const name = `${row.corte_date}_T${row.terminal_number}_${row.photo_kind}_${String(row.id).slice(0, 8)}.${ext}`;

    const created = await drive.files.create({
      requestBody: {
        name,
        parents: [dest],
        description: `Cortes TPV archivo · ${row.corte_date}`,
      },
      media: {
        mimeType: row.mime_type || 'image/jpeg',
        body: Readable.from(buf),
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });

    const now = new Date().toISOString();
    const { error: upErr } = await sb
      .from('tpv_corte_uploads')
      .update({
        archive_status: 'drive',
        drive_file_id: created.data.id,
        drive_web_view_link: created.data.webViewLink || null,
        archived_at: now,
        storage_path: null,
        updated_at: now,
      })
      .eq('id', row.id);
    if (upErr) throw new Error(upErr.message);

    await sb.storage.from(BUCKET).remove([row.storage_path]);
    archived += 1;
    console.log(`OK ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${row.id}: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(JSON.stringify({ archived, failed }, null, 2));
process.exit(failed && !archived ? 1 : 0);
