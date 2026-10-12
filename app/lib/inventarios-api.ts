import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessModule,
  type SessionUser,
} from '@/app/lib/auth';

export async function requireInventariosSession(): Promise<
  SessionUser | NextResponse
> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!canAccessModule(session, 'inventarios')) {
    return NextResponse.json(
      { error: 'Sin acceso al módulo Costos e Inventarios' },
      { status: 403 }
    );
  }
  return session;
}
