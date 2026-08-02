import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhEmployeesWrite,
} from '@/app/lib/hr-api';
import {
  plantillaTeamGroup,
  type HrEmployee,
  type HrEmployeeStatus,
} from '@/app/lib/hr';
import {
  hasDualLimpiezaServicio,
  parseRolesFromBody,
  syncDualFlagInNotes,
} from '@/app/lib/hr-puestos';
import {
  invalidatePlantillaCache,
  resolvePlantillaVigente,
} from '@/app/lib/hr-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMP_SELECT_FULL =
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

const EMP_SELECT_NO_ROLES =
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

const EMP_SELECT_NO_DOB =
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

const EMP_SELECT_MIN =
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

function areaFromPuesto(puesto: string | null): string | null {
  if (!puesto) return null;
  const team = plantillaTeamGroup(puesto);
  if (team === 'cocina') return 'Cocina';
  if (team === 'admin') return 'Administrativo';
  if (team === 'piso') return 'Piso';
  return null;
}

function parseIsoDateField(
  value: unknown,
  field: string
): { ok: true; set: false } | { ok: true; set: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, set: false };
  if (value == null || value === '') return { ok: true, set: true, value: null };
  const iso = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { ok: false, error: `${field} inválida (usa YYYY-MM-DD)` };
  }
  return { ok: true, set: true, value: iso };
}

let lastNacimientoFillAt = 0;
const NACIMIENTO_FILL_TTL_MS = 5 * 60_000;

async function maybeFillNacimientoFromBaseDatos(): Promise<{
  filled: boolean;
  message?: string;
}> {
  const now = Date.now();
  if (now - lastNacimientoFillAt < NACIMIENTO_FILL_TTL_MS) {
    return { filled: false, message: 'skipped_ttl' };
  }
  lastNacimientoFillAt = now;
  try {
    const { loadBaseDatosRows } = await import('@/app/lib/hr-payroll-drive');
    const { enrichEmployeesFromBaseDatos } = await import(
      '@/app/lib/hr-payroll-sync'
    );
    const { rows } = await loadBaseDatosRows();
    if (!rows.length) return { filled: false, message: 'base_datos_empty' };
    const sb = getServiceSupabase();
    await enrichEmployeesFromBaseDatos(sb, rows);
    invalidatePlantillaCache();
    return { filled: true };
  } catch (e) {
    return {
      filled: false,
      message: e instanceof Error ? e.message : 'fill_error',
    };
  }
}

