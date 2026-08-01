import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  canAccessModule,
  type SessionUser,
} from '@/app/lib/auth';

export async function requireReportesSociosSession(): Promise<
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
  if (!canAccessModule(session, 'reportes-socios')) {
    return NextResponse.json(
      { error: 'Sin acceso al módulo Reportes Socios' },
      { status: 403 }
    );
  }
  return session;
}

/** Escritura: Master Panel (admin bootstrap) o sesión con canEdit. */
export async function requireReportesSociosWrite(): Promise<
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
  if (canAccessAdmin(session) || session.canEdit) {
    return session;
  }
  return NextResponse.json(
    { error: 'Solo el administrador puede editar Reportes Socios' },
    { status: 403 }
  );
}
