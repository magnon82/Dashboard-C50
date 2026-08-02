import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import type { HrAvailability, HrAvailabilityKind } from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT =
  'id, employee_id, weekday, date_from, date_to, kind, start_time, end_time, notes, created_by, created_at, updated_at, hr_employees(full_name)';

const KINDS: HrAvailabilityKind[] = [
  'preferencia',
  'off',
  'bloqueo',
  'permiso',
];

function asRow(raw: Record<string, unknown>): HrAvailability {
  const emp = raw.hr_employees as { full_name?: string } | null | undefined;
  return {
    id: String(raw.id),
    employee_id: String(raw.employee_id),
    weekday: raw.weekday != null ? Number(raw.weekday) : null,
    date_from: raw.date_from ? String(raw.date_from).slice(0, 10) : null,
    date_to: raw.date_to ? String(raw.date_to).slice(0, 10) : null,
    kind: raw.kind as HrAvailabilityKind,
    start_time: raw.start_time ? String(raw.start_time).slice(0, 8) : null,
    end_time: raw.end_time ? String(raw.end_time).slice(0, 8) : null,
    notes: raw.notes != null ? String(raw.notes) : null,
    created_by: raw.created_by ? String(raw.created_by) : null,
    employee_name: emp?.full_name ?? null,
  };
}

/**
 * GET /api/hr/availability?employeeId=&from=&to=
 * Lista offs/bloqueos (RH).
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get('employeeId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  try {
    const sb = getServiceSupabase();
    let q = sb
      .from('hr_availability')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(500);

    if (employeeId) q = q.eq('employee_id', employeeId);

    const { data, error } = await q;
    if (error) {
      const missing = hrSchemaMissing(error.message);
      return NextResponse.json({
        ready: !missing,
        items: [] as HrAvailability[],
        message: missing
          ? 'Ejecuta supabase/hr_module.sql en Supabase.'
          : error.message,
      });
    }

    let items = (data || []).map((r) => asRow(r as Record<string, unknown>));

    // Filtro por rango de fechas en memoria (weekday recurrentes siempre pasan)
    if (from && to) {
      const f = from.slice(0, 10);
      const t = to.slice(0, 10);
      items = items.filter((a) => {
        if (a.weekday != null && !a.date_from) return true;
        if (!a.date_from && !a.date_to) return true;
        const df = a.date_from || a.date_to || f;
        const dt = a.date_to || a.date_from || t;
        return df <= t && dt >= f;
      });
    }

    return NextResponse.json({ ready: true, items });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        items: [],
        message: e instanceof Error ? e.message : 'Error',
      },
      { status: 200 }
    );
  }
}

/**
 * POST /api/hr/availability — crear off/bloqueo (RH/gerente con edición).
 * Body: { employee_id, kind?, weekday?, date_from?, date_to?, notes? }
 */
export async function POST(request: Request) {
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

  const employeeId = String(body.employee_id || '').trim();
  if (!employeeId) {
    return NextResponse.json(
      { error: 'employee_id es obligatorio' },
      { status: 400 }
    );
  }

  const kind = (String(body.kind || 'off') as HrAvailabilityKind);
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: 'kind inválido' }, { status: 400 });
  }

  const weekday =
    body.weekday != null && body.weekday !== ''
      ? Number(body.weekday)
      : null;
  if (weekday != null && (weekday < 0 || weekday > 6 || Number.isNaN(weekday))) {
    return NextResponse.json(
      { error: 'weekday debe ser 0 (dom) … 6 (sáb)' },
      { status: 400 }
    );
  }

  const dateFrom = body.date_from
    ? String(body.date_from).slice(0, 10)
    : null;
  const dateTo = body.date_to ? String(body.date_to).slice(0, 10) : dateFrom;

  if (weekday == null && !dateFrom) {
    return NextResponse.json(
      { error: 'Indica weekday (recurrente) o date_from' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_availability')
      .insert({
        employee_id: employeeId,
        kind,
        weekday,
        date_from: dateFrom,
        date_to: dateTo,
        notes: body.notes != null ? String(body.notes) : null,
        created_by: auth.username,
        updated_at: new Date().toISOString(),
      })
      .select(SELECT)
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: hrSchemaMissing(error.message)
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ready: true,
      item: asRow(data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/hr/availability?id=
 */
export async function DELETE(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { error } = await sb.from('hr_availability').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ready: true, deleted: id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
