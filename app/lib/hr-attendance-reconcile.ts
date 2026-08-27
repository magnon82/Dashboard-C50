/**
 * Cotejo checadas vs horarios publicados + texto de incidencias (estilo correo RH).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isVacationScheduleShift,
  type HrScheduleShift,
  addIsoDays,
} from '@/app/lib/hr';
import {
  matchEmployeeId,
  formatHrListName,
  normalizePersonKey,
} from '@/app/lib/hr-person-match';
import {
  classifyArrivalMinutes,
  minutesBetweenHm,
  summarizePolicySanctions,
  HR_ATTENDANCE_DAY_STATUS_LABELS,
  type HrAttendanceDayStatus,
} from '@/app/lib/hr-attendance-policy';
import type { ParsedAttendancePunch } from '@/app/lib/hr-attendance-import';

export type AttendanceDayResult = {
  employee_id: string | null;
  employee_name: string;
  work_date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_in: string | null;
  actual_out: string | null;
  status: HrAttendanceDayStatus;
  late_minutes: number | null;
};

export type AttendancePersonSummary = {
  employee_id: string | null;
  employee_name: string;
  area: string | null;
  days: AttendanceDayResult[];
  retardos: number;
  tolerancias: number;
  sin_entrada: number;
  sin_salida: number;
  faltas: number;
  faltas_equiv: number;
  line: string;
};

export type AttendanceReconcileReport = {
  week_start: string;
  week_end: string;
  people: AttendancePersonSummary[];
  totals: {
    retardos: number;
    tolerancias: number;
    sin_entrada: number;
    sin_salida: number;
    faltas: number;
  };
  narrative: string[];
};

type EmpRow = {
  id: string;
  full_name: string;
  area: string | null;
  puesto: string | null;
};

function time5(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = String(t).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}

function pickInOut(
  punches: ParsedAttendancePunch[]
): { inn: string | null; out: string | null } {
  if (!punches.length) return { inn: null, out: null };
  const sorted = [...punches].sort((a, b) =>
    a.punch_time.localeCompare(b.punch_time)
  );
  const markedIn = sorted.find((p) => p.punch_kind === 'in');
  const markedOut = [...sorted].reverse().find((p) => p.punch_kind === 'out');
  if (markedIn || markedOut) {
    return {
      inn: markedIn?.punch_time ?? sorted[0]?.punch_time ?? null,
      out:
        markedOut?.punch_time ??
        (sorted.length > 1 ? sorted[sorted.length - 1].punch_time : null),
    };
  }
  // unknown kinds: first = in, last = out (if ≥2)
  if (sorted.length === 1) {
    return { inn: sorted[0].punch_time, out: null };
  }
  return {
    inn: sorted[0].punch_time,
    out: sorted[sorted.length - 1].punch_time,
  };
}

function classifyWorkDay(opts: {
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualIn: string | null;
  actualOut: string | null;
  isOff: boolean;
  isVac: boolean;
}): { status: HrAttendanceDayStatus; late: number | null } {
  if (opts.isVac) return { status: 'vacaciones', late: null };
  if (opts.isOff || !opts.scheduledStart) {
    return { status: 'descanso', late: null };
  }
  if (!opts.actualIn && !opts.actualOut) {
    return { status: 'falta', late: null };
  }
  if (!opts.actualIn) return { status: 'sin_entrada', late: null };
  if (!opts.actualOut) {
    const late = minutesBetweenHm(opts.scheduledStart, opts.actualIn);
    const arrival = classifyArrivalMinutes(late != null && late > 0 ? late : 0);
    // Prefer omission of exit over arrival status when both apply
    if (arrival === 'retardo' || arrival === 'tolerancia') {
      // Still flag sin_salida as primary incident for the day list;
      // late minutes kept for counts.
      return { status: 'sin_salida', late: late != null && late > 0 ? late : 0 };
    }
    return { status: 'sin_salida', late: null };
  }
  const late = minutesBetweenHm(opts.scheduledStart, opts.actualIn);
  const latePos = late != null && late > 0 ? late : 0;
  return {
    status: classifyArrivalMinutes(latePos),
    late: latePos > 0 ? latePos : null,
  };
}

function buildPersonLine(s: AttendancePersonSummary): string {
  const bits: string[] = [];
  const retDates = s.days
    .filter((d) => d.status === 'retardo')
    .map((d) => d.work_date.slice(5).replace('-', '/'));
  const tolDates = s.days
    .filter((d) => d.status === 'tolerancia')
    .map((d) => d.work_date.slice(5).replace('-', '/'));
  const sinE = s.days
    .filter((d) => d.status === 'sin_entrada')
    .map((d) => d.work_date.slice(5).replace('-', '/'));
  const sinS = s.days
    .filter((d) => d.status === 'sin_salida')
    .map((d) => d.work_date.slice(5).replace('-', '/'));
  const faltas = s.days
    .filter((d) => d.status === 'falta')
    .map((d) => d.work_date.slice(5).replace('-', '/'));

  if (
    !retDates.length &&
    !tolDates.length &&
    !sinE.length &&
    !sinS.length &&
    !faltas.length
  ) {
    return 'Sin incidencias';
  }
  if (retDates.length) {
    bits.push(
      `${retDates.length} día(s) de entrada con retardo ${retDates.join(', ')}`
    );
  }
  if (tolDates.length) {
    bits.push(
      `${tolDates.length} día(s) de entrada en tolerancia ${tolDates.join(', ')}`
    );
  }
  if (sinE.length) {
    bits.push(`Sin registro de entrada: ${sinE.join(', ')}`);
  }
  if (sinS.length) {
    bits.push(`Sin registro de salida: ${sinS.join(', ')}`);
  }
  if (faltas.length) {
    bits.push(`Falta(s): ${faltas.join(', ')}`);
  }
  const sanc = summarizePolicySanctions({
    retardos: s.retardos,
    omisiones: s.sin_entrada + s.sin_salida,
  });
  if (sanc.faltasEquiv > 0) {
    bits.push(`Equiv. sanciones ≈ ${sanc.faltasEquiv} día(s)`);
  }
  return bits.join(' · ');
}

/**
 * Resuelve nombres crudos → employee_id y arma cotejo semanal.
 */
