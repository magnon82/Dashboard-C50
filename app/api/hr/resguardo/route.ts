import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import {
  HR_RESGUARDO_FORM_VERSION,
  HR_RESGUARDO_SELECT,
  HR_RESGUARDO_SELECT_LEGACY,
  asResguardoRequest,
  buildResguardoFolio,
  normalizeResguardoItems,
  type HrResguardoKind,
  type HrResguardoPayload,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';
import { matchPerson } from '@/app/lib/hr-person-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = new Set<HrResguardoKind>([
  'equipo',
  'herramientas',
  'uniforme',
  'llaves',
]);

function missingAcceptedCols(message: string | undefined | null): boolean {
  if (!message) return false;
  return /accepted_at|accepted_by|schema cache|42703/i.test(message);
}

async function selectResguardos(
  sb: ReturnType<typeof getServiceSupabase>,
  opts: { statusFilter: string | null; limit: number }
) {
  let q = sb
    .from('hr_resguardo_requests')
    .select(HR_RESGUARDO_SELECT)
    .order('created_at', { ascending: false })
    .limit(opts.limit);
  if (opts.statusFilter) q = q.eq('status', opts.statusFilter);
  const res = await q;
  if (!res.error) {
    return { data: res.data, error: null as string | null, legacy: false };
  }
  if (missingAcceptedCols(res.error.message)) {
    let q2 = sb
      .from('hr_resguardo_requests')
      .select(HR_RESGUARDO_SELECT_LEGACY)
      .order('created_at', { ascending: false })
      .limit(opts.limit);
    if (opts.statusFilter) q2 = q2.eq('status', opts.statusFilter);
    const legacy = await q2;
    return {
      data: legacy.data,
      error: legacy.error?.message ?? null,
      legacy: true,
    };
  }
  return { data: null, error: res.error.message, legacy: false };
}

