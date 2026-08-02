import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireStaffOrRrhhSession,
} from '@/app/lib/hr-api';
import { addIsoDays, todayIsoCdmx, type HrScheduleShift } from '@/app/lib/hr';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekdayOfIso,
} from '@/app/lib/hr-schedule-propose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WeekRow = {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
  notes?: string | null;
  published_at?: string | null;
  published_by?: string | null;
};

type WeekBundle = {
  week: WeekRow | null;
  shifts: HrScheduleShift[];
  message: string | null;
  weekStart: string;
  weekEnd: string;
  schemaMissing?: boolean;
  error?: string;
};

function mapRawShifts(shifts: unknown[] | null): HrScheduleShift[] {
  type Raw = Record<string, unknown> & {
    hr_employees?: {
      full_name?: string;
      area?: string;
      puesto?: string;
      notes?: string | null;
    } | null;
  };

  return (shifts || []).map((s) => {
    const raw = s as Raw;
    const emp = raw.hr_employees;
    return {
      id: String(raw.id),
      week_id: String(raw.week_id),
      employee_id: String(raw.employee_id),
      shift_date: String(raw.shift_date).slice(0, 10),
      start_time: raw.start_time
        ? String(raw.start_time).slice(0, 8)
        : null,
      end_time: raw.end_time ? String(raw.end_time).slice(0, 8) : null,
      area: raw.area != null ? String(raw.area) : null,
      role_label: raw.role_label != null ? String(raw.role_label) : null,
      origin: raw.origin === 'auto' ? 'auto' : 'manual',
      notes: raw.notes != null ? String(raw.notes) : null,
      employee_name: emp?.full_name ?? null,
      employee_area: emp?.area ?? null,
      employee_puesto: emp?.puesto ?? null,
      employee_notes: emp?.notes != null ? String(emp.notes) : null,
    };
  });
}

async function loadPublishedWeekRoster(
  sb: ReturnType<typeof getServiceSupabase>,
  weekStart: string,
  kind: 'current' | 'next'
): Promise<WeekBundle> {
  const weekEnd = sundayOfWeek(weekStart);

  const { data: week, error: weekErr } = await sb
    .from('hr_schedule_weeks')
    .select(
      'id, week_start, week_end, status, notes, published_at, published_by'
    )
    .eq('week_start', weekStart)
    .eq('status', 'publicado')
    .maybeSingle();

  if (weekErr) {
    return {
      week: null,
      shifts: [],
      message: weekErr.message,
      weekStart,
      weekEnd,
      schemaMissing: hrSchemaMissing(weekErr.message),
      error: weekErr.message,
    };
  }

  if (!week) {
    return {
      week: null,
      shifts: [],
      message:
        kind === 'current'
          ? 'RH aún no publicó la semana en curso. Cuando lo hagan, verás la tabla de horarios del personal aquí.'
          : 'RH aún no publicó la próxima semana. De viernes a domingo verás la tabla completa aquí cuando esté publicada.',
      weekStart,
      weekEnd,
    };
  }

  const { data: shifts, error: shErr } = await sb
    .from('hr_schedule_shifts')
    .select(
      'id, week_id, employee_id, shift_date, start_time, end_time, area, role_label, origin, notes, hr_employees(full_name, area, puesto, notes)'
    )
    .eq('week_id', week.id)
    .order('shift_date', { ascending: true });

  const weekNorm: WeekRow = {
    ...week,
    week_start: String(week.week_start).slice(0, 10),
    week_end: String(week.week_end).slice(0, 10),
  };

  if (shErr) {
    return {
      week: weekNorm,
      shifts: [],
      message: shErr.message,
      weekStart,
      weekEnd,
      error: shErr.message,
    };
  }

  const mapped = mapRawShifts(shifts);
  return {
    week: weekNorm,
    shifts: mapped,
    message:
      mapped.length === 0
        ? kind === 'current'
          ? 'La semana en curso está publicada, pero aún no hay turnos en la grilla.'
          : 'La próxima semana está publicada, pero aún no hay turnos en la grilla.'
        : null,
    weekStart,
    weekEnd,
  };
}

/** Vie–Dom (CDMX): también mostrar próxima semana publicada. */
function isWeekendPreviewDay(iso: string): boolean {
  const wd = weekdayOfIso(iso);
  return wd === 5 || wd === 6 || wd === 0;
}

/**
 * GET /api/hr/schedules/mine
 * Tabla completa del personal (todos los turnos) de la **semana en curso**
 * si está **publicada**. De **vie a dom** (CDMX) también incluye la próxima
 * semana si está publicada. Nunca expone borradores.
 */
export async function GET(_request: Request) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const today = todayIsoCdmx();
  const weekStart = mondayOfWeek(today);
  const weekEnd = sundayOfWeek(weekStart);
  const includeNextWeek = isWeekendPreviewDay(today);
  const nextWeekStart = addIsoDays(weekStart, 7);
  const nextWeekEnd = sundayOfWeek(nextWeekStart);

  try {
    const sb = getServiceSupabase();
    const current = await loadPublishedWeekRoster(sb, weekStart, 'current');

    if (current.schemaMissing || current.error) {
      return NextResponse.json({
        ready: !current.schemaMissing,
        includeNextWeek,
        week: current.week,
        shifts: current.shifts,
        message: current.schemaMissing
          ? 'Ejecuta supabase/hr_module.sql en Supabase.'
          : current.message,
        weekStart,
        weekEnd,
        nextWeek: null,
        nextShifts: [] as HrScheduleShift[],
        nextMessage: null,
        nextWeekStart: includeNextWeek ? nextWeekStart : null,
        nextWeekEnd: includeNextWeek ? nextWeekEnd : null,
      });
    }

    let next: WeekBundle = {
      week: null,
      shifts: [],
      message: null,
      weekStart: nextWeekStart,
      weekEnd: nextWeekEnd,
    };

    if (includeNextWeek) {
      next = await loadPublishedWeekRoster(sb, nextWeekStart, 'next');
    }

    return NextResponse.json({
      ready: true,
      includeNextWeek,
      week: current.week,
      shifts: current.shifts,
      message: current.message,
      weekStart,
      weekEnd,
      nextWeek: includeNextWeek ? next.week : null,
      nextShifts: includeNextWeek ? next.shifts : [],
      nextMessage: includeNextWeek ? next.message : null,
      nextWeekStart: includeNextWeek ? nextWeekStart : null,
      nextWeekEnd: includeNextWeek ? nextWeekEnd : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        includeNextWeek,
        week: null,
        shifts: [],
        message: e instanceof Error ? e.message : 'Error',
        weekStart,
        weekEnd,
        nextWeek: null,
        nextShifts: [],
        nextMessage: null,
        nextWeekStart: includeNextWeek ? nextWeekStart : null,
        nextWeekEnd: includeNextWeek ? nextWeekEnd : null,
      },
      { status: 200 }
    );
  }
}
