'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import {
  addIsoDays,
  employeeNotesHasFlag,
  formatHrDate,
  formatHrPuesto,
  isGenericPisoArea,
  isPlantillaExterno,
  meseroWithinFamilyRank,
  plantillaPositionKey,
  scheduleSectionFromPosition,
  todayIsoCdmx,
  type HrEmployee,
  type HrScheduleShift,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { hasDualLimpiezaServicio } from '@/app/lib/hr-puestos';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekDateList,
  weekdayOfIso,
} from '@/app/lib/hr-schedule-propose';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');
const DAY_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

/** Vie–Dom CDMX: mostrar también la próxima semana publicada. */
function isWeekendPreviewDay(iso: string): boolean {
  const wd = weekdayOfIso(iso);
  return wd === 5 || wd === 6 || wd === 0;
}

const AREA_ORDER = [
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

type DaySegment = { start: string; end: string };

type DayCell = {
  start: string;
  end: string;
  off: boolean;
  extra?: DaySegment[];
};

type PersonRow = {
  employee_id: string;
  full_name: string;
  area: string;
  puesto: string | null;
  days: DayCell[];
};

type WeekInfo = {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
  published_at?: string | null;
} | null;

type Payload = {
  ready: boolean;
  includeNextWeek?: boolean;
  week: WeekInfo;
  shifts: HrScheduleShift[];
  message?: string | null;
  weekStart: string;
  weekEnd: string;
  nextWeek?: WeekInfo;
  nextShifts?: HrScheduleShift[];
  nextMessage?: string | null;
  nextWeekStart?: string | null;
  nextWeekEnd?: string | null;
};

function normalizeArea(raw: string | null | undefined): string {
  if (!raw?.trim() || isGenericPisoArea(raw)) return 'Otros';
  return scheduleSectionFromPosition(raw);
}

function areaSortKey(area: string): number {
  const i = AREA_ORDER.indexOf(area as (typeof AREA_ORDER)[number]);
  return i >= 0 ? i : AREA_ORDER.length;
}

function resolveRowSection(
  emp: HrEmployee | undefined,
  shiftAreas: string[],
  shiftRoles: string[],
  fallbackName: string,
  notesFallback?: string | null
): { section: string; puesto: string | null } {
  const notes = emp?.notes ?? notesFallback ?? null;
  const dual =
    (emp ? hasDualLimpiezaServicio({ ...emp, notes }) : false) ||
    employeeNotesHasFlag(notes, 'dual_limpieza_mesero');
  const posKey = emp ? plantillaPositionKey(emp) : null;
  const fromPuesto = posKey ? scheduleSectionFromPosition(posKey) : null;

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

  if (
    dual &&
    (section === 'Limpieza' || section === 'Otros' || section === 'Piso')
  ) {
    section = 'Meseros';
  }

  if (isPlantillaExterno({ full_name: emp?.full_name || fallbackName, notes })) {
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

function comparePersonRows(a: PersonRow, b: PersonRow): number {
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

function toHhmm(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}

function emptyDay(): DayCell {
  return { start: '', end: '', off: true };
}

function buildRowsFromShifts(
  shifts: HrScheduleShift[],
  dates: string[]
): PersonRow[] {
  const byId = new Map<string, PersonRow>();
  const shiftAreasByEmp = new Map<string, string[]>();
  const shiftRolesByEmp = new Map<string, string[]>();
  const notesByEmp = new Map<string, string | null>();

  for (const s of shifts) {
    if (s.employee_notes != null && !notesByEmp.has(s.employee_id)) {
      notesByEmp.set(s.employee_id, s.employee_notes);
    }
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
      const stub: HrEmployee | undefined = s.employee_puesto
        ? ({
            id: s.employee_id,
            full_name: s.employee_name || s.employee_id,
            status: 'activo',
            puesto: s.employee_puesto,
            area: s.employee_area ?? null,
            fecha_ingreso: null,
            email: null,
            phone: null,
            drive_folder_path: null,
            notes: s.employee_notes ?? null,
          } as HrEmployee)
        : undefined;
      const { section, puesto } = resolveRowSection(
        stub,
        areas,
        roles,
        s.employee_name || s.employee_id,
        s.employee_notes
      );
      row = {
        employee_id: s.employee_id,
        full_name: s.employee_name || s.employee_id.slice(0, 8),
        area: section,
        puesto,
        days: dates.map(() => emptyDay()),
      };
      byId.set(s.employee_id, row);
    }
    const di = dates.indexOf(s.shift_date);
    if (di < 0) continue;
    const start = toHhmm(s.start_time);
    const end = toHhmm(s.end_time);
    if (!start || !end) continue;
    const cur = row.days[di];
    if (cur.off || !cur.start || !cur.end) {
      row.days[di] = { start, end, off: false };
    } else if (cur.start === start && cur.end === end) {
      // duplicate
    } else {
      const extras = cur.extra ? [...cur.extra] : [];
      if (!extras.some((e) => e.start === start && e.end === end)) {
        extras.push({ start, end });
      }
      row.days[di] = { ...cur, off: false, extra: extras };
    }
  }

  for (const [id, row] of byId) {
    const stub: HrEmployee = {
      id,
      full_name: row.full_name,
      status: 'activo',
      puesto: row.puesto,
      area: row.area,
      fecha_ingreso: null,
      email: null,
      phone: null,
      drive_folder_path: null,
      notes: notesByEmp.get(id) ?? null,
    };
    const { section, puesto } = resolveRowSection(
      stub,
      shiftAreasByEmp.get(id) || [],
      shiftRolesByEmp.get(id) || [],
      row.full_name,
      notesByEmp.get(id)
    );
    row.area = section;
    row.puesto = puesto || row.puesto;
  }

  return [...byId.values()].sort(comparePersonRows);
}

function TeamScheduleTable({
  weekStart,
  shifts,
}: {
  weekStart: string;
  shifts: HrScheduleShift[];
}) {
  const dates = useMemo(() => weekDateList(weekStart), [weekStart]);
  /** Índice Lun–Dom del día civil de hoy (CDMX); -1 si la semana mostrada no lo incluye. */
  const todayIdx = useMemo(() => {
    const today = todayIsoCdmx();
    return dates.findIndex((d) => d.slice(0, 10) === today);
  }, [dates]);
  const rows = useMemo(
    () => buildRowsFromShifts(shifts, dates),
    [shifts, dates]
  );
  const grouped = useMemo(() => {
    const map = new Map<string, PersonRow[]>();
    for (const r of rows) {
      const list = map.get(r.area) || [];
      list.push(r);
      map.set(r.area, list);
    }
    const keys = [...map.keys()].sort(
      (a, b) => areaSortKey(a) - areaSortKey(b)
    );
    return keys.map((area) => ({ area, people: map.get(area)! }));
  }, [rows]);

  return (
    <div
      className="overflow-x-auto rounded-xl bg-white"
      style={{ boxShadow: SUITE.shadow }}
    >
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
            <th
              className="sticky left-0 z-10 px-2 py-2 text-left text-xs font-bold uppercase tracking-wide"
              style={{ backgroundColor: SUITE.navy, minWidth: 140 }}
            >
              Nombre
            </th>
            {DAY_HEADERS.map((d, i) => {
              const isToday = i === todayIdx;
              return (
                <th
                  key={d}
                  colSpan={2}
                  className="border-l border-white/20 px-1 py-2 text-center text-xs font-bold uppercase"
                  style={
                    isToday
                      ? {
                          backgroundColor: SUITE.navySoft,
                          boxShadow: `inset 0 -3px 0 ${SUITE.orange}`,
                        }
                      : undefined
                  }
                >
                  <div>{d}</div>
                  <div
                    className="font-normal"
                    style={{
                      opacity: isToday ? 1 : 0.8,
                      color: isToday ? SUITE.orange : undefined,
                    }}
                  >
                    {dates[i]?.slice(5)}
                  </div>
                </th>
              );
            })}
          </tr>
          <tr style={{ backgroundColor: '#1e3a5f', color: '#cbd5e1' }}>
            <th
              className="sticky left-0 z-10 px-2 py-1"
              style={{ backgroundColor: '#1e3a5f' }}
            />
            {DAY_HEADERS.map((d, i) => {
              const isToday = i === todayIdx;
              const todaySub = isToday
                ? {
                    backgroundColor: '#334e78',
                    color: SUITE.orangeSoft,
                  }
                : undefined;
              return (
                <Fragment key={d}>
                  <th
                    className="border-l border-white/10 px-0.5 py-1 text-center text-[10px] font-semibold w-[4.5rem]"
                    style={todaySub}
                  >
                    Ent.
                  </th>
                  <th
                    className="px-0.5 py-1 text-center text-[10px] font-semibold w-[4.5rem]"
                    style={todaySub}
                  >
                    Sal.
                  </th>
                </Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grouped.length === 0 ? (
            <tr>
              <td
                colSpan={15}
                className="px-3 py-6 text-center text-sm"
                style={{ color: theme.muted }}
              >
                Sin turnos en esta semana.
              </td>
            </tr>
          ) : (
            grouped.map(({ area, people }) => (
              <Fragment key={area}>
                <tr>
                  <td
                    colSpan={15}
                    className="px-2 py-1.5 text-[11px] font-bold tracking-wide uppercase"
                    style={{
                      backgroundColor: '#e8eef8',
                      color: SUITE.navy,
                      borderBottom: `1px solid ${SUITE.border}`,
                    }}
                  >
                    {formatHrPuesto(area)}
                  </td>
                </tr>
                {people.map((p) => (
                  <tr
                    key={p.employee_id}
                    className="border-t border-slate-100"
                  >
                    <td
                      className="sticky left-0 z-[1] bg-white px-2 py-1 text-sm font-medium whitespace-nowrap"
                      style={{
                        color: theme.title,
                        boxShadow: '1px 0 0 #e2e8f0',
                      }}
                    >
                      {formatHrListName(p.full_name)}
                    </td>
                    {p.days.map((d, di) => {
                      const isToday = di === todayIdx;
                      const colWash = isToday
                        ? { backgroundColor: SUITE.orangeSoft }
                        : undefined;
                      const colEdge = isToday
                        ? `border-l border-orange-200`
                        : 'border-l border-slate-100';
                      return d.off ? (
                        <td
                          key={di}
                          colSpan={2}
                          className={`${colEdge} px-1 py-0.5 text-center`}
                          style={colWash}
                        >
                          <span
                            className="inline-block w-full rounded px-1 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                            style={{
                              backgroundColor: '#fef3c7',
                              color: '#92400e',
                            }}
                          >
                            DESCANSO
                          </span>
                        </td>
                      ) : (
                        <Fragment key={`${p.employee_id}-${di}`}>
                          <td
                            className={`${colEdge} px-0.5 py-0.5`}
                            style={colWash}
                          >
                            <span className="block w-full min-w-[4.25rem] rounded border border-slate-200 bg-slate-50 px-0.5 py-1 text-center text-xs tabular-nums text-slate-700">
                              {d.start || '—'}
                            </span>
                          </td>
                          <td className="px-0.5 py-0.5" style={colWash}>
                            <span className="block w-full min-w-[4.25rem] rounded border border-slate-200 bg-slate-50 px-0.5 py-1 text-center text-xs tabular-nums text-slate-700">
                              {d.end || '—'}
                              {(d.extra?.length ?? 0) > 0 ? (
                                <span
                                  className="mt-0.5 block text-[9px] font-semibold text-amber-800"
                                  title={d.extra!
                                    .map((e) => `${e.start}–${e.end}`)
                                    .join(', ')}
                                >
                                  +{d.extra!.length}
                                </span>
                              ) : null}
                            </span>
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function StaffHorarioClient() {
  const today = todayIsoCdmx();
  const weekStart = mondayOfWeek(today);
  const weekEnd = sundayOfWeek(weekStart);
  const clientIncludeNext = isWeekendPreviewDay(today);
  const nextMon = addIsoDays(weekStart, 7);
  const nextSun = sundayOfWeek(nextMon);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/schedules/mine', { cache: 'no-store' });
      const json = (await res.json()) as Payload;
      setData(json);
    } catch {
      setData({
        ready: false,
        includeNextWeek: clientIncludeNext,
        week: null,
        shifts: [],
        message: 'Error de red',
        weekStart,
        weekEnd,
        nextWeek: null,
        nextShifts: [],
        nextMessage: null,
        nextWeekStart: clientIncludeNext ? nextMon : null,
        nextWeekEnd: clientIncludeNext ? nextSun : null,
      });
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd, clientIncludeNext, nextMon, nextSun]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const includeNextWeek = data?.includeNextWeek ?? clientIncludeNext;
  const shifts = data?.shifts || [];
  const showTable = Boolean(data?.week) && shifts.length > 0;

  const nextWeekStartIso =
    data?.nextWeekStart || (includeNextWeek ? nextMon : null);
  const nextWeekEndIso =
    data?.nextWeekEnd || (includeNextWeek ? nextSun : null);
  const nextShifts = data?.nextShifts || [];
  // Vie–Dom: only surface next week when RH has published it.
  const showNextPublished =
    includeNextWeek && Boolean(data?.nextWeek) && nextShifts.length > 0;
  const showNextEmpty =
    includeNextWeek && Boolean(data?.nextWeek) && nextShifts.length === 0;

  const subtitle = includeNextWeek
    ? 'Consulta · esta semana y la próxima (vie–dom, si RH ya publicó)'
    : 'Consulta · tabla del personal, semana en curso publicada';

  return (
    <SuiteShell title="Mi horario" subtitle={subtitle}>
      <p className="mb-4">
        <Link
          href="/staff"
          className="text-sm font-semibold"
          style={{ color: SUITE.orangeDeep }}
        >
          ← Volver a Staff
        </Link>
      </p>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando horario…
        </p>
      ) : (
        <section className="space-y-8">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {(showNextPublished || showNextEmpty) && (
                <span
                  className="text-sm font-bold"
                  style={{ color: theme.title }}
                >
                  Esta semana
                </span>
              )}
              <span
                className="text-sm font-semibold"
                style={{ color: theme.title }}
              >
                {formatHrDate(data?.weekStart || weekStart)} –{' '}
                {formatHrDate(data?.weekEnd || weekEnd)}
              </span>
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: '#fef3c7',
                  color: '#92400e',
                }}
              >
                En curso
              </span>
            </div>

            {!data?.week && (
              <SuiteCard>
                <p
                  className="text-sm font-semibold"
                  style={{ color: theme.title }}
                >
                  Sin horario publicado
                </p>
                <p
                  className="mt-2 text-sm leading-relaxed"
                  style={{ color: theme.muted }}
                >
                  {data?.message ||
                    'RH aún no publicó la semana en curso. Cuando lo hagan, verás la tabla de horarios del personal aquí.'}
                </p>
              </SuiteCard>
            )}

            {data?.week && !showTable && (
              <SuiteCard>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: theme.muted }}
                >
                  {data.message ||
                    'La semana en curso está publicada, pero aún no hay turnos en la grilla.'}
                </p>
              </SuiteCard>
            )}

            {showTable && (
              <TeamScheduleTable
                weekStart={data!.weekStart || weekStart}
                shifts={shifts}
              />
            )}
          </div>

          {(showNextPublished || showNextEmpty) &&
            nextWeekStartIso &&
            nextWeekEndIso && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="text-sm font-bold"
                    style={{ color: theme.title }}
                  >
                    Próxima semana
                  </span>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: theme.title }}
                  >
                    {formatHrDate(nextWeekStartIso)} –{' '}
                    {formatHrDate(nextWeekEndIso)}
                  </span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: '#ecfdf5',
                      color: '#065f46',
                    }}
                  >
                    Publicado
                  </span>
                </div>

                {showNextEmpty && (
                  <SuiteCard>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: theme.muted }}
                    >
                      {data?.nextMessage ||
                        'La próxima semana está publicada, pero aún no hay turnos en la grilla.'}
                    </p>
                  </SuiteCard>
                )}

                {showNextPublished && (
                  <TeamScheduleTable
                    weekStart={nextWeekStartIso}
                    shifts={nextShifts}
                  />
                )}
              </div>
            )}
        </section>
      )}
    </SuiteShell>
  );
}
