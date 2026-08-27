/**
 * Alerta vie–dom CDMX: próxima semana de horarios faltante o sin publicar.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addIsoDays,
  formatHrDate,
  todayIsoCdmx,
  type HrScheduleStatus,
  type HrSummaryAlert,
} from '@/app/lib/hr';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekdayOfIso,
} from '@/app/lib/hr-schedule-propose';

export type NextWeekScheduleAlertKind = 'missing' | 'draft';

export type NextWeekScheduleAlert = {
  active: boolean;
  /** Vie=5, Sáb=6, Dom=0 — ventana de anticipación. */
  inWindow: boolean;
  today: string;
  nextWeekStart: string;
  nextWeekEnd: string;
  kind: NextWeekScheduleAlertKind | null;
  weekId: string | null;
  status: HrScheduleStatus | null;
  message: string | null;
};

/** Vie–Dom CDMX: momento de armar / publicar la semana siguiente. */
export function isNextWeekScheduleAlertWindow(
  today: string = todayIsoCdmx()
): boolean {
  const wd = weekdayOfIso(today);
  return wd === 5 || wd === 6 || wd === 0;
}

export function buildNextWeekScheduleSummaryAlerts(
  info: NextWeekScheduleAlert
): HrSummaryAlert[] {
  if (!info.active || !info.message) return [];
  return [
    {
      id:
        info.kind === 'missing'
          ? 'next-week-missing'
          : 'next-week-draft',
      severity: 'warn',
      message: info.message,
      go: 'horarios',
    },
  ];
}

/**
 * Evalúa estado de la semana siguiente (lunes +7).
 * Solo `active` en vie–dom y si falta crear o falta publicar.
 */
export async function evaluateNextWeekScheduleAlert(
  sb: SupabaseClient,
  opts?: { today?: string }
): Promise<NextWeekScheduleAlert> {
  const today = (opts?.today || todayIsoCdmx()).slice(0, 10);
  const inWindow = isNextWeekScheduleAlertWindow(today);
  const currentMon = mondayOfWeek(today);
  const nextWeekStart = addIsoDays(currentMon, 7);
  const nextWeekEnd = sundayOfWeek(nextWeekStart);

  const base: NextWeekScheduleAlert = {
    active: false,
    inWindow,
    today,
    nextWeekStart,
    nextWeekEnd,
    kind: null,
    weekId: null,
    status: null,
    message: null,
  };

  if (!inWindow) return base;

  const { data, error } = await sb
    .from('hr_schedule_weeks')
    .select('id, status, week_start, week_end')
    .eq('week_start', nextWeekStart)
    .maybeSingle();

  if (error) {
    const missing =
      error.message?.includes('does not exist') || error.code === '42P01';
    if (missing) {
      return {
        ...base,
        active: true,
        kind: 'missing',
        message: `Semana del ${formatHrDate(nextWeekStart)}: no se ha creado el horario (crear 1 semana por adelantado)`,
      };
    }
    return base;
  }

  if (!data?.id) {
    return {
      ...base,
      active: true,
      kind: 'missing',
      message: `Semana del ${formatHrDate(nextWeekStart)}: no se ha creado el horario (crear 1 semana por adelantado)`,
    };
  }

  const status = String(data.status || '') as HrScheduleStatus;
  if (status === 'publicado') {
    return {
      ...base,
      weekId: String(data.id),
      status,
    };
  }

  // borrador / propuesta
  return {
    ...base,
    active: true,
    kind: 'draft',
    weekId: String(data.id),
    status,
    message: `Semana del ${formatHrDate(nextWeekStart)}: horario en borrador — publicación pendiente`,
  };
}
