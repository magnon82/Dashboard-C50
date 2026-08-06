import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhEmployeesWrite,
  requireSchedulesSession,
} from '@/app/lib/hr-api';
import {
  formatEmployeeAreas,
  parseEmployeeAreas,
  plantillaTeamGroup,
  syncExternoFlagInNotes,
  defaultRequiereDocumentacion,
  type HrEmployee,
  type HrEmployeeStatus,
  type HrTipoEmpleo,
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
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes, tipo_empleo, requiere_documentacion';

const EMP_SELECT_FULL_NO_TIPO =
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

const EMP_SELECT_NO_ROLES =
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes, tipo_empleo, requiere_documentacion';

const EMP_SELECT_NO_DOB =
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

const EMP_SELECT_MIN =
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

function missingTipoEmpleoColumn(message: string): boolean {
  return /tipo_empleo|requiere_documentacion/i.test(message);
}

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
/** Soft-fill must not block Cumpleaños; Drive/OCR can stall for minutes. */
const NACIMIENTO_FILL_TIMEOUT_MS = 6_000;

async function probeFechaNacimientoColumn(
  sb: ReturnType<typeof getServiceSupabase>
): Promise<boolean> {
  const { error } = await sb
    .from('hr_employees')
    .select('fecha_nacimiento')
    .limit(1);
  if (
    error &&
    /fecha_nacimiento|column .* does not exist|42703/i.test(error.message || '')
  ) {
    return false;
  }
  return true;
}

/**
 * Soft-fill DOB from BASE DATOS PERSONAL only (no OCR).
 * Doc/acta extraction belongs on profile load — doing it here hung Cumpleaños.
 */
async function maybeFillNacimientoFromBaseDatos(): Promise<{
  filled: boolean;
  message?: string;
  columnMissing?: boolean;
}> {
  const now = Date.now();
  if (now - lastNacimientoFillAt < NACIMIENTO_FILL_TTL_MS) {
    return { filled: false, message: 'skipped_ttl' };
  }
  try {
    const sb = getServiceSupabase();
    const hasCol = await probeFechaNacimientoColumn(sb);
    if (!hasCol) {
      lastNacimientoFillAt = Date.now();
      return {
        filled: false,
        message: 'column_missing',
        columnMissing: true,
      };
    }

    const { loadBaseDatosRows } = await import('@/app/lib/hr-payroll-drive');
    const { enrichEmployeesFromBaseDatos } = await import(
      '@/app/lib/hr-payroll-sync'
    );
    let fromBase = false;
    try {
      const { rows } = await loadBaseDatosRows();
      if (rows.length) {
        await enrichEmployeesFromBaseDatos(sb, rows);
        fromBase = true;
      }
    } catch {
      /* BASE DATOS opcional */
    }

    lastNacimientoFillAt = Date.now();
    invalidatePlantillaCache();
    if (!fromBase) {
      return { filled: false, message: 'nothing_to_fill' };
    }
    return { filled: true, message: 'base_datos' };
  } catch (e) {
    lastNacimientoFillAt = Date.now();
    return {
      filled: false,
      message: e instanceof Error ? e.message : 'fill_error',
    };
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * GET /api/hr/employees
 * Plantilla vigente = unión de última nómina conciliada + personas con turnos
 * reales en la última semana de horarios → seed opcional.
 * Excluye baja / force_exclude / fecha_baja.
 * ?source=activos → fuerza lista de activos (Horarios / catálogo overrides).
 * ?seed=0 → no intenta seed local.
 * ?fill_nacimiento=1 → soft-fill fecha_nacimiento desde BASE DATOS PERSONAL
 *   (TTL 5 min; timeout 6s; sin OCR de expedientes).
 */
export async function GET(request: Request) {
  // Lectura para RR.HH. y editores de horarios (Staff con palomita).
  const auth = await requireSchedulesSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const forceActivos = url.searchParams.get('source') === 'activos';
  const seedDisabled = url.searchParams.get('seed') === '0';
  const fillNacimiento = url.searchParams.get('fill_nacimiento') === '1';

  let nacimientoFill: {
    filled: boolean;
    message?: string;
    columnMissing?: boolean;
  } | null = null;

  try {
    const sb = getServiceSupabase();

    // Soft-fill en paralelo al probe; timeout evita colgar Cumpleaños.
    const fillPromise = fillNacimiento
      ? withTimeout(maybeFillNacimientoFromBaseDatos(), NACIMIENTO_FILL_TIMEOUT_MS, {
          filled: false,
          message: 'fill_timeout',
        })
      : Promise.resolve(null);

    const [nacimientoColumnOk, fillResult] = await Promise.all([
      probeFechaNacimientoColumn(sb),
      fillPromise,
    ]);
    nacimientoFill = fillResult;
    const nacimientoSchemaHint = !nacimientoColumnOk
      ? 'Ejecuta supabase/hr_employee_nacimiento.sql en Supabase.'
      : null;

    if (nacimientoFill?.filled) {
      invalidatePlantillaCache();
    }

    if (!forceActivos) {
      const resolved = await resolvePlantillaVigente(sb, {
        allowSeed: !seedDisabled,
        username: auth.username,
      });

      const code =
        !nacimientoColumnOk
          ? 'nacimiento_schema_missing'
          : resolved.seedCode ?? 'ok';

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
          message: resolved.seedMessage || nacimientoSchemaHint,
          code,
          nacimientoFill,
          nacimientoColumnMissing: !nacimientoColumnOk,
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
          nacimientoSchemaHint ||
          'Abre Nómina (cierra/paga) o importa horarios con turnos reales',
        code:
          !nacimientoColumnOk
            ? 'nacimiento_schema_missing'
            : resolved.seedCode ?? 'empty',
        nacimientoFill,
        nacimientoColumnMissing: !nacimientoColumnOk,
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
        nacimientoColumnMissing: !nacimientoColumnOk,
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
          : nacimientoSchemaHint,
      code: !nacimientoColumnOk ? 'nacimiento_schema_missing' : 'ok',
      nacimientoFill,
      nacimientoColumnMissing: !nacimientoColumnOk,
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
 * Body: { full_name, puesto?, fecha_ingreso?, area?, notes?,
 *         tipo_empleo?: 'interno'|'externo', requiere_documentacion?: boolean }
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

  let tipoEmpleo: HrTipoEmpleo = 'interno';
  if (body.tipo_empleo != null) {
    const t = String(body.tipo_empleo).trim().toLowerCase();
    if (t !== 'interno' && t !== 'externo') {
      return NextResponse.json(
        { error: 'tipo_empleo debe ser interno o externo' },
        { status: 400 }
      );
    }
    tipoEmpleo = t;
  }

  const requiereDocumentacion =
    typeof body.requiere_documentacion === 'boolean'
      ? body.requiere_documentacion
      : defaultRequiereDocumentacion(tipoEmpleo);

  const notesRaw =
    body.notes != null && String(body.notes).trim()
      ? String(body.notes).trim()
      : null;
  let notes = syncDualFlagInNotes(
    notesRaw,
    hasDualLimpiezaServicio({
      puesto,
      puestos_secundarios: puestosSecundarios,
      notes: notesRaw,
      full_name: fullName,
    })
  );
  notes = syncExternoFlagInNotes(notes, tipoEmpleo === 'externo');

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
      tipo_empleo: tipoEmpleo,
      requiere_documentacion: requiereDocumentacion,
      updated_at: nowIso,
    };

    let { data, error } = await sb
      .from('hr_employees')
      .insert(row)
      .select(EMP_SELECT_FULL)
      .single();

    if (error && missingTipoEmpleoColumn(error.message)) {
      const {
        tipo_empleo: _te,
        requiere_documentacion: _rd,
        ...withoutTipo
      } = row;
      void _te;
      void _rd;
      const retry = await sb
        .from('hr_employees')
        .insert(withoutTipo)
        .select(EMP_SELECT_FULL_NO_TIPO)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (error && /puestos_secundarios/i.test(error.message)) {
      const {
        puestos_secundarios: _ps,
        tipo_empleo: _te,
        requiere_documentacion: _rd,
        ...base
      } = row;
      void _ps;
      // Preferir insert con tipo si la columna existe; si no, sin tipo.
      let retry = await sb
        .from('hr_employees')
        .insert({
          ...base,
          tipo_empleo: row.tipo_empleo,
          requiere_documentacion: row.requiere_documentacion,
        })
        .select(EMP_SELECT_NO_ROLES)
        .single();
      if (retry.error && missingTipoEmpleoColumn(retry.error.message)) {
        retry = await sb
          .from('hr_employees')
          .insert(base)
          .select(EMP_SELECT_MIN)
          .single();
      }
      void _te;
      void _rd;
      data = retry.data as typeof data;
      error = retry.error;
      if (!error && data) {
        invalidatePlantillaCache();
        if (requiereDocumentacion) {
          try {
            const { checklistSeedRows } = await import(
              '@/app/lib/hr-employee-profile'
            );
            await sb.from('hr_employee_documents').insert(
              checklistSeedRows((data as HrEmployee).id)
            );
          } catch {
            /* tabla aún no migrada */
          }
        }
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
      if (error && missingTipoEmpleoColumn(error.message)) {
        const {
          tipo_empleo: _te,
          requiere_documentacion: _rd,
          ...withoutTipo
        } = withoutRoles;
        void _te;
        void _rd;
        const retry2 = await sb
          .from('hr_employees')
          .insert(withoutTipo)
          .select(EMP_SELECT_MIN)
          .single();
        data = retry2.data as typeof data;
        error = retry2.error;
      }
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
          hint: missingTipoEmpleoColumn(error?.message || '')
            ? 'Ejecuta supabase/hr_employee_tipo_empleo.sql en Supabase'
            : undefined,
        },
        { status: missing ? 503 : 400 }
      );
    }

    invalidatePlantillaCache();

    if (requiereDocumentacion) {
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
    }

    const docsHint = requiereDocumentacion
      ? ' Puedes escanear docs en el alta o en el perfil → Documentos.'
      : ' Sin checklist documental (externo / docs no requeridos).';

    return NextResponse.json({
      ready: true,
      employee: data as HrEmployee,
      message: `Alta registrada: ${fullName}.${docsHint}`,
      hint:
        data &&
        ((data as HrEmployee).tipo_empleo == null ||
          (data as HrEmployee).requiere_documentacion == null)
          ? 'Ejecuta supabase/hr_employee_tipo_empleo.sql para persistir tipo/docs.'
          : undefined,
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
 *         tipo_empleo?: 'interno'|'externo', requiere_documentacion?: boolean,
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

  let tipoTouched = false;
  if (body.tipo_empleo !== undefined) {
    const t = String(body.tipo_empleo || '')
      .trim()
      .toLowerCase();
    if (t !== 'interno' && t !== 'externo') {
      return NextResponse.json(
        { error: 'tipo_empleo debe ser interno o externo' },
        { status: 400 }
      );
    }
    patch.tipo_empleo = t;
    tipoTouched = true;
    if (body.requiere_documentacion === undefined) {
      patch.requiere_documentacion = defaultRequiereDocumentacion(t);
    }
  }
  if (typeof body.requiere_documentacion === 'boolean') {
    patch.requiere_documentacion = body.requiere_documentacion;
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
    if (body.area === undefined && body.areas === undefined && patch.puesto) {
      const inferred = areaFromPuesto(String(patch.puesto));
      if (inferred) {
        patch.area = inferred;
        patch.areas = [inferred];
      }
    }
  }
  if (body.area !== undefined || body.areas !== undefined) {
    let list: string[] = [];
    if (Array.isArray(body.areas)) {
      list = parseEmployeeAreas(
        null,
        body.areas.map((x: unknown) => String(x ?? ''))
      );
    } else if (Array.isArray(body.area)) {
      list = parseEmployeeAreas(
        body.area.map((x: unknown) => String(x ?? '')),
        null
      );
    } else {
      list = parseEmployeeAreas(
        body.area == null ? null : String(body.area),
        null
      );
    }
    patch.area = formatEmployeeAreas(list);
    patch.areas = list;
  }
  if (body.notes !== undefined || rolesTouched || tipoTouched) {
    const notesIn =
      body.notes !== undefined
        ? body.notes == null
          ? null
          : String(body.notes).trim() || null
        : undefined;
    // Sync dual flag cuando hay roles; si notes no viene, se fusiona en update abajo
    if (notesIn !== undefined) {
      let nextNotes = syncDualFlagInNotes(
        notesIn,
        hasDualLimpiezaServicio({
          puesto: (patch.puesto as string | null | undefined) ?? null,
          puestos_secundarios:
            (patch.puestos_secundarios as string[] | undefined) ?? [],
          notes: notesIn,
        })
      );
      if (tipoTouched) {
        nextNotes = syncExternoFlagInNotes(
          nextNotes,
          patch.tipo_empleo === 'externo'
        );
      }
      patch.notes = nextNotes;
    } else if (tipoTouched) {
      // Solo tipo: cargar notes actuales y sincronizar flag externo.
      const cur = await getServiceSupabase()
        .from('hr_employees')
        .select('notes')
        .eq('id', id)
        .maybeSingle();
      if (!cur.error) {
        patch.notes = syncExternoFlagInNotes(
          (cur.data as { notes?: string | null } | null)?.notes ?? null,
          patch.tipo_empleo === 'externo'
        );
      }
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

    if (error && missingTipoEmpleoColumn(error.message)) {
      if (
        patch.tipo_empleo !== undefined ||
        patch.requiere_documentacion !== undefined
      ) {
        return NextResponse.json(
          {
            error:
              'Faltan columnas tipo_empleo / requiere_documentacion. Ejecuta supabase/hr_employee_tipo_empleo.sql en Supabase.',
            hint: 'supabase/hr_employee_tipo_empleo.sql',
          },
          { status: 503 }
        );
      }
      const retry = await sb
        .from('hr_employees')
        .update(patch)
        .eq('id', id)
        .select(EMP_SELECT_FULL_NO_TIPO)
        .maybeSingle();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (
      error &&
      /\bareas\b|column .* does not exist|42703/i.test(error.message) &&
      patch.areas !== undefined
    ) {
      const { areas: _ar, ...withoutAreas } = patch;
      void _ar;
      const retry = await sb
        .from('hr_employees')
        .update(withoutAreas)
        .eq('id', id)
        .select(EMP_SELECT_FULL_NO_TIPO)
        .maybeSingle();
      data = retry.data as typeof data;
      error = retry.error;
    }

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
