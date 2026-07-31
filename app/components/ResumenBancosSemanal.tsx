'use client';

import type { ReactNode } from 'react';
import type { SemanaBancos } from '@/app/lib/presupuesto';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

const ROWS: Array<{
  key: keyof SemanaBancos;
  label: string;
  tone?: 'muted' | 'invest' | 'total' | 'sub';
}> = [
  { key: 'inicial', label: 'inicial' },
  { key: 'ingresos', label: 'ingresos' },
  { key: 'pagos_mifel', label: 'pagos mifel' },
  { key: 'comisiones', label: 'comisiones' },
  { key: 'pagos_bbva', label: 'pagos bbva' },
  { key: 'inversiones', label: 'inversiones', tone: 'invest' },
  { key: 'suma_ingreso', label: 'suma ingreso', tone: 'sub' },
  { key: 'suma_gasto', label: 'suma gastos', tone: 'sub' },
  { key: 'total', label: 'total', tone: 'total' },
];

interface Props {
  weeks: SemanaBancos[];
  loading?: boolean;
  filters?: ReactNode;
}

export function ResumenBancosSemanal({ weeks, loading, filters }: Props) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: theme.muted }}
        >
          Resumen semanal · bancos
        </p>
        {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando resumen…
        </p>
      ) : weeks.length === 0 ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Sin datos semanales de bancos para este mes.
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
                <th className="px-4 py-3">Concepto</th>
                {weeks.map((w) => (
                  <th key={w.week} className="px-3 py-3 text-right">
                    {w.week}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-slate-100"
                  style={{
                    backgroundColor:
                      row.tone === 'invest'
                        ? SUITE.orangeSoft
                        : row.tone === 'total'
                          ? '#DCFCE7'
                          : row.tone === 'sub'
                            ? '#F8FAFC'
                            : undefined,
                  }}
                >
                  <td
                    className={`px-4 py-2.5 capitalize ${
                      row.tone === 'total' || row.tone === 'sub' ? 'font-bold' : ''
                    }`}
                    style={{ color: theme.title }}
                  >
                    {row.label}
                  </td>
                  {weeks.map((w) => (
                    <td
                      key={w.week}
                      className={`px-3 py-2.5 text-right tabular-nums ${
                        row.tone === 'total' || row.tone === 'sub'
                          ? 'font-bold'
                          : ''
                      }`}
                      style={{
                        color:
                          row.tone === 'invest' ? SUITE.orangeDeep : theme.title,
                      }}
                    >
                      {money(Number(w[row.key] || 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
