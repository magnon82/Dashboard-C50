/**
 * Cliente Drive con permiso de escritura (archivo TPV → admin@).
 * Preferencia: service account + DWD impersonando admin@ (mismo patrón GCal).
 * Scope: drive.file (solo archivos creados por la app).
 *
 * Lectura del resto del suite sigue en google-drive-auth.ts (readonly).
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { google, type drive_v3 } from 'googleapis';
import { normalizeGcalPrivateKey } from '@/app/lib/eventos-gcal';
import {
  DEFAULT_GMAIL_SOURCE_MAILBOX,
  resolveWorkspaceMailbox,
} from '@/app/lib/gmail-source';

export const GOOGLE_DRIVE_FILE_SCOPE =
  'https://www.googleapis.com/auth/drive.file';

export type GoogleDriveWriteStatus = {
  configured: boolean;
  mode: 'service_account' | 'none';
  impersonateUser: string | null;
  message: string;
};

export function getGoogleDriveWriteStatus(): GoogleDriveWriteStatus {
  const clientEmail = process.env.GCAL_CLIENT_EMAIL?.trim() || '';
  const privateKey = normalizeGcalPrivateKey(process.env.GCAL_PRIVATE_KEY);
  if (!clientEmail || !privateKey) {
    return {
      configured: false,
      mode: 'none',
      impersonateUser: null,
      message:
        'Falta GCAL_CLIENT_EMAIL + GCAL_PRIVATE_KEY con domain-wide delegation y scope drive.file para archivar a Drive.',
    };
  }
  const impersonate = resolveWorkspaceMailbox(
    process.env.TPV_ARCHIVE_IMPERSONATE_USER ||
      process.env.HR_DRIVE_IMPERSONATE_USER ||
      process.env.GCAL_IMPERSONATE_USER ||
      DEFAULT_GMAIL_SOURCE_MAILBOX
  );
  return {
    configured: true,
    mode: 'service_account',
    impersonateUser: impersonate,
    message: `Service account → Drive (drive.file) como ${impersonate}.`,
  };
}

function createOauthDriveWriteAuth() {
  // Token de `python ingestor/setup_tpv_archive_drive.py` (drive.file).
  // Solo en Node local/Actions con filesystem; en Vercel preferir DWD.
  const tokenPath = path.resolve(
    process.cwd(),
    'ingestor/token-tpv-archive.json'
  );
  const credPath = path.resolve(process.cwd(), 'ingestor/credentials.json');
  if (!existsSync(tokenPath)) return null;
  const token = JSON.parse(readFileSync(tokenPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const clientInfo = existsSync(credPath)
    ? (JSON.parse(readFileSync(credPath, 'utf8')) as Record<string, unknown>)
    : {};
  const installed =
    (clientInfo.installed as Record<string, unknown> | undefined) ||
    (clientInfo.web as Record<string, unknown> | undefined) ||
    {};
  const oauth2 = new google.auth.OAuth2(
    String(installed.client_id || token.client_id || ''),
    String(installed.client_secret || token.client_secret || '')
  );
  oauth2.setCredentials({
    refresh_token:
      typeof token.refresh_token === 'string' ? token.refresh_token : undefined,
    access_token:
      typeof token.access_token === 'string' ? token.access_token : undefined,
    expiry_date:
      typeof token.expiry_date === 'number' ? token.expiry_date : undefined,
  });
  return oauth2;
}

export function createGoogleDriveWriteAuth() {
  const oauth = createOauthDriveWriteAuth();
  if (oauth) return oauth;

  const status = getGoogleDriveWriteStatus();
  if (!status.configured) throw new Error(status.message);
  const clientEmail = process.env.GCAL_CLIENT_EMAIL!.trim();
  const privateKey = normalizeGcalPrivateKey(process.env.GCAL_PRIVATE_KEY)!;
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [GOOGLE_DRIVE_FILE_SCOPE],
    subject: status.impersonateUser || DEFAULT_GMAIL_SOURCE_MAILBOX,
  });
}

export function createDriveWriteClient(): drive_v3.Drive {
  const auth = createGoogleDriveWriteAuth();
  return google.drive({ version: 'v3', auth });
}

export function tpvArchiveFolderId(): string {
  return (process.env.TPV_ARCHIVE_DRIVE_FOLDER_ID || '').trim();
}