export async function reconcileAttendanceWeek(
  sb: SupabaseClient,
  opts: {
    weekStart: string;
    weekEnd: string;
    punches: ParsedAttendancePunch[];
  }
): Promise<AttendanceReconcileReport> {
  const { data: empData } = await sb
    .from('hr_employees')
    .select('id, full_name, area, puesto, status')
    .neq('status', 'baja');

  const employees = (empData || []) as EmpRow[];
  const byKey = new Map(
    employees.map((e) => [normalizePersonKey(e.full_name), e] as const)
  );
  const named = employees.map((e) => ({ id: e.id, full_name: e.full_name }));

  // Map punches → employee
  type Linked = ParsedAttendancePunch & { employee_id: string | null };
  const linked: Linked[] = opts.punches.map((p) => {
    const id = matchEmployeeId(p.employee_name_raw, byKey, named);
    return { ...p, employee_id: id };
  });

  const { data: weekRow } = await sb
    .from('hr_schedule_weeks')
    .select('id, status')
    .eq('week_start', opts.weekStart)
    .maybeSingle();

  let shifts: HrScheduleShift[] = [];
  if (weekRow?.id) {
    const { data: sh } = await sb
      .from('hr_schedule_shifts')
      .select(
        'employee_id, shift_date, start_time, end_time, notes, role_label, area'
      )
      .eq('week_id', weekRow.id);
    shifts = (sh || []) as HrScheduleShift[];
  }

  // Index shifts by emp+date
  const shiftKey = (empId: string, date: string) => `${empId}|${date}`;
  const shiftsBy = new Map<string, HrScheduleShift[]>();
  for (const s of shifts) {
    const k = shiftKey(String(s.employee_id), String(s.shift_date).slice(0, 10));
    const list = shiftsBy.get(k) || [];
    list.push(s);
    shiftsBy.set(k, list);
  }

  // People involved: schedule week ∪ punch names
  const peopleIds = new Set<string>();
  for (const s of shifts) peopleIds.add(String(s.employee_id));
  for (const p of linked) {
    if (p.employee_id) peopleIds.add(p.employee_id);
  }

  // Also unmatched punch names as synthetic people
  const unmatchedNames = new Set<string>();
  for (const p of linked) {
    if (!p.employee_id) unmatchedNames.add(p.employee_name_raw);
  }

  const dates: string[] = [];
  {
    let cur = opts.weekStart;
    for (let i = 0; i < 14 && cur <= opts.weekEnd; i += 1) {
      dates.push(cur);
      cur = addIsoDays(cur, 1);
    }
  }

  const people: AttendancePersonSummary[] = [];

  const buildForEmployee = (emp: EmpRow | null, displayName: string) => {
    const days: AttendanceDayResult[] = [];
    for (const date of dates) {
      const dayShifts = emp
        ? shiftsBy.get(shiftKey(emp.id, date)) || []
        : [];
      const vac = dayShifts.some((s) => isVacationScheduleShift(s));
      const work = dayShifts.filter(
        (s) =>
          !isVacationScheduleShift(s) &&
          time5(s.start_time) &&
          time5(s.end_time)
      );
      const isOff = !vac && work.length === 0;

      const dayPunches = linked.filter((p) => {
        if (p.punch_date !== date) return false;
        if (emp) return p.employee_id === emp.id;
        return (
          !p.employee_id &&
          normalizePersonKey(p.employee_name_raw) ===
            normalizePersonKey(displayName)
        );
      });
      const { inn, out } = pickInOut(dayPunches);

      let scheduledStart: string | null = null;
      let scheduledEnd: string | null = null;
      if (work.length) {
        // earliest start / latest end
        const starts = work
          .map((s) => time5(s.start_time)!)
          .sort();
        const ends = work.map((s) => time5(s.end_time)!).sort();
        scheduledStart = starts[0] || null;
        scheduledEnd = ends[ends.length - 1] || null;
      }

      if (!emp && dayPunches.length === 0) continue;

      const { status, late } = classifyWorkDay({
        scheduledStart,
        scheduledEnd,
        actualIn: inn,
        actualOut: out,
        isOff: emp ? isOff : dayPunches.length === 0,
        isVac: vac,
      });

      // Skip pure rest days without punches for cleaner report
      if ((status === 'descanso' || status === 'vacaciones') && !inn && !out) {
        continue;
      }

      days.push({
        employee_id: emp?.id ?? null,
        employee_name: displayName,
        work_date: date,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        actual_in: inn,
        actual_out: out,
        status: emp ? status : inn || out ? 'sin_horario' : status,
        late_minutes: late,
      });
    }

    if (!days.length) return;

    const retardos = days.filter((d) => d.status === 'retardo').length;
    const tolerancias = days.filter((d) => d.status === 'tolerancia').length;
    const sin_entrada = days.filter((d) => d.status === 'sin_entrada').length;
    const sin_salida = days.filter((d) => d.status === 'sin_salida').length;
    const faltas = days.filter((d) => d.status === 'falta').length;
    const sanc = summarizePolicySanctions({
      retardos,
      omisiones: sin_entrada + sin_salida,
    });

    const summary: AttendancePersonSummary = {
      employee_id: emp?.id ?? null,
      employee_name: displayName,
      area: emp?.area || emp?.puesto || null,
      days,
      retardos,
      tolerancias,
      sin_entrada,
      sin_salida,
      faltas,
      faltas_equiv: sanc.faltasEquiv,
      line: '',
    };
    summary.line = buildPersonLine(summary);
    people.push(summary);
  };

  for (const id of peopleIds) {
    const emp = employees.find((e) => e.id === id);
    if (!emp) continue;
    buildForEmployee(emp, formatHrListName(emp.full_name));
  }
  for (const name of unmatchedNames) {
    buildForEmployee(null, formatHrListName(name));
  }

  people.sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name, 'es')
  );

  const totals = {
    retardos: people.reduce((n, p) => n + p.retardos, 0),
    tolerancias: people.reduce((n, p) => n + p.tolerancias, 0),
    sin_entrada: people.reduce((n, p) => n + p.sin_entrada, 0),
    sin_salida: people.reduce((n, p) => n + p.sin_salida, 0),
    faltas: people.reduce((n, p) => n + p.faltas, 0),
  };

  const narrative: string[] = [];
  const sinEnt = people.filter((p) => p.sin_entrada > 0);
  if (sinEnt.length) {
    narrative.push('SIN REGISTRO DE ENTRADA:');
    for (const p of sinEnt) {
      const datesList = p.days
        .filter((d) => d.status === 'sin_entrada')
        .map((d) => d.work_date.slice(8) + '/' + d.work_date.slice(5, 7));
      narrative.push(`· ${p.employee_name}: ${datesList.join(', ')}`);
    }
  }
  const sinSal = people.filter((p) => p.sin_salida > 0);
  if (sinSal.length) {
    narrative.push('SIN REGISTRO DE SALIDA:');
    for (const p of sinSal) {
      const datesList = p.days
        .filter((d) => d.status === 'sin_salida')
        .map((d) => d.work_date.slice(8) + '/' + d.work_date.slice(5, 7));
      narrative.push(`· ${p.employee_name}: ${datesList.join(', ')}`);
    }
  }
  for (const p of people) {
    if (p.line === 'Sin incidencias') continue;
    if (p.sin_entrada || p.sin_salida) continue; // already listed
    narrative.push(`· ${p.employee_name}: ${p.line}`);
  }
  if (!narrative.length) {
    narrative.push('Sin incidencias en la semana.');
  }

  return {
    week_start: opts.weekStart,
    week_end: opts.weekEnd,
    people,
    totals,
    narrative,
  };
}

export { HR_ATTENDANCE_DAY_STATUS_LABELS };
