/**
 * Heurística v2: propuesta semanal de horarios.
 * - Meta ~48 h/sem por colaborador de plantilla
 * - Cubre ventana de apertura (inferida del histórico 2026)
 * - Refuerza noche/cena (pico de tráfico)
 * - Base: últimas N semanas publicadas (import HORARIOS C50)
 * Respeta offs (`hr_availability`) y vacaciones aprobadas.
 */

import { addIsoDays } from '@/app/lib/hr';

/** Meta operativa / LFT semanal por colaborador. */
export const TARGET_WEEKLY_HOURS = 48;
export const TARGET_WEEKLY_MINUTES = TARGET_WEEKLY_HOURS * 60;

/**
 * Turno típico cena/noche para relleno (8 h → 6 días = 48 h).
 * Se usa cuando el histórico no aporta un modo vespertino claro.
 */
export const DINNER_SHIFT_TEMPLATES = [
  { start: '14:00:00', end: '22:00:00' },
  { start: '15:00:00', end: '23:00:00' },
] as const;

export const DEFAULT_DINNER_SHIFT = DINNER_SHIFT_TEMPLATES[0];

/** Defaults C50 cuando no hay histórico suficiente. */
export const DEFAULT_OPEN_WINDOW = {
  start: '13:00:00',
  end: '00:00:00',
} as const;

export const DEFAULT_DINNER_PEAK = {
  start: '19:00:00',
  end: '23:00:00',
} as const;

/** Inicio ≥ 13:00 cuenta como ventana vespertina/cena. */
const EVENING_START_HOUR = 13;

/**
 * Orden de prioridad de cobertura cena (JS weekday: 0=dom … 6=sáb).
 * Picos fin de semana primero; lunes suele ser día de descanso.
 */
const CENA_WEEKDAY_PRIORITY = [6, 5, 0, 4, 3, 2, 1]; // sáb, vie, dom, jue, mié, mar, lun

/** Mínimo de solapamiento con pico cena para “refuerzo noche”. */
const DINNER_BOOST_RATIO = 1.5;
const MIN_OPEN_HEADCOUNT = 1;
const MIN_DINNER_HEADCOUNT = 2;

export type ProposeEmployee = {
  id: string;
  full_name: string;
  area: string | null;
  puesto: string | null;
  puestos_secundarios?: string[] | null;
  /** Opcional: flag `dual_limpieza_mesero` en notes (p. ej. Roman Sanchez). */
  notes?: string | null;
};

/**
 * Turno matutino típico limpieza (C50) para rol dual limpieza + mesero.
 * 08:00–16:00 → 8 h; se combina con cena hacia ~48 h/sem.
 */
export const DUAL_LIMPIEZA_MORNING = {
  start: '08:00:00',
  end: '16:00:00',
} as const;

