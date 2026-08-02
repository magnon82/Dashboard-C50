import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireStaffOrRrhhSession,
  resolveLinkedEmployee,
} from '@/app/lib/hr-api';
import { addIsoDays, todayIsoCdmx } from '@/app/lib/hr';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekdayOfIso,
} from '@/app/lib/hr-schedule-propose';
import type { HrScheduleShift } from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LinkedEmp = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
} | null;

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
  myShifts: HrScheduleShift[];
  rosterHint: HrScheduleShift[];
  message: string | null;
  weekStart: string;
  weekEnd: string;
};

function mapShifts(
  shifts: unknown[] | null,
  linked: LinkedEmp,
  authUsername: string,
  emptyLinkedMsg: string,
  rosterMsg: string
): Pick<WeekBundle, 'myShifts' | 'rosterHint' | 'message'> & {
  needLink: boolean;
} {
  type Raw = Record<string, unknown> & {
    hr_employees?: {
      full_name?: string;
      area?: string;
      puesto?: string;
    } | null;
  };

  const mapped: HrScheduleShift[] = (shifts || []).map((s) => {
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
    };
  });

  let myShifts: HrScheduleShift[] = [];
  let rosterHint: HrScheduleShift[] = [];
  let needLink = false;
  let message: string | null = null;

  if (linked) {
    myShifts = mapped.filter((s) => s.employee_id === linked.id);
    message = myShifts.length === 0 ? emptyLinkedMsg : null;
  } else {
    needLink = true;
    const uname = authUsername.trim().toLowerCase();
    const nameMatch = mapped.filter((s) =>
      (s.employee_name || '').toLowerCase().includes(uname)
    );
    if (nameMatch.length > 0) {
      myShifts = nameMatch;
      message =
        'Pide a RH vincular tu usuario (suite_username). Mientras tanto, se muestran turnos cuyo nombre coincide con tu usuario.';
    } else {
      rosterHint = mapped;
      message = rosterMsg;
    }
  }

  return { myShifts, rosterHint, message, needLink };
}

async function loadPublishedWeek(
  sb: ReturnType<typeof getServiceSupabase>,
  weekStart: string,
  linked: LinkedEmp,
  authUsername: string,
  kind: 'current' | 'next'
): Promise<WeekBundle & { needLink: boolean; schemaMissing?: boolean; error?: string }> {
  const weekEnd = sundayOfWeek(weekStart);
  const emptyLinked =
    kind === 'current'
      ? 'La semana en curso está publicada, pero no tienes turnos asignados.'
      : 'La próxima semana está publicada, pero no tienes turnos asignados.';
  const rosterMsg =
    kind === 'current'
      ? 'Pide a RH vincular tu usuario en la ficha (suite_username). Abajo ves el roster publicado de la semana en curso (lectura).'
      : 'Pide a RH vincular tu usuario en la ficha (suite_username). Abajo ves el roster publicado de la próxima semana (lectura).';

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
      myShifts: [],
      rosterHint: [],
      message: weekErr.message,
      weekStart,
      weekEnd,
      needLink: !linked,
      schemaMissing: hrSchemaMissing(weekErr.message),
      error: weekErr.message,
    };
  }

  if (!week) {
    return {
      week: null,
      myShifts: [],
      rosterHint: [],
      message:
        kind === 'current'
          ? linked
            ? 'RH aún no publicó la semana en curso. Cuando lo hagan, verás tus turnos aquí.'
            : 'Pide a RH vincular tu usuario (suite_username en tu ficha). Además, aún no hay horario publicado para la semana en curso.'
          : 'RH aún no publicó la próxima semana. Los viernes verás esos turnos aquí cuando estén publicados.',
      weekStart,
      weekEnd,
      needLink: !linked,
    };
  }

  const { data: shifts, error: shErr } = await sb
    .from('hr_schedule_shifts')
    .select(
      'id, week_id, employee_id, shift_date, start_time, end_time, area, role_label, origin, notes, hr_employees(full_name, area, puesto)'
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
      myShifts: [],
      rosterHint: [],
      message: shErr.message,
      weekStart,
      weekEnd,
      needLink: !linked,
      error: shErr.message,
    };
  }

  const mapped = mapShifts(
    shifts,
    linked,
    authUsername,
    emptyLinked,
    rosterMsg
  );

  return {
    week: weekNorm,
    myShifts: mapped.myShifts,
    rosterHint: mapped.rosterHint,
    message: mapped.message,
    weekStart,
    weekEnd,
    needLink: mapped.needLink,
  };
}

/**
 * GET /api/hr/schedules/mine
 * Semana en curso (CDMX) si está **publicada**.
 * Los **viernes** (CDMX) también incluye la próxima semana si está publicada.
 * Nunca expone borradores.
 */
export async function GET(_request: Request) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const today = todayIsoCdmx();
  const weekStart = mondayOfWeek(today);
  const weekEnd = sundayOfWeek(weekStart);
  const isFriday = weekdayOfIso(today) === 5;
  const nextWeekStart = addIsoDays(weekStart, 7);
  const nextWeekEnd = sundayOfWeek(nextWeekStart);

  try {
    const sb = getServiceSupabase();
    const linked = await resolveLinkedEmployee(sb, auth);

    const current = await loadPublishedWeek(
      sb,
      weekStart,
      linked,
      auth.username,
      'current'
    );

    if (current.schemaMissing || current.error) {
      return NextResponse.json({
        ready: !current.schemaMissing,
        linked: Boolean(linked),
        linkedEmployee: linked,
        isFriday,
        week: current.week,
        myShifts: current.myShifts,
        rosterHint: current.rosterHint,
        message: current.schemaMissing
          ? 'Ejecuta supabase/hr_module.sql en Supabase.'
          : current.message,
        weekStart,
        weekEnd,
        nextWeek: null,
        nextMyShifts: [] as HrScheduleShift[],
        nextRosterHint: [] as HrScheduleShift[],
        nextMessage: null,
        nextWeekStart,
        nextWeekEnd,
      });
    }

    let next: WeekBundle & { needLink: boolean } = {
      week: null,
      myShifts: [],
      rosterHint: [],
      message: null,
      weekStart: nextWeekStart,
      weekEnd: nextWeekEnd,
      needLink: !linked,
    };

    if (isFriday) {
      next = await loadPublishedWeek(
        sb,
        nextWeekStart,
        linked,
        auth.username,
        'next'
      );
    }

    return NextResponse.json({
      ready: true,
      linked: Boolean(linked),
      linkedEmployee: linked,
      needLink: current.needLink || (isFriday && next.needLink),
      isFriday,
      week: current.week,
      myShifts: current.myShifts,
      rosterHint: current.rosterHint,
      message: current.message,
      weekStart,
      weekEnd,
      nextWeek: isFriday ? next.week : null,
      nextMyShifts: isFriday ? next.myShifts : [],
      nextRosterHint: isFriday ? next.rosterHint : [],
      nextMessage: isFriday ? next.message : null,
      nextWeekStart: isFriday ? nextWeekStart : null,
      nextWeekEnd: isFriday ? nextWeekEnd : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        linked: false,
        linkedEmployee: null,
        isFriday,
        week: null,
        myShifts: [],
        rosterHint: [],
        message: e instanceof Error ? e.message : 'Error',
        weekStart,
        weekEnd,
        nextWeek: null,
        nextMyShifts: [],
        nextRosterHint: [],
        nextMessage: null,
        nextWeekStart: isFriday ? nextWeekStart : null,
        nextWeekEnd: isFriday ? nextWeekEnd : null,
      },
      { status: 200 }
    );
  }
}
