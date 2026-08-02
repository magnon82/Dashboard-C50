'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  addIsoDays,
  formatHrDate,
  formatHrPuesto,
  groupPlantillaByTeam,
  hrLeaveDisplayLabel,
  isLeaveTomada,
  leaveInclusiveDays,
  plantillaPositionKey,
  todayIsoCdmx,
  type HrEmployee,
  type HrLeaveBalanceRow,
  type HrLeaveRequest,
  type HrLeaveStatus,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type ListPayload = {
  ready: boolean;
  requests: HrLeaveRequest[];
  message?: string | null;
  error?: string;
};

type BalancesPayload = {
  ready: boolean;
  year: number;
  employees: HrLeaveBalanceRow[];
  message?: string | null;
  error?: string;
  periodLabel?: string | null;
  periodStatus?: string | null;
};

function balanceAsEmployee(r: HrLeaveBalanceRow): HrEmployee {
  return {
    id: r.employee_id,
    full_name: r.full_name,
    status: 'activo',
    puesto: r.puesto,
    area: r.area,
    fecha_ingreso: null,
    email: null,
    phone: null,
    drive_folder_path: null,
  };
}

function formatDays(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-MX');
}

const inputClass =
  'mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400';

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required ? ' *' : ''}
      </span>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      {children}
    </label>
  );
}

function statusStyle(
  status: HrLeaveStatus,
  opts?: { tomada?: boolean }
): { bg: string; color: string } {
  if (opts?.tomada) {
    return { bg: '#e0f2fe', color: '#075985' };
  }
  switch (status) {
    case 'aprobada':
      return { bg: '#ecfdf5', color: '#065f46' };
    case 'rechazada':
      return { bg: '#fef2f2', color: '#991b1b' };
    case 'cancelada':
      return { bg: '#f1f5f9', color: '#475569' };
    default:
      return { bg: SUITE.orangeSoft, color: SUITE.navy };
  }
}

function displayName(r: HrLeaveRequest): string {
  const p = r.payload as { nombre_empleado?: string; puesto?: string };
  return r.employee_name || p?.nombre_empleado || r.requested_by || '—';
}

function displayPuesto(r: HrLeaveRequest): string {
  const p = r.payload as { puesto?: string };
  return r.employee_puesto || p?.puesto || '';
}

function puestoFromEmployee(emp: HrEmployee): string {
  return (
    formatHrPuesto(plantillaPositionKey(emp) || emp.puesto || emp.area) || ''
  );
}

/** Próximas o en curso: date_to >= hoy y estatus pendiente/aprobada. */
function isEnPuerta(r: HrLeaveRequest, today: string): boolean {
  if (r.status !== 'pendiente' && r.status !== 'aprobada') return false;
  return r.date_to.slice(0, 10) >= today;
}

function sortEnPuerta(a: HrLeaveRequest, b: HrLeaveRequest): number {
  const c = a.date_from.localeCompare(b.date_from);
  if (c !== 0) return c;
  return a.date_to.localeCompare(b.date_to);
}

