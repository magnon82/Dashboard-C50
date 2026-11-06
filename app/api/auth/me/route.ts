import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  canAccessStaffCorte,
  canClosePendingCortes,
  canEditHrEmployees,
  canEditHrSchedules,
} from '@/app/lib/auth';
import { touchLastLogin } from '@/app/lib/users';

export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Sesiones de 7 días: registrar acceso real, no solo el form de login.
  try {
    await touchLastLogin(session.username, { throttle: true });
  } catch {
    // no bloquear /me
  }

  return NextResponse.json({
    user: {
      username: session.username,
      role: session.role,
      modules: session.modules,
      capabilities: session.capabilities,
      canEdit: session.canEdit,
      canAccessAdmin: canAccessAdmin(session),
      canAccessStaffCorte: canAccessStaffCorte(session),
      canClosePendingCortes: canClosePendingCortes(session),
      canEditHrEmployees: canEditHrEmployees(session),
      canEditHrSchedules: canEditHrSchedules(session),
    },
  });
}
