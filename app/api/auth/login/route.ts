import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  canAccessAdmin,
  createSessionToken,
  getDashboardPassword,
  getDashboardUser,
  type SessionUser,
} from '@/app/lib/auth';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import {
  createUser,
  ensureStaffCorteCapabilitySeed,
  findUserByUsername,
  toPublicUser,
} from '@/app/lib/users';


export const runtime = 'nodejs';

async function ensureBootstrapAdmin(): Promise<void> {
  try {
    const username = getDashboardUser();
    const existing = await findUserByUsername(username);
    if (existing) return;
    await createUser({
      username,
      displayName: 'Sergio',
      passwordHash: hashPassword(getDashboardPassword()),
      password: getDashboardPassword(),
      role: 'admin',
      modules: ['*'],
      active: true,
    });
  } catch {
    // si falla, login legacy por env
  }
}

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const username = (body.username || '').trim().toLowerCase();
  const password = body.password || '';
  if (!username || !password) {
    return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 });
  }

  await ensureBootstrapAdmin();
  try {
    await ensureStaffCorteCapabilitySeed();
  } catch {
    // seed best-effort
  }

  let session: SessionUser | null = null;

  try {
    const row = await findUserByUsername(username);
    if (row && row.active && verifyPassword(password, row.password_hash)) {
      const pub = toPublicUser(row);
      session = {
        username: pub.username,
        role: pub.role,
        modules: pub.modules,
        capabilities: pub.capabilities,
        canEdit: pub.canEdit,
      };
    }
  } catch {
    // fallback env
  }

  if (!session) {
    if (username === getDashboardUser() && password === getDashboardPassword()) {
      session = {
        username,
        role: 'admin',
        modules: ['*'],
        capabilities: [],
        canEdit: true,
      };
    }
  }

  if (!session) {
    return NextResponse.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
  }

  const token = await createSessionToken(session);
  const response = NextResponse.json({
    ok: true,
    user: {
      username: session.username,
      role: session.role,
      modules: session.modules,
      capabilities: session.capabilities,
      canEdit: session.canEdit,
      canAccessAdmin: canAccessAdmin(session),
      canAccessStaffCorte:
        session.role === 'admin' ||
        session.modules.includes('*') ||
        session.capabilities.includes('staff.corte'),
    },
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  return response;
}
