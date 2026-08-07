'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import {
  addIsoDays,
  formatHrDate,
  formatHrPuesto,
  todayIsoCdmx,
  type HrEmployee,
  type HrScheduleShift,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import {
  DAY_HEADERS,
  areaSortKey,
  buildRowsFromShifts,
  type PersonRow,
} from '@/app/lib/hr-schedule-grid';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekDateList,
  weekdayOfIso,
} from '@/app/lib/hr-schedule-propose';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

/** Vie–Dom CDMX: mostrar también la próxima semana publicada. */
function isWeekendPreviewDay(iso: string): boolean {
  const wd = weekdayOfIso(iso);
  return wd === 5 || wd === 6 || wd === 0;
}

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
  /** Fichas sintéticas desde el join de turnos (dual Limpieza+servicio sin plantilla). */
  const shiftEmployees = useMemo(() => {
    const byId = new Map<string, HrEmployee>();
    for (const s of shifts) {
      if (byId.has(s.employee_id)) continue;
      byId.set(s.employee_id, {
        id: s.employee_id,
        full_name: s.employee_name || s.employee_id.slice(0, 8),
        status: 'activo',
        puesto: s.employee_puesto ?? null,
        puestos_secundarios: s.employee_puestos_secundarios ?? null,
        area: s.employee_area ?? null,
        fecha_ingreso: null,
        email: null,
        phone: null,
        drive_folder_path: null,
        notes: s.employee_notes ?? null,
        force_include: false,
        force_exclude: false,
      });
    }
    return [...byId.values()];
  }, [shifts]);
  const rows = useMemo(
    () => buildRowsFromShifts(shiftEmployees, shifts, dates),
    [shiftEmployees, shifts, dates]
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
                    key={p.rowKey}
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
                      {p.dualTrack === 'limpieza' ? (
                        <span
                          className="ml-1 rounded border border-sky-300 bg-sky-50 px-1 text-[9px] font-bold uppercase tracking-wide text-sky-900"
                          title="Turno de limpieza (doble rol)"
                        >
                          limpieza
                        </span>
                      ) : p.dualLimpiezaServicio ? (
                        <span
                          className="ml-1 rounded border border-amber-300 bg-amber-50 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-900"
                          title="Rol dual: Limpieza y servicio"
                        >
                          dual
                        </span>
                      ) : null}
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
                            style={
                              d.vacation
                                ? {
                                    backgroundColor: '#e0f2fe',
                                    color: '#075985',
                                  }
                                : {
                                    backgroundColor: '#fef3c7',
                                    color: '#92400e',
                                  }
                            }
                          >
                            {d.vacation ? 'VACACIONES' : 'DESCANSO'}
                          </span>
                        </td>
                      ) : (
                        <Fragment key={`${p.rowKey}-${di}`}>
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

export function StaffHorarioClient({
  canEdit = false,
}: {
  canEdit?: boolean;
}) {
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/staff"
          className="text-sm font-semibold"
          style={{ color: SUITE.orangeDeep }}
        >
          ← Volver a Staff
        </Link>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/staff/horario?edit=1"
              className="rounded-lg px-3 py-1.5 text-sm font-bold"
              style={{
                backgroundColor: SUITE.navy,
                color: '#fff',
              }}
            >
              Crear
            </Link>
            <Link
              href="/staff/horario?edit=1"
              className="rounded-lg px-3 py-1.5 text-sm font-bold"
              style={{
                backgroundColor: SUITE.orange,
                color: SUITE.navy,
              }}
            >
              Editar
            </Link>
          </div>
        ) : null}
      </div>

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
