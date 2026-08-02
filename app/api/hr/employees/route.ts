import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import type { HrEmployee } from '@/app/lib/hr';
import {
  invalidatePlantillaCache,
  resolvePlantillaVigente,
} from '@/app/lib/hr-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/employees
 * Plantilla vigente = unión de última nómina conciliada + personas con turnos
 * reales en la última semana de horarios → seed opcional.
 * Excluye baja / force_exclude / fecha_baja.
 * ?source=activos → fuerza lista de activos (Horarios / catálogo overrides).
 * ?seed=0 → no intenta seed local.
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const forceActivos = url.searchParams.get('source') === 'activos';
  const seedDisabled = url.searchParams.get('seed') === '0';

  try {
    const sb = getServiceSupabase();

    if (!forceActivos) {
      const resolved = await resolvePlantillaVigente(sb, {
        allowSeed: !seedDisabled,
        username: auth.username,
      });

      if (resolved.employees.length > 0) {
        return NextResponse.json({
          ready: true,
          source: resolved.source,
          employees: resolved.employees,
          count: resolved.employees.length,
          periodLabel: resolved.period?.label ?? null,
          periodEnd: resolved.period?.period_end ?? null,
          paidAt: resolved.period?.paid_at ?? null,
          periodStatus: resolved.period?.status ?? null,
          scheduleWeekStart: resolved.scheduleWeek?.week_start ?? null,
          scheduleWeekEnd: resolved.scheduleWeek?.week_end ?? null,
          scheduleWeekStatus: resolved.scheduleWeek?.status ?? null,
          seeded: resolved.seeded,
          message: resolved.seedMessage,
          code: resolved.seedCode ?? 'ok',
        });
      }

      return NextResponse.json({
        ready: resolved.seedCode !== 'schema_missing',
        source: resolved.source,
        employees: [] as HrEmployee[],
        count: 0,
        periodLabel: null,
        periodEnd: null,
        paidAt: null,
        periodStatus: null,
        scheduleWeekStart: null,
        scheduleWeekEnd: null,
        scheduleWeekStatus: null,
        seeded: false,
        message:
          resolved.seedMessage ||
          'Abre Nómina (cierra/paga) o importa horarios con turnos reales',
        code: resolved.seedCode ?? 'empty',
      });
    }

    const EMP_ACTIVOS =
      'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';
    const EMP_ACTIVOS_BASE =
      'id, full_name, status, puesto, area, fecha_ingreso, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

    let fallback = await sb
      .from('hr_employees')
      .select(EMP_ACTIVOS)
      .eq('status', 'activo')
      .eq('force_exclude', false)
      .order('full_name', { ascending: true });

    if (
      fallback.error &&
      /fecha_baja|column .* does not exist|42703/i.test(fallback.error.message)
    ) {
      fallback = (await sb
        .from('hr_employees')
        .select(EMP_ACTIVOS_BASE)
        .eq('status', 'activo')
        .eq('force_exclude', false)
        .order('full_name', { ascending: true })) as typeof fallback;
    }

    if (fallback.error) {
      return NextResponse.json({
        ready: false,
        source: 'none',
        employees: [] as HrEmployee[],
        count: 0,
        periodLabel: null,
        periodEnd: null,
        paidAt: null,
        message:
          'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.',
        error: fallback.error.message,
        code: 'schema_missing',
      });
    }

    const employees = (fallback.data || []) as HrEmployee[];
    return NextResponse.json({
      ready: true,
      source: 'activos_forced',
      employees,
      count: employees.length,
      periodLabel: null,
      periodEnd: null,
      paidAt: null,
      message:
        employees.length === 0
          ? 'No hay empleados activos en catálogo.'
          : null,
      code: 'ok',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    const missing = hrSchemaMissing(msg);
    return NextResponse.json(
      {
        ready: false,
        source: 'none',
        employees: [],
        count: 0,
        periodLabel: null,
        periodEnd: null,
        paidAt: null,
        message: missing
          ? 'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.'
          : 'Error al cargar plantilla',
        error: msg,
        code: missing ? 'schema_missing' : 'seed_error',
      },
      { status: 200 }
    );
  }
}

/**
 * PATCH /api/hr/employees
 * RH: force_include / force_exclude / suite_username (+ contacto ligero).
 * Body: { id, force_include?, force_exclude?, suite_username?, email?, phone?, puesto?, area? }
 */
export async function PATCH(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = String(body.id || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.force_include === 'boolean') {
    patch.force_include = body.force_include;
  }
  if (typeof body.force_exclude === 'boolean') {
    patch.force_exclude = body.force_exclude;
  }
  if (body.suite_username !== undefined) {
    const u = body.suite_username == null ? '' : String(body.suite_username).trim();
    patch.suite_username = u.length ? u.toLowerCase() : null;
  }
  if (body.email !== undefined) {
    patch.email = body.email == null ? null : String(body.email).trim() || null;
  }
  if (body.phone !== undefined) {
    patch.phone = body.phone == null ? null : String(body.phone).trim() || null;
  }
  if (body.puesto !== undefined) {
    patch.puesto =
      body.puesto == null ? null : String(body.puesto).trim() || null;
  }
  if (body.area !== undefined) {
    patch.area = body.area == null ? null : String(body.area).trim() || null;
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json(
      { error: 'Nada que actualizar' },
      { status: 400 }
    );
  }

  if (patch.force_include === true) patch.force_exclude = false;
  if (patch.force_exclude === true) patch.force_include = false;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_employees')
      .update(patch)
      .eq('id', id)
      .select(
        'id, full_name, status, puesto, area, fecha_ingreso, email, phone, drive_folder_path, suite_username, force_include, force_exclude'
      )
      .maybeSingle();

    if (error) {
      const missing = hrSchemaMissing(error.message);
      const dup = /unique|duplicate|hr_employees_suite_username/i.test(
        error.message
      );
      return NextResponse.json(
        {
          error: missing
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : dup
              ? 'Ese suite_username ya está vinculado a otro colaborador.'
              : error.message,
        },
        { status: missing ? 503 : dup ? 409 : 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 });
    }

    invalidatePlantillaCache();
    return NextResponse.json({
      ready: true,
      employee: data as HrEmployee,
      message: 'Ficha actualizada.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
