import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';

export async function requireEventosSession(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  const ok =
    session.role === 'admin' ||
    session.modules.includes('*') ||
    session.modules.includes('eventos');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso al módulo Eventos' }, { status: 403 });
  }
  return session;
}

export function requireEventosWrite(
  session: SessionUser
): NextResponse | null {
  if (!session.canEdit && session.role !== 'admin') {
    return NextResponse.json(
      { error: 'Sin permiso de edición en Eventos' },
      { status: 403 }
    );
  }
  return null;
}
