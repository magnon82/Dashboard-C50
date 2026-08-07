'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import { MonthlyComparisonChart } from '@/app/components/MonthlyCharts';
import { colorForYear } from '@/app/components/WeeklyComparisonChart';
import { SectionHeader, yearChipClass } from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  MESES,
  buildWeeklySalesByYear,
  buildMonthlyWeeklyAverageByYear,
  buildMonthlyAvgChartRows,
  yearWeeklyAverageFromMonthly,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type PromedioVentaSemanalPorMesCardProps = {
  records: FinancialRecord[];
  /** Años disponibles en chips (newest-first). */
  years: number[];
  /** Years passed to buildWeeklySalesByYear; defaults to `years`. */
  weeklyDataYears?: number[];
  /** staff_rpt OS+extra por día — fallback Eventos si Sheets vacío. */
  eventosFallbackByDate?: Record<string, number> | null;
  loading?: boolean;
  className?: string;
};

/** Promedio venta semanal por mes · gráfica + tabla multi-año. */
export function PromedioVentaSemanalPorMesCard({
  records,
  years,
  weeklyDataYears,
  eventosFallbackByDate,
  loading = false,
  className = 'mb-8',
}: PromedioVentaSemanalPorMesCardProps) {
  const dataYears = weeklyDataYears ?? years;

  const [compareYears, setCompareYears] = useState<number[]>(() => {
    const y = new Date().getFullYear();
    return [y, y - 1].filter((x) => years.includes(x));
  });

  useEffect(() => {
    const yearSet = new Set(years);
    setCompareYears((prev) => {
      const valid = prev.filter((x) => yearSet.has(x));
      if (valid.length >= 1) {
        if (valid.length === prev.length && valid.every((x, i) => x === prev[i])) {
          return prev;
        }
        return valid;
      }
      const y = new Date().getFullYear();
      return [y, y - 1].filter((x) => yearSet.has(x));
    });
  }, [years]);

  const weeklyByYear = useMemo(
    () =>
      buildWeeklySalesByYear(records, dataYears, { eventosFallbackByDate }),
    [records, dataYears, eventosFallbackByDate]
  );

  const monthlyAvgByYear = useMemo(
    () => buildMonthlyWeeklyAverageByYear(weeklyByYear, years),
    [weeklyByYear, years]
  );

  const monthlyAvgChartRows = useMemo(
    () => buildMonthlyAvgChartRows(monthlyAvgByYear, compareYears),
    [monthlyAvgByYear, compareYears]
  );

  function toggleCompareYear(y: number) {
    setCompareYears((prev) => {
      if (prev.includes(y)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== y);
      }
      return [...prev, y].sort((a, b) => b - a);
    });
  }

  const hasChartData = monthlyAvgChartRows.some((r) =>
    compareYears.some((y) => r[String(y)] != null && Number(r[String(y)]) > 0)
  );

  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';

  return (
    <Card
      className={`${className} ${cardClass}`}
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.orange}`,
      }}
    >
      <SectionHeader title="Promedio venta semanal por mes">
        {years.map((y) => {
          const active = compareYears.includes(y);
          const c = colorForYear(y);
          return (
            <button
              key={y}
              type="button"
              onClick={() => toggleCompareYear(y)}
              className={yearChipClass(active)}
              style={{
                backgroundColor: active ? c : undefined,
                color: active ? '#fff' : undefined,
                border: active ? `2px solid ${c}` : '2px solid #e2e8f0',
              }}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/30"
                style={{ backgroundColor: active ? '#fff' : c }}
              />
              {y}
            </button>
          );
        })}
      </SectionHeader>

      {loading ? (
        <p className="py-16 text-center text-slate-400">Cargando...</p>
      ) : hasChartData ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            {compareYears.map((y) => (
              <div key={y} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: colorForYear(y) }}
                />
                <span className="text-sm font-semibold" style={{ color: theme.title }}>
                  {y}
                </span>
                <span className="text-xs text-slate-500">
                  prom. anual {money(yearWeeklyAverageFromMonthly(monthlyAvgByYear, y))}
                </span>
              </div>
            ))}
          </div>

          <MonthlyComparisonChart rows={monthlyAvgChartRows} years={compareYears} />

          <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr
                  className="text-center text-xs uppercase tracking-wide text-white"
                  style={{ backgroundColor: theme.tableHead }}
                >
                  <th
                    className="sticky left-0 px-4 py-3"
                    style={{ backgroundColor: theme.tableHead }}
                  >
                    Año
                  </th>
                  {MESES.map((m) => (
                    <th key={m} className="px-3 py-3 whitespace-nowrap">
                      {m.slice(0, 3)}
                    </th>
                  ))}
                  <th className="px-4 py-3">Prom. anual</th>
                </tr>
              </thead>
              <tbody>
                {compareYears.map((y, i) => (
                  <tr key={y} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td
                      className="sticky left-0 px-4 py-2.5 font-semibold"
                      style={{
                        color: colorForYear(y),
                        backgroundColor: i % 2 === 0 ? '#fff' : '#f8fafc',
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-6 rounded-sm"
                          style={{ backgroundColor: colorForYear(y) }}
                        />
                        {y}
                      </span>
                    </td>
                    {MESES.map((mes, mi) => {
                      const val =
                        monthlyAvgByYear.get(y)?.get(mi + 1)?.promSemanal ?? 0;
                      return (
                        <td
                          key={mes}
                          className="px-3 py-2.5 text-right tabular-nums text-slate-700 whitespace-nowrap"
                        >
                          {val > 0 ? money(val) : '—'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                      {money(yearWeeklyAverageFromMonthly(monthlyAvgByYear, y))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="py-16 text-center text-slate-400">Sin datos mensuales</p>
      )}
    </Card>
  );
}
