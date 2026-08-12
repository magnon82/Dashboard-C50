'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  RubroRow,
  PresupuestoMeta,
  RubroDesglose,
} from '@/app/lib/presupuesto';
import {
  COLLAPSIBLE_PARENTS,
  buildRubroDesglose,
} from '@/app/lib/presupuesto';
import { getTheme, SUITE } from '@/app/lib/themes';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function pctLabel(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`;
}

function pctInline(v: number | null) {
  if (v == null || Number.isNaN(v)) return '';
  return `(${(Math.abs(v) * 100).toLocaleString('es-MX', {
    maximumFractionDigits: 1,
  })}%)`;
}

interface Props {
  rows: RubroRow[];
  meta: PresupuestoMeta;
  loading?: boolean;
  records?: FinancialRecord[];
  year?: number;
  month?: number;
}

const PARENT_SET = new Set<string>(COLLAPSIBLE_PARENTS);

export function PresupuestoRubros({
  rows,
  meta,
  loading,
  records = [],
  year,
  month,
}: Props) {
  const [openParents, setOpenParents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COLLAPSIBLE_PARENTS.map((p) => [p, false]))
  );
  const [desgloseTarget, setDesgloseTarget] = useState<RubroRow | null>(null);

  const visible = useMemo(() => {
    const out: RubroRow[] = [];
    for (const row of rows) {
      if (row.isParent) {
        out.push(row);
        continue;
      }
      if (row.parent && openParents[row.parent] === false) continue;
      out.push(row);
    }
    return out;
  }, [rows, openParents]);

  const totals = useMemo(() => {
    // Canales / real: solo hojas (sin padres, para no duplicar)
    const leaf = rows.filter((r) => !r.isParent);
    const canales = leaf.reduce(
      (acc, r) => ({
        efectivo: acc.efectivo + r.efectivo,
        mifel: acc.mifel + r.mifel,
        bbva: acc.bbva + r.bbva,
        real: acc.real + r.real,
      }),
      { efectivo: 0, mifel: 0, bbva: 0, real: 0 }
    );
    // Presupuesto vive en padres o en rubros sueltos — no en hijos
    const presupuesto = rows
      .filter((r) => r.isParent || !r.parent)
      .reduce((sum, r) => sum + r.presupuesto, 0);
    return { ...canales, presupuesto };
  }, [rows]);

  /** Venta del mes; si falta, mejor proxy disponible en meta. */
  const ventaBase = useMemo(() => {
    if (meta.venta > 0) return meta.venta;
    const efeBa = Number(meta.efe || 0) + Number(meta.ba || 0);
    if (efeBa > 0) return efeBa;
    return 0;
  }, [meta]);

  const utilidad = useMemo(() => {
    const gastos = totals.real;
    const amount = ventaBase - gastos;
    const pct = ventaBase > 0 ? amount / ventaBase : null;
    return { amount, pct, gastos, venta: ventaBase };
  }, [totals.real, ventaBase]);

  /** Solo meses ya cerrados (antes del mes calendario actual). */
  const showUtilidad = useMemo(() => {
    if (year == null || month == null) return false;
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1; // 1–12
    return year < cy || (year === cy && month < cm);
  }, [year, month]);

  const canDrill =
    Boolean(records.length) && year != null && month != null;

  const desglose: RubroDesglose | null = useMemo(() => {
    if (!desgloseTarget || !canDrill || year == null || month == null) {
      return null;
    }
    return buildRubroDesglose(records, year, month, desgloseTarget);
  }, [desgloseTarget, canDrill, records, year, month]);

  useEffect(() => {
    if (!desgloseTarget) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDesgloseTarget(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desgloseTarget]);

  function toggle(parent: string) {
    if (!PARENT_SET.has(parent)) return;
    setOpenParents((prev) => ({ ...prev, [parent]: !prev[parent] }));
  }

  return (
    <section className="mb-8">
      <div className="mb-3">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: theme.muted }}
        >
          Presupuesto vs real · por rubro
        </p>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando presupuesto…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Sin datos de presupuesto para este mes. El mes sigue
          disponible en el selector; cuando exista el Excel en Drive e
          ingest, los rubros aparecerán aquí.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-[24px] bg-white"
          style={{ boxShadow: SUITE.shadow }}
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr
                className="text-center text-xs uppercase tracking-wide text-white"
                style={{ backgroundColor: theme.tableHead }}
              >
                <th className="px-4 py-3 text-center">Rubro</th>
                <th className="px-3 py-3 text-center">Efectivo</th>
                <th className="px-3 py-3 text-center">Mifel</th>
                <th className="px-3 py-3 text-center">BBVA</th>
                <th className="px-3 py-3 text-center">Real</th>
                <th className="px-3 py-3 text-center">Presupuesto</th>
                <th className="px-3 py-3 text-center">Dif</th>
                <th className="px-4 py-3 text-center">% venta</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const isChildOfGroup = Boolean(row.parent && PARENT_SET.has(row.parent));
                const isGroupParent = Boolean(row.isParent && PARENT_SET.has(row.rubro));

                const childPctSum = isGroupParent
                  ? rows
                      .filter((r) => r.parent === row.rubro)
                      .reduce((sum, r) => {
                        const p =
                          r.pct != null
                            ? r.pct
                            : meta.venta > 0
                              ? r.real / meta.venta
                              : 0;
                        return sum + p;
                      }, 0)
                  : null;

                const dif = row.presupuesto - row.real;
                const pct = isGroupParent
                  ? childPctSum
                  : row.pct != null
                    ? row.pct
                    : meta.venta > 0
                      ? row.real / meta.venta
                      : null;

                // Hijos de insumos ocultan Presupuesto/Dif; hijos de Servicios sí los muestran
                const showBudgetDif =
                  !isChildOfGroup || row.parent === 'Servicios';

                const drillable = canDrill && row.real > 0;

                return (
                  <tr
                    key={`${row.parent || ''}:${row.rubro}:${row.sort}`}
                    className={`border-t border-slate-100 ${
                      row.isParent ? 'bg-slate-50 font-semibold' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5" style={{ color: theme.title }}>
                      {row.isParent ? (
                        <button
                          type="button"
                          onClick={() => toggle(row.rubro)}
                          className="inline-flex items-center gap-2 text-left"
                        >
                          <span className="inline-block w-4 text-slate-500">
                            {openParents[row.rubro] === false ? '▸' : '▾'}
                          </span>
                          {row.rubro}
                        </button>
                      ) : (
                        <span className={row.parent ? 'pl-6' : ''}>{row.rubro}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {row.efectivo ? money(row.efectivo) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {row.mifel ? money(row.mifel) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {row.bbva ? money(row.bbva) : '—'}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums font-semibold"
                      style={{ color: theme.title }}
                    >
                      {drillable ? (
                        <button
                          type="button"
                          onClick={() => setDesgloseTarget(row)}
                          className="inline-flex flex-col items-end gap-0.5 rounded-lg px-1.5 py-0.5 text-right transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                          title="Ver desglose semanal"
                          aria-label={`Ver desglose de ${row.rubro}`}
                        >
                          <span className="underline decoration-slate-300 underline-offset-2">
                            {money(row.real)}
                          </span>
                          <span
                            className="text-[10px] font-medium uppercase tracking-wide"
                            style={{ color: SUITE.navySoft }}
                          >
                            Ver desglose
                          </span>
                        </button>
                      ) : (
                        money(row.real)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {showBudgetDif && row.presupuesto ? money(row.presupuesto) : '—'}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums font-semibold"
                      style={{
                        color: !showBudgetDif
                          ? theme.muted
                          : dif < 0
                            ? '#B91C1C'
                            : dif > 0
                              ? '#15803D'
                              : theme.muted,
                      }}
                    >
                      {showBudgetDif && (row.presupuesto || row.real) ? money(dif) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {pctLabel(pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr
                className="text-white"
                style={{ backgroundColor: theme.tableFoot }}
              >
                <td className="px-4 py-3 font-bold">Total rubros</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {money(totals.efectivo)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {money(totals.mifel)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {money(totals.bbva)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {money(totals.real)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {money(totals.presupuesto)}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {money(totals.presupuesto - totals.real)}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums">
                  {pctLabel(meta.venta > 0 ? totals.real / meta.venta : null)}
                </td>
              </tr>
            </tfoot>
          </table>
          {showUtilidad && utilidad.venta > 0 && (
            <div
              className="border-t border-slate-100 px-4 py-4"
              style={{
                background:
                  utilidad.amount >= 0
                    ? 'linear-gradient(90deg, #ECFDF5 0%, #F0FDF4 55%, #FFFFFF 100%)'
                    : 'linear-gradient(90deg, #FEF2F2 0%, #FFF1F2 55%, #FFFFFF 100%)',
              }}
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p
                    className="text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{
                      color: utilidad.amount >= 0 ? '#166534' : '#991B1B',
                    }}
                  >
                    {utilidad.amount >= 0 ? 'Utilidad' : 'Pérdida'}
                  </p>
                  <p
                    className="mt-1 text-2xl font-bold tabular-nums"
                    style={{
                      color: utilidad.amount >= 0 ? '#15803D' : '#B91C1C',
                    }}
                  >
                    {money(Math.abs(utilidad.amount))}
                    <span className="ml-2 text-base font-semibold opacity-90">
                      {pctInline(utilidad.pct)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs" style={{ color: theme.muted }}>
                    Venta {money(utilidad.venta)} − gastos reales{' '}
                    {money(utilidad.gastos)}
                  </p>
                </div>
                <div className="min-w-[160px] flex-1 max-w-sm">
                  <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                    <span>Gastos / venta</span>
                    <span className="tabular-nums">
                      {pctLabel(
                        utilidad.venta > 0
                          ? utilidad.gastos / utilidad.venta
                          : null
                      )}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            utilidad.venta > 0
                              ? (utilidad.gastos / utilidad.venta) * 100
                              : 0
                          )
                        )}%`,
                        backgroundColor:
                          utilidad.amount >= 0 ? '#22C55E' : '#EF4444',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {desgloseTarget && desglose && (
        <DesgloseModal
          desglose={desglose}
          onClose={() => setDesgloseTarget(null)}
        />
      )}
    </section>
  );
}

function DesgloseModal({
  desglose,
  onClose,
}: {
  desglose: RubroDesglose;
  onClose: () => void;
}) {
  const sourceLabel =
    desglose.source === 'sem_detalle'
      ? 'Presupuesto · hojas SEM'
      : desglose.source === 'estados'
        ? 'Bancos / efectivo / CXP'
        : 'Sin fuente';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desglose-rubro-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[24px] bg-white sm:mx-4 sm:rounded-[24px]"
        style={{ boxShadow: SUITE.shadow }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"
          style={{ backgroundColor: '#F8FAFC' }}
        >
          <div>
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: theme.muted }}
            >
              Desglose semanal · {sourceLabel}
            </p>
            <h2
              id="desglose-rubro-title"
              className="mt-1 text-lg font-semibold"
              style={{ color: theme.title }}
            >
              {desglose.rubro}
              {desglose.parent ? (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  ({desglose.parent})
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm tabular-nums text-slate-600">
              Real del mes {money(desglose.real)}
              {desglose.totalDetalle > 0 ? (
                <>
                  {' '}
                  · detalle {money(desglose.totalDetalle)}
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/70"
          >
            Cerrar
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {desglose.dataNote && (
            <p
              className="mb-4 rounded-2xl px-3 py-2 text-xs leading-relaxed"
              style={{
                backgroundColor: 'rgba(15, 45, 74, 0.06)',
                color: SUITE.navySoft,
              }}
            >
              {desglose.dataNote}
            </p>
          )}

          {desglose.weeks.length === 0 ? (
            <p className="text-sm" style={{ color: theme.muted }}>
              No hay líneas semanales para mostrar.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {desglose.weeks.map((w) => (
                <li key={w.week}>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <p
                      className="text-xs font-bold uppercase tracking-[0.12em]"
                      style={{ color: theme.title }}
                    >
                      SEM {w.week}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-slate-800">
                      {money(w.total)}
                    </p>
                  </div>
                  <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-slate-50/60">
                    {w.lines.map((line, i) => {
                      const concept =
                        line.note ||
                        line.description ||
                        null;
                      return (
                        <li
                          key={`${w.week}-${line.canal}-${i}`}
                          className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            {concept ? (
                              <p
                                className="font-medium capitalize"
                                style={{ color: theme.title }}
                              >
                                {concept}
                              </p>
                            ) : (
                              <p className="font-medium text-slate-500">
                                Sin concepto anotado
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-slate-500">
                              {line.canal}
                            </p>
                          </div>
                          <p className="shrink-0 tabular-nums font-semibold text-slate-800">
                            {money(line.amount)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
