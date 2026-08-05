/**
 * Grilla de horarios (RR.HH.): tipos y lógica pura compartidos por la vista
 * Excel de escritorio y el editor móvil. Sin JSX ni estado de React.
 */

import {
  HR_SHIFT_NOTES_VACACIONES,
  isGenericPisoArea,
  isPlantillaExterno,
  isVacationScheduleShift,
  meseroWithinFamilyRank,
  plantillaPositionKey,
  scheduleSectionFromPosition,
  type HrEmployee,
  type HrScheduleShift,
} from '@/app/lib/hr';
import {
  daySegmentsOverlap,
  hasDualLimpiezaServicio,
} from '@/app/lib/hr-puestos';
import { sumShiftHours } from '@/app/lib/hr-schedule-propose';

export const DAY_HEADERS = [
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
  'Dom',
] as const;

/** Orden de secciones como en HORARIOS C50.xlsx (+ Externos al final). */
export const AREA_ORDER = [
  'Gerencia',
  'Hostess',
  'Caja',
  'Bartender',
  'Meseros',
  'Runner',
  'Cocina',
  'Limpieza',
  'Mantenimiento',
  'Administración',
  'Externos',
] as const;

export type DaySegment = {
  start: string; // HH:mm
  end: string;
  role?: string | null;
};

export type DayCell = {
  start: string; // HH:mm — turno principal (editable en grilla)
  end: string;
  /** Sin Ent/Sal: DESCANSO (omit shift) o VACACIONES (marker shift). */
  off: boolean;
  /** Cuando off: true = VACACIONES, false = DESCANSO. */
  vacation?: boolean;
  role?: string | null;
  /** Turnos adicionales el mismo día (p. ej. mañana+cena); cuentan en «h». */
  extra?: DaySegment[];
};

export type PersonRow = {
  employee_id: string;
  full_name: string;
  area: string;
  puesto: string | null;
  dualLimpiezaServicio?: boolean;
  days: DayCell[]; // 7 lun–dom
};

export function normalizeArea(raw: string | null | undefined): string {
  if (!raw?.trim() || isGenericPisoArea(raw)) return 'Otros';
  return scheduleSectionFromPosition(raw);
}

export function areaSortKey(area: string): number {
  const i = AREA_ORDER.indexOf(area as (typeof AREA_ORDER)[number]);
  return i >= 0 ? i : AREA_ORDER.length;
}

/** Sección de grilla: puesto family → área de turnos → plantilla; nunca «Piso» suelto. */
export function resolveRowSection(
  emp: HrEmployee | undefined,
  shiftAreas: string[],
  shiftRoles: string[],
  fallbackName: string
): { section: string; puesto: string | null } {
  const dual = emp ? hasDualLimpiezaServicio(emp) : false;
  const posKey = emp ? plantillaPositionKey(emp) : null;
  const fromPuesto = posKey ? scheduleSectionFromPosition(posKey) : null;

  // Contar áreas de turnos (ignorar Piso genérico)
  const areaCounts = new Map<string, number>();
  for (const a of shiftAreas) {
    const sec = normalizeArea(a);
    if (sec === 'Otros') continue;
    areaCounts.set(sec, (areaCounts.get(sec) || 0) + 1);
  }
  let fromShifts: string | null = null;
  let best = 0;
  for (const [sec, n] of areaCounts) {
    if (n > best) {
      best = n;
      fromShifts = sec;
    }
  }

  // Rol más frecuente en turnos
  const roleCounts = new Map<string, number>();
  for (const r of shiftRoles) {
    const t = String(r || '').trim();
    if (!t) continue;
    roleCounts.set(t, (roleCounts.get(t) || 0) + 1);
  }
  let topRole: string | null = null;
  let roleBest = 0;
  for (const [r, n] of roleCounts) {
    if (n > roleBest) {
      roleBest = n;
      topRole = r;
    }
  }
  const fromRole = topRole ? scheduleSectionFromPosition(topRole) : null;

  let section =
    (fromPuesto && fromPuesto !== 'Otros' ? fromPuesto : null) ||
    (fromRole && fromRole !== 'Otros' ? fromRole : null) ||
    fromShifts ||
    (dual ? 'Meseros' : null) ||
    'Otros';

  // Dual limpieza/mesero → siempre con Meseros (encargado), no Limpieza sola
  if (dual && (section === 'Limpieza' || section === 'Otros' || section === 'Piso')) {
    section = 'Meseros';
  }

  if (
    isPlantillaExterno({
      full_name: emp?.full_name || fallbackName,
      notes: emp?.notes,
    })
  ) {
    section = 'Externos';
  }

  const puesto =
    emp?.puesto ||
    (dual ? 'Meserx Encargadx' : null) ||
    topRole ||
    (fromPuesto && fromPuesto !== 'Otros' ? fromPuesto : null) ||
    null;

  return { section, puesto };
}

