'use client';

import type { ReactNode } from 'react';
import type { SemanaBancos } from '@/app/lib/presupuesto';
import { formatTimestampCdmx } from '@/app/lib/admin-last-updates';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

type RowTone =
  | 'muted'
  | 'invest'
  | 'total'
  | 'sub'
  | 'inicial'
  | 'efectivo'
  | 'bancos'
  | 'section';

type RowDef =
  | {
      type: 'section';
      id: string;
      label: string;
      tone: 'section';
    }
  | {
      type: 'data';
      key: keyof SemanaBancos;
      label: string;
      tone?: RowTone;
    };

const ROWS: RowDef[] = [
  { type: 'section', id: 'sec-bancos', label: 'Saldo en bancos', tone: 'section' },
  { type: 'data', key: 'inicial', label: 'Saldo Inicial', tone: 'inicial' },
  { type: 'data', key: 'ingresos', label: 'ingresos' },
  { type: 'data', key: 'pagos_mifel', label: 'pagos mifel' },
  { type: 'data', key: 'comisiones', label: 'Comisiones TPV' },
  { type: 'data', key: 'pagos_bbva', label: 'pagos bbva' },
  { type: 'data', key: 'inversiones', label: 'inversiones', tone: 'invest' },
  { type: 'data', key: 'suma_ingreso', label: 'suma ingreso', tone: 'sub' },
  { type: 'data', key: 'suma_gasto', label: 'suma gastos', tone: 'sub' },
  { type: 'data', key: 'total_bancos', label: 'Total bancos', tone: 'bancos' },
  { type: 'section', id: 'sec-efectivo', label: 'Efectivo', tone: 'section' },
  {
    type: 'data',
    key: 'efectivo_ingresos',
    label: 'Efectivo ingresos',
    tone: 'efectivo',
  },
  {
    type: 'data',
    key: 'efectivo_egresos',
    label: 'Efectivo egresos',
    tone: 'efectivo',
  },
  {
    type: 'data',
    key: 'efectivo_neto',
    label: 'Efectivo neto',
    tone: 'efectivo',
  },
  {
    type: 'data',
    key: 'total',
    label: 'Total (bancos + efectivo neto)',
    tone: 'total',
  },
];

interface Props {
  weeks: SemanaBancos[];
  loading?: boolean;
  filters?: ReactNode;
  /** ISO timestamptz de la última carga de presupuesto para el mes. */
  lastUpdatedAt?: string | null;
}

export function ResumenBancosSemanal({
  weeks,
  loading,
  filters,
  lastUpdatedAt,
}: Props) {
  const lastLabel = lastUpdatedAt ? formatTimestampCdmx(lastUpdatedAt) : null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-xs font-bold uppercase tracking-[0.16em]"
            style={{ color: theme.muted }}
          >
            Resumen semanal de movimientos
          </p>
          {lastLabel ? (
            <p className="mt-1 text-xs" style={{ color: theme.muted }}>
              Presupuesto actualizado:{' '}
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                {lastLabel}
              </span>
              <span> · carga manual</span>
            </p>
          ) : !loading ? (
            <p className="mt-1 text-xs" style={{ color: theme.muted }}>
              Presupuesto: sin carga registrada para este mes · carga manual
            </p>
          ) : null}
        </div>
        {filters ? (
          <div className="flex flex-wrap items-center gap-2">{filters}</div>
        ) : null}
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
                className="text-center text-xs uppercase tracking-wide text-white"
                style={{ backgroundColor: theme.tableHead }}
              >
                <th className="px-4 py-3 text-center">Semana</th>
                {weeks.map((w) => (
                  <th key={w.week} className="px-3 py-3 text-center">
                    {w.week}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                if (row.type === 'section') {
                  return (
                    <tr
                      key={row.id}
                      style={{ backgroundColor: '#F1F5F9' }}
                    >
                      <td
                        colSpan={1 + weeks.length}
                        className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: theme.muted }}
                      >
                        {row.label}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={row.key}
                    className="border-t border-slate-100"
                    style={{
                      backgroundColor:
                        row.tone === 'inicial'
                          ? '#E8EEF7'
                          : row.tone === 'invest'
                            ? SUITE.orangeSoft
                            : row.tone === 'efectivo'
                              ? '#F0FDFA'
                              : row.tone === 'bancos'
                                ? '#DBEAFE'
                                : row.tone === 'total'
                                  ? '#DCFCE7'
                                  : row.tone === 'sub'
                                    ? '#F8FAFC'
                                    : undefined,
                    }}
                  >
                    <td
                      className={`px-4 py-2.5 ${
                        row.tone === 'inicial' ||
                        row.tone === 'total' ||
                        row.tone === 'sub' ||
                        row.tone === 'efectivo' ||
                        row.tone === 'bancos'
                          ? 'font-bold'
                          : ''
                      }`}
                      style={{
                        color:
                          row.tone === 'inicial' || row.tone === 'bancos'
                            ? SUITE.navy
                            : row.tone === 'efectivo'
                              ? '#0F766E'
                              : theme.title,
                      }}
                    >
                      {row.label}
                    </td>
                    {weeks.map((w) => (
                      <td
                        key={w.week}
                        className={`px-3 py-2.5 text-right tabular-nums ${
                          row.tone === 'inicial' ||
                          row.tone === 'total' ||
                          row.tone === 'sub' ||
                          row.tone === 'efectivo' ||
                          row.tone === 'bancos'
                            ? 'font-bold'
                            : ''
                        }`}
                        style={{
                          color:
                            row.tone === 'inicial' || row.tone === 'bancos'
                              ? SUITE.navy
                              : row.tone === 'invest'
                                ? SUITE.orangeDeep
                                : row.tone === 'efectivo'
                                  ? '#0F766E'
                                  : theme.title,
                        }}
                      >
                        {money(Number(w[row.key] || 0))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
