'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  HR_STAFF_POLICY_LINKS,
  addIsoDays,
  formatHrDate,
  hrLeaveDisplayLabel,
  isLeaveTomada,
  leaveLaborDays,
  todayIsoCdmx,
  type HrLeaveBalanceRow,
  type HrLeaveRequest,
  type HrLeaveStatus,
} from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type LinkedEmployee = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  email: string | null;
  suite_username: string | null;
};

const inputClass =
  'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type ListPayload = {
  ready: boolean;
  requests: HrLeaveRequest[];
  linkedEmployee?: LinkedEmployee | null;
  message?: string | null;
  error?: string;
};

type BalancePayload = {
  ready: boolean;
  year: number;
  linkedEmployee: LinkedEmployee | null;
  balance: HrLeaveBalanceRow | null;
  periodLabel?: string | null;
  message?: string | null;
  error?: string;
};

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

function formatDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-MX');
}

/** Días ya comprometidos (pendiente o aprobada vigente) que restan del saldo nómina. */
function reservedLeaveDays(
  requests: HrLeaveRequest[],
  today: string
): number {
  let n = 0;
  for (const r of requests) {
    if (r.status === 'pendiente') n += Number(r.days) || 0;
    else if (r.status === 'aprobada' && r.date_to.slice(0, 10) >= today) {
      n += Number(r.days) || 0;
    }
  }
  return n;
}

function monthLabel(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex, 1, 12);
  return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