export function comparePersonRows(a: PersonRow, b: PersonRow): number {
  const ka = areaSortKey(a.area);
  const kb = areaSortKey(b.area);
  if (ka !== kb) return ka - kb;
  if (a.area === 'Meseros' && b.area === 'Meseros') {
    const ra = meseroWithinFamilyRank(a.puesto);
    const rb = meseroWithinFamilyRank(b.puesto);
    if (ra !== rb) return ra - rb;
  }
  return a.full_name.localeCompare(b.full_name, 'es');
}

export function toHhmm(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}

export function toTimeDb(hhmm: string): string | null {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  return `${hhmm}:00`;
}

export function emptyDay(): DayCell {
  return { start: '', end: '', off: true, vacation: false };
}

export function vacationDay(): DayCell {
  return { start: '', end: '', off: true, vacation: true };
}

export function isVacationDay(d: DayCell): boolean {
  return Boolean(d.off && d.vacation);
}

/** Ciclo D → V → turno: worked→DESCANSO→VACACIONES→worked. */
export function cycleDayAbsence(cur: DayCell): DayCell {
  if (!cur.off) return emptyDay();
  if (!cur.vacation) return vacationDay();
  return { start: '14:00', end: '22:00', off: false, vacation: false };
}

export function serializeGrid(rows: PersonRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      id: r.employee_id,
      days: r.days.map((d) => {
        if (isVacationDay(d)) return 'VAC';
        if (d.off) return 'OFF';
        const extras = (d.extra || [])
          .map((e) => `${e.start}-${e.end}`)
          .join('|');
        return extras ? `${d.start}-${d.end}+${extras}` : `${d.start}-${d.end}`;
      }),
    }))
  );
}

export function buildRowsFromShifts(
  employees: HrEmployee[],
  shifts: HrScheduleShift[],
  dates: string[],
  opts?: { seedPlantilla?: boolean }
): PersonRow[] {
  const empById = new Map(employees.map((e) => [e.id, e]));
  const byId = new Map<string, PersonRow>();
  const shiftAreasByEmp = new Map<string, string[]>();
  const shiftRolesByEmp = new Map<string, string[]>();
  // Histórico: solo quien tiene turnos esa semana. Plantilla vigente
  // (force_exclude) solo se siembra en «nueva semana» / borradores futuros.
  const seedPlantilla = opts?.seedPlantilla === true;

  // Primero: quien tiene turnos esa semana
  for (const s of shifts) {
    const areas = shiftAreasByEmp.get(s.employee_id) || [];
    if (s.area) areas.push(s.area);
    else if (s.employee_area) areas.push(s.employee_area);
    shiftAreasByEmp.set(s.employee_id, areas);

    const roles = shiftRolesByEmp.get(s.employee_id) || [];
    if (s.role_label) roles.push(s.role_label);
    else if (s.employee_puesto) roles.push(s.employee_puesto);
    shiftRolesByEmp.set(s.employee_id, roles);

    let row = byId.get(s.employee_id);
    if (!row) {
      const emp = empById.get(s.employee_id);
      const { section, puesto } = resolveRowSection(
        emp,
        areas,
        roles,
        s.employee_name || s.employee_id
      );
      row = {
        employee_id: s.employee_id,
        full_name: emp?.full_name || s.employee_name || s.employee_id.slice(0, 8),
        area: section,
        puesto,
        dualLimpiezaServicio: emp ? hasDualLimpiezaServicio(emp) : false,
        days: dates.map(() => emptyDay()),
      };
      byId.set(s.employee_id, row);
    }
    const di = dates.indexOf(s.shift_date);
    if (di < 0) continue;
    if (isVacationScheduleShift(s)) {
      row.days[di] = vacationDay();
      continue;
    }
    const start = toHhmm(s.start_time);
    const end = toHhmm(s.end_time);
    if (!start || !end) continue;
    const role = s.role_label || null;
    const cur = row.days[di];
    if (cur.off || !cur.start || !cur.end) {
      row.days[di] = { start, end, off: false, vacation: false, role };
    } else if (cur.start === start && cur.end === end) {
      // mismo turno duplicado — ignorar
    } else {
      // Segundo+ turno el mismo día → acumular para la fórmula «h»
      const extras = cur.extra ? [...cur.extra] : [];
      if (!extras.some((e) => e.start === start && e.end === end)) {
        extras.push({ start, end, role });
      }
      row.days[di] = { ...cur, off: false, vacation: false, extra: extras };
    }
  }

  // Re-resolver sección con todos los turnos acumulados (área modal)
  for (const [id, row] of byId) {
    const emp = empById.get(id);
    const { section, puesto } = resolveRowSection(
      emp,
      shiftAreasByEmp.get(id) || [],
      shiftRolesByEmp.get(id) || [],
      row.full_name
    );
    row.area = section;
    row.puesto = puesto || row.puesto;
  }

  if (seedPlantilla) {
    for (const e of employees) {
      if (byId.has(e.id)) continue;
      const { section, puesto } = resolveRowSection(e, [], [], e.full_name);
      byId.set(e.id, {
        employee_id: e.id,
        full_name: e.full_name,
        area: section,
        puesto,
        dualLimpiezaServicio: hasDualLimpiezaServicio(e),
        days: dates.map(() => emptyDay()),
      });
    }
  }

  return [...byId.values()].sort(comparePersonRows);
}