/**
 * GET /api/hr/resguardo — RR.HH.: listado (opcional ?status=pendiente).
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status')?.trim() || null;
  const limitRaw = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 200)
    : 50;

  try {
    const sb = getServiceSupabase();
    const res = await selectResguardos(sb, { statusFilter, limit });

    if (res.error) {
      const missing =
        /does not exist|42P01/i.test(res.error) || /schema cache/i.test(res.error);
      return NextResponse.json({
        ready: false,
        scope: 'rrhh',
        requests: [] as HrResguardoRequest[],
        error: missing
          ? 'Tabla hr_resguardo_requests no migrada. Ejecuta supabase/hr_resguardo.sql.'
          : res.error,
      });
    }

    const requests = (res.data || []).map((r) =>
      asResguardoRequest(r as Record<string, unknown>)
    );

    return NextResponse.json({
      ready: true,
      scope: 'rrhh',
      requests,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        scope: 'rrhh',
        requests: [],
        error: e instanceof Error ? e.message : 'Error al listar resguardos',
      },
      { status: 200 }
    );
  }
}

/**
 * POST /api/hr/resguardo — RR.HH. captura carta de resguardo.
 * Queda pendiente de aceptación del colaborador (Staff).
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const writeBlock = requireRrhhWrite(auth);
  if (writeBlock) return writeBlock;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const kindRaw = String(body.kind || 'equipo').trim() as HrResguardoKind;
  if (!KINDS.has(kindRaw)) {
    return NextResponse.json(
      { error: 'Tipo de resguardo inválido' },
      { status: 400 }
    );
  }

  const payloadIn =
    body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : body;

  const nombre = String(payloadIn.nombre ?? '').trim();
  if (!nombre) {
    return NextResponse.json(
      { error: 'Nombre del responsable es obligatorio' },
      { status: 400 }
    );
  }

  const acepta = Boolean(payloadIn.acepta_condiciones);
  if (!acepta) {
    return NextResponse.json(
      { error: 'Debes aceptar las condiciones de resguardo' },
      { status: 400 }
    );
  }

  const items = normalizeResguardoItems(body.items ?? payloadIn.items);
  if (items.length === 0) {
    return NextResponse.json(
      { error: 'Agrega al menos un ítem (concepto)' },
      { status: 400 }
    );
  }

  const payload: HrResguardoPayload = {
    form_version: HR_RESGUARDO_FORM_VERSION,
    lugar_fecha: String(payloadIn.lugar_fecha ?? '').trim() || undefined,
    nombre,
    rfc: String(payloadIn.rfc ?? '').trim() || undefined,
    puesto: String(payloadIn.puesto ?? '').trim() || undefined,
    email: String(payloadIn.email ?? '').trim() || undefined,
    telefono: String(payloadIn.telefono ?? '').trim() || undefined,
    domicilio: String(payloadIn.domicilio ?? '').trim() || undefined,
    fecha_asignacion:
      String(payloadIn.fecha_asignacion ?? '').trim() || undefined,
    fecha_resguardo:
      String(payloadIn.fecha_resguardo ?? '').trim() || undefined,
    receptor_nombre:
      String(payloadIn.receptor_nombre ?? nombre).trim() || undefined,
    receptor_puesto:
      String(payloadIn.receptor_puesto ?? payloadIn.puesto ?? '').trim() ||
      undefined,
    emisor_nombre: String(payloadIn.emisor_nombre ?? '').trim() || undefined,
    emisor_puesto: String(payloadIn.emisor_puesto ?? '').trim() || undefined,
    acepta_condiciones: true,
    acepta_danio_parcial: Boolean(payloadIn.acepta_danio_parcial),
    acepta_perdida_total: Boolean(payloadIn.acepta_perdida_total),
    observaciones: String(payloadIn.observaciones ?? '').trim() || undefined,
  };

  try {
    const sb = getServiceSupabase();

    let employeeId: string | null = null;
    const empIdIn = body.employee_id
      ? String(body.employee_id).trim()
      : '';
    const suiteIn = body.suite_username
      ? String(body.suite_username).trim()
      : '';
    if (empIdIn) {
      employeeId = empIdIn;
    } else if (suiteIn) {
      const empRes = await sb
        .from('hr_employees')
        .select('id')
        .ilike('suite_username', suiteIn)
        .maybeSingle();
      if (!empRes.error && empRes.data?.id) {
        employeeId = String(empRes.data.id);
      }
    } else {
      const empList = await sb
        .from('hr_employees')
        .select('id, full_name')
        .neq('status', 'baja')
        .limit(500);
      if (!empList.error && empList.data?.length) {
        const m = matchPerson(
          nombre,
          empList.data.map((e) => ({
            id: String(e.id),
            full_name: String(e.full_name || ''),
          }))
        );
        if (
          m.employeeId &&
          (m.autoLink || m.confidence === 'exact' || m.confidence === 'high')
        ) {
          employeeId = m.employeeId;
        }
      }
    }

    const insert = {
      folio: buildResguardoFolio(),
      employee_id: employeeId,
      kind: kindRaw,
      status: 'pendiente',
      payload,
      items,
      requested_by: auth.username,
      notes: String(body.notes ?? '').trim() || null,
      accepted_at: null,
      accepted_by: null,
    };

    let res = await sb
      .from('hr_resguardo_requests')
      .insert(insert)
      .select(HR_RESGUARDO_SELECT)
      .single();

    if (res.error && missingAcceptedCols(res.error.message)) {
      const { accepted_at: _a, accepted_by: _b, ...legacyInsert } = insert;
      res = await sb
        .from('hr_resguardo_requests')
        .insert(legacyInsert)
        .select(HR_RESGUARDO_SELECT_LEGACY)
        .single();
    }

    if (res.error) {
      const missing =
        res.error.message?.includes('does not exist') ||
        res.error.code === '42P01';
      return NextResponse.json(
        {
          error: missing
            ? 'Tabla hr_resguardo_requests no migrada. Ejecuta supabase/hr_resguardo.sql.'
            : res.error.message,
        },
        { status: missing ? 503 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: asResguardoRequest(res.data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar' },
      { status: 500 }
    );
  }
}

const STATUSES = new Set(['pendiente', 'entregado', 'devuelto', 'cancelado']);

/**
 * PATCH /api/hr/resguardo — RR.HH. edita carta existente (perfil).
 */
