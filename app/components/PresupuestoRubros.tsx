'use client';

import { useMemo, useState } from 'react';
import type { RubroRow, PresupuestoMeta } from '@/app/lib/presupuesto';
import { COLLAPSIBLE_PARENTS } from '@/app/lib/presupuesto';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function pctLabel(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`;
}

interface Props {
  rows: RubroRow[];
  meta: PresupuestoMeta;
  loading?: boolean;
}

const PARENT_SET = new Set<string>(COLLAPSIBLE_PARENTS);

export function PresupuestoRubros({ rows, meta, loading }: Props) {
  const [openParents, setOpenParents] = useState<Record<string, boolean>>({
    'INSUMOS DE COCINA': false,
    'INSUMOS DE BARRA': false,
    SERVICIOS: false,
  });

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
        {meta.venta > 0 && (
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            Venta del mes {money(meta.venta)}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando presupuesto…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Sin datos de presupuesto para este mes.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-[24px] bg-white"
          style={{ boxShadow: SUITE.shadow }}
        >
          <table className="min-w-full text-sm">
            <thead>
              <tr
                className="text-left text-xs uppercase tracking-wide text-white"
                style={{ backgroundColor: theme.tableHead }}
              >
                <th className="px-4 py-3">Rubro</th>
                <th className="px-3 py-3 text-right">Efectivo</th>
                <th className="px-3 py-3 text-right">Mifel</th>
                <th className="px-3 py-3 text-right">BBVA</th>
                <th className="px-3 py-3 text-right">Real</th>
                <th className="px-3 py-3 text-right">Presupuesto</th>
                <th className="px-3 py-3 text-right">Dif</th>
                <th className="px-4 py-3 text-right">% venta</th>
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

                const showBudgetDif = !isChildOfGroup;

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
                      {money(row.real)}
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
        </div>
      )}
    </section>
  );
}
