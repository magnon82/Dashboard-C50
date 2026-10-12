import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessModule,
  type SessionUser,
} from '@/app/lib/auth';

export async function requireCalidadSession(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!canAccessModule(session, 'calidad')) {
    return NextResponse.json({ error: 'Sin acceso al módulo Calidad' }, { status: 403 });
  }
  return session;
}

export function calidadQueryError(err: unknown): { status: number; error: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes('calidad_resumen') ||
    lower.includes('calidad_comentarios') ||
    lower.includes('calidad_encuestas') ||
    lower.includes('schema cache') ||
    lower.includes('pgrst202') ||
    lower.includes('does not exist')
  ) {
    return {
      status: 503,
      error:
        'Falta preparar la base de Calidad. Ejecuta supabase/calidad_encuestas.sql en Supabase y corre el sync de encuestas.',
    };
  }
  return { status: 502, error: 'No se pudieron cargar las encuestas de Calidad.' };
}
