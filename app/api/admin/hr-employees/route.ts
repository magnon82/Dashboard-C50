import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';
import { formatHrListName } from '@/app/lib/hr-person-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

/**
 * GET /api/admin/hr-employees — lista corta para vincular Suite ↔ ficha RH.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_employees')
      .select('id, full_name, puesto, area, status, suite_username, force_exclude')
      .neq('status', 'baja')
      .order('full_name', { ascending: true })
      .limit(500);

    if (error) {
      const missing =
        /does not exist|42P01/i.test(error.message) ||
        /schema cache/i.test(error.message);
      return NextResponse.json({
        employees: [],
        error: missing
          ? 'Tablas RR.HH. no migradas.'
          : error.message,
      });
    }

    const employees = (data || [])
      .filter((e) => !e.force_exclude)
      .map((e) => ({
        id: String(e.id),
        full_name: formatHrListName(String(e.full_name || '')) || String(e.full_name || ''),
        puesto: e.puesto != null ? String(e.puesto) : null,
        area: e.area != null ? String(e.area) : null,
        suite_username: e.suite_username
          ? String(e.suite_username).trim().toLowerCase()
          : null,
      }));

    return NextResponse.json({ employees });
  } catch (e) {
    return NextResponse.json(
      {
        employees: [],
        error: e instanceof Error ? e.message : 'Error al listar empleados',
      },
      { status: 500 }
    );
  }
}
