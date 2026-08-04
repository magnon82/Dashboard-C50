import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  getDashboardPassword,
  getDashboardUser,
  type SessionUser,
} from '@/app/lib/auth';
import { hashPassword, verifyPassword } from '@/app/lib/password';
import {
  createUser,
  ensureStaffCorteCapabilitySeed,
  getServiceSupabase,
  listUsers,
  toPublicUser,
  type UserRole,
} from '@/app/lib/users';
import { APP_MODULES } from '@/app/lib/modules';
import {
  CAPABILITY_IDS,
  normalizeCapabilities,
  type CapabilityId,
} from '@/app/lib/capabilities';

export const runtime = 'nodejs';

const MODULE_IDS = new Set(APP_MODULES.map((m) => m.id));

async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!canAccessAdmin(session)) {
    return NextResponse.json(
      { error: 'Solo el administrador puede gestionar usuarios' },
      { status: 403 }
    );
  }
  return session;
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    try {
      await ensureStaffCorteCapabilitySeed();
    } catch {
      // seed best-effort
    }
    const rows = await listUsers();
    const bootstrapUser = getDashboardUser();
    const bootstrapPass = getDashboardPassword();

    // Enlaces Suite → ficha RH (suite_username)
    const linkByUser = new Map<
      string,
      { id: string; full_name: string; puesto: string | null }
    >();
    try {
      const sb = getServiceSupabase();
      const { data: emps } = await sb
        .from('hr_employees')
        .select('id, full_name, puesto, suite_username')
        .not('suite_username', 'is', null)
        .limit(500);
      for (const e of emps || []) {
        const u = String(e.suite_username || '')
          .trim()
          .toLowerCase();
        if (!u) continue;
        linkByUser.set(u, {
          id: String(e.id),
          full_name: String(e.full_name || ''),
          puesto: e.puesto != null ? String(e.puesto) : null,
        });
      }
    } catch {
      // HR opcional
    }

    return NextResponse.json({
      users: rows.map((r) => {
        const pub = toPublicUser(r);
        let password = r.password;
        // Filas antiguas solo tenían hash: si es el admin bootstrap y el hash
        // aún coincide con DASHBOARD_PASSWORD, devolver esa para el formulario.
        if (
          !password &&
          r.username === bootstrapUser &&
          verifyPassword(bootstrapPass, r.password_hash)
        ) {
          password = bootstrapPass;
        }
        const linked = linkByUser.get(pub.username.trim().toLowerCase()) || null;
        return {
          id: pub.id,
          username: pub.username,
          displayName: pub.displayName,
          role: pub.role,
          modules: r.modules || [],
          capabilities: pub.capabilities,
          active: pub.active,
          canEdit: pub.canEdit,
          createdAt: r.created_at,
          /** Solo en respuesta admin: contraseña recuperable si está guardada. */
          password,
          linkedEmployee: linked,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron listar usuarios' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: {
    username?: string;
    displayName?: string;
    password?: string;
    role?: UserRole;
    modules?: string[];
    capabilities?: string[];
    active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const username = (body.username || '').trim().toLowerCase();
  const password = body.password || '';
  // Solo el admin bootstrap existe; los demás siempre son viewers
  const role: UserRole = 'viewer';
  const modules = (body.modules || []).filter((m) =>
    MODULE_IDS.has(m as (typeof APP_MODULES)[number]['id'])
  );
  const capabilities = normalizeCapabilities(
    (body.capabilities || []).filter((c) => CAPABILITY_IDS.has(c))
  ) as CapabilityId[];

  if (!username || username.length < 2) {
    return NextResponse.json({ error: 'Usuario inválido' }, { status: 400 });
  }
  if (password.length < 4) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 4 caracteres' },
      { status: 400 }
    );
  }
  if (role === 'viewer' && modules.length === 0) {
    return NextResponse.json(
      { error: 'Asigna al menos un módulo de lectura al usuario' },
      { status: 400 }
    );
  }

  try {
    const user = await createUser({
      username,
      displayName: body.displayName,
      passwordHash: hashPassword(password),
      password,
      role,
      modules,
      capabilities,
      active: body.active !== false,
    });
    const pub = toPublicUser(user);
    return NextResponse.json({
      user: {
        id: pub.id,
        username: pub.username,
        displayName: pub.displayName,
        role: pub.role,
        modules: user.modules || [],
        capabilities: pub.capabilities,
        active: pub.active,
        canEdit: pub.canEdit,
        password: user.password,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al crear usuario';
    const status = msg.includes('ya existe') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
