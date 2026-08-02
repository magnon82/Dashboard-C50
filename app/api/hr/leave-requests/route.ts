import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireStaffOrRrhhSession,
  resolveLinkedEmployee,
  sessionHasRrhh,
} from '@/app/lib/hr-api';
import {
  leaveInclusiveDays,
  type HrLeavePago,
  type HrLeaveRequest,
  type HrLeaveRequestPayload,
  type HrLeaveStatus,
} from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT =
  'id, employee_id, date_from, date_to, days, status, requested_by, reviewed_by, reviewed_at, notes, payload, created_at, updated_at, hr_employees(full_name, puesto)';

function asLeaveRow(raw: Record<string, unknown>): HrLeaveRequest {
  const emp = raw.hr_employees as
    | { full_name?: string; puesto?: string }
    | null
    | undefined;
  return {
    id: String(raw.id),
    employee_id: raw.employee_id ? String(raw.employee_id) : null,
    date_from: String(raw.date_from).slice(0, 10),
    date_to: String(raw.date_to).slice(0, 10),
    days: Number(raw.days),
    status: raw.status as HrLeaveStatus,
    requested_by: raw.requested_by ? String(raw.requested_by) : null,
    reviewed_by: raw.reviewed_by ? String(raw.reviewed_by) : null,
    reviewed_at: raw.reviewed_at ? String(raw.reviewed_at) : null,
    notes: raw.notes != null ? String(raw.notes) : null,
    payload: (raw.payload || {}) as HrLeaveRequest['payload'],
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
    employee_name: emp?.full_name ?? null,
    employee_puesto: emp?.puesto ?? null,
  };
}

function schemaHint(message: string): boolean {
  return (
    hrSchemaMissing(message) || /column .* payload/i.test(message)
  );
}

/**
 * GET /api/hr/leave-requests
 * - Staff: propias (+ employee vinculado)
 * - RR.HH.: todas (opcional ?status=pendiente)
 * Incluye `linkedEmployee` para precargar el formulario Staff.
 */
export async function GET(request: Request) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const isRrhh = sessionHasRrhh(auth);

  try {
    const sb = getServiceSupabase();

    const statusOk =
      statusFilter &&
      ['pendiente', 'aprobada', 'rechazada', 'cancelada'].includes(statusFilter)
        ? statusFilter
        : null;

    let rows: Record<string, unknown>[] = [];
    let linked: Awaited<ReturnType<typeof resolveLinkedEmployee>> = null;

    if (isRrhh) {
      let q = sb
        .from('hr_leave_requests')
        .select(SELECT)
        .order('created_at', { ascending: false })
        .limit(200);
      if (statusOk) q = q.eq('status', statusOk);
      const [linkedRes, listRes] = await Promise.all([
        resolveLinkedEmployee(sb, auth),
        q,
      ]);
      linked = linkedRes;
      if (listRes.error) {
        const missing = schemaHint(listRes.error.message);
        return NextResponse.json({
          ready: !missing,
          requests: [] as HrLeaveRequest[],
          linkedEmployee: linked,
          isRrhh,
          message: missing
            ? 'Ejecuta supabase/hr_leave_request_form.sql (o hr_module.sql actualizado) en Supabase.'
            : listRes.error.message,
          error: listRes.error.message,
        });
      }
      rows = (listRes.data || []) as Record<string, unknown>[];
    } else {
      linked = await resolveLinkedEmployee(sb, auth);
      const username = auth.username.trim();
      let qOwn = sb
        .from('hr_leave_requests')
        .select(SELECT)
        .ilike('requested_by', username)
        .order('created_at', { ascending: false })
        .limit(50);
      if (statusOk) qOwn = qOwn.eq('status', statusOk);

      let qEmp = linked?.id
        ? sb
            .from('hr_leave_requests')
            .select(SELECT)
            .eq('employee_id', linked.id)
            .order('created_at', { ascending: false })
            .limit(50)
        : null;
      if (qEmp && statusOk) qEmp = qEmp.eq('status', statusOk);

      const [own, emp] = await Promise.all([
        qOwn,
        qEmp ?? Promise.resolve({ data: null, error: null }),
      ]);
      if (own.error) {
        const missing = schemaHint(own.error.message);
        return NextResponse.json({
          ready: !missing,
          requests: [] as HrLeaveRequest[],
          linkedEmployee: linked,
          isRrhh,
          message: missing
            ? 'Ejecuta supabase/hr_leave_request_form.sql (o hr_module.sql actualizado) en Supabase.'
            : own.error.message,
          error: own.error.message,
        });
      }
      const byId = new Map<string, Record<string, unknown>>();
      for (const r of own.data || []) {
        byId.set(String((r as { id: string }).id), r as Record<string, unknown>);
      }
      if (!emp.error && emp.data) {
        for (const r of emp.data) {
          byId.set(String((r as { id: string }).id), r as Record<string, unknown>);
        }
      }
      rows = Array.from(byId.values()).sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      );
    }

    const requests = rows.map((r) => asLeaveRow(r));

    return NextResponse.json({
      ready: true,
      requests,
      linkedEmployee: linked,
      isRrhh,
      message: null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        requests: [],
        linkedEmployee: null,
        isRrhh,
        message: e instanceof Error ? e.message : 'Error al cargar solicitudes',
        error: e instanceof Error ? e.message : 'Error',
      },
      { status: 200 }
    );
  }
}

/**
 * POST /api/hr/leave-requests
 * - Staff: crea su propia solicitud (pendiente).
 * - RR.HH.: puede capturar en nombre de cualquier colaborador (employee_id libre).
 */
