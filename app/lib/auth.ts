import type { UserRole } from '@/app/lib/users';

export const SESSION_COOKIE = 'c50_dashboard_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 días

export interface SessionUser {
  username: string;
  role: UserRole;
  /** '*' = todos (admin); o ids de módulo */
  modules: string[];
  canEdit: boolean;
}

export function getDashboardUser(): string {
  return (process.env.DASHBOARD_USER || 'sergio').trim().toLowerCase();
}

export function getDashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD || 'sikame';
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

function encodeModules(modules: string[]): string {
  if (modules.includes('*')) return '*';
  return modules.filter(Boolean).join('+') || '-';
}

function decodeModules(raw: string): string[] {
  if (raw === '*') return ['*'];
  if (!raw || raw === '-') return [];
  return raw.split('+').filter(Boolean);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const mods = encodeModules(user.role === 'admin' ? ['*'] : user.modules);
  const payload = `v2:${user.username}:${user.role}:${mods}:${exp}`;
  const sig = await hmacSign(payload, getAuthSecret());
  return `${payload}:${sig}`;
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  const lastColon = token.lastIndexOf(':');
  if (lastColon <= 0) return null;

  const sig = token.slice(lastColon + 1);
  const payload = token.slice(0, lastColon);
  const expected = await hmacSign(payload, getAuthSecret());
  if (!safeEqual(sig, expected)) return null;

  const parts = payload.split(':');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, username, role, mods, expRaw] = parts;
    const exp = Number(expRaw);
    if (!username || !exp || Date.now() > exp) return null;
    if (role !== 'admin' && role !== 'viewer') return null;
    const modules = role === 'admin' ? ['*'] : decodeModules(mods);
    return {
      username,
      role,
      modules,
      canEdit: role === 'admin',
    };
  }

  // Compat: tokens viejos username:exp
  if (parts.length === 2) {
    const [username, expRaw] = parts;
    const exp = Number(expRaw);
    if (!username || !exp || Date.now() > exp) return null;
    if (username !== getDashboardUser()) return null;
    return {
      username,
      role: 'admin',
      modules: ['*'],
      canEdit: true,
    };
  }

  return null;
}

export function canAccessModule(session: SessionUser, moduleId: string): boolean {
  if (session.role === 'admin' || session.modules.includes('*')) return true;
  return session.modules.includes(moduleId);
}

/** Solo el admin bootstrap (DASHBOARD_USER) ve y usa /admin */
export function canAccessAdmin(session: SessionUser): boolean {
  return (
    session.role === 'admin' &&
    session.username.trim().toLowerCase() === getDashboardUser()
  );
}