function isoFromParts(y: number, m: number, day: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildMonthCells(year: number, monthIndex: number): (string | null)[] {
  const first = new Date(year, monthIndex, 1, 12);
  // Convert Sun=0…Sat=6 → Mon=0…Sun=6
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(isoFromParts(year, monthIndex, d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function StaffVacacionesClient() {
  const today = todayIsoCdmx();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<HrLeaveRequest[]>([]);
  const [schemaMsg, setSchemaMsg] = useState<string | null>(null);
  const [linked, setLinked] = useState<LinkedEmployee | null>(null);

  const [balance, setBalance] = useState<HrLeaveBalanceRow | null>(null);
  const [balanceYear, setBalanceYear] = useState<number | null>(null);
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [balanceMsg, setBalanceMsg] = useState<string | null>(null);

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [pickMode, setPickMode] = useState<'from' | 'to'>('from');
  const [calCursor, setCalCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, balRes] = await Promise.all([
        fetch('/api/hr/leave-requests', { cache: 'no-store' }),
        fetch('/api/hr/leave-balances/mine', { cache: 'no-store' }),
      ]);
      const reqJson = (await reqRes.json()) as ListPayload;
      const balJson = (await balRes.json()) as BalancePayload;

      if (!reqRes.ok) {
        setError(reqJson.error || 'No se pudo cargar');
      } else {
        setRequests(reqJson.requests || []);
        setSchemaMsg(reqJson.ready ? null : reqJson.message || null);
        if (reqJson.linkedEmployee) setLinked(reqJson.linkedEmployee);
      }

      if (balRes.ok) {
        setBalance(balJson.balance);
        setBalanceYear(balJson.year ?? null);
        setPeriodLabel(balJson.periodLabel ?? null);
        setBalanceMsg(balJson.message ?? null);
        if (balJson.linkedEmployee) setLinked(balJson.linkedEmployee);
        else if (!reqJson.linkedEmployee) setLinked(null);
      }
    } catch {
      setError('Error de red al cargar vacaciones');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const days =
    desde && hasta && hasta >= desde ? leaveLaborDays(desde, hasta) : 0;

  const reserved = useMemo(
    () => reservedLeaveDays(requests, today),
    [requests, today]
  );

  const nominaRemaining =
    balance?.days_remaining != null && Number.isFinite(balance.days_remaining)
      ? Number(balance.days_remaining)
      : null;

  const available =
    nominaRemaining == null ? null : Math.max(0, nominaRemaining - reserved);

  const overBalance =
    available != null && days > 0 && days > available;

  const cells = useMemo(
    () => buildMonthCells(calCursor.year, calCursor.month),
    [calCursor.year, calCursor.month]
  );

  function selectDay(iso: string) {
    if (iso < today) return;
    setFormError(null);
    if (pickMode === 'from' || !desde || (desde && hasta)) {
      setDesde(iso);
      setHasta('');
      setPickMode('to');
      return;
    }
    if (iso < desde) {
      setHasta(desde);
      setDesde(iso);
    } else {
      setHasta(iso);
    }
    setPickMode('from');
  }

  function shiftMonth(delta: number) {
    setCalCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1, 12);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function dayTone(iso: string | null): {
    bg: string;
    color: string;
    border: string;
    disabled: boolean;
  } {
    if (!iso) {
      return { bg: 'transparent', color: 'transparent', border: 'transparent', disabled: true };
    }
    const past = iso < today;
    const inRange =
      desde &&
      ((hasta && iso >= desde && iso <= hasta) || (!hasta && iso === desde));
    const isEdge = iso === desde || iso === hasta;
    if (isEdge) {
      return {
        bg: SUITE.navy,
        color: '#fff',
        border: SUITE.navy,
        disabled: past,
      };
    }
    if (inRange) {
      return {
        bg: SUITE.orangeSoft,
        color: SUITE.navy,
        border: SUITE.orangeSoft,
        disabled: past,
      };
    }
    if (past) {
      return {
        bg: '#f8fafc',
        color: '#94a3b8',
        border: 'transparent',
        disabled: true,
      };
    }
    return {
      bg: '#fff',
      color: theme.title,
      border: '#e2e8f0',
      disabled: false,
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setToast(null);

    if (!linked) {
      setFormError(
        'Tu usuario no está vinculado a un colaborador. Pide a RH que asigne tu suite_username.'
      );
      return;
    }
    if (!desde || !hasta) {
      setFormError('Elige el rango en el calendario (desde y hasta).');
      return;
    }
    if (hasta < desde) {
      setFormError('La fecha «Hasta» debe ser ≥ «Desde».');
      return;
    }
    if (available == null) {
      setFormError(
        'No hay saldo de vacaciones disponible. Consulta a RH antes de solicitar.'
      );
      return;
    }
    if (days > available) {
      setFormError(
        `Solo tienes ${available} día${available === 1 ? '' : 's'} disponible${available === 1 ? '' : 's'} (pediste ${days}).`
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/hr/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha_solicitud: today,
          solicitada_a: '',
          nombre_empleado: linked.full_name,
          curp: '',
          puesto: linked.puesto || '',
          date_from: desde,
          date_to: hasta,
          ultimo_dia_laborado: addIsoDays(desde, -1),
          fecha_reingreso: addIsoDays(hasta, 1),
          days,
          pago_vacaciones: 'nomina',
          observaciones: observaciones.trim(),
          capturada_por_rh: false,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error || 'No se pudo enviar la solicitud');
        return;
      }
      setToast(json.message || 'Solicitud enviada. Queda pendiente de RH.');
      setDesde('');
      setHasta('');
      setObservaciones('');
      setPickMode('from');
      await refresh();
    } catch {
      setFormError('Error de red al enviar');
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    Boolean(linked) &&
    Boolean(desde && hasta) &&
    days > 0 &&
    available != null &&
    !overBalance &&
    !saving;

  return (
    <div className="space-y-5">
      <p className="mb-1">
        <Link
          href="/staff"
          className="text-sm font-semibold"
          style={{ color: SUITE.orangeDeep }}
        >
          ← Volver a Staff
        </Link>
      </p>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {schemaMsg && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {schemaMsg}
        </div>
      )}
      {toast && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {toast}
        </div>
      )}
      {formError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {formError}
        </div>
      )}

      <SuiteCard accent className="max-w-3xl">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Mis vacaciones
          {balanceYear ? ` · ${balanceYear}` : ''}
        </p>
        <h2 className="mt-2 text-xl font-bold" style={{ color: theme.title }}>
          {linked ? linked.full_name : 'Solicitar vacaciones'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Elige el periodo en el calendario. La solicitud queda{' '}
          <strong style={{ color: theme.title }}>pendiente</strong> hasta que RH
          la apruebe o rechace en Recursos Humanos.
        </p>
        {!linked && !loading ? (
          <p className="mt-3 text-sm text-amber-900">
            Tu usuario Suite no está vinculado a la plantilla. Pide a RH que
            asigne tu <code className="text-xs">suite_username</code>.
          </p>
        ) : null}
        <ul className="mt-3 space-y-1 text-xs" style={{ color: theme.muted }}>
          {HR_STAFF_POLICY_LINKS.filter((l) =>
            l.surfaces.includes('vacaciones')
          ).map((l) => (
            <li key={l.local_path}>
              <span
                className="font-semibold"
                style={{ color: SUITE.orangeDeep }}
              >
                Política
              </span>
              {' · '}
              {l.title}
            </li>
          ))}
        </ul>
      </SuiteCard>

      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        <SuiteCard className="sm:col-span-1">
          <p
            className="text-[11px] font-bold uppercase tracking-wide"
            style={{ color: theme.muted }}
          >
            Por tomar
          </p>
          <p
            className="mt-1 text-3xl font-bold tabular-nums"
            style={{ color: SUITE.navy }}
          >
            {loading ? '…' : formatDays(nominaRemaining)}
          </p>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            {periodLabel
              ? `Según nómina ${periodLabel}`
              : 'Saldo en nómina en curso'}
          </p>
        </SuiteCard>
        <SuiteCard className="sm:col-span-1">
          <p
            className="text-[11px] font-bold uppercase tracking-wide"
            style={{ color: theme.muted }}
          >
            Comprometidos
          </p>
          <p
            className="mt-1 text-3xl font-bold tabular-nums"
            style={{ color: theme.title }}
          >
            {loading ? '…' : formatDays(reserved)}
          </p>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Pendientes + aprobadas vigentes
          </p>
        </SuiteCard>
        <SuiteCard className="sm:col-span-1">
          <p
            className="text-[11px] font-bold uppercase tracking-wide"
            style={{ color: theme.muted }}
          >
            Disponibles
          </p>
          <p
            className="mt-1 text-3xl font-bold tabular-nums"
            style={{ color: overBalance ? '#991b1b' : SUITE.orangeDeep }}
          >
            {loading ? '…' : formatDays(available)}
          </p>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Tomadas (nómina): {formatDays(balance?.days_taken)}
          </p>
        </SuiteCard>
      </div>
      {balanceMsg ? (
        <p className="max-w-3xl text-sm" style={{ color: '#b45309' }}>
          {balanceMsg}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
        <SuiteCard>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold" style={{ color: theme.title }}>
              Calendario
            </h3>
            <p className="text-xs" style={{ color: theme.muted }}>
              {pickMode === 'to' && desde
                ? 'Elige la fecha hasta'
                : 'Elige la fecha desde'}
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

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide"
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
              const tone = dayTone(iso);
              return (
                <button
                  key={iso ?? `e-${idx}`}
                  type="button"
                  disabled={!iso || tone.disabled}
                  onClick={() => iso && selectDay(iso)}
                  className="min-h-10 rounded-lg text-sm font-semibold tabular-nums disabled:cursor-default"
                  style={{
                    backgroundColor: tone.bg,
                    color: tone.color,
                    border: `1px solid ${tone.border}`,
                  }}
                >
                  {iso ? Number(iso.slice(8, 10)) : ''}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex h-full flex-col gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Desde</span>
              <input
                type="date"
                className={`${inputClass} mt-auto`}
                value={desde}
                min={today}
                onChange={(e) => {
                  const v = e.target.value;
                  setDesde(v);
                  if (hasta && v && hasta < v) setHasta('');
                  setPickMode(v ? 'to' : 'from');
                }}
              />
            </label>
            <label className="flex h-full flex-col gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Hasta</span>
              <input
                type="date"
                className={`${inputClass} mt-auto`}
                value={hasta}
                min={desde || today}
                onChange={(e) => {
                  setHasta(e.target.value);
                  setPickMode('from');
                }}
              />
            </label>
          </div>

          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            {days > 0 ? (
              <>
                Periodo:{' '}
                <strong style={{ color: theme.title }}>
                  {formatHrDate(desde)} → {formatHrDate(hasta)}
                </strong>
                {' · '}
                <strong
                  style={{
                    color: overBalance ? '#991b1b' : SUITE.navy,
                  }}
                >
                  {days} día{days === 1 ? '' : 's'}
                </strong>
                {overBalance && available != null
                  ? ` · supera los ${available} disponibles`
                  : null}
              </>
            ) : (
              'Selecciona un rango para ver el total de días.'
            )}
          </p>

          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-slate-700">
              Observaciones
            </span>
            <textarea
              className={`${inputClass} min-h-[88px] py-2`}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Opcional"
            />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-4 min-h-11 w-full rounded-xl px-4 text-sm font-bold disabled:opacity-50 sm:w-auto"
            style={{
              backgroundColor: SUITE.navy,
              color: '#fff',
            }}
          >
            {saving ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </SuiteCard>
      </form>

      <SuiteCard className="max-w-3xl">
        <h3 className="text-base font-bold" style={{ color: theme.title }}>
          Mis solicitudes
        </h3>
        {loading ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Cargando…
          </p>
        ) : requests.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Aún no hay solicitudes registradas a tu nombre.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {requests.map((r) => {
              const tomada = isLeaveTomada(r.status, r.date_to, today);
              const st = statusStyle(r.status, { tomada });
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p
                      className="text-sm font-semibold"
                      style={{ color: theme.title }}
                    >
                      {formatHrDate(r.date_from)} → {formatHrDate(r.date_to)}
                      <span className="ml-2 font-normal text-slate-500">
                        ({r.days} día{Number(r.days) === 1 ? '' : 's'})
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Registrada {formatHrDate(r.created_at)}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ backgroundColor: st.bg, color: st.color }}
                  >
                    {hrLeaveDisplayLabel(r.status, r.date_to, today)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SuiteCard>
    </div>
  );
}
