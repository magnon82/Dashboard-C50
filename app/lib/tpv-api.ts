import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';

/** Sesión con acceso al módulo Ventas (o admin). Viewers con ventas pueden subir cortes. */
export async function requireVentasSession(): Promise<SessionUser | NextResponse> {
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
    session.modules.includes('ventas');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso al módulo Ventas' }, { status: 403 });
  }
  return session;
}
