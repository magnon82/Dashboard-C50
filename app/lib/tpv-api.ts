import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessAdmin,
  canAccessCorteTpv,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import {
  adminCorteDateWindow,
  isAdminWritableCorteDate,
  isStaffWritableCorteDate,
  staffCorteDateWindow,
} from '@/app/lib/tpv-cortes';

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
 * Staff/Ventas: día operativo CDMX o el día anterior (catch-up).
 * Master/admin: día operativo y hasta 7 días atrás (sin futuro).
 */
export function assertWritableCorteDate(
  session: SessionUser,
  corteDate: string
): NextResponse | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) {
    return NextResponse.json({ error: 'Fecha de corte inválida' }, { status: 400 });
  }
  const { opDay, prevDay } = staffCorteDateWindow();
  if (isTpvAdminWriter(session)) {
    if (isAdminWritableCorteDate(corteDate)) return null;
    const { minDate, maxDate } = adminCorteDateWindow();
    return NextResponse.json(
      {
        error: `Master solo puede cargar el día operativo (${opDay}) o hasta 7 días atrás (${minDate}–${maxDate}). La fecha del corte es la del día de operación (00:00–05:59 → día anterior).`,
        min_date: minDate,
        max_date: maxDate,
        staff_window_date: opDay,
        staff_prev_date: prevDay,
      },
      { status: 403 }
    );
  }
  if (isStaffWritableCorteDate(corteDate)) return null;
  return NextResponse.json(
    {
      error: `Solo puedes subir o editar el corte del día operativo (${opDay}) o del día anterior (${prevDay}). De 00:00 a 05:59 el día operativo ya es el de la noche anterior.`,
      staff_window_date: opDay,
      staff_prev_date: prevDay,
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
