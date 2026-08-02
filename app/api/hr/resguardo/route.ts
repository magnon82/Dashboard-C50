import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import {
  HR_RESGUARDO_FORM_VERSION,
  buildResguardoFolio,
  normalizeResguardoItems,
  type HrResguardoKind,
  type HrResguardoPayload,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = new Set<HrResguardoKind>([
  'equipo',
  'herramientas',
  'uniforme',
  'llaves',
]);

const SELECT =
  'id, folio, employee_id, kind, status, payload, items, requested_by, reviewed_by, reviewed_at, notes, created_at, updated_at';

function asRequest(row: Record<string, unknown>): HrResguardoRequest {
  return {
    id: String(row.id),
    folio: row.folio != null ? String(row.folio) : null,
    employee_id: row.employee_id != null ? String(row.employee_id) : null,
    kind: (row.kind as HrResguardoKind) || 'equipo',
    status: (row.status as HrResguardoRequest['status']) || 'pendiente',
    payload: (row.payload || {}) as HrResguardoPayload,
    items: normalizeResguardoItems(row.items),
    requested_by: row.requested_by != null ? String(row.requested_by) : null,
    reviewed_by: row.reviewed_by != null ? String(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at != null ? String(row.reviewed_at) : null,
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
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
    let q = sb
      .from('hr_resguardo_requests')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusFilter) {
      q = q.eq('status', statusFilter);
    }

    const res = await q;

    if (res.error) {
      const missing =
        res.error.message?.includes('does not exist') ||
        res.error.code === '42P01';
      return NextResponse.json({
        ready: false,
        scope: 'rrhh',
        requests: [] as HrResguardoRequest[],
        error: missing
          ? 'Tabla hr_resguardo_requests no migrada. Ejecuta supabase/hr_resguardo.sql.'
          : res.error.message,
      });
    }

    const requests = (res.data || []).map((r) =>
      asRequest(r as Record<string, unknown>)
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
    };

    const res = await sb
      .from('hr_resguardo_requests')
      .insert(insert)
      .select(SELECT)
      .single();

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
      request: asRequest(res.data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar' },
      { status: 500 }
    );
  }
}
