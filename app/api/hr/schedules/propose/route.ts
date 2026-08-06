import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireSchedulesSession,
  requireSchedulesWrite,
} from '@/app/lib/hr-api';
import type { ProposeEmployee } from '@/app/lib/hr-schedule-propose';
import {
  buildUnavailableKeys,
  mondayOfWeek,
  proposeWeeklySchedule,
  sundayOfWeek,
  weekDateList,
  type HistoricalShift,
} from '@/app/lib/hr-schedule-propose';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/hr/schedules/propose
 * Body: { week_start: YYYY-MM-DD, use_activos_fallback?: boolean, replace?: boolean }
 *
 * Genera semana status=propuesta a partir de plantilla + histórico − disponibilidad/leave.
 */
export async function POST(request: Request) {
  const auth = await requireSchedulesSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireSchedulesWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const weekStartRaw = String(body.week_start || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw)) {
    return NextResponse.json(
      { error: 'week_start (YYYY-MM-DD) es obligatorio' },
      { status: 400 }
    );
  }

  const weekStart = mondayOfWeek(weekStartRaw);
  const weekEnd = sundayOfWeek(weekStart);
  const useActivos = Boolean(body.use_activos_fallback);
  const replace = body.replace !== false; // default true if same week exists as propuesta

  try {
    const sb = getServiceSupabase();

    // —— Plantilla ——
    let employees: ProposeEmployee[] = [];
    let plantillaSource: string = 'empty';
    let plantillaNote: string | null = null;

    const resolved = await resolvePlantillaVigente(sb, { allowSeed: false });
    if (resolved.employees.length > 0) {
      employees = resolved.employees.map((e) => ({
        id: e.id,
        full_name: e.full_name,
        area: e.area,
        puesto: e.puesto,
        notes: null,
      }));
      plantillaSource = resolved.source;
      if (resolved.scheduleWeek) {
        plantillaNote = `Incluye horarios ${resolved.scheduleWeek.week_start} (${resolved.scheduleWeek.status}).`;
      } else if (
        resolved.source === 'periodo_transcurrido' ||
        resolved.source === 'plantilla_vigente' ||
        resolved.source === 'seed_local_2026'
      ) {
        plantillaNote =
          'Plantilla solo desde nómina conciliada (sin semana de horarios con turnos reales).';
      }
    } else if (useActivos) {
      const activos = await sb
        .from('hr_employees')
        .select('id, full_name, area, puesto, notes')
        .eq('status', 'activo')
        .eq('force_exclude', false)
        .order('full_name');
      if (activos.error) {
        return NextResponse.json(
          {
            error: hrSchemaMissing(activos.error.message)
              ? 'Ejecuta supabase/hr_module.sql en Supabase.'
              : activos.error.message,
          },
          { status: 400 }
        );
      }
      employees = (activos.data || []).map((e) => ({
        id: String(e.id),
        full_name: String(e.full_name),
        area: e.area ? String(e.area) : null,
        puesto: e.puesto ? String(e.puesto) : null,
        notes: e.notes ? String(e.notes) : null,
      }));
      plantillaSource = 'activos_fallback';
      plantillaNote =
        'Plantilla vigente vacía: se usaron todos los empleados activos.';
    } else {
      const countActivos = await sb
        .from('hr_employees')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'activo')
        .eq('force_exclude', false);

      return NextResponse.json(
        {
          error: 'plantilla_vacia',
          message:
            'Plantilla vacía: cierra/paga la última nómina o importa horarios con turnos reales; también puedes «Generar con activos».',
          activosCount: countActivos.count ?? 0,
        },
        { status: 409 }
      );
    }

    if (employees.length === 0) {
      return NextResponse.json(
        {
          error: 'sin_empleados',
          message:
            'No hay colaboradores para armar la propuesta. Crea empleados en hr_employees o importa nómina.',
        },
        { status: 409 }
      );
    }

    // Notes (flag dual_limpieza_mesero) no vienen en plantilla — enriquecer
    {
      const ids = employees.map((e) => e.id);
      const notesRes = await sb
        .from('hr_employees')
        .select('id, notes')
        .in('id', ids);
      if (!notesRes.error && notesRes.data) {
        const byId = new Map(
          notesRes.data.map((r) => [
            String(r.id),
            r.notes ? String(r.notes) : null,
          ])
        );
        employees = employees.map((e) => ({
          ...e,
          notes: byId.get(e.id) ?? e.notes ?? null,
        }));
      }
    }

    // —— Semana existente ——
    const existing = await sb
      .from('hr_schedule_weeks')
      .select('id, status')
      .eq('week_start', weekStart)
      .maybeSingle();

    if (existing.data) {
      if (existing.data.status === 'publicado' && !replace) {
        return NextResponse.json(
          {
            error: 'semana_publicada',
            message:
              'Ya hay un horario publicado para esa semana. Despublica o edita el existente.',
            weekId: existing.data.id,
          },
          { status: 409 }
        );
      }
      if (existing.data.status === 'publicado') {
        return NextResponse.json(
          {
            error: 'semana_publicada',
            message:
              'No se puede regenerar una semana publicada. Cambia el estatus a borrador primero o elige otra semana.',
            weekId: existing.data.id,
          },
          { status: 409 }
        );
      }
      if (replace) {
        await sb
          .from('hr_schedule_weeks')
          .delete()
          .eq('id', existing.data.id);
      } else {
        return NextResponse.json(
          {
            error: 'semana_existe',
            message: 'Ya existe una propuesta/borrador para esa semana.',
            weekId: existing.data.id,
          },
          { status: 409 }
        );
      }
    }

    // —— Histórico: preferir semanas publicadas (import 2026); fallback borrador ——
    const publishedHist = await sb
      .from('hr_schedule_weeks')
      .select('id, week_start, status')
      .eq('status', 'publicado')
      .lt('week_start', weekStart)
      .order('week_start', { ascending: false })
      .limit(16);

    let histWeeks = publishedHist;
    if (
      publishedHist.error ||
      !publishedHist.data ||
      publishedHist.data.length === 0
    ) {
      histWeeks = await sb
        .from('hr_schedule_weeks')
        .select('id, week_start, status')
        .eq('status', 'borrador')
        .lt('week_start', weekStart)
        .order('week_start', { ascending: false })
        .limit(8);
    }

    let lastWeek: { weekStart: string; shifts: HistoricalShift[] } | null =
      null;
    const recentShifts: HistoricalShift[] = [];

    if (!histWeeks.error && histWeeks.data && histWeeks.data.length > 0) {
      const weekIds = histWeeks.data.map((w) => w.id);
      const { data: allShifts } = await sb
        .from('hr_schedule_shifts')
        .select(
          'week_id, employee_id, shift_date, start_time, end_time, area, role_label'
        )
        .in('week_id', weekIds);

      const byWeek = new Map<string, HistoricalShift[]>();
      for (const s of allShifts || []) {
        const row: HistoricalShift = {
          employee_id: String(s.employee_id),
          shift_date: String(s.shift_date).slice(0, 10),
          start_time: s.start_time ? String(s.start_time).slice(0, 8) : null,
          end_time: s.end_time ? String(s.end_time).slice(0, 8) : null,
          area: s.area ? String(s.area) : null,
          role_label: s.role_label ? String(s.role_label) : null,
        };
        recentShifts.push(row);
        const list = byWeek.get(String(s.week_id)) || [];
        list.push(row);
        byWeek.set(String(s.week_id), list);
      }

      const first = histWeeks.data[0];
      const firstShifts = byWeek.get(first.id) || [];
      if (firstShifts.length > 0) {
        lastWeek = {
          weekStart: String(first.week_start).slice(0, 10),
          shifts: firstShifts,
        };
      }
    }

    // —— Disponibilidad + leave ——
    const dates = weekDateList(weekStart);
    const empIds = employees.map((e) => e.id);

    const [availRes, leaveRes] = await Promise.all([
      sb
        .from('hr_availability')
        .select('employee_id, kind, weekday, date_from, date_to')
        .in('employee_id', empIds),
      sb
        .from('hr_leave_requests')
        .select('employee_id, date_from, date_to, status')
        .eq('status', 'aprobada')
        .in('employee_id', empIds)
        .lte('date_from', weekEnd)
        .gte('date_to', weekStart),
    ]);

    const unavailableKeys = buildUnavailableKeys({
      weekDates: dates,
      availability: (availRes.data || []).map((a) => ({
        employee_id: String(a.employee_id),
        kind: String(a.kind),
        weekday: a.weekday != null ? Number(a.weekday) : null,
        date_from: a.date_from ? String(a.date_from).slice(0, 10) : null,
        date_to: a.date_to ? String(a.date_to).slice(0, 10) : null,
      })),
      approvedLeave: (leaveRes.data || []).map((l) => ({
        employee_id: l.employee_id ? String(l.employee_id) : null,
        date_from: String(l.date_from).slice(0, 10),
        date_to: String(l.date_to).slice(0, 10),
      })),
    });

    const proposal = proposeWeeklySchedule({
      weekStart,
      employees,
      lastWeek,
      recentShifts,
      unavailableKeys,
    });

    const notesParts = [
      proposal.message,
      plantillaNote,
      `Plantilla: ${plantillaSource} (${employees.length}).`,
    ].filter(Boolean);

    const { data: weekRow, error: weekErr } = await sb
      .from('hr_schedule_weeks')
      .insert({
        week_start: weekStart,
        week_end: weekEnd,
        status: 'propuesta',
        notes: notesParts.join(' '),
        created_by: auth.username,
        updated_at: new Date().toISOString(),
      })
      .select(
        'id, week_start, week_end, status, notes, created_by, published_by, published_at, created_at, updated_at'
      )
      .single();

    if (weekErr || !weekRow) {
      return NextResponse.json(
        {
          error: hrSchemaMissing(weekErr?.message)
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : weekErr?.message || 'No se pudo crear la semana',
        },
        { status: 400 }
      );
    }

    if (proposal.shifts.length > 0) {
      const rows = proposal.shifts.map((s) => ({
        week_id: weekRow.id,
        employee_id: s.employee_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        area: s.area,
        role_label: s.role_label,
        origin: 'auto' as const,
        notes: s.notes,
      }));
      const { error: shiftErr } = await sb
        .from('hr_schedule_shifts')
        .insert(rows);
      if (shiftErr) {
        // Semana creada pero sin turnos — reportar
        return NextResponse.json({
          ready: true,
          week: {
            ...weekRow,
            week_start: String(weekRow.week_start).slice(0, 10),
            week_end: String(weekRow.week_end).slice(0, 10),
          },
          mode: proposal.mode,
          shiftCount: 0,
          skippedUnavailable: proposal.skippedUnavailable,
          plantillaSource,
          message: `${proposal.message} Error al insertar turnos: ${shiftErr.message}`,
          employees,
          windows: proposal.windows,
          hoursByEmployee: proposal.hoursByEmployee,
        });
      }
    }

    return NextResponse.json({
      ready: true,
      week: {
        ...weekRow,
        week_start: String(weekRow.week_start).slice(0, 10),
        week_end: String(weekRow.week_end).slice(0, 10),
      },
      mode: proposal.mode,
      shiftCount: proposal.shifts.length,
      skippedUnavailable: proposal.skippedUnavailable,
      plantillaSource,
      message: notesParts.join(' '),
      employees,
      windows: proposal.windows,
      hoursByEmployee: proposal.hoursByEmployee,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al generar propuesta' },
      { status: 500 }
    );
  }
}
