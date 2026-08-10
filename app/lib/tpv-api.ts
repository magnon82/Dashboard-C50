import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessAdmin,
  canAccessCorteTpv,
  canClosePendingCortes,
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
 * Master/admin o palomita `staff.corte_pendientes`: ventana 7 días (sin futuro).
 */
export function assertWritableCorteDate(
  session: SessionUser,
  corteDate: string
): NextResponse | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) {
    return NextResponse.json({ error: 'Fecha de corte inválida' }, { status: 400 });
  }
  const { opDay, prevDay } = staffCorteDateWindow();
  if (isStaffWritableCorteDate(corteDate)) return null;

  if (isTpvAdminWriter(session) || canClosePendingCortes(session)) {
    if (isAdminWritableCorteDate(corteDate)) return null;
    const { minDate, maxDate } = adminCorteDateWindow();
    return NextResponse.json(
      {
        error: `Solo puedes cargar el día operativo (${opDay}) o pendientes desde el 1 de agosto (${minDate}–${maxDate}). La fecha del corte es la del día de operación (00:00–05:59 → día anterior).`,
        min_date: minDate,
        max_date: maxDate,
        staff_window_date: opDay,
        staff_prev_date: prevDay,
      },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      error: `Solo puedes subir o editar el corte del día operativo (${opDay}) o del día anterior (${prevDay}). Días más atrás: permiso «Cortes pendientes» en Master.`,
      staff_window_date: opDay,
      staff_prev_date: prevDay,
    },
    { status: 403 }
  );
}

/**
 * Cierre RPT (staff-corte): staff = hoy/ayer; días más atrás Master o
 * palomita `staff.corte_pendientes` (ventana 7 días calendario).
 */
export function assertStaffCorteWritableDate(
  session: SessionUser,
  corteDate: string
): NextResponse | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) {
    return NextResponse.json({ error: 'Fecha de corte inválida' }, { status: 400 });
  }
  const { opDay, prevDay } = staffCorteDateWindow();
  if (isStaffWritableCorteDate(corteDate)) return null;

  if (canClosePendingCortes(session)) {
    if (isAdminWritableCorteDate(corteDate)) return null;
    const { minDate, maxDate } = adminCorteDateWindow();
    return NextResponse.json(
      {
        error: `Solo puedes cerrar el día operativo (${opDay}) o pendientes desde el 1 de agosto (${minDate}–${maxDate}).`,
        min_date: minDate,
        max_date: maxDate,
        staff_window_date: opDay,
        staff_prev_date: prevDay,
      },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      error: `Solo puedes cerrar el corte del día operativo (${opDay}) o del día anterior (${prevDay}). Días más atrás: permiso «Cortes pendientes» en Master.`,
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
    m.includes('could not find') ||
    m.includes('staff_rpt_diario') ||
    m.includes('tpv_corte_uploads')
  ) {
    return 'Esquema incompleto en producción. En Supabase → SQL Editor ejecuta TODO supabase/staff_corte_prod_fix.sql (idempotente) y vuelve a intentar.';
  }
  if (m.includes('bucket') || m.includes('storage') || m.includes('not found')) {
    return '¿Existe el bucket privado tpv-cortes? Ejecuta supabase/staff_corte_prod_fix.sql o supabase/tpv_cortes.sql.';
  }
  return '¿Ejecutaste supabase/staff_corte_prod_fix.sql (o tpv_cortes.sql + staff_rpt_diario.sql)?';
}

/** Errores PostgREST/Postgres de tabla o columna ausente (fallar rápido, no OCR). */
export function isTpvSchemaError(message: string | null | undefined): boolean {
  const m = String(message || '');
  return /photo_kind|staff_rpt_diario|tpv_corte_uploads|schema cache|does not exist|Could not find the|PGRST204|PGRST205|42P01|42703|relation .* does not exist/i.test(
    m
  );
}

/**
 * Respuesta rápida (400) cuando falta schema — evita 504 por OCR/timeouts.
 * Spanish message for Staff UI.
 */
export function tpvSchemaMissingResponse(
  errorMessage: string,
  extras?: Record<string, unknown>
): NextResponse {
  const m = String(errorMessage || '');
  let error =
    'Falta esquema de Corte del día en Supabase. Ejecuta supabase/staff_corte_prod_fix.sql';
  if (/photo_kind/i.test(m)) {
    error =
      'Falta la columna photo_kind en tpv_corte_uploads. Ejecuta supabase/staff_corte_prod_fix.sql';
  } else if (/staff_rpt_diario/i.test(m)) {
    error =
      'Falta la tabla staff_rpt_diario. Ejecuta supabase/staff_corte_prod_fix.sql';
  } else if (/tpv_corte_uploads/i.test(m)) {
    error =
      'Falta la tabla tpv_corte_uploads. Ejecuta supabase/staff_corte_prod_fix.sql';
  }
  return NextResponse.json(
    {
      error,
      schemaMissing: true,
      hint: tpvSchemaHint(m),
      detail: m.slice(0, 240),
      ...(extras || {}),
    },
    { status: 400 }
  );
}

/**
 * Probe barato: ¿existe photo_kind? Si no, falla antes de OCR (evita 504).
 * null = OK; string = mensaje de error de schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client
export async function probeTpvPhotoKindColumn(sb: any): Promise<string | null> {
  const { error } = await sb
    .from('tpv_corte_uploads')
    .select('photo_kind')
    .limit(1);
  if (error && isTpvSchemaError(error.message)) return error.message;
  if (error) return error.message;
  return null;
}
