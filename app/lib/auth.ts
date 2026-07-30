export const SESSION_COOKIE = 'c50_dashboard_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 días

export function getDashboardUser(): string {
  return process.env.DASHBOARD_USER || 'puerto';
}

export function getDashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD || 'milagros';
}

function getAuthSecret(): string {
  return process.env.AUTH_SECRET || 'c50-local-dev-secret-cambiar-en-produccion';
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function createSessionToken(username: string): Promise<string> {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${username}:${exp}`;
  const sig = await hmacSign(payload, getAuthSecret());
  return `${payload}:${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const lastColon = token.lastIndexOf(':');
  if (lastColon <= 0) return false;

  const sig = token.slice(lastColon + 1);
  const payload = token.slice(0, lastColon);
  const sep = payload.indexOf(':');
  if (sep <= 0) return false;

  const username = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!username || !exp || Date.now() > exp) return false;

  const expected = await hmacSign(payload, getAuthSecret());
  if (!safeEqual(sig, expected)) return false;

  return username === getDashboardUser();
}

export function validateCredentials(username: string, password: string): boolean {
  return username === getDashboardUser() && password === getDashboardPassword();
}
