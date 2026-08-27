'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatHrDate, formatHrPuesto } from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import {
  DAY_HEADERS,
  areaSortKey,
  frequentShiftPresets,
  isVacationDay,
  rowDayHasOverlapConflict,
  rowHoursTone,
  type DayCell,
  type DaySegment,
  type PersonRow,
} from '@/app/lib/hr-schedule-grid';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

const OFF_STYLE = { bg: '#fef3c7', color: '#92400e' };
const VAC_STYLE = { bg: '#e0f2fe', color: '#075985' };
const WORK_STYLE = { bg: '#e8eef8', color: SUITE.navy };

function cellStyle(d: DayCell): { bg: string; color: string } {
  if (isVacationDay(d)) return VAC_STYLE;
  if (d.off) return OFF_STYLE;
  return WORK_STYLE;
}

function cellLabel(d: DayCell): string {
  if (isVacationDay(d)) return 'VACACIONES';
  if (d.off) return 'DESCANSO';
  if (!d.start || !d.end) return 'Sin horario';
  return `${d.start}–${d.end}`;
}

function extraLabel(d: DayCell): string | null {
  const extras = (d.extra || []).filter((e) => e.start && e.end);
  if (!extras.length) return null;
  return extras.map((e) => `${e.start}–${e.end}`).join(' · ');
}

/** Índice Lun–Dom del día de hoy dentro de la semana, o 0 si no cae dentro. */
function defaultDayIndex(dates: string[], todayIso: string): number {
  const i = dates.findIndex((d) => d.slice(0, 10) === todayIso);
  return i >= 0 ? i : 0;
}

type Props = {
  rows: PersonRow[];
  dates: string[];
  /** Semana pasada: todo solo lectura. */
  readOnly: boolean;
  /** Por índice Lun–Dom: la fecha civil ya pasó (CDMX). */
  dayLocked: boolean[];
  todayIso: string;
  onCell: (rowKey: string, dayIndex: number, patch: Partial<DayCell>) => void;
  onApplyWeek: (rowKey: string, cell: DayCell) => void;
};

/**
 * Editor de horarios para celular: en vez de la grilla Excel (7 días × Ent/Sal),
 * se edita un día a la vez o una persona a la vez, con hoja de turno táctil.
 *
 * Monta con `key` = semana para que el día/persona seleccionados se reinicien
 * al cambiar de semana.
 */