/** Detecta doble rol limpieza mañana + mesero tarde/noche (roles, notes o nombre). */
export function isDualLimpiezaMesero(
  emp: Pick<ProposeEmployee, 'full_name' | 'notes'> & {
    puesto?: string | null;
    puestos_secundarios?: string[] | null;
  }
): boolean {
  // Import dinámico evitado: misma lógica que hasDualLimpiezaServicio
  const notes = (emp.notes || '').toLowerCase();
  if (notes.includes('dual_limpieza_mesero')) return true;
  const roles = [
    emp.puesto,
    ...(Array.isArray(emp.puestos_secundarios) ? emp.puestos_secundarios : []),
  ]
    .map((r) =>
      String(r || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
    )
    .filter(Boolean);
  const hasLimp = roles.some((r) => r.includes('limpieza'));
  const hasServ = roles.some(
    (r) =>
      /\bmeser/.test(r) ||
      /\bhoste/.test(r) ||
      /\bbartender\b/.test(r) ||
      /\bbarra\b/.test(r) ||
      /\bcapitan\b/.test(r)
  );
  if (hasLimp && hasServ) return true;
  const n = (emp.full_name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\broman\b/.test(n) && /\bsanchez\b/.test(n);
}

export type HistoricalShift = {
  employee_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  area: string | null;
  role_label: string | null;
};

export type ProposedShift = {
  employee_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  area: string | null;
  role_label: string | null;
  origin: 'auto';
  notes: string | null;
};

/** Ventanas operativas inferidas (o defaults C50). */
export type VenueWindows = {
  /** Apertura del local (inicio servicio). */
  openStart: string;
  /** Cierre del local (puede ser 00:00 overnight). */
  openEnd: string;
  /** Inicio pico cena/noche. */
  dinnerPeakStart: string;
  /** Fin pico cena/noche. */
  dinnerPeakEnd: string;
  /** Turno típico vespertino para asignar/rellenar. */
  typicalDinnerShift: { start: string; end: string };
};

export type EmployeeHours = {
  employee_id: string;
  full_name: string;
  hours: number;
};

export type ProposeResult = {
  shifts: ProposedShift[];
  mode: 'copy_last' | 'average_recent' | 'dinner_default';
  message: string;
  skippedUnavailable: number;
  windows: VenueWindows;
  hoursByEmployee: EmployeeHours[];
};

/** Lunes (ISO) de la semana que contiene `iso` (YYYY-MM-DD), zona CDMX-friendly vía noon. */
export function mondayOfWeek(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  const day = d.getDay(); // 0=dom … 6=sáb
  const delta = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function sundayOfWeek(weekStartMonday: string): string {
  return addIsoDays(weekStartMonday, 6);
}

/** 7 fechas lun–dom a partir de week_start (lunes). */
export function weekDateList(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addIsoDays(weekStart, i));
}

/** weekday JS: 0=dom … 6=sáb (igual que hr_availability.weekday). */
export function weekdayOfIso(iso: string): number {
  return new Date(iso.slice(0, 10) + 'T12:00:00').getDay();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso.slice(0, 10) + 'T12:00:00').getTime();
  const b = new Date(toIso.slice(0, 10) + 'T12:00:00').getTime();
  return Math.round((b - a) / 86_400_000);
}

/** ¿Empleado no disponible ese día? (offs/bloqueos/permisos + leave). */
export function isUnavailableOnDate(
  employeeId: string,
  date: string,
  unavailableKeys: Set<string>
): boolean {
  return unavailableKeys.has(`${employeeId}|${date}`);
}

/**
 * Construye claves employeeId|YYYY-MM-DD a partir de filas de disponibilidad
 * y de vacaciones aprobadas solapadas con la semana.
 */
export function buildUnavailableKeys(opts: {
  weekDates: string[];
  availability: Array<{
    employee_id: string;
    kind: string;
    weekday: number | null;
    date_from: string | null;
    date_to: string | null;
  }>;
  approvedLeave: Array<{
    employee_id: string | null;
    date_from: string;
    date_to: string;
  }>;
}): Set<string> {
  const keys = new Set<string>();
  const weekSet = new Set(opts.weekDates);

  for (const a of opts.availability) {
    if (a.kind === 'preferencia') continue;
    for (const d of opts.weekDates) {
      const wd = weekdayOfIso(d);
      if (a.weekday != null && a.weekday === wd) {
        keys.add(`${a.employee_id}|${d}`);
        continue;
      }
      if (a.date_from && a.date_to) {
        if (d >= a.date_from.slice(0, 10) && d <= a.date_to.slice(0, 10)) {
          keys.add(`${a.employee_id}|${d}`);
        }
      } else if (a.date_from && !a.date_to) {
        if (d === a.date_from.slice(0, 10)) {
          keys.add(`${a.employee_id}|${d}`);
        }
      }
    }
  }

  for (const leave of opts.approvedLeave) {
    if (!leave.employee_id) continue;
    const from = leave.date_from.slice(0, 10);
    const to = leave.date_to.slice(0, 10);
    for (const d of weekSet) {
      if (d >= from && d <= to) {
        keys.add(`${leave.employee_id}|${d}`);
      }
    }
  }

  return keys;
}

function timeKey(t: string | null): string {
  return (t || '').slice(0, 5) || '';
}

function parseHour(t: string | null): number | null {
  if (!t) return null;
  const h = Number(t.slice(0, 2));
  return Number.isFinite(h) ? h : null;
}

function minutesOfDay(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function formatMinutesAsTime(totalMin: number): string {
  const m = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[idx];
}

/** Duración en minutos; soporta turnos que cruzan medianoche. */
export function shiftMinutes(
  start: string | null,
  end: string | null
): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.slice(0, 5).split(':').map(Number);
  const [eh, em] = end.slice(0, 5).split(':').map(Number);
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
  let startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM <= startM) endM += 24 * 60;
  return endM - startM;
}

/** Horas (1 decimal) desde un par Ent/Sal; 0 si falta alguno. */
export function shiftHours(
  start: string | null,
  end: string | null
): number {
  const mins = shiftMinutes(start, end);
  if (mins <= 0) return 0;
  return Math.round((mins / 60) * 10) / 10;
}

/** Suma horas de varios pares Ent/Sal (p. ej. semana o turnos duales). */
export function sumShiftHours(
  pairs: Array<{ start: string | null; end: string | null }>
): number {
  let mins = 0;
  for (const p of pairs) {
    mins += shiftMinutes(p.start, p.end);
  }
  if (mins <= 0) return 0;
  return Math.round((mins / 60) * 10) / 10;
}

function normalizeTime(t: string | null): string | null {
  if (!t) return null;
  const hhmm = t.slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return t;
  return `${hhmm}:00`;
}

function endTimeAfterMinutes(start: string, minutes: number): string {
  const startM =
    Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endM = startM + minutes;
  const eh = Math.floor((endM % (24 * 60)) / 60);
  const em = (endM % (24 * 60)) % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;
}

/** Fin absoluto en minutos (puede ser > 1440 si overnight). */
function absoluteEndMinutes(start: string, end: string): number {
  let e = minutesOfDay(end);
  const s = minutesOfDay(start);
  if (e <= s) e += 24 * 60;
  return e;
}

/** ¿El turno solapa [bandStart, bandEnd) en minutos del día (bandEnd puede >1440)? */
function overlapsBand(
  start: string | null,
  end: string | null,
  bandStart: number,
  bandEnd: number
): boolean {
  if (!start || !end) return false;
  const s = minutesOfDay(start);
  const e = absoluteEndMinutes(start, end);
  return s < bandEnd && e > bandStart;
}

/**
 * Infere ventana cena desde histórico (modo de turnos vespertinos ~6+ h).
 * Si no hay patrón usable → DEFAULT_DINNER_SHIFT.
 */
