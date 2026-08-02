import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessAdmin,
  canAccessCorteTpv,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import { defaultCorteDateCdmx } from '@/app/lib/tpv-cortes';

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

/** Admin Master (bootstrap) o rol admin con todos los módulos. */
export function isTpvAdminWriter(session: SessionUser): boolean {
  return canAccessAdmin(session) || session.role === 'admin' || session.modules.includes('*');
}

/**
 * Staff/Ventas: solo la fecha de la ventana nocturna (defaultCorteDateCdmx).
 * Admin: cualquier `corte_date` válida (re-subidas / pruebas de días pasados).
 */
export function assertWritableCorteDate(
  session: SessionUser,
  corteDate: string
): NextResponse | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) {
    return NextResponse.json({ error: 'Fecha de corte inválida' }, { status: 400 });
  }
  if (isTpvAdminWriter(session)) return null;
  const staffWindow = defaultCorteDateCdmx();
  if (corteDate === staffWindow) return null;
  return NextResponse.json(
    {
      error: `Solo el admin puede subir o editar cortes de fechas distintas a ${staffWindow} (ventana staff 00:00–05:59 → día anterior).`,
      staff_window_date: staffWindow,
    },
    { status: 403 }
  );
}

/** Hint claro si falta schema/bucket (p. ej. photo_kind / staff_rpt). */
export function tpvSchemaHint(errorMessage: string): string {
  const m = errorMessage.toLowerCase();
  if (
    m.includes('photo_kind') ||
    m.includes('column') ||
    m.includes('schema cache') ||
    m.includes('does not exist') ||
    m.includes('could not find')
  ) {
    return 'Esquema incompleto en producción. En Supabase → SQL Editor ejecuta supabase/staff_corte_prod_fix.sql (idempotente).';
  }
  if (m.includes('bucket') || m.includes('storage') || m.includes('not found')) {
    return '¿Existe el bucket privado tpv-cortes? Ejecuta supabase/staff_corte_prod_fix.sql o supabase/tpv_cortes.sql.';
  }
  return '¿Ejecutaste supabase/staff_corte_prod_fix.sql (o tpv_cortes.sql + tpv_cortes_two_photos.sql)?';
}