export function RrhhHorariosMobile({
  rows,
  dates,
  readOnly,
  dayLocked,
  todayIso,
  onCell,
  onApplyWeek,
}: Props) {
  const [mode, setMode] = useState<'dia' | 'persona'>('dia');
  const [dayIndex, setDayIndex] = useState(() =>
    defaultDayIndex(dates, todayIso)
  );
  const [personId, setPersonId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{
    rowKey: string;
    dayIndex: number;
  } | null>(null);

  const presets = useMemo(() => frequentShiftPresets(rows), [rows]);

  const groupedByArea = useMemo(() => {
    const map = new Map<string, PersonRow[]>();
    for (const r of rows) {
      const list = map.get(r.area) || [];
      list.push(r);
      map.set(r.area, list);
    }
    return [...map.keys()]
      .sort((a, b) => areaSortKey(a) - areaSortKey(b))
      .map((area) => ({ area, people: map.get(area)! }));
  }, [rows]);

  const dayStats = useMemo(
    () =>
      dates.map((_, i) => {
        let turnos = 0;
        for (const r of rows) {
          const d = r.days[i];
          if (d && !d.off && d.start && d.end) turnos += 1;
        }
        return turnos;
      }),
    [rows, dates]
  );

  const selectedPerson = useMemo(
    () => rows.find((r) => r.rowKey === personId) || null,
    [rows, personId]
  );

  const sheetPerson = useMemo(
    () => (sheet ? rows.find((r) => r.rowKey === sheet.rowKey) : null),
    [rows, sheet]
  );

  function openSheet(rowKey: string, di: number) {
    if (readOnly || dayLocked[di]) return;
    setSheet({ rowKey, dayIndex: di });
  }

  return (
    <div className="space-y-3 lg:hidden">
      <div
        className="flex rounded-xl bg-white p-1"
        style={{ boxShadow: SUITE.shadow }}
        role="tablist"
        aria-label="Modo de edición"
      >
        {(
          [
            ['dia', 'Por día'],
            ['persona', 'Por persona'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className="min-h-11 flex-1 rounded-lg text-sm font-bold transition-colors"
            style={
              mode === key
                ? { backgroundColor: SUITE.navy, color: '#fff' }
                : { color: theme.muted }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'dia' ? (
        <>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {dates.map((iso, i) => {
              const active = i === dayIndex;
              const locked = readOnly || dayLocked[i];
              const isToday = iso.slice(0, 10) === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setDayIndex(i)}
                  aria-pressed={active}
                  className="min-h-14 shrink-0 rounded-xl px-3 py-1.5 text-center"
                  style={{
                    backgroundColor: active ? SUITE.navy : '#fff',
                    color: active ? '#fff' : theme.title,
                    boxShadow: SUITE.shadow,
                    outline: isToday && !active ? `2px solid ${SUITE.orangeDeep}` : undefined,
                    opacity: locked && !active ? 0.6 : 1,
                  }}
                >
                  <span className="block text-xs font-bold uppercase">
                    {DAY_HEADERS[i]}
                  </span>
                  <span className="block text-sm font-semibold tabular-nums">
                    {iso.slice(8)}
                  </span>
                  <span
                    className="block text-[10px] tabular-nums"
                    style={{ color: active ? 'rgba(255,255,255,.75)' : theme.muted }}
                  >
                    {locked ? '🔒' : `${dayStats[i]} t`}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-xs" style={{ color: theme.muted }}>
            {formatHrDate(dates[dayIndex])} · {dayStats[dayIndex]} turno
            {dayStats[dayIndex] === 1 ? '' : 's'}
            {readOnly || dayLocked[dayIndex]
              ? ' · solo consulta'
              : ' · toca a una persona para editar'}
          </p>

          <div className="space-y-3">
            {groupedByArea.map(({ area, people }) => (
              <section
                key={area}
                className="overflow-hidden rounded-xl bg-white"
                style={{ boxShadow: SUITE.shadow }}
              >
                <h5
                  className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                  style={{ backgroundColor: '#e8eef8', color: SUITE.navy }}
                >
                  {formatHrPuesto(area)}
                </h5>
                <ul>
                  {people.map((p) => {
                    const d = p.days[dayIndex];
                    if (!d) return null;
                    const st = cellStyle(d);
                    const locked = readOnly || dayLocked[dayIndex];
                    const conflict = rowDayHasOverlapConflict(p, dayIndex, rows);
                    const extras = extraLabel(d);
                    return (
                      <li
                        key={p.rowKey}
                        className="border-t border-slate-100 first:border-t-0"
                      >
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => openSheet(p.rowKey, dayIndex)}
                          className="flex min-h-14 w-full items-center justify-between gap-2 px-3 py-2 text-left disabled:opacity-70"
                        >
                          <span className="min-w-0">
                            <span
                              className="block truncate text-sm font-semibold"
                              style={{ color: theme.title }}
                            >
                              {formatHrListName(p.full_name)}
                              {p.dualTrack === 'limpieza' ? (
                                <span className="ml-1 rounded border border-sky-300 bg-sky-50 px-1 text-[9px] font-bold uppercase text-sky-900">
                                  limpieza
                                </span>
                              ) : p.dualLimpiezaServicio ? (
                                <span className="ml-1 rounded border border-amber-300 bg-amber-50 px-1 text-[9px] font-bold uppercase text-amber-900">
                                  dual
                                </span>
                              ) : null}
                            </span>
                            {extras ? (
                              <span
                                className="block truncate text-[11px]"
                                style={{ color: theme.muted }}
                              >
                                2º turno {extras}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums"
                            style={{
                              backgroundColor: conflict ? '#ffe4e6' : st.bg,
                              color: conflict ? '#9f1239' : st.color,
                            }}
                          >
                            {cellLabel(d)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : selectedPerson ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setPersonId(null)}
            className="min-h-11 text-sm font-semibold"
            style={{ color: SUITE.navy }}
          >
            ← Todas las personas
          </button>
          <div
            className="rounded-xl bg-white px-3 py-2"
            style={{ boxShadow: SUITE.shadow }}
          >
            <p className="text-sm font-bold" style={{ color: theme.title }}>
              {formatHrListName(selectedPerson.full_name)}
            </p>
            {(() => {
              const tone = rowHoursTone(selectedPerson);
              return (
                <p
                  className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums"
                  style={tone.style}
                  title={tone.title}
                >
                  {tone.label === '—'
                    ? 'Sin horas'
                    : `${tone.label} h en la semana`}
                </p>
              );
            })()}
            <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
              {formatHrPuesto(selectedPerson.area)}
            </p>
          </div>
          <ul className="space-y-1.5">
            {selectedPerson.days.map((d, i) => {
              const st = cellStyle(d);
              const locked = readOnly || dayLocked[i];
              const extras = extraLabel(d);
              return (
                <li key={dates[i]}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => openSheet(selectedPerson.rowKey, i)}
                    className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left disabled:opacity-70"
                    style={{ boxShadow: SUITE.shadow }}
                  >
                    <span>
                      <span
                        className="block text-sm font-semibold"
                        style={{ color: theme.title }}
                      >
                        {DAY_HEADERS[i]} {dates[i]?.slice(8)}
                      </span>
                      {extras ? (
                        <span
                          className="block text-[11px]"
                          style={{ color: theme.muted }}
                        >
                          2º turno {extras}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums"
                      style={{ backgroundColor: st.bg, color: st.color }}
                    >
                      {locked ? cellLabel(d) : cellLabel(d)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByArea.map(({ area, people }) => (
            <section
              key={area}
              className="overflow-hidden rounded-xl bg-white"
              style={{ boxShadow: SUITE.shadow }}
            >
              <h5
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                style={{ backgroundColor: '#e8eef8', color: SUITE.navy }}
              >
                {formatHrPuesto(area)}
              </h5>
              <ul>
                {people.map((p) => {
                  const turnos = p.days.filter(
                    (d) => !d.off && d.start && d.end
                  ).length;
                  const tone = rowHoursTone(p);
                  return (
                    <li
                      key={p.rowKey}
                      className="border-t border-slate-100 first:border-t-0"
                    >
                      <button
                        type="button"
                        onClick={() => setPersonId(p.rowKey)}
                        className="flex min-h-14 w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      >
                        <span
                          className="min-w-0 truncate text-sm font-semibold"
                          style={{ color: theme.title }}
                        >
                          {formatHrListName(p.full_name)}
                        </span>
                        <span
                          className="shrink-0 text-xs tabular-nums"
                          style={{ color: theme.muted }}
                        >
                          {turnos} turnos ·{' '}
                          <span
                            className="rounded px-1 font-bold tabular-nums"
                            style={tone.style}
                            title={tone.title}
                          >
                            {tone.label} h
                          </span>{' '}
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {sheet && sheetPerson ? (
        <ShiftSheet
          person={sheetPerson}
          dayIndex={sheet.dayIndex}
          dateIso={dates[sheet.dayIndex]}
          presets={presets}
          onClose={() => setSheet(null)}
          onCell={onCell}
          onApplyWeek={onApplyWeek}
        />
      ) : null}
    </div>
  );
}

function ShiftSheet({
  person,
  dayIndex,
  dateIso,
  presets,
  onClose,
  onCell,
  onApplyWeek,
}: {
  person: PersonRow;
  dayIndex: number;
  dateIso: string;
  presets: Array<{ start: string; end: string }>;
  onClose: () => void;
  onCell: (rowKey: string, dayIndex: number, patch: Partial<DayCell>) => void;
  onApplyWeek: (rowKey: string, cell: DayCell) => void;
}) {
  const day = person.days[dayIndex];
  const extras = (day?.extra || []).filter((e) => e.start && e.end);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!day) return null;

  function setShift(start: string, end: string) {
    onCell(person.rowKey, dayIndex, {
      start,
      end,
      off: false,
      vacation: false,
    });
  }

  function setExtras(next: DaySegment[]) {
    onCell(person.rowKey, dayIndex, {
      extra: next.length ? next : undefined,
    });
  }

  const active = !day.off && day.start && day.end;

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:hidden">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Turno de ${person.full_name}`}
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pb-6 pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className="truncate text-base font-bold"
              style={{ color: theme.title }}
            >
              {formatHrListName(person.full_name)}
            </p>
            <p className="text-xs" style={{ color: theme.muted }}>
              {DAY_HEADERS[dayIndex]} · {formatHrDate(dateIso)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 px-2 text-sm font-bold"
            style={{ color: SUITE.navy }}
          >
            Listo
          </button>
        </div>

        <p
          className="mt-3 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: theme.muted }}
        >
          Turnos frecuentes
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {presets.map((p) => {
            const on = active && day.start === p.start && day.end === p.end;
            return (
              <button
                key={`${p.start}-${p.end}`}
                type="button"
                onClick={() => setShift(p.start, p.end)}
                className="min-h-12 rounded-xl text-sm font-bold tabular-nums"
                style={
                  on
                    ? { backgroundColor: SUITE.navy, color: '#fff' }
                    : { backgroundColor: '#e8eef8', color: SUITE.navy }
                }
              >
                {p.start}–{p.end}
              </button>
            );
          })}
        </div>

        <p
          className="mt-4 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: theme.muted }}
        >
          Horario personalizado
        </p>
        <div className="mt-1.5 flex items-end gap-2">
          <label className="flex-1 text-xs" style={{ color: theme.muted }}>
            Entrada
            <input
              type="time"
              value={day.start}
              onChange={(e) =>
                onCell(person.rowKey, dayIndex, {
                  start: e.target.value,
                  off: false,
                  vacation: false,
                })
              }
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base tabular-nums"
            />
          </label>
          <label className="flex-1 text-xs" style={{ color: theme.muted }}>
            Salida
            <input
              type="time"
              value={day.end}
              onChange={(e) =>
                onCell(person.rowKey, dayIndex, {
                  end: e.target.value,
                  off: false,
                  vacation: false,
                })
              }
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base tabular-nums"
            />
          </label>
        </div>

        {extras.length > 0 && (
          <>
            <p
              className="mt-4 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: theme.muted }}
            >
              Segundo turno
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {extras.map((e, i) => (
                <li
                  key={`${e.start}-${e.end}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"
                >
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: theme.title }}
                  >
                    {e.start}–{e.end}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExtras(extras.filter((_, idx) => idx !== i))
                    }
                    className="min-h-11 px-2 text-xs font-bold text-red-800"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {active && extras.length === 0 && (
          <button
            type="button"
            onClick={() => setExtras([{ start: '18:00', end: '22:00' }])}
            className="mt-2 min-h-11 text-sm font-semibold"
            style={{ color: SUITE.navy }}
          >
            + Agregar segundo turno
          </button>
        )}

        <div className="mt-4 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() =>
              onCell(person.rowKey, dayIndex, { off: true })
            }
            className="min-h-12 rounded-xl text-sm font-bold uppercase tracking-wide"
            style={
              day.off && !day.vacation
                ? { backgroundColor: '#92400e', color: '#fff' }
                : OFF_STYLE_BUTTON
            }
          >
            Descanso
          </button>
          <button
            type="button"
            onClick={() =>
              onCell(person.rowKey, dayIndex, { vacation: true })
            }
            className="min-h-12 rounded-xl text-sm font-bold uppercase tracking-wide"
            style={
              isVacationDay(day)
                ? { backgroundColor: '#075985', color: '#fff' }
                : VAC_STYLE_BUTTON
            }
          >
            Vacaciones
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            onApplyWeek(person.rowKey, day);
            onClose();
          }}
          className="mt-3 min-h-12 w-full rounded-xl border border-slate-200 text-sm font-semibold"
          style={{ color: theme.title }}
        >
          Aplicar este día a toda la semana
        </button>
        <p className="mt-2 text-[11px]" style={{ color: theme.muted }}>
          Los días ya pasados no se modifican. Recuerda Guardar al terminar.
        </p>
      </div>
    </div>
  );
}

const OFF_STYLE_BUTTON = { backgroundColor: OFF_STYLE.bg, color: OFF_STYLE.color };
const VAC_STYLE_BUTTON = { backgroundColor: VAC_STYLE.bg, color: VAC_STYLE.color };
