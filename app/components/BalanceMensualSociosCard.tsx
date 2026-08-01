'use client';

import { useMemo } from 'react';
import { Card } from '@tremor/react';
import { SectionHeader } from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  buildBalanceMensualPorAno,
  sumBalanceMensual,
} from '@/app/lib/presupuesto';
import { MESES, type FinancialRecord } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

const BALANCE_YEAR = 2026;

function money(v: number) {
  return `$${v.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function balanceColor(v: number): string {
  if (v > 0) return '#0F766E';
  if (v < 0) return '#B91C1C';
  return theme.muted;
}

export type BalanceMensualSociosCardProps = {
  records: FinancialRecord[];
  loading?: boolean;
  className?: string;
};

/**
 * Balance mensual 2026 para Reportes Socios.
 * Misma base que el resumen semanal de Finanzas (sin detalle de movimientos).
 */
export function BalanceMensualSociosCard({
  records,
  loading = false,
  className = 'mb-8',
}: BalanceMensualSociosCardProps) {
  const rows = useMemo(
    () => buildBalanceMensualPorAno(records, BALANCE_YEAR),
    [records]
  );
  const ytd = useMemo(() => sumBalanceMensual(rows), [rows]);

  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';

  return (
    <Card
      className={`${className} ${cardClass}`}
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.navy}`,
      }}
    >
      <SectionHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-lg font-semibold leading-none"
              style={{ color: theme.title }}
            >
              Balance
            </span>
            <span
              className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              {BALANCE_YEAR}
            </span>
          </div>
        }
      />

      <p className="mb-4 text-xs" style={{ color: theme.muted }}>
        Totales mensuales · sin detalle de movimientos · {BALANCE_YEAR}. El mes
        se incorpora al acumulado a partir del día 10 del mes siguiente.
      </p>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando balance…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Sin meses incorporados aún en {BALANCE_YEAR}.
        </p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Kpi label="Ingresos" value={ytd.ingresos} />
            <Kpi label="Gastos" value={ytd.gastos} />
            <Kpi
              label="Balance"
              value={ytd.balance}
              valueColor={balanceColor(ytd.balance)}
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase tracking-wide"
                  style={{ backgroundColor: '#F8FAFC', color: theme.muted }}
                >
                  <th className="px-4 py-3 font-semibold">Mes</th>
                  <th className="px-4 py-3 text-right font-semibold">Ingresos</th>
                  <th className="px-4 py-3 text-right font-semibold">Gastos</th>
                  <th className="px-4 py-3 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.year}-${r.month}`}
                    className="border-t border-slate-100"
                  >
                    <td
                      className="px-4 py-2.5 font-medium"
                      style={{ color: theme.title }}
                    >
                      {MESES[r.month - 1]}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right tabular-nums"
                      style={{ color: theme.title }}
                    >
                      {money(r.ingresos)}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right tabular-nums"
                      style={{ color: theme.title }}
                    >
                      {money(r.gastos)}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right font-semibold tabular-nums"
                      style={{ color: balanceColor(r.balance) }}
                    >
                      {money(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr
                  className="border-t border-slate-200"
                  style={{ backgroundColor: '#F8FAFC' }}
                >
                  <td
                    className="px-4 py-3 text-xs font-bold uppercase tracking-wide"
                    style={{ color: theme.muted }}
                  >
                    Acumulado (meses incorporados)
                  </td>
                  <td
                    className="px-4 py-3 text-right font-semibold tabular-nums"
                    style={{ color: theme.title }}
                  >
                    {money(ytd.ingresos)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-semibold tabular-nums"
                    style={{ color: theme.title }}
                  >
                    {money(ytd.gastos)}
                  </td>
                  <td
                    className="px-4 py-3 text-right font-semibold tabular-nums"
                    style={{ color: balanceColor(ytd.balance) }}
                  >
                    {money(ytd.balance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function Kpi({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: number;
  valueColor?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <p
        className="text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: theme.muted }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-xl font-semibold tabular-nums"
        style={{ color: valueColor || theme.title }}
      >
        {money(value)}
      </p>
    </div>
  );
}