export function rowsToShifts(
  rows: PersonRow[],
  dates: string[]
): Omit<HrScheduleShift, 'id' | 'week_id'>[] {
  const out: Omit<HrScheduleShift, 'id' | 'week_id'>[] = [];
  for (const r of rows) {
    for (let i = 0; i < 7; i++) {
      const d = r.days[i];
      if (!d) continue;
      if (isVacationDay(d)) {
        out.push({
          employee_id: r.employee_id,
          shift_date: dates[i],
          start_time: null,
          end_time: null,
          area: r.area === 'Otros' ? null : r.area,
          role_label: null,
          origin: 'manual',
          notes: HR_SHIFT_NOTES_VACACIONES,
          employee_name: r.full_name,
        });
        continue;
      }
      if (d.off) continue;
      const segments: DaySegment[] = [];
      if (d.start && d.end) {
        segments.push({ start: d.start, end: d.end, role: d.role || r.puesto });
      }
      for (const e of d.extra || []) {
        if (e.start && e.end) segments.push(e);
      }
      for (const seg of segments) {
        const role = seg.role || r.puesto;
        const areaFromRole = role
          ? scheduleSectionFromPosition(role)
          : r.area;
        out.push({
          employee_id: r.employee_id,
          shift_date: dates[i],
          start_time: toTimeDb(seg.start),
          end_time: toTimeDb(seg.end),
          area:
            areaFromRole && areaFromRole !== 'Otros'
              ? areaFromRole
              : r.area === 'Otros'
                ? null
                : r.area,
          role_label: role,
          origin: 'manual',
          notes: null,
          employee_name: r.full_name,
        });
      }
    }
  }
  return out;
}

export function rowDayHasOverlapConflict(
  row: PersonRow,
  dayIndex: number
): boolean {
  if (!row.dualLimpiezaServicio) return false;
  const d = row.days[dayIndex];
  if (!d || d.off) return false;
  const segs: Array<{ start: string; end: string }> = [];
  if (d.start && d.end) segs.push({ start: d.start, end: d.end });
  for (const e of d.extra || []) {
    if (e.start && e.end) segs.push({ start: e.start, end: e.end });
  }
  return daySegmentsOverlap(segs);
}

/**
 * Fórmula «h»: suma de horas asignadas (Ent/Sal) en la semana.
 * DESCANSO / sin Ent+Sal → 0 · nocturno (Sal ≤ Ent) → cruza medianoche · duales → suman.
 */
export function rowHours(row: PersonRow): number {
  const pairs: Array<{ start: string | null; end: string | null }> = [];
  for (const d of row.days) {
    if (d.off) continue;
    if (d.start && d.end) {
      pairs.push({ start: toTimeDb(d.start), end: toTimeDb(d.end) });
    }
    for (const e of d.extra || []) {
      if (e.start && e.end) {
        pairs.push({ start: toTimeDb(e.start), end: toTimeDb(e.end) });
      }
    }
  }
  return sumShiftHours(pairs);
}

export function formatRowHours(hours: number): string {
  return hours > 0 ? hours.toFixed(1) : '—';
}

export function rowHasDualShifts(row: PersonRow): boolean {
  return row.days.some((d) => !d.off && (d.extra?.length ?? 0) > 0);
}

/** Turnos más usados en la semana (para atajos del editor móvil). */
export function frequentShiftPresets(
  rows: PersonRow[],
  limit = 6
): Array<{ start: string; end: string }> {
  const counts = new Map<string, number>();
  const bump = (start: string, end: string) => {
    if (!start || !end) return;
    const key = `${start}~${end}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const r of rows) {
    for (const d of r.days) {
      if (d.off) continue;
      bump(d.start, d.end);
      for (const e of d.extra || []) bump(e.start, e.end);
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => {
      const [start, end] = key.split('~');
      return { start, end };
    });

  const fallback = [
    { start: '08:00', end: '16:00' },
    { start: '12:00', end: '20:00' },
    { start: '14:00', end: '22:00' },
    { start: '16:00', end: '00:00' },
  ];
  for (const f of fallback) {
    if (top.length >= limit) break;
    if (top.some((t) => t.start === f.start && t.end === f.end)) continue;
    top.push(f);
  }
  return top;
}
