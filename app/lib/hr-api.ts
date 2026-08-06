import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessAdmin,
  canAccessModule,
  canEditHrEmployees,
  canEditHrSchedules,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import type { SupabaseClient } from '@supabase/supabase-js';

async function readSession(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  return session;
}

/**
 * Acceso módulo `rrhh` (igual que Eventos/Staff: canAccessModule).
 * Futuro (no v1): flags anidados rrhh.payroll / rrhh.expedientes para sueldos y PDFs.
 */
export async function requireRrhhSession(): Promise<SessionUser | NextResponse> {
  const session = await readSession();
  if (session instanceof NextResponse) return session;
  if (!canAccessModule(session, 'rrhh')) {
    return NextResponse.json(
      { error: 'Sin acceso al módulo Recursos Humanos' },
      { status: 403 }
    );
  }
  return session;
}

/** Solo Master bootstrap (DASHBOARD_USER) — p.ej. verificar documentos. */
export function requireMasterAdmin(session: SessionUser): NextResponse | null {
  if (!canAccessAdmin(session)) {
    return NextResponse.json(
      { error: 'Solo el administrador Master puede verificar documentos' },
      { status: 403 }
    );
  }
  return null;
}

/** Staff (piso) o RR.HH. — formularios publicados al personal. */
export async function requireStaffOrRrhhSession(): Promise<
  SessionUser | NextResponse
> {
  const session = await readSession();
  if (session instanceof NextResponse) return session;
  const ok =
    canAccessModule(session, 'staff') || canAccessModule(session, 'rrhh');
  if (!ok) {
    return NextResponse.json(
      { error: 'Sin acceso a Staff / Recursos Humanos' },
      { status: 403 }
    );
  }
  return session;
}

export function sessionHasRrhh(session: SessionUser): boolean {
  return canAccessModule(session, 'rrhh');
}

export function requireRrhhWrite(session: SessionUser): NextResponse | null {
  if (!session.canEdit && session.role !== 'admin') {
    return NextResponse.json(
      { error: 'Sin permiso de edición en RR.HH.' },
      { status: 403 }
    );
  }
  return null;
}

/** Alta / baja / editar ficha de empleados (palomita Master o admin). */
export function requireRrhhEmployeesWrite(
  session: SessionUser
): NextResponse | null {
  if (!canEditHrEmployees(session)) {
    return NextResponse.json(
      { error: 'Sin permiso de edición de empleados' },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Lectura/edición de horarios: módulo `rrhh` o palomita `rrhh.schedules_edit`.
 * Misma fuente de verdad que /rrhh → Horarios (APIs /api/hr/schedules*).
 */
export async function requireSchedulesSession(): Promise<
  SessionUser | NextResponse
> {
  const session = await readSession();
  if (session instanceof NextResponse) return session;
  if (!canEditHrSchedules(session)) {
    return NextResponse.json(
      { error: 'Sin permiso para editar horarios' },
      { status: 403 }
    );
  }
  return session;
}

export function requireSchedulesWrite(
  session: SessionUser
): NextResponse | null {
  if (!canEditHrSchedules(session)) {
    return NextResponse.json(
      { error: 'Sin permiso de edición de horarios' },
      { status: 403 }
    );
  }
  return null;
}

export type HrLinkedEmployee = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  email: string | null;
  suite_username: string | null;
};

/**
 * Vincula sesión Suite → hr_employees (suite_username, email, o nombre).
 */
export async function resolveLinkedEmployee(
  sb: SupabaseClient,
  session: SessionUser
): Promise<HrLinkedEmployee | null> {
  const username = session.username.trim().toLowerCase();
  const select =
    'id, full_name, puesto, area, email, suite_username';

  const byUser = await sb
    .from('hr_employees')
    .select(select)
    .ilike('suite_username', username)
    .maybeSingle();

  if (!byUser.error && byUser.data) {
    return byUser.data as HrLinkedEmployee;
  }

  const byEmail = await sb
    .from('hr_employees')
    .select(select)
    .ilike('email', `${username}%`)
    .eq('status', 'activo')
    .limit(2);

  if (!byEmail.error && byEmail.data?.length === 1) {
    return byEmail.data[0] as HrLinkedEmployee;
  }

  // Nombre: username contenido en full_name (solo si match único)
  const byName = await sb
    .from('hr_employees')
    .select(select)
    .ilike('full_name', `%${username}%`)
    .eq('status', 'activo')
    .limit(2);

  if (!byName.error && byName.data?.length === 1) {
    return byName.data[0] as HrLinkedEmployee;
  }

  return null;
}

export function hrSchemaMissing(message: string | undefined | null): boolean {
  if (!message) return false;
  return /does not exist|schema cache|42P01/i.test(message);
}
