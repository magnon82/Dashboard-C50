import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, canAccessAdmin, type SessionUser } from '@/app/lib/auth';
import { hashPassword } from '@/app/lib/password';
import { findUserByUsername, updateUser, type UserRole } from '@/app/lib/users';
import { APP_MODULES } from '@/app/lib/modules';
import { toPublicUser } from '@/app/lib/users';

export const runtime = 'nodejs';

const MODULE_IDS = new Set(APP_MODULES.map((m) => m.id));

async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const session = await verifySessionToken(token);
  if (!session) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  if (!canAccessAdmin(session)) {
    return NextResponse.json({ error: 'Solo el administrador' }, { status: 403 });
  }
  return session;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  let body: {
    displayName?: string;
    password?: string;
    role?: UserRole;
    modules?: string[];
    active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  if (body.password && body.password.length < 4) {
    return NextResponse.json({ error: 'Contraseña muy corta' }, { status: 400 });
  }

  if (typeof body.active === 'boolean' && body.active === false) {
    const self = await findUserByUsername(auth.username);
    if (self?.id === id) {
      return NextResponse.json(
        { error: 'No puedes desactivar tu propio usuario admin' },
        { status: 400 }
      );
    }
  }

  // Solo el admin bootstrap puede ser admin; el resto siempre viewer
  let role: UserRole | undefined = body.role;
  if (role !== undefined) {
    const self = await findUserByUsername(auth.username);
    if (self?.id === id) {
      role = 'admin';
    } else {
      role = 'viewer';
    }
  }

  const modules =
    body.modules !== undefined
      ? body.modules.filter((m) => MODULE_IDS.has(m as (typeof APP_MODULES)[number]['id']))
      : undefined;

  try {
    const user = await updateUser(id, {
      displayName: body.displayName,
      passwordHash: body.password ? hashPassword(body.password) : undefined,
      role,
      modules,
      active: body.active,
    });
    const pub = toPublicUser(user);
    return NextResponse.json({
      user: {
        id: pub.id,
        username: pub.username,
        displayName: pub.displayName,
        role: pub.role,
        modules: user.modules || [],
        active: pub.active,
        canEdit: pub.canEdit,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar' },
      { status: 500 }
    );
  }
}
