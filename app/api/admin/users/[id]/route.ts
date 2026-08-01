import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  getDashboardUser,
  type SessionUser,
} from '@/app/lib/auth';
import { hashPassword } from '@/app/lib/password';
import {
  deleteUser,
  findUserById,
  findUserByUsername,
  updateUser,
  type UserRole,
  toPublicUser,
} from '@/app/lib/users';
import { APP_MODULES } from '@/app/lib/modules';

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
    username?: string;
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

  const username =
    body.username !== undefined ? body.username.trim().toLowerCase() : undefined;
  if (username !== undefined && username.length < 2) {
    return NextResponse.json({ error: 'Usuario inválido' }, { status: 400 });
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

  // No permitir renombrar al admin bootstrap fuera de DASHBOARD_USER
  if (username !== undefined) {
    const self = await findUserByUsername(auth.username);
    if (self?.id === id && username !== auth.username.trim().toLowerCase()) {
      return NextResponse.json(
        {
          error:
            'No puedes cambiar el usuario del administrador bootstrap (DASHBOARD_USER)',
        },
        { status: 400 }
      );
    }
  }

  const modules =
    body.modules !== undefined
      ? body.modules.filter((m) => MODULE_IDS.has(m as (typeof APP_MODULES)[number]['id']))
      : undefined;

  try {
    const user = await updateUser(id, {
      username,
      displayName: body.displayName,
      passwordHash: body.password ? hashPassword(body.password) : undefined,
      password: body.password || undefined,
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
        password: user.password,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al actualizar';
    const status = msg.includes('ya existe')
      ? 409
      : msg.includes('inválido')
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** Alias: el cliente admin usa PATCH; PUT acepta los mismos campos. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return PATCH(request, context);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  const target = await findUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
  }

  const bootstrap = getDashboardUser();
  if (target.username.trim().toLowerCase() === bootstrap) {
    return NextResponse.json(
      {
        error:
          'No se puede eliminar al administrador bootstrap (DASHBOARD_USER)',
      },
      { status: 400 }
    );
  }

  if (auth.username.trim().toLowerCase() === target.username.trim().toLowerCase()) {
    return NextResponse.json(
      { error: 'No puedes eliminar tu propio usuario' },
      { status: 400 }
    );
  }

  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al eliminar';
    const status = msg.includes('no encontrado') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
