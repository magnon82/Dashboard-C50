import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import {
  isCurrentScheduleWeek,
  isPastScheduleWeek,
  todayIsoCdmx,
  type HrScheduleShift,
  type HrScheduleStatus,
  type HrScheduleWeek,
} from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK_SELECT =
  'id, week_start, week_end, status, notes, created_by, published_by, published_at, created_at, updated_at';

const SHIFT_SELECT =
  'id, week_id, employee_id, shift_date, start_time, end_time, area, role_label, origin, notes, hr_employees(full_name, area, puesto)';

function mapShift(raw: Record<string, unknown>): HrScheduleShift {
  const emp = raw.hr_employees as
    | { full_name?: string; area?: string; puesto?: string }
    | null
    | undefined;
  return {
    id: String(raw.id),
    week_id: String(raw.week_id),
    employee_id: String(raw.employee_id),
    shift_date: String(raw.shift_date).slice(0, 10),
    start_time: raw.start_time ? String(raw.start_time).slice(0, 8) : null,
    end_time: raw.end_time ? String(raw.end_time).slice(0, 8) : null,
    area: raw.area != null ? String(raw.area) : null,
    role_label: raw.role_label != null ? String(raw.role_label) : null,
    origin: raw.origin === 'auto' ? 'auto' : 'manual',
    notes: raw.notes != null ? String(raw.notes) : null,
    employee_name: emp?.full_name ?? null,
    employee_area: emp?.area ?? null,
    employee_puesto: emp?.puesto ?? null,
  };
}

type Ctx = { params: Promise<{ weekId: string }> };

