import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessCorteTpv,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';

/**
 * Sesión con acceso a Cortes TPV (Ventas, Staff o admin).
 * Viewers con esos módulos pueden subir cortes.
 */
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
  if (!canAccessCorteTpv(session)) {
    return NextResponse.json(
      {
        error:
          'Sin acceso a Cortes TPV (permiso «Puede hacer el corte» o módulo Ventas)',
      },
      { status: 403 }
    );
  }
  return session;
}