export async function POST(request: Request) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const isRrhh = sessionHasRrhh(auth);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const fechaSolicitud = String(body.fecha_solicitud || '').slice(0, 10);
  const solicitadaA = String(body.solicitada_a || '').trim();
  const nombre = String(body.nombre_empleado || '').trim();
  const curp = String(body.curp || '')
    .trim()
    .toUpperCase();
  const puesto = String(body.puesto || '').trim();
  const dateFrom = String(body.date_from || body.desde || '').slice(0, 10);
  const dateTo = String(body.date_to || body.hasta || '').slice(0, 10);
  const ultimoDia = String(body.ultimo_dia_laborado || '').slice(0, 10);
  const fechaReingreso = String(body.fecha_reingreso || '').slice(0, 10);
  const pagoRaw = String(body.pago_vacaciones || 'nomina');
  const pago: HrLeavePago =
    pagoRaw === 'inmediato' ? 'inmediato' : 'nomina';
  const observaciones = String(body.observaciones || '').trim();
  const daysInput = body.days != null ? Number(body.days) : null;
  const capturadaPorRh = isRrhh && body.capturada_por_rh !== false;

  if (!fechaSolicitud || !nombre || !dateFrom || !dateTo) {
    return NextResponse.json(
      {
        error:
          'Faltan campos obligatorios: fecha de solicitud, nombre, desde y hasta.',
      },
      { status: 400 }
    );
  }
  if (dateTo < dateFrom) {
    return NextResponse.json(
      { error: 'La fecha «Hasta» debe ser ≥ «Desde».' },
      { status: 400 }
    );
  }

  const days =
    daysInput != null && Number.isFinite(daysInput) && daysInput > 0
      ? daysInput
      : leaveInclusiveDays(dateFrom, dateTo);

  if (days <= 0) {
    return NextResponse.json(
      { error: 'Total de días inválido.' },
      { status: 400 }
    );
  }

  const payload: HrLeaveRequestPayload = {
    form_version: 'formato-c50-v1',
    fecha_solicitud: fechaSolicitud,
    solicitada_a: solicitadaA,
    nombre_empleado: nombre,
    curp,
    puesto,
    ultimo_dia_laborado: ultimoDia,
    fecha_reingreso: fechaReingreso,
    pago_vacaciones: pago,
    observaciones,
    ...(capturadaPorRh ? { capturada_por_rh: true } : {}),
  };

  try {
    const sb = getServiceSupabase();
    const linked = await resolveLinkedEmployee(sb, auth);
    let employeeId: string | null =
      typeof body.employee_id === 'string' && body.employee_id
        ? body.employee_id
        : !isRrhh
          ? linked?.id ?? null
          : null;

    // Staff no puede atribuir a otro empleado
    if (!isRrhh) {
      if (linked?.id) {
        employeeId = linked.id;
      } else {
        employeeId = null;
      }
    } else if (employeeId) {
      // Validar que el empleado exista (evita IDs inventados)
      const { data: emp, error: empErr } = await sb
        .from('hr_employees')
        .select('id, full_name, puesto')
        .eq('id', employeeId)
        .maybeSingle();
      if (empErr || !emp) {
        return NextResponse.json(
          { error: 'Empleado no encontrado en plantilla.' },
          { status: 400 }
        );
      }
      // Nombre y puesto siempre desde la ficha del empleado (no captura manual).
      const empName = String(
        (emp as { full_name?: string }).full_name || ''
      ).trim();
      const empPuesto = String(
        (emp as { puesto?: string | null }).puesto || ''
      ).trim();
      if (empName) payload.nombre_empleado = empName;
      if (empPuesto) payload.puesto = empPuesto;
    }

    const insert = {
      employee_id: employeeId,
      date_from: dateFrom,
      date_to: dateTo,
      days,
      status: 'pendiente' as const,
      requested_by: auth.username,
      notes: observaciones || null,
      payload,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from('hr_leave_requests')
      .insert(insert)
      .select(SELECT)
      .single();

    if (error) {
      const missing = schemaHint(error.message);
      return NextResponse.json(
        {
          error: missing
            ? 'Falta migración: ejecuta supabase/hr_leave_request_form.sql en Supabase.'
            : error.message,
        },
        { status: missing ? 503 : 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: asLeaveRow(data as Record<string, unknown>),
      message: capturadaPorRh
        ? 'Solicitud capturada. Queda pendiente de aprobación.'
        : 'Solicitud enviada. Queda pendiente de aprobación de RH.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/hr/leave-requests — RH aprueba / rechaza (simple).
 * Body: { id, status: 'aprobada' | 'rechazada', notes? }
 */
export async function PATCH(request: Request) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  if (!sessionHasRrhh(auth)) {
    return NextResponse.json(
      { error: 'Solo RR.HH. puede aprobar o rechazar.' },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = String(body.id || '');
  const status = String(body.status || '') as HrLeaveStatus;
  if (!id || !['aprobada', 'rechazada'].includes(status)) {
    return NextResponse.json(
      { error: 'Se requiere id y status aprobada|rechazada.' },
      { status: 400 }
    );
  }

  const notes =
    body.notes != null && String(body.notes).trim()
      ? String(body.notes).trim()
      : undefined;

  try {
    const sb = getServiceSupabase();
    const patch: Record<string, unknown> = {
      status,
      reviewed_by: auth.username,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (notes !== undefined) patch.notes = notes;

    const { data, error } = await sb
      .from('hr_leave_requests')
      .update(patch)
      .eq('id', id)
      .select(SELECT)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      request: asLeaveRow(data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar' },
      { status: 500 }
    );
  }
}
