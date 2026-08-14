'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminSubgroup } from '@/app/components/AdminSubgroup';
import {
  ADMIN_EDITABLE_BUDGETS,
  adminBudgetKey,
  type AdminEditableBudget,
} from '@/app/lib/presupuesto';
import { MESES } from '@/app/lib/ventas-semana';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

/** Dashboards afectados por estos ajustes (ampliar cuando se sumen módulos). */
const AFECTA_DASHBOARDS = ['Finanzas'] as const;

type EstablishedRow = {
  rubro: string;
  parent: string | null;
  weeklyRate: number | null;
  ventaPct: number | null;
  note: string | null;
  defaultPresupuesto: number | null;
  establecido: number;
  base: number;
  hasOverride: boolean;
  overrideAmount: number | null;
};

type LoadPayload = {
  established: EstablishedRow[];
  weekCount: number;
  meta: { venta: number; efe: number; ba: number };
};

function money(v: number) {
  return `$${v.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function rowKey(rubro: string, parent?: string | null) {
  return adminBudgetKey(rubro, parent ?? null);
}

function groupOf(b: AdminEditableBudget): 'fijos' | 'semanales' | 'servicios' | 'otros' {
  if (b.weeklyRate != null) return 'semanales';
  if (b.parent === 'Servicios') return 'servicios';
  if (
    b.defaultPresupuesto != null ||
    b.ventaPct != null ||
    ['Nómina', 'Finiquitos y reclutamiento'].includes(b.rubro)
  ) {
    return 'fijos';
  }
  return 'otros';
}

const GROUP_LABEL: Record<ReturnType<typeof groupOf>, string> = {
  fijos: 'Fórmula fija / % venta',
  semanales: 'Rubros semanales (× N semanas SEM)',
  servicios: 'Servicios (hijos)',
  otros: 'Otros rubros (Excel)',
};

export function AdminPresupuestoAjustes() {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [weeklyRates, setWeeklyRates] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<EstablishedRow[]>([]);
  const [weekCount, setWeekCount] = useState(0);
  const [venta, setVenta] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingRubro, setSavingRubro] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/admin/presupuesto-ajustes?year=${year}&month=${month}`,
        { cache: 'no-store' }
      );
      const json = (await res.json()) as LoadPayload & { error?: string };
      if (!res.ok) {
        setError(json.error || 'No se pudieron cargar ajustes');
        return;
      }

      const established = json.established || [];
      setRows(established);
      setWeekCount(Number(json.weekCount || 0));
      setVenta(Number(json.meta?.venta || 0));

      const inputs: Record<string, string> = {};
      const rates: Record<string, string> = {};
      const n = Number(json.weekCount || 0);

      for (const b of ADMIN_EDITABLE_BUDGETS) {
        const k = rowKey(b.rubro, b.parent);
        const est = established.find(
          (e) => rowKey(e.rubro, e.parent) === k
        );
        const amount = est?.establecido ?? b.defaultPresupuesto ?? 0;
        inputs[k] = String(amount);
        if (b.weeklyRate != null) {
          const rate =
            n > 0 && est
              ? est.establecido / n
              : b.weeklyRate;
          rates[k] = String(Number(rate.toFixed(2)));
        }
      }
      setValues(inputs);
      setWeeklyRates(rates);
    } catch {
      setError('Error de red al cargar ajustes');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  async function saveRubro(rubro: string, parent: string | null) {
    const k = rowKey(rubro, parent);
    setSavingRubro(k);
    setError('');
    setOkMsg('');
    const raw = values[k];
    const presupuesto = Number(String(raw || '').replace(/,/g, ''));
    if (!Number.isFinite(presupuesto) || presupuesto < 0) {
      setError('Monto inválido');
      setSavingRubro(null);
      return;
    }
    try {
      const res = await fetch('/api/admin/presupuesto-ajustes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, rubro, parent, presupuesto }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo guardar');
        return;
      }
      setOkMsg(`${rubro} · ${MESES[month - 1]} ${year} actualizado`);
      await load();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSavingRubro(null);
    }
  }

  async function clearRubro(rubro: string, parent: string | null) {
    const k = rowKey(rubro, parent);
    setSavingRubro(k);
    setError('');
    setOkMsg('');
    try {
      const qs = new URLSearchParams({
        year: String(year),
        month: String(month),
        rubro,
      });
      if (parent) qs.set('parent', parent);
      const res = await fetch(`/api/admin/presupuesto-ajustes?${qs}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo restablecer');
        return;
      }
      setOkMsg(`${rubro} restablecido a fórmula / Excel`);
      await load();
    } catch {
      setError('Error de red al restablecer');
    } finally {
      setSavingRubro(null);
    }
  }

  /** Solo edita tarifa semanal; el total mes se recalcula (rate × N) y se guarda así. */
  function setRate(k: string, rateStr: string) {
    setWeeklyRates((prev) => ({ ...prev, [k]: rateStr }));
    const rate = Number(String(rateStr || '').replace(/,/g, ''));
    if (Number.isFinite(rate) && weekCount > 0) {
      setValues((prev) => ({
        ...prev,
        [k]: String(Number((rate * weekCount).toFixed(2))),
      }));
    } else if (Number.isFinite(rate) && weekCount === 0) {
      setValues((prev) => ({ ...prev, [k]: '0' }));
    }
  }

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const byGroup = useMemo(() => {
    const groups: Array<{
      id: ReturnType<typeof groupOf>;
      label: string;
      items: AdminEditableBudget[];
    }> = [
      { id: 'fijos', label: GROUP_LABEL.fijos, items: [] },
      { id: 'semanales', label: GROUP_LABEL.semanales, items: [] },
      { id: 'servicios', label: GROUP_LABEL.servicios, items: [] },
      { id: 'otros', label: GROUP_LABEL.otros, items: [] },
    ];
    for (const b of ADMIN_EDITABLE_BUDGETS) {
      const g = groupOf(b);
      groups.find((x) => x.id === g)!.items.push(b);
    }
    return groups.filter((g) => g.items.length > 0);
  }, []);

  function estFor(b: AdminEditableBudget): EstablishedRow | undefined {
    const k = rowKey(b.rubro, b.parent);
    return rows.find((e) => rowKey(e.rubro, e.parent) === k);
  }

  function monthlyFromInput(k: string): number {
    const n = Number(String(values[k] || '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <AdminSubgroup
      title="Ajustes de presupuesto"
      description={
        <>
          Afecta:{' '}
          <span className="font-semibold text-slate-700">
            {AFECTA_DASHBOARDS.join(', ')}
          </span>
          . Solo el administrador puede modificar montos.
        </>
      }
      open={open}
      onOpenChange={setOpen}
    >
          <p className="text-sm" style={{ color: theme.muted }}>
            Se guarda como{' '}
            <code className="text-xs">presupuesto_ajuste</code> (total del mes)
            y reemplaza la fórmula o el Excel en Finanzas para el mes elegido.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold text-slate-700">
              Año
              <select
                className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Mes
              <select
                className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MESES.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
              Semanas SEM (N):{' '}
              <strong className="tabular-nums">{weekCount}</strong>
              {venta > 0 && (
                <>
                  <span className="mx-2 text-slate-300">·</span>
                  Venta: <strong className="tabular-nums">{money(venta)}</strong>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {okMsg && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {okMsg}
            </div>
          )}

          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Cargando presupuesto…</p>
          ) : (
            <div className="mt-5 space-y-6">
              {byGroup.map((group) => (
                <div key={group.id}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    {group.label}
                  </h3>
                  {group.id === 'semanales' && (
                    <p className="mb-2 text-xs text-slate-500">
                      Edita solo la tarifa por semana. El total del mes se calcula
                      automáticamente (tarifa × N semanas SEM) y es lo que se
                      guarda.
                      {weekCount === 0 && (
                        <span className="mt-1 block text-amber-700">
                          Aún no hay hojas SEM para este mes (N = 0). El total por
                          fórmula será $0 hasta que se ingieran las semanas.
                        </span>
                      )}
                    </p>
                  )}
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-center text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-2.5 text-center">Rubro</th>
                          <th className="px-3 py-2.5 text-center">Establecido</th>
                          <th className="px-3 py-2.5 text-center">Origen</th>
                          <th className="px-3 py-2.5 text-center">Editar</th>
                          <th className="px-3 py-2.5 text-center">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((b) => {
                          const parent = b.parent ?? null;
                          const k = rowKey(b.rubro, parent);
                          const est = estFor(b);
                          const hasOverride = Boolean(est?.hasOverride);
                          const busy = savingRubro === k;
                          const isWeekly = b.weeklyRate != null;

                          return (
                            <tr key={k} className="border-t border-slate-100 align-top">
                              <td className="px-3 py-2.5">
                                <p className="font-semibold text-slate-800">
                                  {b.rubro}
                                  {parent && (
                                    <span className="ml-1 text-xs font-normal text-slate-400">
                                      · {parent}
                                    </span>
                                  )}
                                </p>
                                {(b.note || isWeekly) && (
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {b.note ||
                                      (isWeekly
                                        ? `${money(b.weeklyRate!)} × ${weekCount} sem`
                                        : '')}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-800">
                                {money(est?.establecido ?? 0)}
                                {isWeekly && weekCount > 0 && (
                                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                                    {money(
                                      (est?.establecido ?? 0) / weekCount
                                    )}{' '}
                                    / sem · N={weekCount}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-slate-600">
                                {hasOverride ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                                    Ajuste admin
                                  </span>
                                ) : b.ventaPct != null ? (
                                  <span className="text-xs text-slate-500">
                                    Fórmula {Math.round(b.ventaPct * 100)}% venta
                                    <span className="mt-0.5 block tabular-nums">
                                      Base {money(est?.base ?? 0)}
                                    </span>
                                  </span>
                                ) : isWeekly ? (
                                  <span className="text-xs text-slate-500">
                                    Fórmula {money(b.weeklyRate!)} × {weekCount}
                                    <span className="mt-0.5 block tabular-nums">
                                      Base {money(est?.base ?? 0)}
                                    </span>
                                  </span>
                                ) : b.defaultPresupuesto != null ? (
                                  <span className="text-xs text-slate-500">
                                    Fórmula fija
                                    <span className="mt-0.5 block tabular-nums">
                                      Base {money(est?.base ?? b.defaultPresupuesto)}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    Excel / catálogo
                                    <span className="mt-0.5 block tabular-nums">
                                      Base {money(est?.base ?? 0)}
                                    </span>
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                {isWeekly ? (
                                  <div className="flex flex-wrap items-end gap-2">
                                    <label className="text-[11px] font-semibold text-slate-500">
                                      Por semana
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={weeklyRates[k] ?? ''}
                                        onChange={(e) => setRate(k, e.target.value)}
                                        className="mt-0.5 block w-28 rounded-lg border border-slate-300 px-2 py-1.5 tabular-nums outline-none focus:border-blue-500"
                                      />
                                    </label>
                                    <div className="pb-1.5">
                                      <p className="text-[11px] font-semibold text-slate-500">
                                        Total mes
                                      </p>
                                      <p className="mt-0.5 text-sm tabular-nums font-semibold text-slate-800">
                                        = {money(monthlyFromInput(k))}
                                        <span className="ml-1 text-xs font-normal text-slate-400">
                                          (× {weekCount} sem)
                                        </span>
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={values[k] ?? ''}
                                    onChange={(e) =>
                                      setValues((prev) => ({
                                        ...prev,
                                        [k]: e.target.value,
                                      }))
                                    }
                                    className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 tabular-nums outline-none focus:border-blue-500"
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void saveRubro(b.rubro, parent)}
                                    className="text-sm font-semibold text-blue-700 hover:underline disabled:opacity-50"
                                  >
                                    {busy ? 'Guardando…' : 'Guardar'}
                                  </button>
                                  {hasOverride && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => void clearRubro(b.rubro, parent)}
                                      className="text-sm font-semibold text-slate-600 hover:underline disabled:opacity-50"
                                    >
                                      Restablecer
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
    </AdminSubgroup>
  );
}