export function inferDinnerWindow(
  historical: HistoricalShift[]
): { start: string; end: string } {
  const evening = historical.filter((s) => {
    const h = parseHour(s.start_time);
    return (
      h != null &&
      h >= EVENING_START_HOUR &&
      shiftMinutes(s.start_time, s.end_time) >= 360
    );
  });
  const pool =
    evening.length > 0
      ? evening
      : historical.filter(
          (s) => shiftMinutes(s.start_time, s.end_time) >= 360
        );
  if (pool.length === 0) {
    return { ...DEFAULT_DINNER_SHIFT };
  }

  const counts = new Map<string, { n: number; start: string; end: string }>();
  for (const s of pool) {
    const start = normalizeTime(s.start_time);
    const end = normalizeTime(s.end_time);
    if (!start || !end) continue;
    const k = `${start.slice(0, 5)}-${end.slice(0, 5)}`;
    const prev = counts.get(k);
    if (prev) prev.n += 1;
    else counts.set(k, { n: 1, start, end });
  }
  let best: { n: number; start: string; end: string } | null = null;
  for (const v of counts.values()) {
    if (!best || v.n > best.n) best = v;
  }
  if (!best) return { ...DEFAULT_DINNER_SHIFT };

  const eveningCandidates = [...counts.values()]
    .filter((v) => {
      const h = parseHour(v.start);
      return h != null && h >= EVENING_START_HOUR;
    })
    .sort((a, b) => b.n - a.n);
  if (
    eveningCandidates.length > 0 &&
    eveningCandidates[0].n >= best.n * 0.6
  ) {
    return {
      start: eveningCandidates[0].start,
      end: eveningCandidates[0].end,
    };
  }
  return { start: best.start, end: best.end };
}

/**
 * Infere apertura / cierre / pico cena desde histórico agregado
 * (percentiles de inicios y fines). Defaults C50 si hay pocos datos.
 */
export function inferVenueWindows(
  historical: HistoricalShift[]
): VenueWindows {
  const typicalDinnerShift = inferDinnerWindow(historical);
  const usable = historical.filter(
    (s) =>
      s.start_time &&
      s.end_time &&
      shiftMinutes(s.start_time, s.end_time) >= 60
  );

  if (usable.length < 8) {
    return {
      openStart: DEFAULT_OPEN_WINDOW.start,
      openEnd: DEFAULT_OPEN_WINDOW.end,
      dinnerPeakStart: DEFAULT_DINNER_PEAK.start,
      dinnerPeakEnd: DEFAULT_DINNER_PEAK.end,
      typicalDinnerShift,
    };
  }

  const starts = usable
    .map((s) => minutesOfDay(s.start_time!))
    .sort((a, b) => a - b);
  const ends = usable
    .map((s) => absoluteEndMinutes(s.start_time!, s.end_time!))
    .sort((a, b) => a - b);

  // Apertura ≈ percentil 15 de inicios (ignora outliers muy tempranos)
  let openStartMin = percentileSorted(starts, 0.15);
  // Cierre ≈ percentil 85 de fines
  let openEndAbs = percentileSorted(ends, 0.85);

  // Clamp razonables restaurante MX
  openStartMin = Math.min(15 * 60, Math.max(10 * 60, openStartMin));
  openEndAbs = Math.min(26 * 60, Math.max(22 * 60, openEndAbs)); // 22:00–02:00

  // Pico cena: defaults 19–23, o intersección con turno típico vespertino
  let dinnerPeakStart = minutesOfDay(DEFAULT_DINNER_PEAK.start);
  let dinnerPeakEnd = minutesOfDay(DEFAULT_DINNER_PEAK.end);
  if (dinnerPeakEnd <= dinnerPeakStart) dinnerPeakEnd += 24 * 60;

  const typStart = minutesOfDay(typicalDinnerShift.start);
  const typEndAbs = absoluteEndMinutes(
    typicalDinnerShift.start,
    typicalDinnerShift.end
  );
  // Si el típico es claramente noche, centrar pico en la segunda mitad del turno
  if (typStart >= EVENING_START_HOUR * 60) {
    const mid = Math.floor((typStart + typEndAbs) / 2);
    dinnerPeakStart = Math.max(typStart, Math.min(mid, 19 * 60));
    dinnerPeakEnd = Math.min(typEndAbs, Math.max(mid + 60, 23 * 60));
  }

  return {
    openStart: formatMinutesAsTime(openStartMin),
    openEnd: formatMinutesAsTime(openEndAbs),
    dinnerPeakStart: formatMinutesAsTime(dinnerPeakStart),
    dinnerPeakEnd: formatMinutesAsTime(dinnerPeakEnd),
    typicalDinnerShift,
  };
}

function employeeWeekMinutes(
  shifts: ProposedShift[],
  employeeId: string
): number {
  return shifts
    .filter((s) => s.employee_id === employeeId)
    .reduce((sum, s) => sum + shiftMinutes(s.start_time, s.end_time), 0);
}

