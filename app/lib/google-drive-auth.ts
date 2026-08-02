/**
 * Auth Google Drive / Sheets (solo lectura) para Next.js.
 *
 * Orden de preferencia:
 * 1) OAuth (mismo token que ingestor/google_auth.py):
 *    GOOGLE_OAUTH_TOKEN_JSON (+ opcional GOOGLE_OAUTH_CLIENT_JSON)
 * 2) Service account reutilizando GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY
 *    (+ HR_DRIVE_IMPERSONATE_USER o GCAL_IMPERSONATE_USER para DWD)
 *
 * Scopes requeridos:
 *   - https://www.googleapis.com/auth/drive.readonly
 *   - https://www.googleapis.com/auth/spreadsheets.readonly
 *
 * Con service account: comparte la carpeta de Nóminas con el email del SA,
 * o usa domain-wide delegation + impersonación de un usuario con acceso.
 */

import { google } from 'googleapis';
import { normalizeGcalPrivateKey } from '@/app/lib/eventos-gcal';

export const GOOGLE_DRIVE_READONLY_SCOPE =
  'https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_SHEETS_READONLY_SCOPE =
  'https://www.googleapis.com/auth/spreadsheets.readonly';

const DRIVE_SCOPES = [
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_SHEETS_READONLY_SCOPE,
];

export type GoogleDriveAuthStatus = {
  configured: boolean;
  mode: 'oauth' | 'service_account' | 'none';
  clientEmail: string | null;
  impersonateUser: string | null;
  message: string;
};

function parseJsonEnv(raw: string | undefined): Record<string, unknown> | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getGoogleDriveAuthStatus(): GoogleDriveAuthStatus {
  const token = parseJsonEnv(process.env.GOOGLE_OAUTH_TOKEN_JSON);
  if (token && (token.refresh_token || token.access_token)) {
    return {
      configured: true,
      mode: 'oauth',
      clientEmail: typeof token.client_id === 'string' ? token.client_id : null,
      impersonateUser: null,
      message: 'OAuth Google (Drive/Sheets readonly).',
    };
  }

  const clientEmail = process.env.GCAL_CLIENT_EMAIL?.trim() || '';
  const privateKey = normalizeGcalPrivateKey(process.env.GCAL_PRIVATE_KEY);
  if (clientEmail && privateKey) {
    const impersonate =
      process.env.HR_DRIVE_IMPERSONATE_USER?.trim() ||
      process.env.GCAL_IMPERSONATE_USER?.trim() ||
      '';
    return {
      configured: true,
      mode: 'service_account',
      clientEmail,
      impersonateUser: impersonate || null,
      message: impersonate
        ? `Service account con impersonación (${impersonate}).`
        : 'Service account: comparte la carpeta de Nóminas con el email del SA.',
    };
  }

  return {
    configured: false,
    mode: 'none',
    clientEmail: null,
    impersonateUser: null,
    message:
      'Faltan credenciales Google. Define GOOGLE_OAUTH_TOKEN_JSON o GCAL_CLIENT_EMAIL + GCAL_PRIVATE_KEY (scopes drive.readonly y spreadsheets.readonly).',
  };
}

export function createGoogleDriveAuth() {
  const status = getGoogleDriveAuthStatus();
  if (!status.configured) {
    throw new Error(status.message);
  }

  if (status.mode === 'oauth') {
    const token = parseJsonEnv(process.env.GOOGLE_OAUTH_TOKEN_JSON)!;
    const clientInfo = parseJsonEnv(process.env.GOOGLE_OAUTH_CLIENT_JSON);
    const installed =
      (clientInfo?.installed as Record<string, unknown> | undefined) ||
      (clientInfo?.web as Record<string, unknown> | undefined) ||
      {};
    const clientId =
      (installed.client_id as string | undefined) ||
      (token.client_id as string | undefined) ||
      '';
    const clientSecret =
      (installed.client_secret as string | undefined) ||
      (token.client_secret as string | undefined) ||
      '';
    const redirect =
      Array.isArray(installed.redirect_uris) && installed.redirect_uris[0]
        ? String(installed.redirect_uris[0])
        : undefined;

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
    oauth2.setCredentials({
      refresh_token:
        typeof token.refresh_token === 'string' ? token.refresh_token : undefined,
      access_token:
        typeof token.access_token === 'string' ? token.access_token : undefined,
      expiry_date:
        typeof token.expiry_date === 'number' ? token.expiry_date : undefined,
      scope: DRIVE_SCOPES.join(' '),
    });
    return oauth2;
  }

  const clientEmail = process.env.GCAL_CLIENT_EMAIL!.trim();
  const privateKey = normalizeGcalPrivateKey(process.env.GCAL_PRIVATE_KEY);
  const subject =
    process.env.HR_DRIVE_IMPERSONATE_USER?.trim() ||
    process.env.GCAL_IMPERSONATE_USER?.trim() ||
    '';

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: DRIVE_SCOPES,
    ...(subject ? { subject } : {}),
  });
}

export function createDriveClient() {
  const auth = createGoogleDriveAuth();
  return google.drive({ version: 'v3', auth });
}

export function createSheetsClient() {
  const auth = createGoogleDriveAuth();
  return google.sheets({ version: 'v4', auth });
}

/** Errores amigables sin rutas OS ni dumps técnicos. */
export function friendlyDriveError(err: unknown): string {
  const anyErr = err as {
    code?: number | string;
    status?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
    response?: { status?: number; data?: { error?: { message?: string } } };
  };
  const status =
    Number(anyErr?.code) ||
    Number(anyErr?.status) ||
    Number(anyErr?.response?.status) ||
    0;
  const raw =
    anyErr?.response?.data?.error?.message ||
    anyErr?.errors?.[0]?.message ||
    anyErr?.message ||
    String(err);
  const lower = raw.toLowerCase();

  if (
    status === 401 ||
    lower.includes('invalid_grant') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid_client')
  ) {
    return 'No se pudo conectar con Drive: credenciales inválidas o token vencido. Vuelve a autorizar Google o revisa el service account.';
  }
  if (
    status === 403 ||
    status === 404 ||
    lower.includes('forbidden') ||
    lower.includes('not found') ||
    lower.includes('insufficient')
  ) {
    return 'No se pudo conectar con Drive: sin acceso a la carpeta de Nóminas. Comparte la carpeta con la cuenta de servicio o usa OAuth con acceso a esa carpeta.';
  }
  if (lower.includes('faltan credenciales') || lower.includes('scopes')) {
    return raw;
  }
  return 'No se pudo conectar con Drive. Intenta de nuevo o usa subir archivo / captura manual.';
}
