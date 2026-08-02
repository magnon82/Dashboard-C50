'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import {
  addIsoDays,
  formatHrDate,
  todayIsoCdmx,
  type HrScheduleShift,
} from '@/app/lib/hr';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekDateList,
  weekdayOfIso,
} from '@/app/lib/hr-schedule-propose';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

type Linked = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
} | null;

type WeekInfo = {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
  published_at?: string | null;
} | null;

type Payload = {
  ready: boolean;
  linked: boolean;
  linkedEmployee: Linked;
  needLink?: boolean;
  isFriday?: boolean;
  week: WeekInfo;
  myShifts: HrScheduleShift[];
  rosterHint: HrScheduleShift[];
  message?: string | null;
  weekStart: string;
  weekEnd: string;
  nextWeek?: WeekInfo;
  nextMyShifts?: HrScheduleShift[];
  nextRosterHint?: HrScheduleShift[];
  nextMessage?: string | null;
  nextWeekStart?: string | null;
  nextWeekEnd?: string | null;
};

function fmtTime(t: string | null | undefined): string {
  if (!t) return '—';
  return t.slice(0, 5);
}

function WeekGrid({
  weekStart,
  shifts,
}: {
  weekStart: string;
  shifts: HrScheduleShift[];
}) {
  const dates = useMemo(() => weekDateList(weekStart), [weekStart]);
  const byDate = useMemo(() => {
    const m = new Map<string, HrScheduleShift[]>();
    for (const s of shifts) {
      const list = m.get(s.shift_date) || [];
      list.push(s);
      m.set(s.shift_date, list);
    }
    return m;
  }, [shifts]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {dates.map((d) => {
        const list = byDate.get(d) || [];
        const wd = new Date(d + 'T12:00:00').getDay();
        return (
          <div
            key={d}
            className="rounded-2xl bg-white px-3 py-3"
            style={{ boxShadow: SUITE.shadow }}
          >
            <p
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: theme.muted }}
            >
              {WEEKDAY_SHORT[wd]} · {formatHrDate(d)}
            </p>
            {list.length === 0 ? (
              <p className="mt-2 text-xs" style={{ color: theme.muted }}>
                Libre / sin turno
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {list.map((s, i) => (
                  <li key={`${s.id || i}`} className="text-sm">
                    <span
                      className="font-semibold"
                      style={{ color: theme.title }}
                    >
                      {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                    </span>
                    {s.area ? (
                      <span style={{ color: theme.muted }}>
                        {' '}
                        · {s.area}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RosterHintList({ shifts }: { shifts: HrScheduleShift[] }) {
  if (shifts.length === 0) return null;
  return (
    <SuiteCard>
      <p className="text-sm font-bold" style={{ color: theme.title }}>
        Roster publicado (lectura)
      </p>
      <ul className="mt-3 divide-y divide-slate-100">
        {shifts.map((s, i) => (
          <li key={`${s.id || i}`} className="py-2 text-sm">
            <strong>{s.employee_name || '—'}</strong>
            {' · '}
            {formatHrDate(s.shift_date)} · {fmtTime(s.start_time)}–
            {fmtTime(s.end_time)}
            {s.area ? ` · ${s.area}` : ''}
          </li>
        ))}
      </ul>
    </SuiteCard>
  );
}

export function StaffHorarioClient() {
  const today = todayIsoCdmx();
  const weekStart = mondayOfWeek(today);
  const weekEnd = sundayOfWeek(weekStart);
  const clientIsFriday = weekdayOfIso(today) === 5;
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
        linked: false,
        linkedEmployee: null,
        isFriday: clientIsFriday,
        week: null,
        myShifts: [],
        rosterHint: [],
        message: 'Error de red',
        weekStart,
        weekEnd,
        nextWeek: null,
        nextMyShifts: [],
        nextRosterHint: [],
        nextMessage: null,
        nextWeekStart: clientIsFriday ? nextMon : null,
        nextWeekEnd: clientIsFriday ? nextSun : null,
      });
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd, clientIsFriday, nextMon, nextSun]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isFriday = data?.isFriday ?? clientIsFriday;
  const hasMyShifts = (data?.myShifts?.length ?? 0) > 0;
  const showWeekGrid = Boolean(data?.week) && hasMyShifts;

  const nextWeekStartIso =
    data?.nextWeekStart || (isFriday ? nextMon : null);
  const nextWeekEndIso = data?.nextWeekEnd || (isFriday ? nextSun : null);
  const nextHasShifts = (data?.nextMyShifts?.length ?? 0) > 0;
  const showNextGrid = Boolean(data?.nextWeek) && nextHasShifts;

  const subtitle = isFriday
    ? 'Semana en curso · los viernes también la próxima (si RH ya publicó)'
    : 'Semana en curso · solo lo publicado por RH';

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
        <div className="space-y-6 max-w-3xl">
          {data?.needLink && (
            <SuiteCard accent>
              <p
                className="text-xs font-bold uppercase tracking-[0.16em]"
                style={{ color: SUITE.orangeDeep }}
              >
                Vinculación
              </p>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: theme.muted }}
              >
                Pide a RH vincular tu usuario de la Suite en tu ficha
                (`suite_username`). Sin eso, solo intentamos coincidir por nombre
                en el roster publicado.
              </p>
            </SuiteCard>
          )}

          {data?.linkedEmployee && (
            <p className="text-sm" style={{ color: theme.muted }}>
              Vinculado:{' '}
              <strong style={{ color: theme.title }}>
                {data.linkedEmployee.full_name}
              </strong>
              {data.linkedEmployee.puesto
                ? ` · ${data.linkedEmployee.puesto}`
                : ''}
            </p>
          )}

          {/* ——— Esta semana ——— */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {isFriday && (
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
                  backgroundColor: SUITE.orangeSoft,
                  color: SUITE.navy,
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
                    'RH aún no publicó la semana en curso. Cuando lo hagan, verás tus turnos aquí.'}
                </p>
              </SuiteCard>
            )}

            {data?.week && !hasMyShifts && data.message && (
              <SuiteCard>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: theme.muted }}
                >
                  {data.message}
                </p>
              </SuiteCard>
            )}

            {data?.week && hasMyShifts && data.message && (
              <SuiteCard>
                <p className="text-sm" style={{ color: theme.muted }}>
                  {data.message}
                </p>
              </SuiteCard>
            )}

            {showWeekGrid && (
              <WeekGrid
                weekStart={data!.weekStart || weekStart}
                shifts={data!.myShifts}
              />
            )}

            {!data?.linked && (data?.rosterHint?.length ?? 0) > 0 && (
              <RosterHintList shifts={data!.rosterHint} />
            )}
          </section>

          {/* ——— Próxima semana (solo viernes) ——— */}
          {isFriday && nextWeekStartIso && nextWeekEndIso && (
            <section className="space-y-3">
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
                    backgroundColor: data?.nextWeek
                      ? SUITE.orangeSoft
                      : '#e2e8f0',
                    color: SUITE.navy,
                  }}
                >
                  {data?.nextWeek ? 'Publicado' : 'Pendiente'}
                </span>
              </div>

              {!data?.nextWeek && (
                <SuiteCard>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: theme.title }}
                  >
                    Próxima semana aún no publicada
                  </p>
                  <p
                    className="mt-2 text-sm leading-relaxed"
                    style={{ color: theme.muted }}
                  >
                    {data?.nextMessage ||
                      'RH aún no publicó la próxima semana. Los viernes verás esos turnos aquí cuando estén publicados.'}
                  </p>
                </SuiteCard>
              )}

              {data?.nextWeek && !nextHasShifts && data.nextMessage && (
                <SuiteCard>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: theme.muted }}
                  >
                    {data.nextMessage}
                  </p>
                </SuiteCard>
              )}

              {showNextGrid && (
                <WeekGrid
                  weekStart={nextWeekStartIso}
                  shifts={data!.nextMyShifts || []}
                />
              )}

              {!data?.linked &&
                (data?.nextRosterHint?.length ?? 0) > 0 && (
                  <RosterHintList shifts={data!.nextRosterHint || []} />
                )}
            </section>
          )}
        </div>
      )}
    </SuiteShell>
  );
}