export function buildHoursByEmployee(
  shifts: ProposedShift[],
  employees: ProposeEmployee[]
): EmployeeHours[] {
  return employees
    .map((e) => ({
      employee_id: e.id,
      full_name: e.full_name,
      hours: Math.round((employeeWeekMinutes(shifts, e.id) / 60) * 10) / 10,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'));
}

/**
 * Recorta turnos de un empleado hacia ≤ TARGET_WEEKLY_MINUTES.
 * Conserva preferentemente turnos cena / días de mayor prioridad.
 */
function capEmployeeTowardTarget(
  shifts: ProposedShift[],
  employeeId: string
): ProposedShift[] {
  const mine = shifts.filter((s) => s.employee_id === employeeId);
  const others = shifts.filter((s) => s.employee_id !== employeeId);
  const total = mine.reduce(
    (sum, s) => sum + shiftMinutes(s.start_time, s.end_time),
    0
  );
  if (total <= TARGET_WEEKLY_MINUTES) return shifts;

  const priorityRank = new Map(
    CENA_WEEKDAY_PRIORITY.map((wd, i) => [wd, i])
  );
  // Orden: mayor valor cena primero (se conservan primero)
  const retainOrder = [...mine].sort((a, b) => {
    const ah = parseHour(a.start_time) ?? 99;
    const bh = parseHour(b.start_time) ?? 99;
    const aEve = ah >= EVENING_START_HOUR ? 1 : 0;
    const bEve = bh >= EVENING_START_HOUR ? 1 : 0;
    if (aEve !== bEve) return bEve - aEve;
    const aPri = priorityRank.get(weekdayOfIso(a.shift_date)) ?? 99;
    const bPri = priorityRank.get(weekdayOfIso(b.shift_date)) ?? 99;
    if (aPri !== bPri) return aPri - bPri;
    return (
      shiftMinutes(b.start_time, b.end_time) -
      shiftMinutes(a.start_time, a.end_time)
    );
  });

  const tentativelyKept: ProposedShift[] = [];
  let keptMinutes = 0;

  for (const s of retainOrder) {
    const mins = shiftMinutes(s.start_time, s.end_time);
    if (mins <= 0) continue;
    if (keptMinutes + mins <= TARGET_WEEKLY_MINUTES) {
      tentativelyKept.push(s);
      keptMinutes += mins;
      continue;
    }
    const room = TARGET_WEEKLY_MINUTES - keptMinutes;
    if (room >= 240 && s.start_time) {
      tentativelyKept.push({
        ...s,
        end_time: endTimeAfterMinutes(s.start_time, room),
      });
      keptMinutes = TARGET_WEEKLY_MINUTES;
    }
  }

  tentativelyKept.sort((a, b) => a.shift_date.localeCompare(b.shift_date));
  return [...others, ...tentativelyKept];
}

/**
 * Rellena días libres con ventana cena hasta acercarse a 48 h (sin pasarse).
 */
function fillEmployeeTowardTarget(
  shifts: ProposedShift[],
  emp: ProposeEmployee,
  weekStart: string,
  unavailable: Set<string>,
  window: { start: string; end: string }
): ProposedShift[] {
  const weekDates = weekDateList(weekStart);
  const windowMins = shiftMinutes(window.start, window.end);
  if (windowMins <= 0) return shifts;

  const mine = shifts.filter((s) => s.employee_id === emp.id);
  const others = shifts.filter((s) => s.employee_id !== emp.id);
  let total = mine.reduce(
    (sum, s) => sum + shiftMinutes(s.start_time, s.end_time),
    0
  );
  if (total >= TARGET_WEEKLY_MINUTES) return shifts;

  const taken = new Set(mine.map((s) => s.shift_date));
  const candidates = [...weekDates].sort((a, b) => {
    const pa = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(a));
    const pb = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(b));
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  const added: ProposedShift[] = [...mine];

  for (const date of candidates) {
    if (total >= TARGET_WEEKLY_MINUTES) break;
    if (taken.has(date)) continue;
    if (isUnavailableOnDate(emp.id, date, unavailable)) continue;
    const remaining = TARGET_WEEKLY_MINUTES - total;
    if (remaining < 240) break;

    let end = window.end;
    let mins = windowMins;
    if (mins > remaining) {
      end = endTimeAfterMinutes(window.start, remaining);
      mins = remaining;
    }

    added.push({
      employee_id: emp.id,
      shift_date: date,
      start_time: window.start,
      end_time: end,
      area: emp.area,
      role_label: emp.puesto,
      origin: 'auto',
      notes: null,
    });
    taken.add(date);
    total += mins;
  }

  return [...others, ...added];
}

function pickCoverageCandidate(
  employees: ProposeEmployee[],
  shifts: ProposedShift[],
  date: string,
  unavailable: Set<string>,
  preferEveningHistory: Map<string, number>
): ProposeEmployee | null {
  const busy = new Set(
    shifts.filter((s) => s.shift_date === date).map((s) => s.employee_id)
  );
  const ranked = [...employees]
    .filter((e) => !busy.has(e.id))
    .filter((e) => !isUnavailableOnDate(e.id, date, unavailable))
    .map((e) => ({
      emp: e,
      mins: employeeWeekMinutes(shifts, e.id),
      eve: preferEveningHistory.get(e.id) || 0,
    }))
    .filter((x) => x.mins <= TARGET_WEEKLY_MINUTES - 240)
    .sort((a, b) => {
      // Prioriza quien aún le faltan más horas; empate → más histórico noche
      const gapA = TARGET_WEEKLY_MINUTES - a.mins;
      const gapB = TARGET_WEEKLY_MINUTES - b.mins;
      if (gapA !== gapB) return gapB - gapA;
      return b.eve - a.eve;
    });
  return ranked[0]?.emp ?? null;
}

function addShiftClamped(
  shifts: ProposedShift[],
  emp: ProposeEmployee,
  date: string,
  start: string,
  end: string
): ProposedShift[] {
  const current = employeeWeekMinutes(shifts, emp.id);
  const room = TARGET_WEEKLY_MINUTES - current;
  if (room < 240) return shifts;
  let useEnd = end;
  let mins = shiftMinutes(start, end);
  if (mins > room) {
    useEnd = endTimeAfterMinutes(start, room);
    mins = room;
  }
  if (mins < 240) return shifts;
  return [
    ...shifts,
    {
      employee_id: emp.id,
      shift_date: date,
      start_time: start,
      end_time: useEnd,
      area: emp.area,
      role_label: emp.puesto,
      origin: 'auto',
      notes: null,
    },
  ];
}

/**
 * Asegura cobertura de apertura y refuerzo de pico cena/noche por día.
 * No remapea turnos históricos matutinos (sirven para abrir).
 */
function ensureOpeningAndDinnerCoverage(
  shifts: ProposedShift[],
  employees: ProposeEmployee[],
  weekStart: string,
  unavailable: Set<string>,
  windows: VenueWindows,
  historical: HistoricalShift[]
): ProposedShift[] {
  const openStartM = minutesOfDay(windows.openStart);
  const openBandEnd = openStartM + 180; // primeras ~3 h
  let dinnerStartM = minutesOfDay(windows.dinnerPeakStart);
  let dinnerEndM = minutesOfDay(windows.dinnerPeakEnd);
  if (dinnerEndM <= dinnerStartM) dinnerEndM += 24 * 60;

  const eveningScore = new Map<string, number>();
  for (const s of historical) {
    const h = parseHour(s.start_time);
    if (h != null && h >= EVENING_START_HOUR) {
      eveningScore.set(
        s.employee_id,
        (eveningScore.get(s.employee_id) || 0) + 1
      );
    }
  }

  let result = [...shifts];
  const weekDates = [...weekDateList(weekStart)].sort((a, b) => {
    const pa = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(a));
    const pb = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(b));
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  for (const date of weekDates) {
    const dayShifts = () =>
      result.filter((s) => s.shift_date === date);

    const openCount = () =>
      dayShifts().filter((s) =>
        overlapsBand(s.start_time, s.end_time, openStartM, openBandEnd)
      ).length;

    const dinnerCount = () =>
      dayShifts().filter((s) =>
        overlapsBand(s.start_time, s.end_time, dinnerStartM, dinnerEndM)
      ).length;

    // —— Apertura ——
    while (openCount() < MIN_OPEN_HEADCOUNT) {
      const cand = pickCoverageCandidate(
        employees,
        result,
        date,
        unavailable,
        eveningScore
      );
      if (!cand) break;
      const openShiftEnd = endTimeAfterMinutes(
        windows.openStart,
        Math.min(
          8 * 60,
          shiftMinutes(
            windows.typicalDinnerShift.start,
            windows.typicalDinnerShift.end
          ) || 8 * 60
        )
      );
      const before = result.length;
      result = addShiftClamped(
        result,
        cand,
        date,
        windows.openStart,
        openShiftEnd
      );
      if (result.length === before) break;
    }

    // —— Refuerzo noche: más gente en pico que en apertura ——
    const targetDinner = Math.max(
      MIN_DINNER_HEADCOUNT,
      Math.ceil(Math.max(openCount(), 1) * DINNER_BOOST_RATIO)
    );
    let guard = 0;
    while (dinnerCount() < targetDinner && guard < employees.length) {
      guard += 1;
      const cand = pickCoverageCandidate(
        employees,
        result,
        date,
        unavailable,
        eveningScore
      );
      if (!cand) break;
      const before = result.length;
      result = addShiftClamped(
        result,
        cand,
        date,
        windows.typicalDinnerShift.start,
        windows.typicalDinnerShift.end
      );
      if (result.length === before) break;
    }
  }

  return result;
}

/**
 * Rol dual: ~mitad mañana limpieza + mitad cena/mesero hacia 48 h.
 * Sustituye turnos previos del colaborador (histórico suele ser solo LIMPIEZA).
 */
function reshapeDualLimpiezaMesero(
  shifts: ProposedShift[],
  emp: ProposeEmployee,
  weekStart: string,
  unavailable: Set<string>,
  dinner: { start: string; end: string }
): ProposedShift[] {
  const others = shifts.filter((s) => s.employee_id !== emp.id);
  const available = weekDateList(weekStart).filter(
    (d) => !isUnavailableOnDate(emp.id, d, unavailable)
  );
  const eveningOrder = [...available].sort((a, b) => {
    const pa = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(a));
    const pb = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(b));
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });
  const morningMins =
    shiftMinutes(DUAL_LIMPIEZA_MORNING.start, DUAL_LIMPIEZA_MORNING.end) ||
    8 * 60;
  const dinnerMins = shiftMinutes(dinner.start, dinner.end) || 8 * 60;
  const eveningDaysNeeded = Math.min(
    eveningOrder.length,
    Math.max(1, Math.ceil(TARGET_WEEKLY_MINUTES / 2 / dinnerMins))
  );
  const eveningDates = new Set(eveningOrder.slice(0, eveningDaysNeeded));
  const morningOrder = available
    .filter((d) => !eveningDates.has(d))
    .sort((a, b) => a.localeCompare(b));

  const added: ProposedShift[] = [];
  let total = 0;

  for (const date of eveningOrder) {
    if (!eveningDates.has(date)) continue;
    if (total >= TARGET_WEEKLY_MINUTES) break;
    const remaining = TARGET_WEEKLY_MINUTES - total;
    if (remaining < 240) break;
    let end = dinner.end;
    let mins = dinnerMins;
    if (mins > remaining) {
      end = endTimeAfterMinutes(dinner.start, remaining);
      mins = remaining;
    }
    added.push({
      employee_id: emp.id,
      shift_date: date,
      start_time: dinner.start,
      end_time: end,
      area: emp.area || 'Piso',
      role_label: emp.puesto || 'Meserx Encargadx',
      origin: 'auto',
      notes: 'dual_limpieza_mesero:mesero',
    });
    total += mins;
  }

  for (const date of morningOrder) {
    if (total >= TARGET_WEEKLY_MINUTES) break;
    const remaining = TARGET_WEEKLY_MINUTES - total;
    if (remaining < 240) break;
    let end: string = DUAL_LIMPIEZA_MORNING.end;
    let mins = morningMins;
    if (mins > remaining) {
      end = endTimeAfterMinutes(DUAL_LIMPIEZA_MORNING.start, remaining);
      mins = remaining;
    }
    added.push({
      employee_id: emp.id,
      shift_date: date,
      start_time: DUAL_LIMPIEZA_MORNING.start,
      end_time: end,
      area: emp.area || 'Piso',
      role_label: 'Limpieza',
      origin: 'auto',
      notes: 'dual_limpieza_mesero:limpieza',
    });
    total += mins;
  }

  added.sort((a, b) => a.shift_date.localeCompare(b.shift_date));
  return [...others, ...added];
}

/**
 * Ajusta propuesta: cap/fill a 48 h (relleno en cena), cobertura apertura + pico noche.
 * Conserva patrones matutinos del histórico (no remapea todo a cena).
 * Dual limpieza/mesero: ventana mañana + cena (ver `isDualLimpiezaMesero`).
 */
function adjustShiftsToWeeklyTarget(
  shifts: ProposedShift[],
  employees: ProposeEmployee[],
  weekStart: string,
  unavailable: Set<string>,
  windows: VenueWindows,
  historical: HistoricalShift[]
): ProposedShift[] {
  let result = [...shifts];
  for (const emp of employees) {
    if (isDualLimpiezaMesero(emp)) {
      result = reshapeDualLimpiezaMesero(
        result,
        emp,
        weekStart,
        unavailable,
        windows.typicalDinnerShift
      );
      continue;
    }
    result = capEmployeeTowardTarget(result, emp.id);
    result = fillEmployeeTowardTarget(
      result,
      emp,
      weekStart,
      unavailable,
      windows.typicalDinnerShift
    );
  }
  result = ensureOpeningAndDinnerCoverage(
    result,
    employees,
    weekStart,
    unavailable,
    windows,
    historical
  );
  // Cap final por si el refuerzo de cobertura empujó a alguien sobre 48 h
  for (const emp of employees) {
    result = capEmployeeTowardTarget(result, emp.id);
  }
  return result;
}

/**
 * Esqueleto: mezcla apertura + cena hacia ~48 h, priorizando noches.
 */
function proposeDinnerDefault(
  employees: ProposeEmployee[],
  targetWeekStart: string,
  unavailable: Set<string>,
  windows: VenueWindows
): { shifts: ProposedShift[]; skipped: number } {
  const weekDates = weekDateList(targetWeekStart);
  const workDates = [...weekDates].sort((a, b) => {
    const pa = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(a));
    const pb = CENA_WEEKDAY_PRIORITY.indexOf(weekdayOfIso(b));
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  const shifts: ProposedShift[] = [];
  let skipped = 0;
  const dinnerMins =
    shiftMinutes(
      windows.typicalDinnerShift.start,
      windows.typicalDinnerShift.end
    ) || 8 * 60;
  const daysNeeded = Math.max(
    1,
    Math.ceil(TARGET_WEEKLY_MINUTES / dinnerMins)
  );

  // Reparto rotativo: ~1 de cada 4 turnos de apertura; el resto cena
  let openSlot = 0;

  for (const emp of employees) {
    let assigned = 0;
    let minutes = 0;
    for (const date of workDates) {
      if (assigned >= daysNeeded || minutes >= TARGET_WEEKLY_MINUTES) break;
      if (isUnavailableOnDate(emp.id, date, unavailable)) {
        skipped += 1;
        continue;
      }
      const remaining = TARGET_WEEKLY_MINUTES - minutes;
      if (remaining < 240) break;

      const useOpen = openSlot % 4 === 0;
      openSlot += 1;
      const start = useOpen
        ? windows.openStart
        : windows.typicalDinnerShift.start;
      const fullEnd = useOpen
        ? endTimeAfterMinutes(windows.openStart, dinnerMins)
        : windows.typicalDinnerShift.end;
      const mins = Math.min(
        shiftMinutes(start, fullEnd) || dinnerMins,
        remaining
      );
      const end =
        mins < (shiftMinutes(start, fullEnd) || dinnerMins)
          ? endTimeAfterMinutes(start, mins)
          : fullEnd;

      shifts.push({
        employee_id: emp.id,
        shift_date: date,
        start_time: start,
        end_time: end,
        area: emp.area,
        role_label: emp.puesto,
        origin: 'auto',
        notes: null,
      });
      assigned += 1;
      minutes += mins;
    }
  }

  return { shifts, skipped };
}

/**
 * Promedio reciente: por empleado + weekday, toma el horario más frecuente
 * (ligero sesgo a patrones vespertinos).
 */
function proposeFromAverage(
  employees: ProposeEmployee[],
  historical: HistoricalShift[],
  targetWeekStart: string,
  unavailable: Set<string>
): { shifts: ProposedShift[]; skipped: number } {
  type Bucket = Map<
    string,
    {
      count: number;
      start: string | null;
      end: string | null;
      area: string | null;
      role: string | null;
    }
  >;
  const byEmpWeekday = new Map<string, Bucket>();

  for (const s of historical) {
    const wd = weekdayOfIso(s.shift_date);
    const empKey = s.employee_id;
    if (!byEmpWeekday.has(empKey)) byEmpWeekday.set(empKey, new Map());
    const bucket = byEmpWeekday.get(empKey)!;
    const tk = `${timeKey(s.start_time)}-${timeKey(s.end_time)}`;
    const prev = bucket.get(`${wd}|${tk}`);
    if (prev) {
      prev.count += 1;
    } else {
      bucket.set(`${wd}|${tk}`, {
        count: 1,
        start: s.start_time,
        end: s.end_time,
        area: s.area,
        role: s.role_label,
      });
    }
  }

  const empIds = new Set(employees.map((e) => e.id));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const shifts: ProposedShift[] = [];
  let skipped = 0;

  for (const [empId, bucket] of byEmpWeekday) {
    if (!empIds.has(empId)) continue;
    const emp = empById.get(empId);
    const bestByWd = new Map<
      number,
      {
        count: number;
        start: string | null;
        end: string | null;
        area: string | null;
        role: string | null;
        eveningBonus: number;
      }
    >();
    for (const [key, val] of bucket) {
      const wd = Number(key.split('|')[0]);
      const h = parseHour(val.start);
      const eveningBonus = h != null && h >= EVENING_START_HOUR ? 0.5 : 0;
      const score = val.count + eveningBonus;
      const cur = bestByWd.get(wd);
      const curScore = cur ? cur.count + cur.eveningBonus : -1;
      if (!cur || score > curScore) {
        bestByWd.set(wd, { ...val, eveningBonus });
      }
    }
    for (const [wd, pattern] of bestByWd) {
      const dates = weekDateList(targetWeekStart);
      const date = dates.find((d) => weekdayOfIso(d) === wd);
      if (!date) continue;
      if (isUnavailableOnDate(empId, date, unavailable)) {
        skipped += 1;
        continue;
      }
      shifts.push({
        employee_id: empId,
        shift_date: date,
        start_time: pattern.start,
        end_time: pattern.end,
        area: pattern.area || emp?.area || null,
        role_label: pattern.role || emp?.puesto || null,
        origin: 'auto',
        notes: null,
      });
    }
  }

  return { shifts, skipped };
}

/**
 * Copia turnos de una semana fuente alineando por weekday.
 */
function proposeCopyLast(
  employees: ProposeEmployee[],
  sourceShifts: HistoricalShift[],
  sourceWeekStart: string,
  targetWeekStart: string,
  unavailable: Set<string>
): { shifts: ProposedShift[]; skipped: number } {
  const empIds = new Set(employees.map((e) => e.id));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const offset = daysBetween(sourceWeekStart, targetWeekStart);
  const shifts: ProposedShift[] = [];
  let skipped = 0;

  for (const s of sourceShifts) {
    if (!empIds.has(s.employee_id)) continue;
    const newDate = addIsoDays(s.shift_date.slice(0, 10), offset);
    const max = addIsoDays(targetWeekStart, 6);
    if (newDate < targetWeekStart || newDate > max) continue;
    if (isUnavailableOnDate(s.employee_id, newDate, unavailable)) {
      skipped += 1;
      continue;
    }
    const emp = empById.get(s.employee_id);
    shifts.push({
      employee_id: s.employee_id,
      shift_date: newDate,
      start_time: s.start_time,
      end_time: s.end_time,
      area: s.area || emp?.area || null,
      role_label: s.role_label || emp?.puesto || null,
      origin: 'auto',
      notes: null,
    });
  }

  return { shifts, skipped };
}

function windowsNote(w: VenueWindows): string {
  return (
    ` Apertura ${w.openStart.slice(0, 5)}–${w.openEnd.slice(0, 5)};` +
    ` pico noche ${w.dinnerPeakStart.slice(0, 5)}–${w.dinnerPeakEnd.slice(0, 5)};` +
    ` turno típico ${w.typicalDinnerShift.start.slice(0, 5)}–${w.typicalDinnerShift.end.slice(0, 5)}.`
  );
}

function hoursNote(hours: EmployeeHours[]): string {
  if (hours.length === 0) return '';
  const avg =
    hours.reduce((a, b) => a + b.hours, 0) / Math.max(1, hours.length);
  const near = hours.filter(
    (h) => Math.abs(h.hours - TARGET_WEEKLY_HOURS) <= 4
  ).length;
  return ` Media ≈ ${avg.toFixed(1)} h/sem (meta ${TARGET_WEEKLY_HOURS}; ${near}/${hours.length} cerca).`;
}

function countDistinctWeeks(shifts: HistoricalShift[]): number {
  const set = new Set<string>();
  for (const s of shifts) {
    if (s.shift_date) set.add(mondayOfWeek(s.shift_date));
  }
  return set.size;
}

/**
 * Genera propuesta v2.
 * - ≥2 semanas históricas → average_recent (patrones tipicos + 48 h + cobertura)
 * - 1 semana clara → copy_last (+ mismo ajuste)
 * - Sin histórico → esqueleto apertura/cena hacia 48 h
 */
export function proposeWeeklySchedule(opts: {
  weekStart: string;
  employees: ProposeEmployee[];
  /** Turnos de la última semana de referencia (publicado/borrador). */
  lastWeek: { weekStart: string; shifts: HistoricalShift[] } | null;
  /** Turnos de hasta N semanas recientes (para promedio). */
  recentShifts?: HistoricalShift[];
  unavailableKeys: Set<string>;
}): ProposeResult {
  const weekStart = mondayOfWeek(opts.weekStart);
  const { employees, unavailableKeys } = opts;
  const historical = opts.recentShifts?.length
    ? opts.recentShifts
    : opts.lastWeek?.shifts || [];
  const windows = inferVenueWindows(historical);

  if (employees.length === 0) {
    return {
      shifts: [],
      mode: 'dinner_default',
      message:
        'Sin colaboradores en la plantilla. En RH → Nómina cierra/paga la última semana conciliada (la plantilla refleja ese roster), o usa force_include.',
      skippedUnavailable: 0,
      windows,
      hoursByEmployee: [],
    };
  }

  const weekCount = countDistinctWeeks(historical);
  const preferAverage =
    weekCount >= 2 && (opts.recentShifts?.length || 0) > 0;

  if (preferAverage) {
    const { shifts: raw, skipped } = proposeFromAverage(
      employees,
      opts.recentShifts!,
      weekStart,
      unavailableKeys
    );
    if (raw.length > 0) {
      const shifts = adjustShiftsToWeeklyTarget(
        raw,
        employees,
        weekStart,
        unavailableKeys,
        windows,
        historical
      );
      const hoursByEmployee = buildHoursByEmployee(shifts, employees);
      return {
        shifts,
        mode: 'average_recent',
        message:
          (skipped > 0
            ? `Propuesta por promedio de ${weekCount} semanas históricas. Se omitieron ${skipped} turno(s) por no disponibilidad.`
            : `Propuesta por promedio de ${weekCount} semanas históricas (publicado/import).`) +
          ` Meta ${TARGET_WEEKLY_HOURS} h/sem · cubre apertura · refuerza noche.` +
          windowsNote(windows) +
          hoursNote(hoursByEmployee),
        skippedUnavailable: skipped,
        windows,
        hoursByEmployee,
      };
    }
  }

  if (opts.lastWeek && opts.lastWeek.shifts.length > 0) {
    const { shifts: raw, skipped } = proposeCopyLast(
      employees,
      opts.lastWeek.shifts,
      mondayOfWeek(opts.lastWeek.weekStart),
      weekStart,
      unavailableKeys
    );
    const shifts = adjustShiftsToWeeklyTarget(
      raw,
      employees,
      weekStart,
      unavailableKeys,
      windows,
      historical
    );
    const hoursByEmployee = buildHoursByEmployee(shifts, employees);
    return {
      shifts,
      mode: 'copy_last',
      message:
        (skipped > 0
          ? `Propuesta copiada de la semana del ${opts.lastWeek.weekStart}. Se omitieron ${skipped} turno(s) por no disponibilidad / vacaciones.`
          : `Propuesta copiada de la semana del ${opts.lastWeek.weekStart}.`) +
        ` Meta ${TARGET_WEEKLY_HOURS} h/sem · cubre apertura · refuerza noche.` +
        windowsNote(windows) +
        hoursNote(hoursByEmployee),
      skippedUnavailable: skipped,
      windows,
      hoursByEmployee,
    };
  }

  if (opts.recentShifts && opts.recentShifts.length > 0) {
    const { shifts: raw, skipped } = proposeFromAverage(
      employees,
      opts.recentShifts,
      weekStart,
      unavailableKeys
    );
    if (raw.length > 0) {
      const shifts = adjustShiftsToWeeklyTarget(
        raw,
        employees,
        weekStart,
        unavailableKeys,
        windows,
        historical
      );
      const hoursByEmployee = buildHoursByEmployee(shifts, employees);
      return {
        shifts,
        mode: 'average_recent',
        message:
          (skipped > 0
            ? `Propuesta por promedio de semanas recientes. Se omitieron ${skipped} turno(s) por no disponibilidad.`
            : 'Propuesta por promedio de patrones en semanas recientes.') +
          ` Meta ${TARGET_WEEKLY_HOURS} h/sem · cubre apertura · refuerza noche.` +
          windowsNote(windows) +
          hoursNote(hoursByEmployee),
        skippedUnavailable: skipped,
        windows,
        hoursByEmployee,
      };
    }
  }

  const { shifts: rawDefault, skipped } = proposeDinnerDefault(
    employees,
    weekStart,
    unavailableKeys,
    windows
  );
  const shifts = adjustShiftsToWeeklyTarget(
    rawDefault,
    employees,
    weekStart,
    unavailableKeys,
    windows,
    historical
  );
  const hoursByEmployee = buildHoursByEmployee(shifts, employees);
  return {
    shifts,
    mode: 'dinner_default',
    message:
      `Sin histórico publicado. Esqueleto apertura/cena hacia ${TARGET_WEEKLY_HOURS} h/sem.` +
      windowsNote(windows) +
      (skipped > 0
        ? ` Se omitieron ${skipped} día(s) por no disponibilidad.`
        : '') +
      hoursNote(hoursByEmployee),
    skippedUnavailable: skipped,
    windows,
    hoursByEmployee,
  };
}
