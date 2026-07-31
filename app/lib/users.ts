import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'viewer';

/** Usuarios del suite (sin tabla extra): financial_records.source_file */
export const AUTH_SOURCE_FILE = 'dashboard_auth';
export const AUTH_CATEGORY = 'DashboardUser';

export interface DashboardUserRow {
  id: string;
  username: string;
  display_name: string | null;
  password_hash: string;
  /** Contraseña en claro solo para recuperación en admin; login usa password_hash. */
  password: string | null;
  role: UserRole;
  modules: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  modules: string[];
  active: boolean;
  canEdit: boolean;
}

interface UserPayload {
  username: string;
  display_name: string | null;
  password_hash: string;
  /** Recuperable solo vía API admin (requireAdmin). Opcional en filas antiguas. */
  password?: string;
  role: UserRole;
  modules: string[];
  active: boolean;
  updated_at: string;
}

function clean(value: string | undefined): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

export function getServiceSupabase(): SupabaseClient {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function toPublicUser(row: DashboardUserRow): PublicUser {
  const canEdit = row.role === 'admin';
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    modules: row.role === 'admin' ? ['*'] : row.modules || [],
    active: row.active,
    canEdit,
  };
}

function parsePayload(description: string): UserPayload | null {
  try {
    const p = JSON.parse(description) as UserPayload;
    if (!p?.username || !p?.password_hash || !p?.role) return null;
    return p;
  } catch {
    return null;
  }
}

function recordToUser(r: {
  id: string;
  date?: string;
  description?: string;
}): DashboardUserRow | null {
  const p = parsePayload(r.description || '');
  if (!p) return null;
  return {
    id: r.id,
    username: p.username,
    display_name: p.display_name ?? null,
    password_hash: p.password_hash,
    password: typeof p.password === 'string' && p.password ? p.password : null,
    role: p.role === 'admin' ? 'admin' : 'viewer',
    modules: Array.isArray(p.modules) ? p.modules : [],
    active: p.active !== false,
    created_at: r.date || p.updated_at,
    updated_at: p.updated_at || r.date || new Date().toISOString(),
  };
}

async function fetchAuthRecords() {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .select('id,date,description,source_file,category')
    .eq('source_file', AUTH_SOURCE_FILE)
    .eq('category', AUTH_CATEGORY)
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function listUsers(): Promise<DashboardUserRow[]> {
  const rows = await fetchAuthRecords();
  return rows
    .map((r) => recordToUser(r))
    .filter((u): u is DashboardUserRow => Boolean(u))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function countUsers(): Promise<number> {
  const users = await listUsers();
  return users.length;
}

export async function findUserByUsername(
  username: string
): Promise<DashboardUserRow | null> {
  const needle = username.trim().toLowerCase();
  const users = await listUsers();
  return users.find((u) => u.username === needle) ?? null;
}

export async function createUser(input: {
  username: string;
  displayName?: string | null;
  passwordHash: string;
  /** Texto claro para que el admin pueda ver/editar la contraseña asignada. */
  password?: string;
  role: UserRole;
  modules: string[];
  active?: boolean;
}): Promise<DashboardUserRow> {
  const username = input.username.trim().toLowerCase();
  const existing = await findUserByUsername(username);
  if (existing) throw new Error('Ese usuario ya existe');

  const now = new Date().toISOString();
  const plain = input.password?.trim() || undefined;
  const payload: UserPayload = {
    username,
    display_name: input.displayName?.trim() || null,
    password_hash: input.passwordHash,
    ...(plain ? { password: plain } : {}),
    role: input.role,
    modules: input.role === 'admin' ? ['*'] : input.modules,
    active: input.active !== false,
    updated_at: now,
  };

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .insert({
      date: now.slice(0, 10),
      type: 'commission',
      category: AUTH_CATEGORY,
      amount: 0,
      description: JSON.stringify(payload),
      source_file: AUTH_SOURCE_FILE,
    })
    .select('id,date,description')
    .single();

  if (error) throw new Error(error.message);
  const user = recordToUser(data);
  if (!user) throw new Error('No se pudo crear el usuario');
  return user;
}

export async function updateUser(
  id: string,
  patch: {
    displayName?: string | null;
    passwordHash?: string;
    password?: string;
    role?: UserRole;
    modules?: string[];
    active?: boolean;
  }
): Promise<DashboardUserRow> {
  const sb = getServiceSupabase();
  const { data: row, error: findErr } = await sb
    .from('financial_records')
    .select('id,date,description,source_file,category')
    .eq('id', id)
    .eq('source_file', AUTH_SOURCE_FILE)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (!row) throw new Error('Usuario no encontrado');

  const current = recordToUser(row);
  if (!current) throw new Error('Usuario corrupto');

  const role = patch.role ?? current.role;
  const modules =
    role === 'admin'
      ? ['*']
      : patch.modules !== undefined
        ? patch.modules
        : current.modules;

  if (role === 'viewer' && modules.filter((m) => m !== '*').length === 0) {
    throw new Error('Asigna al menos un módulo');
  }

  const plain =
    patch.password !== undefined
      ? patch.password.trim() || undefined
      : current.password || undefined;

  const payload: UserPayload = {
    username: current.username,
    display_name:
      patch.displayName !== undefined
        ? patch.displayName?.trim() || null
        : current.display_name,
    password_hash: patch.passwordHash ?? current.password_hash,
    ...(plain ? { password: plain } : {}),
    role,
    modules,
    active: patch.active !== undefined ? patch.active : current.active,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('financial_records')
    .update({ description: JSON.stringify(payload) })
    .eq('id', id)
    .select('id,date,description')
    .single();
  if (error) throw new Error(error.message);
  const user = recordToUser(data);
  if (!user) throw new Error('No se pudo actualizar');
  return user;
}
