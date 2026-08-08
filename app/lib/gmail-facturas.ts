/**
 * Relee adjuntos CFDI (PDF/XML) desde Gmail cuando el path local
 * no existe en Vercel (File Stream / runner de Actions).
 *
 * Usa el mismo OAuth que el ingestor (GOOGLE_OAUTH_* · gmail.readonly).
 */

import { google } from 'googleapis';

type GmailPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { attachmentId?: string | null; data?: string | null; size?: number | null };
  parts?: GmailPart[] | null;
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

function createGmailAuth() {
  const token = parseJsonEnv(process.env.GOOGLE_OAUTH_TOKEN_JSON);
  if (!token || !(token.refresh_token || token.access_token)) {
    throw new Error('Falta GOOGLE_OAUTH_TOKEN_JSON para leer adjuntos Gmail');
  }
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
  });
  return oauth2;
}

function walkParts(part: GmailPart | null | undefined, out: GmailPart[]) {
  if (!part) return;
  const name = String(part.filename || '').trim();
  if (name && part.body?.attachmentId) out.push(part);
  for (const child of part.parts || []) walkParts(child, out);
}

function decodeGmailData(data: string): Buffer {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

export type GmailFacturaFile = {
  bytes: Buffer;
  filename: string;
  contentType: string;
  kind: 'pdf' | 'xml';
};

/** Baja PDF o XML del mensaje Gmail (preferencia estricta por extensión). */
export async function fetchFacturaAttachmentFromGmail(
  gmailId: string,
  prefer: 'pdf' | 'xml'
): Promise<GmailFacturaFile | null> {
  const id = String(gmailId || '').trim();
  if (!id) return null;

  const gmail = google.gmail({ version: 'v1', auth: createGmailAuth() });
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  });
  const parts: GmailPart[] = [];
  walkParts(msg.data.payload as GmailPart | undefined, parts);

  const wantExt = prefer === 'pdf' ? '.pdf' : '.xml';
  const candidates = parts.filter((p) =>
    String(p.filename || '')
      .toLowerCase()
      .endsWith(wantExt)
  );
  const pick = candidates[0] || null;
  if (!pick?.body?.attachmentId || !pick.filename) return null;

  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: id,
    id: pick.body.attachmentId,
  });
  const raw = att.data.data;
  if (!raw) return null;

  return {
    bytes: decodeGmailData(raw),
    filename: pick.filename,
    contentType: prefer === 'pdf' ? 'application/pdf' : 'application/xml',
    kind: prefer,
  };
}
