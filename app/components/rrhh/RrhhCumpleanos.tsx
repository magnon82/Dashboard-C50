'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { UpcomingBirthdaysList } from '@/app/components/hr/UpcomingBirthdaysList';
import {
  formatHrPuesto,
  todayIsoCdmx,
  upcomingBirthdays,
  type HrEmployee,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type Payload = {
  ready: boolean;
  employees: HrEmployee[];
  count: number;
  message?: string | null;
  error?: string;
  code?: string | null;
  nacimientoFill?: { filled: boolean; message?: string } | null;
  nacimientoColumnMissing?: boolean;
};

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
  });
}

/** Celdas lun–dom del mes (ISO o null). */
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month - 1, 1);
  // JS: 0=dom … 6=sáb → lun=0
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function RrhhCumpleanos() {
  const today = todayIsoCdmx();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftDob, setDraftDob] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [calCursor, setCalCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y!, month: m! };
  });

  const refresh = useCallback(async (opts?: { softFill?: boolean }) => {
    setLoading(true);
    setSaveMsg(null);
    try {
      // Plantilla first (no fill) so Cumpleaños never hangs on Drive/OCR.
      const res = await fetch('/api/hr/employees', { cache: 'no-store' });
      const json = (await res.json()) as Payload;
      setData(json);
      setLoading(false);

      if (opts?.softFill === false) return;
      if (json.nacimientoColumnMissing || json.code === 'nacimiento_schema_missing') {
        return;
      }

      void fetch('/api/hr/employees?fill_nacimiento=1', { cache: 'no-store' })
        .then(async (fillRes) => {
          const filled = (await fillRes.json()) as Payload;
          if (filled.nacimientoFill?.filled || filled.employees?.length) {
            setData(filled);
          }
        })
        .catch(() => {
          /* soft-fill opcional */
        });
    } catch {
      setData({
        ready: false,
        employees: [],
        count: 0,
        message: 'Error de red al cargar plantilla',
      });
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const employees = data?.employees ?? [];

  const upcoming = useMemo(
    () => upcomingBirthdays(employees, today),
    [employees, today]
  );

  /** Cumpleaños en el mes del calendario (mes/día del DOB, año del cursor). */
  const birthdaysInMonth = useMemo(() => {
    const map = new Map<number, typeof upcoming>();
    for (const e of employees) {
      const dob = e.fecha_nacimiento
        ? String(e.fecha_nacimiento).slice(0, 10)
        : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) continue;
      const m = Number(dob.slice(5, 7));
      const d = Number(dob.slice(8, 10));
      if (m !== calCursor.month) continue;
      const entry = upcoming.find((u) => u.employee_id === e.id);
      const row = entry || {
        employee_id: e.id,
        full_name: e.full_name,
        puesto: e.puesto,
        area: e.area,
        fecha_nacimiento: dob,
        next_date: `${calCursor.year}-${dob.slice(5)}`,
        days_until: 0,
      };
      const list = map.get(d) || [];
      list.push(row);
      map.set(d, list);
    }
    return map;
  }, [employees, calCursor.month, calCursor.year, upcoming]);

  const missingDob = useMemo(() => {
    return employees
      .filter((e) => !e.fecha_nacimiento)
      .slice()
      .sort((a, b) =>
        formatHrListName(a.full_name).localeCompare(
          formatHrListName(b.full_name),
          'es'
        )
      );
  }, [employees]);

  const cells = useMemo(
    () => monthCells(calCursor.year, calCursor.month),
    [calCursor.year, calCursor.month]
  );

  const shiftMonth = (delta: number) => {
    setCalCursor((c) => {
      let m = c.month + delta;
      let y = c.year;
      if (m < 1) {
        m = 12;
        y -= 1;
      } else if (m > 12) {
        m = 1;
        y += 1;
      }
      return { year: y, month: m };
    });
  };

  const saveDob = async (employeeId: string) => {
    const iso = (draftDob[employeeId] || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      setSaveMsg('Elige una fecha de nacimiento válida.');
      return;
    }
    setSavingId(employeeId);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/hr/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: employeeId, fecha_nacimiento: iso }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveMsg(json.error || 'No se pudo guardar');
        return;
      }
      setDraftDob((prev) => {
        const next = { ...prev };
        delete next[employeeId];
        return next;
      });
      await refresh({ softFill: false });
      setSaveMsg('Fecha de nacimiento guardada.');
    } catch {
      setSaveMsg('Error de red al guardar');
    } finally {
      setSavingId(null);
    }
  };

  const schemaHint =
    data?.nacimientoColumnMissing === true ||
    data?.code === 'nacimiento_schema_missing' ||
    data?.code === 'schema_missing' ||
    (typeof data?.error === 'string' &&
      /fecha_nacimiento/i.test(data.error || ''));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.title }}>
          Cumpleaños del Staff
        </h2>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>
          Plantilla vigente · próximos primero · fecha desde alta / expediente
        </p>
      </div>

      {schemaHint ? (
        <SuiteCard>
          <p className="text-sm text-amber-800">
            Falta la columna de nacimiento. Ejecuta{' '}
            <code className="rounded bg-amber-50 px-1 text-xs">
              supabase/hr_employee_nacimiento.sql
            </code>{' '}
            en Supabase.
          </p>
        </SuiteCard>
      ) : null}

      {saveMsg ? (
        <p className="text-sm" style={{ color: SUITE.navy }}>
          {saveMsg}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Próximos cumpleaños
          </h3>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Del más cercano al más lejano
          </p>

          <UpcomingBirthdaysList
            upcoming={upcoming}
            loading={loading}
            emptyMessage="Sin fechas de nacimiento en plantilla. Captúralas abajo."
          />
        </SuiteCard>

        <SuiteCard>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold" style={{ color: theme.title }}>
              Calendario
            </h3>
            <p className="text-xs" style={{ color: theme.muted }}>
              {upcoming.length} con fecha
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="min-h-10 rounded-xl px-3 text-sm font-bold"
              style={{
                backgroundColor: SUITE.orangeSoft,
                color: SUITE.navy,
              }}
            >
              ←
            </button>
            <p
              className="text-sm font-bold capitalize"
              style={{ color: theme.title }}
            >
              {monthLabel(calCursor.year, calCursor.month)}
            </p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="min-h-10 rounded-xl px-3 text-sm font-bold"
              style={{
                backgroundColor: SUITE.orangeSoft,
                color: SUITE.navy,
              }}
            >
              →
            </button>
          </div>

          <div
            className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: theme.muted }}
          >
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((iso, idx) => {
              if (!iso) {
                return <div key={`e-${idx}`} className="min-h-11" />;
              }
              const day = Number(iso.slice(8, 10));
              const isToday = iso === today;
              const hits = birthdaysInMonth.get(day) || [];
              const hasBday = hits.length > 0;
              const tip = hasBday
                ? hits.map((h) => formatHrListName(h.full_name)).join(', ')
                : undefined;
              return (
                <div
                  key={iso}
                  title={tip}
                  className="flex min-h-11 flex-col items-center justify-center rounded-lg text-sm tabular-nums"
                  style={{
                    backgroundColor: hasBday
                      ? SUITE.orangeSoft
                      : isToday
                        ? '#e8eef8'
                        : '#fff',
                    color: hasBday ? SUITE.navy : theme.title,
                    border: `1px solid ${
                      hasBday
                        ? SUITE.orange
                        : isToday
                          ? SUITE.navy
                          : '#e2e8f0'
                    }`,
                    fontWeight: hasBday || isToday ? 700 : 500,
                  }}
                >
                  <span>{day}</span>
                  {hasBday ? (
                    <span
                      className="mt-0.5 text-[10px] font-semibold leading-none"
                      style={{ color: SUITE.orangeDeep }}
                    >
                      {hits.length > 1 ? `${hits.length}` : '•'}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SuiteCard>
      </div>

      {missingDob.length > 0 ? (
        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Sin fecha de nacimiento
          </h3>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            {missingDob.length} en plantilla vigente.
          </p>
          <ul className="mt-4 space-y-3">
            {missingDob.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-3 last:border-0"
              >
                <div className="min-w-[10rem] flex-1">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: theme.title }}
                  >
                    {formatHrListName(e.full_name)}
                  </p>
                  <p className="text-xs" style={{ color: theme.muted }}>
                    {formatHrPuesto(e.puesto) || e.area || '—'}
                  </p>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-600">
                    Fecha de nacimiento
                  </span>
                  <input
                    type="date"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    value={draftDob[e.id] || ''}
                    onChange={(ev) =>
                      setDraftDob((prev) => ({
                        ...prev,
                        [e.id]: ev.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={savingId === e.id || !draftDob[e.id]}
                  onClick={() => saveDob(e.id)}
                  className="min-h-10 rounded-xl px-3.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  {savingId === e.id ? 'Guardando…' : 'Guardar'}
                </button>
              </li>
            ))}
          </ul>
        </SuiteCard>
      ) : null}

      {!loading && employees.length === 0 && data?.message ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          {data.message}
        </p>
      ) : null}
    </div>
  );
}
