import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessModule,
  type SessionUser,
} from '@/app/lib/auth';
import type { RecetaArea } from '@/app/lib/recetario-types';

export async function requireRecetarioSession(
  area: RecetaArea
): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!canAccessModule(session, area)) {
    return NextResponse.json({ error: 'Sin acceso a este módulo' }, { status: 403 });
  }
  return session;
}