export async function PATCH(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const writeBlock = requireRrhhWrite(auth);
  if (writeBlock) return writeBlock;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = String(body.id || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  const kindRaw = body.kind != null ? String(body.kind).trim() : null;
  if (kindRaw && !KINDS.has(kindRaw as HrResguardoKind)) {
    return NextResponse.json(
      { error: 'Tipo de resguardo inválido' },
      { status: 400 }
    );
  }

  const statusRaw = body.status != null ? String(body.status).trim() : null;
  if (statusRaw && !STATUSES.has(statusRaw)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
  }

  const payloadIn =
    body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : null;

  let payload: HrResguardoPayload | undefined;
  if (payloadIn) {
    const nombre = String(payloadIn.nombre ?? '').trim();
    if (!nombre) {
      return NextResponse.json(
        { error: 'Nombre del responsable es obligatorio' },
        { status: 400 }
      );
    }
    if (!Boolean(payloadIn.acepta_condiciones)) {
      return NextResponse.json(
        { error: 'Debes aceptar las condiciones de resguardo' },
        { status: 400 }
      );
    }
    payload = {
      form_version: HR_RESGUARDO_FORM_VERSION,
      lugar_fecha: String(payloadIn.lugar_fecha ?? '').trim() || undefined,
      nombre,
      rfc: String(payloadIn.rfc ?? '').trim() || undefined,
      puesto: String(payloadIn.puesto ?? '').trim() || undefined,
      email: String(payloadIn.email ?? '').trim() || undefined,
      telefono: String(payloadIn.telefono ?? '').trim() || undefined,
      domicilio: String(payloadIn.domicilio ?? '').trim() || undefined,
      fecha_asignacion:
        String(payloadIn.fecha_asignacion ?? '').trim() || undefined,
      fecha_resguardo:
        String(payloadIn.fecha_resguardo ?? '').trim() || undefined,
      receptor_nombre:
        String(payloadIn.receptor_nombre ?? nombre).trim() || undefined,
      receptor_puesto:
        String(payloadIn.receptor_puesto ?? payloadIn.puesto ?? '').trim() ||
        undefined,
      emisor_nombre: String(payloadIn.emisor_nombre ?? '').trim() || undefined,
      emisor_puesto: String(payloadIn.emisor_puesto ?? '').trim() || undefined,
      acepta_condiciones: true,
      acepta_danio_parcial: Boolean(payloadIn.acepta_danio_parcial),
      acepta_perdida_total: Boolean(payloadIn.acepta_perdida_total),
      observaciones: String(payloadIn.observaciones ?? '').trim() || undefined,
      empleado_aceptado_at:
        String(payloadIn.empleado_aceptado_at ?? '').trim() || undefined,
      empleado_aceptado_por:
        String(payloadIn.empleado_aceptado_por ?? '').trim() || undefined,
    };
  }

  let items: ReturnType<typeof normalizeResguardoItems> | undefined;
  if (body.items !== undefined) {
    items = normalizeResguardoItems(body.items);
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Agrega al menos un ítem (concepto)' },
        { status: 400 }
      );
    }
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (kindRaw) patch.kind = kindRaw;
  if (statusRaw) {
    patch.status = statusRaw;
    if (statusRaw !== 'pendiente') {
      patch.reviewed_by = auth.username;
      patch.reviewed_at = new Date().toISOString();
    }
  }
  if (payload) patch.payload = payload;
  if (items) patch.items = items;
  if (body.notes !== undefined) {
    patch.notes =
      body.notes == null || String(body.notes).trim() === ''
        ? null
        : String(body.notes).trim();
  }

  try {
    const sb = getServiceSupabase();
    let res = await sb
      .from('hr_resguardo_requests')
      .update(patch)
      .eq('id', id)
      .select(HR_RESGUARDO_SELECT)
      .single();

    if (res.error && missingAcceptedCols(res.error.message)) {
      res = await sb
        .from('hr_resguardo_requests')
        .update(patch)
        .eq('id', id)
        .select(HR_RESGUARDO_SELECT_LEGACY)
        .single();
    }

    if (res.error) {
      const missing =
        res.error.message?.includes('does not exist') ||
        res.error.code === '42P01';
      return NextResponse.json(
        {
          error: missing
            ? 'Tabla hr_resguardo_requests no migrada. Ejecuta supabase/hr_resguardo.sql.'
            : res.error.message,
        },
        { status: missing ? 503 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: asResguardoRequest(res.data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar' },
      { status: 500 }
    );
  }
}
