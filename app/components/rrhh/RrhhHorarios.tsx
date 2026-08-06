'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { RrhhHorariosMobile } from '@/app/components/rrhh/RrhhHorariosMobile';
import {
  addIsoDays,
  formatHrDate,
  formatHrPuesto,
  isCurrentScheduleWeek,
  isPastScheduleWeek,
  scheduleWeekStatusLabel,
  todayIsoCdmx,
  type HrEmployee,
  type HrScheduleShift,
  type HrScheduleStatus,
  type HrScheduleWeek,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import {
  findLimpiezaServicioConflicts,
  hasDualLimpiezaServicio,
} from '@/app/lib/hr-puestos';
import { weekNumberForHorariosMonday } from '@/app/lib/hr-schedule-import';
import {
  mondayOfWeek,
  sundayOfWeek,
  weekDateList,
} from '@/app/lib/hr-schedule-propose';
import {
  DAY_HEADERS,
  areaSortKey,
  buildRowsFromShifts,
  comparePersonRows,
  cycleDayAbsence,
  emptyDay,
  formatRowHours,
  isVacationDay,
  personRowKey,
  resolveRowSection,
  rowDayHasOverlapConflict,
  rowHasDualShifts,
  rowHours,
  rowsToShifts,
  serializeGrid,
  vacationDay,
  type DayCell,
  type DualRoleTrack,
  type PersonRow,
} from '@/app/lib/hr-schedule-grid';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

function statusStyle(status: HrScheduleStatus): { bg: string; color: string } {
  switch (status) {
    case 'publicado':
      return { bg: '#ecfdf5', color: '#065f46' };
    case 'borrador':
      return { bg: '#eff6ff', color: '#1e40af' };
    default:
      return { bg: SUITE.orangeSoft, color: SUITE.navy };
  }
}

type PayrollPrepToast = {
  skipped?: boolean;
  created?: boolean;
  refreshed?: boolean;
  lineCount?: number;
  reason?: string;
};

/** Sufijo de toast cuando Publicar prepara nómina borrador. */
function payrollPrepToast(prep: PayrollPrepToast | undefined): string {
  if (!prep || prep.skipped) return '';
  const n = prep.lineCount ?? 0;
  if (prep.created) return ` · Nómina borrador lista (${n} líneas)`;
  if (prep.refreshed) return ` · Nómina borrador actualizada (${n} líneas)`;
  return '';
}

/** Badge: pasada → Publicado; en curso → En curso; futura → Borrador hasta Publicar. */
function weekStatusBadge(
  status: HrScheduleStatus,
  weekStart: string,
  weekEnd?: string
): { label: string; bg: string; color: string } {
  if (isCurrentScheduleWeek(weekStart)) {
    return { label: 'En curso', bg: '#fef3c7', color: '#92400e' };
  }
  const end = weekEnd || addIsoDays(weekStart.slice(0, 10), 6);
  if (isPastScheduleWeek(end)) {
    const st = statusStyle('publicado');
    return { label: 'Publicado', bg: st.bg, color: st.color };
  }
  const st = statusStyle(status);
  return {
    label: scheduleWeekStatusLabel(status, weekStart, todayIsoCdmx(), end),
    bg: st.bg,
    color: st.color,
  };
}

function weekLabel(w: Pick<HrScheduleWeek, 'week_start' | 'week_number'>): string {
  const n =
    w.week_number ?? weekNumberForHorariosMonday(w.week_start) ?? null;
  return n != null ? `SEMANA ${n}` : `Semana ${w.week_start.slice(5)}`;
}

export function RrhhHorarios() {
  const currentMonday = useMemo(() => mondayOfWeek(todayIsoCdmx()), []);
  const currentYear = Number(currentMonday.slice(0, 4)) || 2026;

  const [year, setYear] = useState(currentYear);
  const [yearOptions, setYearOptions] = useState<number[]>([currentYear]);
  const [weeks, setWeeks] = useState<HrScheduleWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [weekDetail, setWeekDetail] = useState<HrScheduleWeek | null>(null);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('[]');

  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [importReady, setImportReady] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [softLoading, setSoftLoading] = useState(false);

  const [showNewWeek, setShowNewWeek] = useState(false);
  const [newWeekDate, setNewWeekDate] = useState(currentMonday);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addEmpId, setAddEmpId] = useState('');
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);

  const dates = useMemo(
    () =>
      weekDetail
        ? weekDateList(weekDetail.week_start)
        : weekDateList(currentMonday),
    [weekDetail, currentMonday]
  );

  const dirty =
    weekDetail != null && serializeGrid(rows) !== savedSnapshot;

  /** Semanas con week_end &lt; hoy CDMX: histórico solo lectura. */
  const pastLocked =
    weekDetail != null && isPastScheduleWeek(weekDetail.week_end);

  /** Por columna: fecha civil &lt; hoy CDMX → Ent/Sal/DESCANSO/VACACIONES solo lectura. */
  const dayLocked = useMemo(() => {
    const today = todayIsoCdmx();
    return dates.map((d) => d.slice(0, 10) < today);
  }, [dates]);

  const totalHours = useMemo(
    () =>
      Math.round(
        rows.reduce((sum, r) => sum + rowHours(r), 0) * 10
      ) / 10,
    [rows]
  );

  const shiftCount = useMemo(
    () =>
      rows.reduce((n, r) => {
        let c = 0;
        for (const d of r.days) {
          if (d.off) continue;
          if (d.start && d.end) c += 1;
          c += (d.extra || []).filter((e) => e.start && e.end).length;
        }
        return n + c;
      }, 0),
    [rows]
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

  const employeesNotInGrid = useMemo(() => {
    const ids = new Set(rows.map((r) => r.employee_id));
    return employees.filter((e) => !ids.has(e.id));
  }, [employees, rows]);

  const refreshEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/employees', { cache: 'no-store' });
      const json = await res.json();
      let list: HrEmployee[] = json.employees || [];
      if (list.length === 0) {
        const res2 = await fetch('/api/hr/employees?source=activos', {
          cache: 'no-store',
        });
        const json2 = await res2.json();
        list = json2.employees || [];
      }
      setEmployees(list);
      return list;
    } catch {
      setEmployees([]);
      return [] as HrEmployee[];
    }
  }, []);

  const refreshImportProbe = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/schedules/import', { cache: 'no-store' });
      const json = await res.json();
      setImportReady(Boolean(json.ready));
      setImportNote(json.note || null);
    } catch {
      setImportReady(false);
      setImportNote(null);
    }
  }, []);

  const refreshWeeks = useCallback(
    async (
      y: number
    ): Promise<{ list: HrScheduleWeek[]; schemaMissing: boolean }> => {
      setLoading(true);
      try {
        const res = await fetch(`/api/hr/schedules?year=${y}&limit=500`, {
          cache: 'no-store',
        });
        const json = await res.json();
        const list: HrScheduleWeek[] = json.weeks || [];
        const missing = Boolean(json.schemaMissing);
        setWeeks(list);
        setSchemaMissing(missing);
        if (Array.isArray(json.years) && json.years.length) {
          const ys = [...new Set([...(json.years as number[]), y, currentYear, 2026])]
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => b - a);
          setYearOptions(ys);
        } else {
          setYearOptions((prev) =>
            [...new Set([...prev, y, currentYear, 2026])]
              .filter((n) => Number.isFinite(n))
              .sort((a, b) => b - a)
          );
        }
        if (!json.ready) {
          setMessage(
            json.message ||
              'Faltan tablas de RR.HH. Ejecuta supabase/hr_module.sql en Supabase.'
          );
        } else if (list.length === 0 && json.message) {
          setMessage(json.message);
        } else {
          setMessage(null);
        }
        return { list, schemaMissing: missing };
      } catch {
        setMessage('Error de red al cargar horarios');
        setSchemaMissing(false);
        setWeeks([]);
        return { list: [], schemaMissing: false };
      } finally {
        setLoading(false);
      }
    },
    [currentYear]
  );

  /** Soft-load: si el año está vacío y hay xlsx local, importa sin replace. */
  const ensureYearFromLocal = useCallback(
    async (y: number, opts?: { refreshExisting?: boolean; silent?: boolean }) => {
      setSoftLoading(true);
      try {
        const res = await fetch('/api/hr/schedules/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ensure_year',
            year: y,
            refreshExisting: opts?.refreshExisting === true,
            createMissing: true,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (!opts?.silent) {
            setToast(
              json.message ||
                json.error ||
                (res.status === 503
                  ? 'Faltan tablas de RR.HH. Ejecuta supabase/hr_module.sql en Supabase.'
                  : 'No se pudo cargar el archivo local de horarios')
            );
          }
          if (json.message || json.error) {
            setMessage(json.message || json.error);
          }
          return false;
        }
        if (
          !opts?.silent &&
          (json.weeksImported > 0 || json.shiftsImported > 0)
        ) {
          setToast(json.message || 'Histórico de horarios cargado');
        }
        return true;
      } catch {
        if (!opts?.silent) setToast('Error de red al importar horarios');
        return false;
      } finally {
        setSoftLoading(false);
      }
    },
    []
  );

  const applyLoadedWeek = useCallback(
    (week: HrScheduleWeek, shifts: HrScheduleShift[], emps: HrEmployee[]) => {
      setWeekDetail(week);
      setSelectedId(week.id);
      // Solo sembrar plantilla vigente en semanas futuras (nueva planificación).
      // Histórico / en curso: filas = quienes tienen turnos esa semana.
      const seedPlantilla =
        !isPastScheduleWeek(week.week_end || addIsoDays(week.week_start, 6)) &&
        !isCurrentScheduleWeek(week.week_start);
      const next = buildRowsFromShifts(
        emps,
        shifts,
        weekDateList(week.week_start),
        { seedPlantilla }
      );
      setRows(next);
      setSavedSnapshot(serializeGrid(next));
      const y = Number(week.week_start.slice(0, 4));
      if (Number.isFinite(y) && y !== year) setYear(y);
    },
    [year]
  );

  const clearWorkspace = useCallback(() => {
    setWeekDetail(null);
    setSelectedId(null);
    setRows([]);
    setSavedSnapshot('[]');
  }, []);

  const loadWeekById = useCallback(
    async (
      id: string,
      opts?: { emps?: HrEmployee[]; force?: boolean }
    ) => {
      if (!opts?.force && dirty) {
        if (
          !confirm(
            'Hay cambios sin guardar. ¿Descartarlos y cambiar de semana?'
          )
        ) {
          return;
        }
      }
      setBusy(true);
      try {
        const res = await fetch(`/api/hr/schedules/${id}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok || !json.ready) {
          setToast(json.error || json.message || 'No se pudo cargar la semana');
          clearWorkspace();
          return;
        }
        const staff = opts?.emps ?? employees;
        applyLoadedWeek(json.week, json.shifts || [], staff);
      } catch {
        setToast('Error de red');
        clearWorkspace();
      } finally {
        setBusy(false);
      }
    },
    [dirty, employees, applyLoadedWeek, clearWorkspace]
  );

  useEffect(() => {
    void (async () => {
      // Plantilla + semanas en paralelo; probe de xlsx solo si el año está vacío
      const [emps, weeksResult] = await Promise.all([
        refreshEmployees(),
        refreshWeeks(year),
      ]);
      let { list, schemaMissing: missing } = weeksResult;

      // Soft-load SOLO si no hay semanas (nunca si el año ya tiene histórico)
      if (list.length === 0 && !missing) {
        await refreshImportProbe();
        const probe = await fetch('/api/hr/schedules/import', {
          cache: 'no-store',
        })
          .then((r) => r.json())
          .catch(() => null);
        const fileYear =
          probe?.selectedYear === year ||
          (probe?.localFiles || []).some(
            (f: { year: number }) => f.year === year
          ) ||
          (year === 2026 && probe?.ready);
        if (probe?.ready && fileYear) {
          setMessage(`Cargando HORARIOS C50 ${year} desde Descargas…`);
          const ok = await ensureYearFromLocal(year, { silent: true });
          ({ list } = await refreshWeeks(year));
          if (ok && list.length > 0) {
            setToast(
              `Histórico cargado: ${list.length} semanas de ${year}`
            );
          } else if (!ok && probe?.note) {
            setMessage(probe.note);
          }
        } else if (probe && !probe.ready) {
          setMessage(
            probe.note ||
              `Sin semanas en ${year}. Coloca «HORARIOS C50 ${year}.xlsx» en Descargas e importa.`
          );
        }
      } else {
        // Año ya tiene semanas: probe en background (botón import), sin bloquear
        void refreshImportProbe();
      }

      if (list.length === 0) clearWorkspace();
      else {
        const curso =
          list.find((w) => w.week_start === currentMonday) || list[0];
        if (curso) await loadWeekById(curso.id, { emps, force: true });
      }
    })();
    // Montaje inicial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeYear(y: number) {
    if (dirty && !confirm('Hay cambios sin guardar. ¿Continuar?')) return;
    setYear(y);
    clearWorkspace();
    let { list } = await refreshWeeks(y);
    if (list.length === 0 && importReady) {
      setMessage(`Cargando HORARIOS C50 ${y} desde Descargas…`);
      await ensureYearFromLocal(y, { silent: true });
      ({ list } = await refreshWeeks(y));
      if (list.length > 0) {
        setToast(`Histórico cargado: ${list.length} semanas de ${y}`);
        const curso =
          list.find((w) => w.week_start === currentMonday) || list[0];
        if (curso) await loadWeekById(curso.id, { force: true });
      }
    }
  }

  async function selectWeek(id: string) {
    if (id === selectedId && weekDetail) return;
    await loadWeekById(id);
  }

  async function importHorarios2026() {
    setBusy(true);
    setToast(null);
    try {
      const ok = await ensureYearFromLocal(2026, {
        refreshExisting: true,
        silent: false,
      });
      setYear(2026);
      const { list } = await refreshWeeks(2026);
      await refreshEmployees();
      await refreshImportProbe();
      if (!ok && list.length === 0) {
        return;
      }
      if (ok) {
        setToast(
          list.length > 0
            ? `Importación lista · ${list.length} semanas`
            : 'Importación terminó sin semanas'
        );
      }
      const curso =
        list.find((w) => w.week_start === currentMonday) || list[0];
      if (curso) await loadWeekById(curso.id, { force: true });
      else clearWorkspace();
    } catch {
      setToast('Error de red al importar');
    } finally {
      setBusy(false);
    }
  }

  async function createNewWeek() {
    const monday = mondayOfWeek(newWeekDate || currentMonday);
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch('/api/hr/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: monday }),
      });
      const json = await res.json();
      if (res.status === 409 && json.weekId) {
        setToast(json.message || 'Semana ya existe');
        setShowNewWeek(false);
        const y = Number(monday.slice(0, 4));
        if (y !== year) setYear(y);
        await refreshWeeks(y || year);
        await loadWeekById(String(json.weekId), { force: true });
        return;
      }
      if (!res.ok) {
        setToast(json.error || json.message || 'No se pudo crear');
        return;
      }
      setToast(json.message || 'Semana creada');
      setShowNewWeek(false);
      const y = Number(monday.slice(0, 4)) || year;
      setYear(y);
      await refreshWeeks(y);
      if (json.week) {
        applyLoadedWeek(json.week, json.shifts || [], employees);
      }
    } catch {
      setToast('Error de red');
    } finally {
      setBusy(false);
    }
  }

  async function saveShifts() {
    if (!weekDetail || pastLocked || !dirty) return;
    if (!confirm('¿Guardar los cambios en el horario?')) return;
    const shifts = rowsToShifts(rows, dates);
    const dualIds = new Set(
      rows.filter((r) => r.dualLimpiezaServicio).map((r) => r.employee_id)
    );
    const conflicts = findLimpiezaServicioConflicts(shifts, dualIds);
    if (conflicts.length > 0) {
      setToast(conflicts[0]!.message);
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      // En curso → publicar al Guardar; futuras quedan borrador hasta Publicar.
      const body: Record<string, unknown> = { shifts };
      if (isCurrentScheduleWeek(weekDetail.week_start)) {
        body.status = 'publicado';
      }
      const res = await fetch(`/api/hr/schedules/${weekDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo guardar');
        return;
      }
      if (json.week) setWeekDetail(json.week);
      const seedPlantilla =
        !isPastScheduleWeek(
          weekDetail.week_end || addIsoDays(weekDetail.week_start, 6)
        ) && !isCurrentScheduleWeek(weekDetail.week_start);
      const next = buildRowsFromShifts(
        employees,
        json.shifts || shifts,
        dates,
        { seedPlantilla }
      );
      setRows(next);
      setSavedSnapshot(serializeGrid(next));
      const payrollNote = payrollPrepToast(
        json.payroll as PayrollPrepToast | undefined
      );
      setToast(
        json.week?.status === 'publicado'
          ? isCurrentScheduleWeek(weekDetail.week_start)
            ? `Horario guardado (en curso / publicado)${payrollNote}`
            : `Horario guardado y publicado${payrollNote}`
          : 'Horario guardado (borrador · usa Publicar para Staff)'
      );
      await refreshWeeks(year);
    } catch {
      setToast('Error de red');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: HrScheduleStatus) {
    if (!weekDetail || pastLocked) return;
    if (status !== 'publicado') return;
    if (dirty) {
      setToast('Guarda los turnos antes de publicar.');
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/hr/schedules/${weekDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo cambiar estatus');
        return;
      }
      setWeekDetail(json.week);
      const payrollNote = payrollPrepToast(
        json.payroll as PayrollPrepToast | undefined
      );
      setToast(`Publicado · visible en Staff → Mi horario${payrollNote}`);
      await refreshWeeks(year);
    } catch {
      setToast('Error de red');
    } finally {
      setBusy(false);
    }
  }

  async function deleteWeek() {
    if (!weekDetail || pastLocked) return;
    if (weekDetail.status === 'publicado') {
      setToast('No se puede eliminar un horario publicado');
      return;
    }
    if (!confirm('¿Eliminar esta semana del histórico?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/schedules/${weekDetail.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo eliminar');
        return;
      }
      clearWorkspace();
      await refreshWeeks(year);
      setToast('Semana eliminada');
    } catch {
      setToast('Error de red');
    } finally {
      setBusy(false);
    }
  }

  function updateCell(
    rowKey: string,
    dayIndex: number,
    patch: Partial<DayCell>
  ) {
    if (pastLocked || dayLocked[dayIndex]) return;
    setRows((prev) => {
      const nextRows = prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const days = r.days.map((d, i) => {
          if (i !== dayIndex) return d;
          const next = { ...d, ...patch };
          if (patch.vacation === true) {
            next.start = '';
            next.end = '';
            next.off = true;
            next.vacation = true;
            next.extra = undefined;
            next.role = undefined;
          } else if (patch.off === true) {
            next.start = '';
            next.end = '';
            next.off = true;
            next.vacation = false;
            next.extra = undefined;
            next.role = undefined;
          } else if (patch.start !== undefined || patch.end !== undefined) {
            next.vacation = false;
            next.off = !(next.start || next.end);
            if (next.off) {
              next.extra = undefined;
              next.role = undefined;
            }
          }
          return next;
        });
        return { ...r, days };
      });
      const row = nextRows.find((r) => r.rowKey === rowKey);
      if (row && rowDayHasOverlapConflict(row, dayIndex, nextRows)) {
        setToast(
          'Candado: Limpieza y servicio no pueden solaparse el mismo día.'
        );
        return prev;
      }
      return nextRows;
    });
  }

  function toggleOff(rowKey: string, dayIndex: number) {
    if (pastLocked || dayLocked[dayIndex]) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const days = [...r.days];
        days[dayIndex] = cycleDayAbsence(days[dayIndex]);
        return { ...r, days };
      })
    );
  }

  /** Móvil: copia el día editado al resto de la semana (respeta días bloqueados). */
  function applyCellToWeek(rowKey: string, cell: DayCell) {
    if (pastLocked) return;
    setRows((prev) => {
      const nextRows = prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const days = r.days.map((d, i) =>
          dayLocked[i]
            ? d
            : { ...cell, extra: cell.extra ? [...cell.extra] : undefined }
        );
        return { ...r, days };
      });
      const row = nextRows.find((r) => r.rowKey === rowKey);
      if (row) {
        for (let i = 0; i < 7; i++) {
          if (dayLocked[i]) continue;
          if (rowDayHasOverlapConflict(row, i, nextRows)) {
            setToast(
              'Candado: Limpieza y servicio no pueden solaparse el mismo día.'
            );
            return prev;
          }
        }
      }
      return nextRows;
    });
  }

  function setVacation(rowKey: string, dayIndex: number) {
    if (pastLocked || dayLocked[dayIndex]) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== rowKey) return r;
        const days = [...r.days];
        days[dayIndex] = vacationDay();
        return { ...r, days };
      })
    );
  }

  function addPersonToGrid() {
    if (pastLocked || !addEmpId || !weekDetail) return;
    const emp = employees.find((e) => e.id === addEmpId);
    if (!emp) return;
    if (rows.some((r) => r.employee_id === emp.id)) {
      setToast('Ya está en la grilla');
      return;
    }
    const dual = hasDualLimpiezaServicio(emp);
    const tracks: Array<DualRoleTrack | null> = dual
      ? ['servicio', 'limpieza']
      : [null];
    const added: PersonRow[] = tracks.map((track) => {
      const resolved = resolveRowSection(
        emp,
        [],
        [],
        emp.full_name,
        track
      );
      return {
        rowKey: personRowKey(emp.id, track),
        employee_id: emp.id,
        full_name: emp.full_name,
        area: resolved.section,
        puesto: resolved.puesto || emp.puesto,
        dualLimpiezaServicio: dual,
        dualTrack: track,
        days: dates.map(() => emptyDay()),
      };
    });
    setRows((prev) => [...prev, ...added].sort(comparePersonRows));
    setAddEmpId('');
  }

  const nextMonday = addIsoDays(currentMonday, 7);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold" style={{ color: theme.title }}>
            Horarios
          </h3>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            Histórico de semanas · grilla tipo Excel (Lun–Dom / Ent.–Sal.)
          </p>
        </div>
        <div className="relative flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold" style={{ color: theme.muted }}>
            Año
            <select
              className="mt-1 block min-w-[5.5rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={year}
              disabled={busy || loading}
              onChange={(e) => void changeYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setNewWeekDate(nextMonday);
              setShowNewWeek((v) => !v);
            }}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: SUITE.navy }}
          >
            Nueva semana
          </button>
          {weeks.length === 0 && !loading && !softLoading ? (
            <button
              type="button"
              disabled={busy || softLoading}
              onClick={() => void importHorarios2026()}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#9a3412' }}
              title={
                importNote ||
                'Importa HORARIOS C50 2026 desde Descargas'
              }
            >
              Importar horarios 2026
            </button>
          ) : weeks.length > 0 ? (
            <>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
                style={{ color: theme.title }}
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen((v) => !v)}
              >
                Más…
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  style={{ boxShadow: SUITE.shadow }}
                >
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy || softLoading}
                    title={
                      importNote ||
                      'Relee HORARIOS C50 2026.xlsx y actualiza semanas/turnos'
                    }
                    onClick={() => {
                      setMenuOpen(false);
                      void importHorarios2026();
                    }}
                  >
                    {softLoading
                      ? 'Actualizando…'
                      : 'Actualizar desde Excel 2026'}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {toast && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
          {toast}
        </p>
      )}
      {message && (
        <SuiteCard accent className="max-w-3xl">
          <p className="text-sm" style={{ color: theme.muted }}>
            {message}
          </p>
          {schemaMissing && (
            <p className="mt-2 text-sm font-semibold text-red-800">
              Ejecuta <code className="text-xs">supabase/hr_module.sql</code> en
              Supabase y recarga.
            </p>
          )}
        </SuiteCard>
      )}

      {showNewWeek && (
        <SuiteCard className="max-w-xl">
          <p className="text-sm font-bold" style={{ color: theme.title }}>
            Nueva semana
          </p>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Se copian los turnos de la semana anterior (misma gente / Ent–Sal /
            DESCANSO / VACACIONES). Puedes editar después. Futuras quedan en borrador hasta
            Publicar.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs mb-1" style={{ color: theme.muted }}>
                Fecha (se usa el lunes de esa semana)
              </span>
              <input
                type="date"
                value={newWeekDate}
                onChange={(e) => setNewWeekDate(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
              onClick={() => setNewWeekDate(currentMonday)}
            >
              Semana en curso
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
              onClick={() => setNewWeekDate(nextMonday)}
            >
              Próxima semana
            </button>
            <button
              type="button"
              disabled={busy || !newWeekDate}
              onClick={() => void createNewWeek()}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: SUITE.orangeDeep }}
            >
              Crear
            </button>
            <button
              type="button"
              className="text-sm font-semibold text-slate-600"
              onClick={() => setShowNewWeek(false)}
            >
              Cancelar
            </button>
          </div>
          <p className="mt-2 text-xs" style={{ color: theme.muted }}>
            Lunes: {formatHrDate(mondayOfWeek(newWeekDate || currentMonday))} –{' '}
            {formatHrDate(sundayOfWeek(mondayOfWeek(newWeekDate || currentMonday)))}
          </p>
        </SuiteCard>
      )}

      {/* Selector de semana compacto (móvil): el histórico largo estorba al editar */}
      {weeks.length > 0 && (
        <div className="lg:hidden">
          <button
            type="button"
            disabled={busy}
            aria-expanded={weekPickerOpen}
            onClick={() => setWeekPickerOpen((v) => !v)}
            className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl bg-white px-3 text-left disabled:opacity-50"
            style={{ boxShadow: SUITE.shadow }}
          >
            <span className="min-w-0">
              <span
                className="block truncate text-sm font-bold"
                style={{ color: theme.title }}
              >
                {weekDetail ? weekLabel(weekDetail) : 'Elige una semana'}
              </span>
              {weekDetail && (
                <span className="block text-xs" style={{ color: theme.muted }}>
                  {formatHrDate(weekDetail.week_start)} –{' '}
                  {formatHrDate(weekDetail.week_end)}
                </span>
              )}
            </span>
            <span
              className="shrink-0 text-xs font-bold"
              style={{ color: SUITE.navy }}
            >
              {weekPickerOpen ? 'Cerrar' : 'Cambiar'}
            </span>
          </button>
          {weekPickerOpen && (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {weeks.map((w) => (
                <li key={w.id}>
                  <WeekButton
                    week={w}
                    active={w.id === selectedId}
                    disabled={busy}
                    onSelect={() => {
                      setWeekPickerOpen(false);
                      void selectWeek(w.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        {/* Histórico (en móvil se sustituye por el selector compacto de arriba) */}
        <aside
          className={
            weeks.length > 0 ? 'hidden space-y-2 lg:block' : 'space-y-2'
          }
        >
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-bold" style={{ color: theme.title }}>
              Histórico
            </h4>
            <span className="text-xs" style={{ color: theme.muted }}>
              {weeks.length} semana{weeks.length === 1 ? '' : 's'}
            </span>
          </div>
          {loading || softLoading ? (
            <p className="text-sm" style={{ color: theme.muted }}>
              {softLoading
                ? `Importando HORARIOS C50 ${year}…`
                : 'Cargando…'}
            </p>
          ) : weeks.length === 0 ? (
            <SuiteCard>
              <p className="text-sm font-semibold" style={{ color: theme.title }}>
                {schemaMissing
                  ? 'Tablas de RR.HH. no encontradas'
                  : `Sin semanas en ${year}`}
              </p>
              <p className="mt-2 text-sm" style={{ color: theme.muted }}>
                {schemaMissing
                  ? 'Ejecuta supabase/hr_module.sql en Supabase.'
                  : importReady
                    ? `Hay archivo local listo${importNote ? ` (${importNote})` : ''}. Pulsa el botón para cargar el histórico.`
                    : importNote ||
                      `Coloca «HORARIOS C50 ${year}.xlsx» en Descargas, o crea una semana nueva.`}
              </p>
              {!schemaMissing && (
                <button
                  type="button"
                  disabled={busy || softLoading}
                  onClick={() => void importHorarios2026()}
                  className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#9a3412' }}
                >
                  {importReady
                    ? 'Cargar histórico 2026'
                    : 'Reintentar importación'}
                </button>
              )}
            </SuiteCard>
          ) : (
            <ul
              className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1"
              role="listbox"
              aria-label="Semanas de horario"
            >
              {weeks.map((w) => (
                <li key={w.id}>
                  <WeekButton
                    week={w}
                    active={w.id === selectedId}
                    disabled={busy}
                    onSelect={() => void selectWeek(w.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Editor */}
        <main className="min-w-0 space-y-3">
          {!weekDetail ? (
            <SuiteCard className="max-w-2xl">
              <p className="text-sm font-bold" style={{ color: theme.title }}>
                Elige una semana del histórico o crea una nueva
              </p>
              <p className="mt-2 text-sm" style={{ color: theme.muted }}>
                El histórico pasado es solo lectura. Ajusta turnos en la semana
                en curso o futuras (Ent./Sal. como el Excel de HORARIOS).
              </p>
            </SuiteCard>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4
                  className="text-base font-bold"
                  style={{ color: theme.title }}
                >
                  {weekLabel(weekDetail)}
                </h4>
                {(() => {
                  const badge = weekStatusBadge(
                    weekDetail.status,
                    weekDetail.week_start,
                    weekDetail.week_end
                  );
                  return (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-bold uppercase"
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  );
                })()}
                <span className="text-sm" style={{ color: theme.muted }}>
                  {formatHrDate(weekDetail.week_start)} –{' '}
                  {formatHrDate(weekDetail.week_end)}
                  {' · '}
                  {shiftCount} turnos ·{' '}
                  {totalHours > 0 ? `${totalHours} h` : '0 h'}
                </span>
                {pastLocked && (
                  <span className="text-xs font-semibold text-slate-600">
                    Solo lectura
                  </span>
                )}
                {!pastLocked && dirty && (
                  <span className="text-xs font-semibold text-amber-800">
                    Sin guardar
                  </span>
                )}
              </div>

              {!pastLocked && (
                <div className="hidden flex-wrap gap-2 lg:flex">
                  {dirty && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveShifts()}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: SUITE.navy }}
                    >
                      Guardar
                    </button>
                  )}
                  {weekDetail.status !== 'publicado' && (
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => void setStatus('publicado')}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: '#065f46' }}
                    >
                      Publicar
                    </button>
                  )}
                  {weekDetail.status !== 'publicado' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteWeek()}
                      className="rounded-xl px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
                      style={{ backgroundColor: '#fef2f2' }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              )}

              {/* Editor táctil (celular): un día o una persona a la vez */}
              <RrhhHorariosMobile
                key={weekDetail.id}
                rows={rows}
                dates={dates}
                readOnly={pastLocked}
                dayLocked={dayLocked}
                todayIso={todayIsoCdmx()}
                onCell={updateCell}
                onApplyWeek={applyCellToWeek}
              />

              {/* Grilla Excel (escritorio) */}
              <div
                className="hidden overflow-x-auto rounded-xl bg-white lg:block"
                style={{ boxShadow: SUITE.shadow }}
              >
                <table className="w-full min-w-[920px] border-collapse text-sm">
                  <thead>
                    <tr style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
                      <th
                        className="sticky left-0 z-10 px-2 py-2 text-left text-xs font-bold uppercase tracking-wide"
                        style={{ backgroundColor: SUITE.navy, minWidth: 140 }}
                      >
                        Nombre
                      </th>
                      {DAY_HEADERS.map((d, i) => (
                        <th
                          key={d}
                          colSpan={2}
                          className="border-l border-white/20 px-1 py-2 text-center text-xs font-bold uppercase"
                        >
                          <div>{d}</div>
                          <div className="font-normal opacity-80">
                            {dates[i]?.slice(5)}
                          </div>
                        </th>
                      ))}
                      <th
                        className="border-l border-white/20 px-2 py-2 text-center text-xs font-bold"
                        title="Horas asignadas = suma de Ent/Sal de la semana (solo lectura / fórmula)"
                      >
                        h
                      </th>
                    </tr>
                    <tr style={{ backgroundColor: '#1e3a5f', color: '#cbd5e1' }}>
                      <th
                        className="sticky left-0 z-10 px-2 py-1 text-left text-[10px] font-semibold"
                        style={{ backgroundColor: '#1e3a5f' }}
                      />
                      {DAY_HEADERS.map((d) => (
                        <FragmentDaySubHeaders key={d} />
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.length === 0 ? (
                      <tr>
                        <td
                          colSpan={16}
                          className="px-3 py-6 text-center text-sm"
                          style={{ color: theme.muted }}
                        >
                          Sin personal. Agrega personas con el selector de abajo.
                        </td>
                      </tr>
                    ) : (
                      grouped.map(({ area, people }) => (
                        <AreaFragment
                          key={area}
                          area={area}
                          people={people}
                          allRows={rows}
                          readOnly={pastLocked}
                          dayLocked={dayLocked}
                          onCell={updateCell}
                          onToggleOff={toggleOff}
                          onSetVacation={setVacation}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {!pastLocked && employeesNotInGrid.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm">
                    <span
                      className="block text-xs mb-1"
                      style={{ color: theme.muted }}
                    >
                      Agregar persona a la semana
                    </span>
                    <select
                      value={addEmpId}
                      onChange={(e) => setAddEmpId(e.target.value)}
                      className="rounded-lg border border-slate-200 px-2 py-2 text-sm max-w-[220px]"
                    >
                      <option value="">—</option>
                      {employeesNotInGrid.map((e) => (
                        <option key={e.id} value={e.id}>
                          {formatHrListName(e.full_name)}
                          {e.area ? ` · ${formatHrPuesto(e.area)}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !addEmpId}
                    onClick={addPersonToGrid}
                    className="rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: SUITE.navy }}
                  >
                    Agregar
                  </button>
                </div>
              )}

              <p className="text-xs" style={{ color: theme.muted }}>
                {pastLocked
                  ? 'Semana pasada: solo consulta. No se pueden editar Ent./Sal. La columna h suma las horas de los turnos.'
                  : 'Hoy y días futuros editables (CDMX). D = descanso · V = vacaciones · ciclo en la barra D→V→turno. Columna h = horas (nocturnos cruzan medianoche). Guardar aparece con cambios; en curso publica al guardar.'}
              </p>

              {/* Acciones fijas en celular: siempre al alcance del pulgar */}
              {!pastLocked && (
                <div
                  className="sticky bottom-0 z-30 -mx-1 flex items-center gap-2 border-t border-slate-200 bg-white/95 px-1 py-2 backdrop-blur lg:hidden"
                  style={{
                    paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
                  }}
                >
                  {dirty ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveShifts()}
                      className="min-h-12 flex-1 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                      style={{ backgroundColor: SUITE.navy }}
                    >
                      Guardar cambios
                    </button>
                  ) : (
                    <span
                      className="flex-1 text-xs font-semibold"
                      style={{ color: theme.muted }}
                    >
                      Sin cambios pendientes
                    </span>
                  )}
                  {weekDetail.status !== 'publicado' && (
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => void setStatus('publicado')}
                      className="min-h-12 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50"
                      style={{ backgroundColor: '#065f46' }}
                    >
                      Publicar
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function WeekButton({
  week,
  active,
  disabled,
  onSelect,
}: {
  week: HrScheduleWeek;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const badge = weekStatusBadge(week.status, week.week_start, week.week_end);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={disabled}
      onClick={onSelect}
      className="w-full rounded-xl bg-white px-3 py-2.5 text-left transition-shadow disabled:opacity-50"
      style={{
        boxShadow: SUITE.shadow,
        outline: active ? `2px solid ${SUITE.navy}` : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" style={{ color: theme.title }}>
          {weekLabel(week)}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{ backgroundColor: badge.bg, color: badge.color }}
        >
          {badge.label}
        </span>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
        {formatHrDate(week.week_start)} – {formatHrDate(week.week_end)}
      </p>
      <p className="mt-0.5 text-xs tabular-nums" style={{ color: theme.muted }}>
        {week.shift_count ?? 0} turnos
        {week.hours_total != null ? ` · ${week.hours_total} h` : ''}
      </p>
    </button>
  );
}

function FragmentDaySubHeaders() {
  return (
    <>
      <th className="border-l border-white/10 px-0.5 py-1 text-center text-[10px] font-semibold w-[4.5rem]">
        Ent.
      </th>
      <th className="px-0.5 py-1 text-center text-[10px] font-semibold w-[4.5rem]">
        Sal.
      </th>
    </>
  );
}

function AreaFragment({
  area,
  people,
  allRows,
  readOnly = false,
  dayLocked = [],
  onCell,
  onToggleOff,
  onSetVacation,
}: {
  area: string;
  people: PersonRow[];
  allRows: PersonRow[];
  readOnly?: boolean;
  /** true por índice Lun–Dom si la fecha civil ya pasó (CDMX). */
  dayLocked?: boolean[];
  onCell: (rowKey: string, day: number, patch: Partial<DayCell>) => void;
  onToggleOff: (rowKey: string, day: number) => void;
  onSetVacation: (rowKey: string, day: number) => void;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={16}
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
          className="border-t border-slate-100 hover:bg-slate-50/80"
        >
          <td
            className="sticky left-0 z-[1] bg-white px-2 py-1 text-sm font-medium whitespace-nowrap"
            style={{ color: theme.title, boxShadow: '1px 0 0 #e2e8f0' }}
          >
            {formatHrListName(p.full_name)}
            {p.dualLimpiezaServicio ? (
              <span
                className="ml-1 rounded border border-amber-300 bg-amber-50 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-900"
                title="Rol dual: Limpieza y servicio no pueden solaparse"
              >
                dual
              </span>
            ) : null}
          </td>
          {p.days.map((d, di) => {
            const cellLocked = readOnly || Boolean(dayLocked[di]);
            const overlapConflict = rowDayHasOverlapConflict(p, di, allRows);
            const vac = isVacationDay(d);
            if (d.off) {
              const barBg = vac ? '#e0f2fe' : '#fef3c7';
              const barFg = vac ? '#075985' : '#92400e';
              const barLabel = vac ? 'VACACIONES' : 'DESCANSO';
              const barTitle = cellLocked
                ? !readOnly && dayLocked[di]
                  ? 'Día pasado: solo consulta'
                  : undefined
                : vac
                  ? 'Clic para asignar turno (ciclo V→turno)'
                  : 'Clic para Vacaciones (ciclo D→V→turno)';
              return (
                <td
                  key={di}
                  colSpan={2}
                  className={`border-l border-slate-100 px-1 py-0.5 text-center${
                    cellLocked && !readOnly ? ' bg-slate-50/70' : ''
                  }`}
                >
                  {cellLocked ? (
                    <span
                      className="inline-block w-full rounded px-1 py-1.5 text-[11px] font-bold uppercase tracking-wide opacity-80"
                      style={{ backgroundColor: barBg, color: barFg }}
                      title={barTitle}
                    >
                      {barLabel}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onToggleOff(p.rowKey, di)}
                      className="w-full rounded px-1 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                      style={{ backgroundColor: barBg, color: barFg }}
                      title={barTitle}
                    >
                      {barLabel}
                    </button>
                  )}
                </td>
              );
            }
            return (
              <Fragment key={`${p.rowKey}-${di}`}>
                <td
                  className={`border-l border-slate-100 px-0.5 py-0.5${
                    cellLocked && !readOnly ? ' bg-slate-50/70' : ''
                  }${overlapConflict ? ' bg-rose-50' : ''}`}
                >
                  <input
                    type="time"
                    value={d.start}
                    disabled={cellLocked}
                    onChange={(e) =>
                      onCell(p.rowKey, di, { start: e.target.value })
                    }
                    title={
                      overlapConflict
                        ? 'Candado: turnos solapados (Limpieza ↔ servicio)'
                        : !readOnly && dayLocked[di]
                          ? 'Día pasado: solo consulta'
                          : undefined
                    }
                    className={`w-full min-w-[4.25rem] rounded border px-0.5 py-1 text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-500${
                      overlapConflict
                        ? ' border-rose-400'
                        : ' border-slate-200'
                    }`}
                  />
                </td>
                <td
                  className={`px-0.5 py-0.5${
                    cellLocked && !readOnly ? ' bg-slate-50/70' : ''
                  }${overlapConflict ? ' bg-rose-50' : ''}`}
                >
                  <div className="flex items-center gap-0.5">
                    <input
                      type="time"
                      value={d.end}
                      disabled={cellLocked}
                      onChange={(e) =>
                        onCell(p.rowKey, di, { end: e.target.value })
                      }
                      title={
                        overlapConflict
                          ? 'Candado: turnos solapados (Limpieza ↔ servicio)'
                          : !readOnly && dayLocked[di]
                            ? 'Día pasado: solo consulta'
                            : undefined
                      }
                      className={`w-full min-w-[4.25rem] rounded border px-0.5 py-1 text-xs tabular-nums disabled:bg-slate-50 disabled:text-slate-500${
                        overlapConflict
                          ? ' border-rose-400'
                          : ' border-slate-200'
                      }`}
                    />
                    {!cellLocked && (
                      <>
                        <button
                          type="button"
                          title="Marcar DESCANSO (ciclo D→V→turno)"
                          aria-label="Marcar DESCANSO"
                          onClick={() => onToggleOff(p.rowKey, di)}
                          className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                          style={{
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                          }}
                        >
                          D
                        </button>
                        <button
                          type="button"
                          title="Marcar VACACIONES"
                          aria-label="Marcar VACACIONES"
                          onClick={() => onSetVacation(p.rowKey, di)}
                          className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                          style={{
                            backgroundColor: '#e0f2fe',
                            color: '#075985',
                          }}
                        >
                          V
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </Fragment>
            );
          })}
          <td
            className="border-l border-slate-100 px-2 py-1 text-center text-xs font-semibold tabular-nums select-none"
            style={{ color: theme.muted }}
            aria-readonly="true"
            title={
              rowHasDualShifts(p)
                ? 'Horas asignadas (fórmula: suma Ent/Sal, incl. turnos duales del mismo día)'
                : 'Horas asignadas (fórmula: suma Ent/Sal de la semana)'
            }
          >
            {formatRowHours(rowHours(p))}
          </td>
        </tr>
      ))}
    </>
  );
}
