'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import { MonthlyTotalComparisonChart } from '@/app/components/MonthlyCharts';
import { colorForYear } from '@/app/components/WeeklyComparisonChart';
import { SectionHeader, yearChipClass } from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  buildWeeklySalesByYear,
  buildMonthlySalesByYear,
  buildMonthlyTotalChartRows,
  monthlyAverageForYear,
  monthlyTotalForYear,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type VentasPorMesCardProps = {
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

/** Ventas por mes · gráfica comparativa multi-año (misma lógica que Ventas). */
export function VentasPorMesCard({
  records,
  years,
  weeklyDataYears,
  eventosFallbackByDate,
  loading = false,
  className = 'mb-8',
}: VentasPorMesCardProps) {
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

  const monthlyByYear = useMemo(
    () =>
      buildMonthlySalesByYear(records, weeklyByYear, years, {
        eventosFallbackByDate,
      }),
    [records, weeklyByYear, years, eventosFallbackByDate]
  );

  const monthlyTotalChartRows = useMemo(
    () => buildMonthlyTotalChartRows(monthlyByYear, compareYears, null),
    [monthlyByYear, compareYears]
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

  const hasChartData = monthlyTotalChartRows.some((r) =>
    compareYears.some((y) => Number(r[String(y)] ?? 0) > 0)
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
      <SectionHeader title="Ventas por mes">
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
                  total {money(monthlyTotalForYear(monthlyByYear, y))}
                  {monthlyAverageForYear(monthlyByYear, y) > 0 && (
                    <> · prom. mensual {money(monthlyAverageForYear(monthlyByYear, y))}</>
                  )}
                </span>
              </div>
            ))}
          </div>
          <MonthlyTotalComparisonChart rows={monthlyTotalChartRows} years={compareYears} />
        </>
      ) : (
        <p className="py-16 text-center text-slate-400">Sin datos</p>
      )}
    </Card>
  );
}
