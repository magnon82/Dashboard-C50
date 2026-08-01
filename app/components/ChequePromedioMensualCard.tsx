'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Text } from '@tremor/react';
import { MonthlyComparisonChart } from '@/app/components/MonthlyCharts';
import { colorForYear } from '@/app/components/WeeklyComparisonChart';
import {
  SectionHeader,
  filterControlClass,
  filterSelectClass,
  yearChipClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  buildMonthlyPersonasByYear,
  buildPersonasHistorico,
  buildPersonasMetricChartRows,
  buildWeekToDateSales,
  parseIsoDate,
  type FinancialRecord,
  type PersonasHistoricoMetric,
} from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pax(v: number) {
  return Math.round(v).toLocaleString('es-MX');
}

export type ChequePromedioMensualCardProps = {
  records: FinancialRecord[];
  /** Años disponibles en chips (newest-first). */
  years: number[];
  className?: string;
};

/** Cheque promedio mensual · gráfica multi-año (Ver: cheque | personas). */
export function ChequePromedioMensualCard({
  records,
  years,
  className = 'mb-8',
}: ChequePromedioMensualCardProps) {
  const [personasYears, setPersonasYears] = useState<number[]>(() => {
    const y = new Date().getFullYear();
    return [y, y - 1].filter((x) => years.includes(x));
  });
  const [personasMetric, setPersonasMetric] =
    useState<PersonasHistoricoMetric>('cheque');

  const weekToDate = useMemo(() => buildWeekToDateSales(records), [records]);

  const monthlyPersonasByYear = useMemo(
    () => buildMonthlyPersonasByYear(records, years),
    [records, years]
  );

  useEffect(() => {
    const y = weekToDate.year;
    const py = weekToDate.prevYear;
    const yearSet = new Set(years);
    setPersonasYears((prev) => {
      const valid = prev.filter((x) => yearSet.has(x));
      if (valid.length >= 1) {
        if (valid.length === prev.length && valid.every((x, i) => x === prev[i])) {
          return prev;
        }
        return valid;
      }
      return [y, py].filter((x) => yearSet.has(x));
    });
  }, [weekToDate.year, weekToDate.prevYear, years]);

  const personasHistorico = useMemo(() => {
    const mesAsOf =
      parseIsoDate(weekToDate.asOf)?.m ?? new Date().getMonth() + 1;
    const selected =
      personasYears.length > 0
        ? personasYears
        : [weekToDate.year, weekToDate.prevYear];
    return buildPersonasHistorico(monthlyPersonasByYear, selected, mesAsOf);
  }, [
    monthlyPersonasByYear,
    personasYears,
    weekToDate.year,
    weekToDate.prevYear,
    weekToDate.asOf,
  ]);

  const chartRows = useMemo(
    () =>
      buildPersonasMetricChartRows(
        monthlyPersonasByYear,
        personasHistorico.years,
        personasMetric
      ),
    [monthlyPersonasByYear, personasHistorico.years, personasMetric]
  );

  function togglePersonasYear(y: number) {
    setPersonasYears((prev) => {
      if (prev.includes(y)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== y);
      }
      return [...prev, y].sort((a, b) => b - a);
    });
  }

  if (personasHistorico.rows.length === 0) return null;

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
      <SectionHeader title="Cheque promedio mensual">
        <label className={filterControlClass}>
          <span className="text-slate-500">Ver</span>
          <select
            className={`${filterSelectClass} min-w-[9rem] cursor-pointer`}
            value={personasMetric}
            onChange={(e) =>
              setPersonasMetric(e.target.value as PersonasHistoricoMetric)
            }
            aria-label="Métrica cheque o personas"
          >
            <option value="cheque">Cheque promedio</option>
            <option value="personas">Número de personas</option>
          </select>
        </label>
        {years.map((y) => {
          const active = personasYears.includes(y);
          const c = colorForYear(y);
          return (
            <button
              key={y}
              type="button"
              onClick={() => togglePersonasYear(y)}
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
      <Text className="-mt-2 mb-4 text-sm text-slate-500">
        {personasMetric === 'cheque'
          ? 'Infocaja · Cheque promedio = Venta Total ÷ Personas'
          : 'Infocaja · Número de personas por mes'}
      </Text>

      {chartRows.some((r) =>
        personasHistorico.years.some(
          (y) => r[String(y)] != null && Number(r[String(y)]) > 0
        )
      ) && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            {personasHistorico.years.map((y) => {
              const ytd = personasHistorico.ytdByYear[y];
              const ytdLabel =
                personasMetric === 'cheque'
                  ? ytd?.chequePromedio != null
                    ? money(ytd.chequePromedio)
                    : null
                  : (ytd?.personas ?? 0) > 0
                    ? pax(ytd.personas)
                    : null;
              return (
                <div key={y} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: colorForYear(y) }}
                  />
                  <span
                    className="text-sm font-semibold"
                    style={{ color: theme.title }}
                  >
                    {y}
                  </span>
                  {ytdLabel != null && (
                    <span className="text-xs text-slate-500">{ytdLabel}</span>
                  )}
                </div>
              );
            })}
          </div>
          <MonthlyComparisonChart
            rows={chartRows}
            years={personasHistorico.years}
            subtitle={
              personasMetric === 'cheque'
                ? 'Cheque promedio = Venta Total ÷ Personas'
                : 'Número de personas (Infocaja)'
            }
            valueDecimals={personasMetric === 'cheque' ? 2 : 0}
            valueKind={personasMetric === 'cheque' ? 'money' : 'count'}
            yFromZero
          />
        </>
      )}
    </Card>
  );
}
