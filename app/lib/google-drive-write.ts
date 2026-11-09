/**
 * Cliente Drive con permiso de escritura (archivo TPV → admin@).
 * Preferencia: service account + DWD impersonando admin@ (mismo patrón GCal).
 * Scope: drive.file (solo archivos creados por la app).
 *
 * Lectura del resto del suite sigue en google-drive-auth.ts (readonly).
 */

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

export function createGoogleDriveWriteAuth() {
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
