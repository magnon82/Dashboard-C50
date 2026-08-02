import type { CapabilityId } from '@/app/lib/capabilities';
import {
  STAFF_CORTE_SEED_USERNAMES,
  hasCapability,
  normalizeCapabilities,
} from '@/app/lib/capabilities';
import type { UserRole } from '@/app/lib/users';

export const SESSION_COOKIE = 'c50_dashboard_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 días

export interface SessionUser {
  username: string;
  role: UserRole;
  /** '*' = todos (admin); o ids de módulo */
  modules: string[];
  /** Permisos granulares (staff.corte, …). Admin → todos vía hasCapability. */
  capabilities: CapabilityId[];
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

function encodeCapabilities(capabilities: string[]): string {
  if (!capabilities.length) return '-';
  return capabilities.filter(Boolean).join('+');
}

function decodeCapabilities(raw: string): CapabilityId[] {
  if (!raw || raw === '-') return [];
  return normalizeCapabilities(raw.split('+'));
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const mods = encodeModules(user.role === 'admin' ? ['*'] : user.modules);
  const caps = encodeCapabilities(
    user.role === 'admin' ? [] : user.capabilities || []
  );
  // v3: username:role:modules:capabilities:exp
  const payload = `v3:${user.username}:${user.role}:${mods}:${caps}:${exp}`;
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

  if (parts[0] === 'v3' && parts.length === 6) {
    const [, username, role, mods, caps, expRaw] = parts;
    const exp = Number(expRaw);
    if (!username || !exp || Date.now() > exp) return null;
    if (role !== 'admin' && role !== 'viewer') return null;
    const modules = role === 'admin' ? ['*'] : decodeModules(mods);
    return {
      username,
      role,
      modules,
      capabilities: role === 'admin' ? [] : decodeCapabilities(caps),
      canEdit: role === 'admin',
    };
  }

  // Compat v2 (sin capabilities) → capabilities vacías
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
      capabilities: [],
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
      capabilities: [],
      canEdit: true,
    };
  }

  return null;
}

export function canAccessModule(session: SessionUser, moduleId: string): boolean {
  if (session.role === 'admin' || session.modules.includes('*')) return true;
  return session.modules.includes(moduleId);
}

export function sessionHasCapability(
  session: SessionUser,
  id: CapabilityId
): boolean {
  return hasCapability(session.capabilities, id, {
    role: session.role,
    modules: session.modules,
  });
}

/** Sesiones v2 sin capabilities: roman/roberto hasta re-login tras el seed. */
function legacySeedStaffCorte(session: SessionUser): boolean {
  if (session.capabilities?.length) return false;
  const u = session.username.trim().toLowerCase();
  return (STAFF_CORTE_SEED_USERNAMES as readonly string[]).includes(u);
}

/**
 * Cortes TPV (operar / API):
 * - Admin → sí
 * - Capability `staff.corte` → sí (palomita Master)
 * - Módulo Ventas → sí (gerencia / reportes en /ventas/corte-tpv)
 * Staff sin palomita → no (aunque tenga módulo staff).
 */
export function canAccessCorteTpv(session: SessionUser): boolean {
  if (session.role === 'admin' || session.modules.includes('*')) return true;
  if (sessionHasCapability(session, 'staff.corte')) return true;
  if (legacySeedStaffCorte(session)) return true;
  return canAccessModule(session, 'ventas');
}

/** Card /staff/corte: solo quien tiene la palomita (o admin). */
export function canAccessStaffCorte(session: SessionUser): boolean {
  if (session.role === 'admin' || session.modules.includes('*')) return true;
  if (sessionHasCapability(session, 'staff.corte')) return true;
  return legacySeedStaffCorte(session);
}

export function isCorteTpvPath(pathname: string): boolean {
  return pathname === '/ventas/corte-tpv' || pathname.startsWith('/ventas/corte-tpv/');
}

export function isStaffCortePath(pathname: string): boolean {
  return pathname === '/staff/corte' || pathname.startsWith('/staff/corte/');
}

/** Solo el admin bootstrap (DASHBOARD_USER) ve y usa /admin */
export function canAccessAdmin(session: SessionUser): boolean {
  return (
    session.role === 'admin' &&
    session.username.trim().toLowerCase() === getDashboardUser()
  );
}