/**
 * GET /api/hr/schedules/[weekId]
 */
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const { weekId } = await ctx.params;
  if (!weekId) {
    return NextResponse.json({ error: 'weekId requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const [weekRes, shiftsRes] = await Promise.all([
      sb
        .from('hr_schedule_weeks')
        .select(WEEK_SELECT)
        .eq('id', weekId)
        .maybeSingle(),
      sb
        .from('hr_schedule_shifts')
        .select(SHIFT_SELECT)
        .eq('week_id', weekId)
        .order('shift_date', { ascending: true }),
    ]);

    if (weekRes.error) {
      return NextResponse.json(
        {
          ready: false,
          message: hrSchemaMissing(weekRes.error.message)
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : weekRes.error.message,
        },
        { status: 200 }
      );
    }
    if (!weekRes.data) {
      return NextResponse.json({ error: 'Semana no encontrada' }, { status: 404 });
    }

    if (shiftsRes.error) {
      return NextResponse.json(
        { ready: false, message: shiftsRes.error.message },
        { status: 200 }
      );
    }

    const w = weekRes.data as HrScheduleWeek;
    return NextResponse.json({
      ready: true,
      week: {
        ...w,
        week_start: String(w.week_start).slice(0, 10),
        week_end: String(w.week_end).slice(0, 10),
      },
      shifts: (shiftsRes.data || []).map((s) =>
        mapShift(s as Record<string, unknown>)
      ),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/hr/schedules/[weekId]
 * Body: {
 *   status?: propuesta|borrador|publicado,
 *   notes?: string,
 *   shifts?: Array<{ employee_id, shift_date, start_time?, end_time?, area?, role_label?, notes? }>
 * }
 * Si `shifts` viene, reemplaza todos los turnos de la semana.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  const { weekId } = await ctx.params;
  if (!weekId) {
    return NextResponse.json({ error: 'weekId requerido' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data: current, error: findErr } = await sb
      .from('hr_schedule_weeks')
      .select(WEEK_SELECT)
      .eq('id', weekId)
      .maybeSingle();

    if (findErr || !current) {
      return NextResponse.json(
        { error: findErr?.message || 'Semana no encontrada' },
        { status: 404 }
      );
    }

    const weekEnd = String(current.week_end).slice(0, 10);
    const pastLocked = isPastScheduleWeek(weekEnd, todayIsoCdmx());
    if (pastLocked && (Array.isArray(body.shifts) || body.status !== undefined)) {
      return NextResponse.json(
        {
          error:
            'Semana pasada en solo lectura. Solo se pueden ajustar semanas en curso o futuras.',
        },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.notes !== undefined) {
      if (pastLocked) {
        return NextResponse.json(
          { error: 'Semana pasada en solo lectura.' },
          { status: 400 }
        );
      }
      patch.notes = body.notes == null ? null : String(body.notes);
    }

    const weekStart = String(current.week_start).slice(0, 10);
    const isCurrent = isCurrentScheduleWeek(weekStart, todayIsoCdmx());
    const isFuture = !pastLocked && !isCurrent;

    // Guardar turnos: en curso → publicar; futuras quedan borrador hasta Publicar.
    // Si el cliente manda status junto con shifts en una semana futura, se ignora
    // (Publicar es un PATCH solo de status, sin shifts).
    if (Array.isArray(body.shifts) && isFuture) {
      delete body.status;
    } else if (
      Array.isArray(body.shifts) &&
      body.status === undefined &&
      isCurrent &&
      current.status !== 'publicado'
    ) {
      body.status = 'publicado';
    }

    if (body.status !== undefined) {
      const status = String(body.status) as HrScheduleStatus;
      if (!['propuesta', 'borrador', 'publicado'].includes(status)) {
        return NextResponse.json({ error: 'status inválido' }, { status: 400 });
      }
      // Pasado/en curso: no despublicar. Futuras: se puede volver a borrador.
      const from = current.status as HrScheduleStatus;
      const allowed: Record<HrScheduleStatus, HrScheduleStatus[]> = {
        propuesta: ['borrador', 'publicado', 'propuesta'],
        borrador: ['propuesta', 'publicado', 'borrador'],
        publicado: isFuture ? ['publicado', 'borrador'] : ['publicado'],
      };
      if (from === 'publicado' && status === 'borrador' && !isFuture) {
        return NextResponse.json(
          {
            error:
              'No se puede despublicar pasado o en curso. El histórico queda publicado.',
          },
          { status: 400 }
        );
      }
      if (!allowed[from].includes(status)) {
        return NextResponse.json(
          {
            error: `No se puede pasar de «${from}» a «${status}»`,
          },
          { status: 400 }
        );
      }
      patch.status = status;
      if (status === 'publicado') {
        patch.published_by = auth.username;
        patch.published_at = new Date().toISOString();
      } else if (status === 'borrador' && from === 'publicado') {
        patch.published_by = null;
        patch.published_at = null;
      }
    }

    const { data: week, error: upErr } = await sb
      .from('hr_schedule_weeks')
      .update(patch)
      .eq('id', weekId)
      .select(WEEK_SELECT)
      .single();

    if (upErr || !week) {
      return NextResponse.json(
        { error: upErr?.message || 'No se pudo actualizar' },
        { status: 400 }
      );
    }

    let shiftsOut: HrScheduleShift[] | undefined;

    if (Array.isArray(body.shifts)) {
      const incoming = body.shifts as Record<string, unknown>[];
      await sb.from('hr_schedule_shifts').delete().eq('week_id', weekId);

      if (incoming.length > 0) {
        const rows = incoming.map((s) => ({
          week_id: weekId,
          employee_id: String(s.employee_id),
          shift_date: String(s.shift_date).slice(0, 10),
          start_time: s.start_time ? String(s.start_time).slice(0, 8) : null,
          end_time: s.end_time ? String(s.end_time).slice(0, 8) : null,
          area: s.area != null ? String(s.area) : null,
          role_label: s.role_label != null ? String(s.role_label) : null,
          origin: s.origin === 'auto' ? 'auto' : 'manual',
          notes: s.notes != null ? String(s.notes) : null,
        }));
        const { error: insErr } = await sb
          .from('hr_schedule_shifts')
          .insert(rows);
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 400 });
        }
      }

      const { data: shifts } = await sb
        .from('hr_schedule_shifts')
        .select(SHIFT_SELECT)
        .eq('week_id', weekId)
        .order('shift_date', { ascending: true });
      shiftsOut = (shifts || []).map((s) =>
        mapShift(s as Record<string, unknown>)
      );
    }

    const w = week as HrScheduleWeek;
    return NextResponse.json({
      ready: true,
      week: {
        ...w,
        week_start: String(w.week_start).slice(0, 10),
        week_end: String(w.week_end).slice(0, 10),
      },
      shifts: shiftsOut,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/hr/schedules/[weekId] — solo propuesta/borrador.
 */
export async function DELETE(_request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  const { weekId } = await ctx.params;
  try {
    const sb = getServiceSupabase();
    const { data: current } = await sb
      .from('hr_schedule_weeks')
      .select('id, status, week_end')
      .eq('id', weekId)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    }
    const weekEnd = String(current.week_end).slice(0, 10);
    if (isPastScheduleWeek(weekEnd, todayIsoCdmx())) {
      return NextResponse.json(
        { error: 'No se puede eliminar una semana pasada (solo lectura).' },
        { status: 400 }
      );
    }
    if (current.status === 'publicado') {
      return NextResponse.json(
        {
          error:
            'No se puede borrar un horario publicado. Solo borradores futuros vacíos.',
        },
        { status: 400 }
      );
    }

    const { error } = await sb
      .from('hr_schedule_weeks')
      .delete()
      .eq('id', weekId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ready: true, deleted: weekId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