function RequestTable({
  rows,
  emptyLabel,
  showActions,
  today,
  busyId,
  onDecide,
}: {
  rows: HrLeaveRequest[];
  emptyLabel: string;
  showActions: boolean;
  today: string;
  busyId: string | null;
  onDecide: (id: string, status: 'aprobada' | 'rechazada') => void;
}) {
  if (rows.length === 0) {
    return (
      <SuiteCard className="max-w-3xl">
        <p className="text-sm" style={{ color: theme.muted }}>
          {emptyLabel}
        </p>
      </SuiteCard>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-2xl bg-white"
      style={{ boxShadow: SUITE.shadow }}
    >
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr
            className="border-b border-slate-100 text-xs uppercase tracking-wide"
            style={{ color: theme.muted }}
          >
            <th className="px-4 py-3 font-semibold">Colaborador</th>
            <th className="px-4 py-3 font-semibold">Periodo</th>
            <th className="px-4 py-3 font-semibold">Días</th>
            <th className="px-4 py-3 font-semibold">Estatus</th>
            {showActions ? (
              <th className="px-4 py-3 font-semibold">Acciones</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tomada = isLeaveTomada(r.status, r.date_to, today);
            const st = statusStyle(r.status, { tomada });
            const p = r.payload as {
              pago_vacaciones?: string;
              observaciones?: string;
              capturada_por_rh?: boolean;
              source?: string;
            };
            const inCourse =
              r.date_from.slice(0, 10) <= today &&
              r.date_to.slice(0, 10) >= today;
            return (
              <tr key={r.id} className="border-b border-slate-50 align-top">
                <td className="px-4 py-3">
                  <p className="font-semibold" style={{ color: theme.title }}>
                    {displayName(r)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      displayPuesto(r),
                      p.capturada_por_rh && 'Captura RH',
                      p.source === 'gmail_import' && 'Gmail',
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                  {p.observaciones ? (
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                      {p.observaciones}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatHrDate(r.date_from)} → {formatHrDate(r.date_to)}
                  {inCourse ? (
                    <p
                      className="text-xs font-semibold"
                      style={{ color: SUITE.orangeDeep }}
                    >
                      En curso
                    </p>
                  ) : null}
                  <p className="text-xs text-slate-500">
                    Pago:{' '}
                    {p.pago_vacaciones === 'inmediato' ? 'Inmediato' : 'Nómina'}
                  </p>
                </td>
                <td className="px-4 py-3 tabular-nums">{r.days}</td>
                <td className="px-4 py-3">
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{ backgroundColor: st.bg, color: st.color }}
                  >
                    {hrLeaveDisplayLabel(r.status, r.date_to, today)}
                  </span>
                </td>
                {showActions ? (
                  <td className="px-4 py-3">
                    {r.status === 'pendiente' ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => onDecide(r.id, 'aprobada')}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => onDecide(r.id, 'rechazada')}
                          className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {r.reviewed_by ? `Por ${r.reviewed_by}` : '—'}
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RrhhVacaciones() {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pendiente' | 'todas'>('todas');
  const [requests, setRequests] = useState<HrLeaveRequest[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [empSource, setEmpSource] = useState<string | null>(null);
  const [balances, setBalances] = useState<HrLeaveBalanceRow[]>([]);
  const [balancesYear, setBalancesYear] = useState<number | null>(null);
  const [balancesPeriodLabel, setBalancesPeriodLabel] = useState<string | null>(
    null
  );
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [balancesMessage, setBalancesMessage] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState('');
  const [fechaSolicitud, setFechaSolicitud] = useState(todayIsoCdmx);
  const [nombre, setNombre] = useState('');
  const [curp, setCurp] = useState('');
  const [puesto, setPuesto] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [ultimoDia, setUltimoDia] = useState('');
  const [reingreso, setReingreso] = useState('');
  const [days, setDays] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const today = todayIsoCdmx();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Siempre todas: «en puerta» necesita aprobadas próximas + historial.
      const res = await fetch('/api/hr/leave-requests', { cache: 'no-store' });
      const json = (await res.json()) as ListPayload;
      setRequests(json.requests || []);
      setMessage(
        json.ready ? null : json.message || json.error || 'Sin datos'
      );
    } catch {
      setMessage('Error de red al cargar solicitudes');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      let res = await fetch('/api/hr/employees', { cache: 'no-store' });
      let json = await res.json();
      let list = (json.employees || []) as HrEmployee[];
      let source = String(json.source || '');
      if (list.length === 0) {
        res = await fetch('/api/hr/employees?source=activos', {
          cache: 'no-store',
        });
        json = await res.json();
        list = (json.employees || []) as HrEmployee[];
        source = String(json.source || 'activos');
      }
      setEmployees(list);
      setEmpSource(source);
    } catch {
      setEmployees([]);
      setEmpSource(null);
    }
  }, []);

  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const res = await fetch('/api/hr/leave-balances', { cache: 'no-store' });
      const json = (await res.json()) as BalancesPayload;
      setBalances(json.employees || []);
      setBalancesYear(json.year ?? null);
      setBalancesPeriodLabel(json.periodLabel ?? null);
      setBalancesMessage(
        json.ready
          ? json.message || null
          : json.message || json.error || 'Sin saldos'
      );
    } catch {
      setBalances([]);
      setBalancesYear(null);
      setBalancesPeriodLabel(null);
      setBalancesMessage('Error de red al cargar saldos');
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([refresh(), loadEmployees(), loadBalances()]);
  }, [refresh, loadEmployees, loadBalances]);

  useEffect(() => {
    if (!desde || !hasta || hasta < desde) return;
    setDays(String(leaveInclusiveDays(desde, hasta)));
    setUltimoDia((prev) => prev || addIsoDays(desde, -1));
    setReingreso((prev) => prev || addIsoDays(hasta, 1));
  }, [desde, hasta]);

  function onSelectEmployee(id: string) {
    setEmployeeId(id);
    if (!id) {
      setNombre('');
      setPuesto('');
      return;
    }
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    setNombre(emp.full_name || '');
    setPuesto(puestoFromEmployee(emp));
  }

  function resetFormKeepEmployee() {
    setFechaSolicitud(todayIsoCdmx);
    setCurp('');
    setDesde('');
    setHasta('');
    setUltimoDia('');
    setReingreso('');
    setDays('');
    setObservaciones('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setToast(null);

    if (!employeeId || !nombre.trim() || !fechaSolicitud || !desde || !hasta) {
      setFormError('Selecciona colaborador y completa fecha, desde y hasta.');
      return;
    }

    const emp = employees.find((e) => e.id === employeeId);
    const puestoPayload = emp ? puestoFromEmployee(emp) : puesto.trim();
    const nombrePayload = emp?.full_name?.trim() || nombre.trim();

    setSaving(true);
    try {
      const res = await fetch('/api/hr/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha_solicitud: fechaSolicitud,
          solicitada_a: '',
          nombre_empleado: nombrePayload,
          curp: curp.trim(),
          puesto: puestoPayload,
          date_from: desde,
          date_to: hasta,
          ultimo_dia_laborado: ultimoDia,
          fecha_reingreso: reingreso,
          days: days ? Number(days) : undefined,
          pago_vacaciones: 'nomina',
          observaciones: observaciones.trim(),
          employee_id: employeeId,
          capturada_por_rh: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || 'No se pudo guardar');
        return;
      }
      setToast(json.message || 'Solicitud capturada.');
      resetFormKeepEmployee();
      await refresh();
    } catch {
      setFormError('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function decide(id: string, status: 'aprobada' | 'rechazada') {
    setBusyId(id);
    setToast(null);
    try {
      const res = await fetch('/api/hr/leave-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo actualizar');
        return;
      }
      setToast(
        status === 'aprobada' ? 'Solicitud aprobada.' : 'Solicitud rechazada.'
      );
      await refresh();
    } catch {
      setToast('Error de red');
    } finally {
      setBusyId(null);
    }
  }

  const enPuerta = requests
    .filter((r) => isEnPuerta(r, today))
    .slice()
    .sort(sortEnPuerta);

  const history =
    filter === 'pendiente'
      ? requests.filter((r) => r.status === 'pendiente')
      : requests;

  const pendingCount = requests.filter((r) => r.status === 'pendiente').length;
  const daysNum = days ? Number(days) : 0;
  const warnDays = daysNum > 6;
  const warnAnticipacion =
    fechaSolicitud && desde
      ? leaveInclusiveDays(fechaSolicitud, desde) - 1 < 15
      : false;

  const balanceById = new Map(
    balances.map((b) => [b.employee_id, b] as const)
  );
  const balanceGroups = groupPlantillaByTeam(
    balances.map(balanceAsEmployee)
  );

  return (
    <div className="space-y-4">
      {toast && (
        <div className="max-w-3xl rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {toast}
        </div>
      )}
      {message && (
        <div className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      )}
      {formError && (
        <div className="max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {formError}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.14em]"
              style={{ color: SUITE.orangeDeep }}
            >
              Plantilla vigente
              {balancesYear ? ` · ${balancesYear}` : ''}
            </p>
            <h3 className="mt-1 text-lg font-bold" style={{ color: theme.title }}>
              Saldos de vacaciones
            </h3>
            {balancesPeriodLabel ? (
              <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                Según nómina {balancesPeriodLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => loadBalances()}
            className="text-xs font-semibold underline-offset-2 hover:underline"
            style={{ color: SUITE.orangeDeep }}
          >
            Actualizar
          </button>
        </div>
        {balancesMessage && (
          <p className="text-sm" style={{ color: '#b45309' }}>
            {balancesMessage}
          </p>
        )}
        {balancesLoading ? (
          <p className="text-sm" style={{ color: theme.muted }}>
            Cargando saldos…
          </p>
        ) : balances.length === 0 ? (
          !balancesMessage ? (
            <p className="text-sm" style={{ color: theme.muted }}>
              Sin plantilla para mostrar saldos.
            </p>
          ) : null
        ) : (
          <div
            className="overflow-x-auto rounded-2xl bg-white"
            style={{ boxShadow: SUITE.shadow }}
          >
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr
                  className="border-b text-[11px] uppercase tracking-[0.12em]"
                  style={{ color: theme.muted }}
                >
                  <th className="px-4 py-3 font-semibold">Nombre</th>
                  <th className="px-4 py-3 font-semibold">Puesto</th>
                  <th className="px-4 py-3 font-semibold text-right">
                    Tomadas
                  </th>
                  <th className="px-4 py-3 font-semibold text-right">
                    Por tomar
                  </th>
                </tr>
              </thead>
              <tbody>
                {balanceGroups.map((bucket) => (
                  <Fragment key={bucket.group}>
                    <tr
                      className="border-b border-slate-200"
                      style={{ backgroundColor: SUITE.orangeSoft }}
                    >
                      <td
                        colSpan={4}
                        className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide"
                        style={{ color: SUITE.navy }}
                      >
                        {bucket.label}
                        <span className="ml-2 font-semibold normal-case tracking-normal opacity-80">
                          {bucket.employees.length}
                        </span>
                      </td>
                    </tr>
                    {bucket.employees.map((emp) => {
                      const bal = balanceById.get(emp.id);
                      const puesto =
                        formatHrPuesto(
                          plantillaPositionKey(emp) || emp.puesto || emp.area
                        ) || '—';
                      return (
                        <tr
                          key={emp.id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td
                            className="px-4 py-3 font-medium"
                            style={{ color: theme.title }}
                          >
                            {formatHrListName(emp.full_name)}
                          </td>
                          <td
                            className="px-4 py-3"
                            style={{ color: theme.muted }}
                          >
                            {puesto}
                          </td>
                          <td
                            className="px-4 py-3 text-right tabular-nums"
                            style={{ color: theme.title }}
                          >
                            {formatDays(bal?.days_taken ?? null)}
                          </td>
                          <td
                            className="px-4 py-3 text-right font-semibold tabular-nums"
                            style={{ color: SUITE.navy }}
                            title={
                              bal?.days_entitled != null
                                ? `Correspondientes: ${formatDays(bal.days_entitled)}`
                                : undefined
                            }
                          >
                            {formatDays(bal?.days_remaining ?? null)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.14em]"
              style={{ color: SUITE.orangeDeep }}
            >
              Próximas
            </p>
            <h3 className="mt-1 text-lg font-bold" style={{ color: theme.title }}>
              Vacaciones en puerta
            </h3>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              Aprobadas o pendientes con fecha hasta ≥ hoy (incluye en curso).
            </p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            className="text-xs font-semibold underline-offset-2 hover:underline"
            style={{ color: SUITE.orangeDeep }}
          >
            Actualizar
          </button>
        </div>
        {loading ? (
          <p className="text-sm" style={{ color: theme.muted }}>
            Cargando vacaciones en puerta…
          </p>
        ) : (
          <RequestTable
            rows={enPuerta}
            emptyLabel="No hay vacaciones en puerta."
            showActions
            today={today}
            busyId={busyId}
            onDecide={decide}
          />
        )}
      </section>

      <form onSubmit={onSubmit} className="max-w-3xl space-y-4 pt-2">
        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Nueva solicitud
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Colaborador"
              required
              hint={
                employees.length > 0
                  ? empSource === 'activos_forced' ||
                    empSource === 'employees_fallback'
                    ? 'Lista de activos · el puesto se toma del empleado'
                    : 'Plantilla vigente · el puesto se toma del empleado'
                  : 'Sin plantilla cargada'
              }
            >
              <select
                className={inputClass}
                value={employeeId}
                onChange={(e) => onSelectEmployee(e.target.value)}
                disabled={employees.length === 0}
                required
              >
                <option value="">
                  {employees.length === 0
                    ? '— Sin empleados cargados —'
                    : '— Seleccionar —'}
                </option>
                {employees.map((e) => {
                  const p = puestoFromEmployee(e);
                  return (
                    <option key={e.id} value={e.id}>
                      {formatHrListName(e.full_name)}
                      {p ? ` · ${p}` : ''}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="Fecha de la solicitud" required>
              <input
                type="date"
                className={inputClass}
                value={fechaSolicitud}
                onChange={(e) => setFechaSolicitud(e.target.value)}
                required
              />
            </Field>
            <Field
              label="Puesto"
              hint="Según ficha del colaborador (plantilla)"
            >
              <input
                type="text"
                className={`${inputClass} bg-slate-50 text-slate-700`}
                value={puesto}
                readOnly
                tabIndex={-1}
                placeholder={
                  employeeId ? 'Sin puesto en ficha' : 'Elige colaborador'
                }
              />
            </Field>
            <Field label="CURP">
              <input
                type="text"
                className={`${inputClass} uppercase`}
                value={curp}
                onChange={(e) => setCurp(e.target.value.toUpperCase())}
                maxLength={18}
                placeholder="18 caracteres"
              />
            </Field>
          </div>
        </SuiteCard>

        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Periodo solicitado
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Desde" required>
              <input
                type="date"
                className={inputClass}
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                required
              />
            </Field>
            <Field label="Hasta" required>
              <input
                type="date"
                className={inputClass}
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                required
              />
            </Field>
            <Field label="Último día laborado">
              <input
                type="date"
                className={inputClass}
                value={ultimoDia}
                onChange={(e) => setUltimoDia(e.target.value)}
              />
            </Field>
            <Field label="Fecha de reingreso">
              <input
                type="date"
                className={inputClass}
                value={reingreso}
                onChange={(e) => setReingreso(e.target.value)}
              />
            </Field>
            <Field label="Total de días" required>
              <input
                type="number"
                min={1}
                step={0.5}
                className={inputClass}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                required
              />
            </Field>
          </div>
          {(warnDays || warnAnticipacion) && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
              {warnAnticipacion && (
                <li>Menos de 15 días de anticipación (política orientativa).</li>
              )}
              {warnDays && (
                <li>Más de 6 días (tope orientativo de política).</li>
              )}
            </ul>
          )}
          <div className="mt-4">
            <Field label="Observaciones">
              <textarea
                className={`${inputClass} min-h-[72px] py-2`}
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-5 min-h-12 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-60"
            style={{ backgroundColor: SUITE.navy }}
          >
            {saving ? 'Guardando…' : 'Registrar solicitud'}
          </button>
        </SuiteCard>
      </form>

      <section className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="text-sm font-semibold" style={{ color: theme.title }}>
              Historial de solicitudes
            </p>
            <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
              Las aprobadas cuyo periodo ya terminó aparecen como Tomadas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFilter('pendiente')}
            className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{
              backgroundColor:
                filter === 'pendiente' ? SUITE.orangeSoft : '#fff',
              color: SUITE.navy,
              boxShadow: SUITE.shadow,
            }}
          >
            Pendientes
            {pendingCount ? ` (${pendingCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setFilter('todas')}
            className="rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{
              backgroundColor: filter === 'todas' ? SUITE.orangeSoft : '#fff',
              color: SUITE.navy,
              boxShadow: SUITE.shadow,
            }}
          >
            Todas
          </button>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: theme.muted }}>
            Cargando solicitudes…
          </p>
        ) : (
          <RequestTable
            rows={history}
            emptyLabel={
              filter === 'pendiente'
                ? 'No hay solicitudes pendientes.'
                : 'No hay solicitudes registradas.'
            }
            showActions
            today={today}
            busyId={busyId}
            onDecide={decide}
          />
        )}
      </section>
    </div>
  );
}