/**
 * GET /api/hr/employees
 * Plantilla vigente = unión de última nómina conciliada + personas con turnos
 * reales en la última semana de horarios → seed opcional.
 * Excluye baja / force_exclude / fecha_baja.
 * ?source=activos → fuerza lista de activos (Horarios / catálogo overrides).
 * ?seed=0 → no intenta seed local.
 * ?fill_nacimiento=1 → soft-fill fecha_nacimiento desde BASE DATOS PERSONAL.
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const forceActivos = url.searchParams.get('source') === 'activos';
  const seedDisabled = url.searchParams.get('seed') === '0';
  const fillNacimiento = url.searchParams.get('fill_nacimiento') === '1';

  let nacimientoFill: { filled: boolean; message?: string } | null = null;
  if (fillNacimiento) {
    nacimientoFill = await maybeFillNacimientoFromBaseDatos();
  }

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
          nacimientoFill,
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
        nacimientoFill,
      });
    }

    const EMP_ACTIVOS =
      'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';
    const EMP_ACTIVOS_NO_ROLES =
      'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, fecha_nacimiento, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';
    const EMP_ACTIVOS_BAJA =
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
      /puestos_secundarios|column .* does not exist|42703/i.test(
        fallback.error.message
      )
    ) {
      fallback = (await sb
        .from('hr_employees')
        .select(EMP_ACTIVOS_NO_ROLES)
        .eq('status', 'activo')
        .eq('force_exclude', false)
        .order('full_name', { ascending: true })) as typeof fallback;
    }

    if (
      fallback.error &&
      /fecha_nacimiento|column .* does not exist|42703/i.test(
        fallback.error.message
      )
    ) {
      fallback = (await sb
        .from('hr_employees')
        .select(EMP_ACTIVOS_BAJA)
        .eq('status', 'activo')
        .eq('force_exclude', false)
        .order('full_name', { ascending: true })) as typeof fallback;
    }

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
        nacimientoFill,
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
      nacimientoFill,
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
        nacimientoFill,
      },
      { status: 200 }
    );
  }
}

/**
 * POST /api/hr/employees — alta en plantilla.
 * Body: { full_name, puesto?, fecha_ingreso?, area?, notes? }
 * Crea status=activo + force_include (aparece en plantilla sin nómina aún).
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const fullName = String(body.full_name || '').trim().replace(/\s+/g, ' ');
  if (fullName.length < 3) {
    return NextResponse.json(
      { error: 'Nombre completo requerido (mín. 3 caracteres)' },
      { status: 400 }
    );
  }

  const rolesParsed = parseRolesFromBody(body);
  if (!rolesParsed.ok) {
    return NextResponse.json({ error: rolesParsed.error }, { status: 400 });
  }
  const puesto =
    rolesParsed.roles.primary ||
    (body.puesto == null
      ? null
      : String(body.puesto).trim().replace(/\s+/g, ' ') || null);
  const puestosSecundarios = rolesParsed.roles.secondary;
  const areaExplicit =
    body.area == null ? null : String(body.area).trim() || null;
  const area = areaExplicit || areaFromPuesto(puesto);

  const ingreso = parseIsoDateField(body.fecha_ingreso, 'fecha_ingreso');
  if (!ingreso.ok) {
    return NextResponse.json({ error: ingreso.error }, { status: 400 });
  }
  const fechaIngreso = ingreso.set ? ingreso.value : null;

  const notesRaw =
    body.notes != null && String(body.notes).trim()
      ? String(body.notes).trim()
      : null;
  const notes = syncDualFlagInNotes(
    notesRaw,
    hasDualLimpiezaServicio({
      puesto,
      puestos_secundarios: puestosSecundarios,
      notes: notesRaw,
      full_name: fullName,
    })
  );

  try {
    const sb = getServiceSupabase();
    const nowIso = new Date().toISOString();
    const row: Record<string, unknown> = {
      full_name: fullName,
      status: 'activo',
      puesto,
      puestos_secundarios: puestosSecundarios,
      area,
      fecha_ingreso: fechaIngreso,
      force_include: true,
      force_exclude: false,
      fecha_baja: null,
      source: 'manual',
      notes,
      updated_at: nowIso,
    };

    let { data, error } = await sb
      .from('hr_employees')
      .insert(row)
      .select(EMP_SELECT_FULL)
      .single();

    if (error && /puestos_secundarios/i.test(error.message)) {
      const { puestos_secundarios: _ps, ...withoutRoles } = row;
      void _ps;
      const retry = await sb
        .from('hr_employees')
        .insert(withoutRoles)
        .select(EMP_SELECT_NO_ROLES)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
      if (!error) {
        return NextResponse.json(
          {
            ready: true,
            employee: data,
            message:
              'Alta registrada. Ejecuta supabase/hr_employee_puestos.sql para roles secundarios.',
            hint: 'supabase/hr_employee_puestos.sql',
          },
          { status: 201 }
        );
      }
    }

    if (
      error &&
      /fecha_nacimiento|column .* does not exist|42703/i.test(error.message)
    ) {
      const { puestos_secundarios: _ps, ...withoutRoles } = row;
      void _ps;
      const retry = await sb
        .from('hr_employees')
        .insert(withoutRoles)
        .select(EMP_SELECT_NO_DOB)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (
      error &&
      /fecha_baja|column .* does not exist|42703/i.test(error.message)
    ) {
      const { fecha_baja: _fb, ...withoutBaja } = row;
      void _fb;
      const retry = await sb
        .from('hr_employees')
        .insert(withoutBaja)
        .select(
          'id, full_name, status, puesto, area, fecha_ingreso, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes'
        )
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (error || !data) {
      const missing = hrSchemaMissing(error?.message);
      return NextResponse.json(
        {
          error: missing
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : error?.message || 'No se pudo dar de alta',
        },
        { status: missing ? 503 : 400 }
      );
    }

    invalidatePlantillaCache();

    try {
      const { checklistSeedRows } = await import(
        '@/app/lib/hr-employee-profile'
      );
      await sb.from('hr_employee_documents').insert(
        checklistSeedRows((data as HrEmployee).id)
      );
    } catch {
      /* tabla aún no migrada — perfil pedirá SQL */
    }

    return NextResponse.json({
      ready: true,
      employee: data as HrEmployee,
      message: `Alta registrada: ${fullName}. Completa el perfil (documentos) desde el nombre en plantilla.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/hr/employees
 * RH: ficha, overrides, alta/reactivación y baja.
 * Body: { id, force_include?, force_exclude?, suite_username?, email?, phone?,
 *         puesto?, area?, sueldo_diario?, fecha_nacimiento?, fecha_ingreso?, fecha_baja?,
 *         status?: 'activo'|'baja'|'suspendido', full_name?,
 *         action?: 'baja'|'alta' }
 * action=baja → status baja + force_exclude + fecha_baja (requerida).
 * action=alta → status activo + force_include + limpia fecha_baja.
 */
export async function PATCH(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
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

  const action =
    body.action === 'baja' || body.action === 'alta'
      ? (body.action as 'baja' | 'alta')
      : null;

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (action === 'baja') {
    const baja = parseIsoDateField(body.fecha_baja, 'fecha_baja');
    if (!baja.ok) {
      return NextResponse.json({ error: baja.error }, { status: 400 });
    }
    if (!baja.set || !baja.value) {
      return NextResponse.json(
        { error: 'fecha_baja (YYYY-MM-DD) es obligatoria para dar de baja' },
        { status: 400 }
      );
    }
    patch.status = 'baja';
    patch.fecha_baja = baja.value;
    patch.force_exclude = true;
    patch.force_include = false;
  } else if (action === 'alta') {
    patch.status = 'activo';
    patch.fecha_baja = null;
    patch.force_exclude = false;
    patch.force_include = true;
    const ingreso = parseIsoDateField(body.fecha_ingreso, 'fecha_ingreso');
    if (!ingreso.ok) {
      return NextResponse.json({ error: ingreso.error }, { status: 400 });
    }
    if (ingreso.set) patch.fecha_ingreso = ingreso.value;
  }

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
  if (body.full_name !== undefined) {
    const n = String(body.full_name || '').trim().replace(/\s+/g, ' ');
    if (n.length < 3) {
      return NextResponse.json(
        { error: 'Nombre completo inválido' },
        { status: 400 }
      );
    }
    patch.full_name = n;
  }
  const rolesTouched =
    body.puesto !== undefined ||
    body.puestos_secundarios !== undefined ||
    Array.isArray(body.puestos) ||
    Array.isArray(body.roles);
  if (rolesTouched) {
    const rolesParsed = parseRolesFromBody(body);
    if (!rolesParsed.ok) {
      return NextResponse.json({ error: rolesParsed.error }, { status: 400 });
    }
    // Si solo mandan secundarios, no borrar puesto existente salvo que venga puesto/roles
    if (
      body.puesto !== undefined ||
      Array.isArray(body.puestos) ||
      Array.isArray(body.roles)
    ) {
      patch.puesto = rolesParsed.roles.primary;
    }
    if (
      body.puestos_secundarios !== undefined ||
      Array.isArray(body.puestos) ||
      Array.isArray(body.roles)
    ) {
      patch.puestos_secundarios = rolesParsed.roles.secondary;
    }
    if (body.area === undefined && patch.puesto) {
      const inferred = areaFromPuesto(String(patch.puesto));
      if (inferred) patch.area = inferred;
    }
  }
  if (body.area !== undefined) {
    patch.area = body.area == null ? null : String(body.area).trim() || null;
  }
  if (body.notes !== undefined || rolesTouched) {
    const notesIn =
      body.notes !== undefined
        ? body.notes == null
          ? null
          : String(body.notes).trim() || null
        : undefined;
    // Sync dual flag cuando hay roles; si notes no viene, se fusiona en update abajo
    if (notesIn !== undefined) {
      patch.notes = syncDualFlagInNotes(
        notesIn,
        hasDualLimpiezaServicio({
          puesto: (patch.puesto as string | null | undefined) ?? null,
          puestos_secundarios:
            (patch.puestos_secundarios as string[] | undefined) ?? [],
          notes: notesIn,
        })
      );
    }
  }
  if (body.sueldo_diario !== undefined) {
    if (body.sueldo_diario == null || body.sueldo_diario === '') {
      patch.sueldo_diario = null;
    } else {
      const n = Number(String(body.sueldo_diario).replace(/,/g, '').trim());
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: 'sueldo_diario inválido' },
          { status: 400 }
        );
      }
      patch.sueldo_diario = Math.round(n * 100) / 100;
    }
  }
  if (body.status !== undefined && !action) {
    const st = String(body.status).trim() as HrEmployeeStatus;
    if (!['activo', 'baja', 'suspendido'].includes(st)) {
      return NextResponse.json({ error: 'status inválido' }, { status: 400 });
    }
    patch.status = st;
    if (st === 'baja') {
      patch.force_exclude = true;
      patch.force_include = false;
    }
  }

  const ingresoPatch = parseIsoDateField(body.fecha_ingreso, 'fecha_ingreso');
  if (!ingresoPatch.ok) {
    return NextResponse.json({ error: ingresoPatch.error }, { status: 400 });
  }
  if (ingresoPatch.set && action !== 'alta') {
    patch.fecha_ingreso = ingresoPatch.value;
  }

  const bajaPatch = parseIsoDateField(body.fecha_baja, 'fecha_baja');
  if (!bajaPatch.ok) {
    return NextResponse.json({ error: bajaPatch.error }, { status: 400 });
  }
  if (bajaPatch.set && action !== 'baja' && action !== 'alta') {
    patch.fecha_baja = bajaPatch.value;
  }

  if (body.fecha_nacimiento !== undefined) {
    if (body.fecha_nacimiento == null || body.fecha_nacimiento === '') {
      patch.fecha_nacimiento = null;
    } else {
      const iso = String(body.fecha_nacimiento).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return NextResponse.json(
          { error: 'fecha_nacimiento inválida (usa YYYY-MM-DD)' },
          { status: 400 }
        );
      }
      patch.fecha_nacimiento = iso;
    }
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
    let { data, error } = await sb
      .from('hr_employees')
      .update(patch)
      .eq('id', id)
      .select(EMP_SELECT_FULL)
      .maybeSingle();

    if (
      error &&
      /sueldo_diario|column .* does not exist|42703/i.test(error.message) &&
      patch.sueldo_diario !== undefined
    ) {
      return NextResponse.json(
        {
          error:
            'Falta columna sueldo_diario. Ejecuta supabase/hr_employee_sueldo.sql en Supabase.',
        },
        { status: 503 }
      );
    }

    if (
      error &&
      /fecha_nacimiento|column .* does not exist|42703/i.test(error.message)
    ) {
      const { fecha_nacimiento: _dob, ...withoutDob } = patch;
      void _dob;
      const retry = await sb
        .from('hr_employees')
        .update(withoutDob)
        .eq('id', id)
        .select(EMP_SELECT_NO_DOB)
        .maybeSingle();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (
      error &&
      /sueldo_diario|column .* does not exist|42703/i.test(error.message)
    ) {
      const { sueldo_diario: _sd, ...withoutSd } = patch;
      void _sd;
      const retry = await sb
        .from('hr_employees')
        .update(withoutSd)
        .eq('id', id)
        .select(EMP_SELECT_MIN)
        .maybeSingle();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (
      error &&
      /fecha_baja|column .* does not exist|42703/i.test(error.message)
    ) {
      const { fecha_baja: _fb, ...withoutBaja } = patch;
      void _fb;
      if (action === 'baja') {
        return NextResponse.json(
          {
            error:
              'Falta columna fecha_baja. Ejecuta supabase/hr_employee_baja.sql en Supabase.',
          },
          { status: 503 }
        );
      }
      const retry = await sb
        .from('hr_employees')
        .update(withoutBaja)
        .eq('id', id)
        .select(EMP_SELECT_MIN)
        .maybeSingle();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (error) {
      const missing = hrSchemaMissing(error.message);
      const missingDob = /fecha_nacimiento|column .* does not exist|42703/i.test(
        error.message
      );
      const dup = /unique|duplicate|hr_employees_suite_username/i.test(
        error.message
      );
      return NextResponse.json(
        {
          error: missingDob
            ? 'Ejecuta supabase/hr_employee_nacimiento.sql en Supabase.'
            : missing
              ? 'Ejecuta supabase/hr_module.sql en Supabase.'
              : dup
                ? 'Ese suite_username ya está vinculado a otro colaborador.'
                : error.message,
        },
        { status: missing || missingDob ? 503 : dup ? 409 : 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 });
    }

    invalidatePlantillaCache();
    const message =
      action === 'baja'
        ? `Baja registrada (${String(patch.fecha_baja)}). Fuera de plantilla vigente.`
        : action === 'alta'
          ? 'Reactivado en plantilla (force_include).'
          : 'Ficha actualizada.';
    return NextResponse.json({
      ready: true,
      employee: data as HrEmployee,
      message,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
