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

const METRIC_TITLE: Record<PersonasHistoricoMetric, string> = {
  cheque: 'Cheque promedio mensual',
  personas: 'Flujo de personas mensual',
};

const METRIC_SUBTITLE: Record<PersonasHistoricoMetric, string> = {
  cheque: 'Infocaja · Cheque promedio = Venta Total ÷ Personas',
  personas: 'Infocaja · Flujo de personas (comensales) por mes',
};

const METRIC_CHART_SUBTITLE: Record<PersonasHistoricoMetric, string> = {
  cheque: 'Cheque promedio = Venta Total ÷ Personas',
  personas: 'Flujo de personas (Infocaja)',
};

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pax(v: number) {
  return Math.round(v).toLocaleString('es-MX');
}

function varPctLabel(pct: number | null | undefined) {
  if (pct == null) return '—';
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`;
}

function varPctClass(pct: number | null | undefined) {
  if (pct == null) return 'text-slate-400';
  return pct >= 0 ? 'text-emerald-700' : 'text-rose-700';
}

export type ChequePromedioMensualCardProps = {
  records: FinancialRecord[];
  /** Años disponibles en chips (newest-first). */
  years: number[];
  className?: string;
};

/** Cheque / flujo de personas mensual · gráfica multi-año (Ver: cheque | personas). */
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
  const primaryYear = personasHistorico.years[0];
  const compareYear = personasHistorico.years[1];
  const showVar = compareYear != null;
  const ytdChangePct =
    personasMetric === 'cheque'
      ? personasHistorico.ytdChequeChangePct
      : personasHistorico.ytdPersonasChangePct;
  const lastMesLabel = personasHistorico.rows.at(-1)?.mes ?? 'hoy';

  function formatMetricCell(
    cell: { personas: number; chequePromedio: number | null } | undefined
  ): { label: string; hasValue: boolean } {
    if (!cell) return { label: '—', hasValue: false };
    if (personasMetric === 'cheque') {
      return cell.chequePromedio != null
        ? { label: money(cell.chequePromedio), hasValue: true }
        : { label: '—', hasValue: false };
    }
    return cell.personas > 0
      ? { label: pax(cell.personas), hasValue: true }
      : { label: '—', hasValue: false };
  }

  const hasChartData = chartRows.some((r) =>
    personasHistorico.years.some(
      (y) => r[String(y)] != null && Number(r[String(y)]) > 0
    )
  );

  return (
    <Card
      className={`${className} ${cardClass}`}
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.orange}`,
      }}
    >
      <SectionHeader title={METRIC_TITLE[personasMetric]}>
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
        {METRIC_SUBTITLE[personasMetric]}
      </Text>

      {hasChartData && (
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
            subtitle={METRIC_CHART_SUBTITLE[personasMetric]}
            valueDecimals={personasMetric === 'cheque' ? 2 : 0}
            valueKind={personasMetric === 'cheque' ? 'money' : 'count'}
            yFromZero
          />
        </>
      )}

      <div className={`${hasChartData ? 'mt-5' : ''} overflow-x-auto rounded-lg border border-slate-200`}>
        <table className="min-w-full text-sm">
          <thead>
            <tr
              className="text-xs font-bold uppercase tracking-wide text-white"
              style={{ backgroundColor: theme.tableHead }}
            >
              <th className="px-4 py-2.5 text-left">Mes</th>
              {personasHistorico.years.map((y) => (
                <th
                  key={y}
                  className="border-l border-l-white/25 px-3 py-2.5 text-right"
                >
                  {y}
                </th>
              ))}
              {showVar && (
                <th className="border-l border-l-white/25 px-3 py-2.5 text-right">
                  Var. vs {compareYear}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {personasHistorico.rows.map((row, i) => {
              const pct =
                personasMetric === 'cheque'
                  ? row.chequeChangePct
                  : row.personasChangePct;
              return (
                <tr
                  key={row.month}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                >
                  <td className="px-4 py-2 text-slate-700">{row.mes}</td>
                  {personasHistorico.years.map((y) => {
                    const formatted = formatMetricCell(row.byYear[y]);
                    return (
                      <td
                        key={y}
                        className="border-l border-slate-200 px-3 py-2 text-right font-semibold tabular-nums"
                        style={{
                          color: formatted.hasValue
                            ? theme.tableTotal
                            : '#94a3b8',
                        }}
                      >
                        {formatted.label}
                      </td>
                    );
                  })}
                  {showVar && (
                    <td
                      className={`border-l border-slate-200 px-3 py-2 text-right font-semibold tabular-nums ${varPctClass(
                        pct
                      )}`}
                    >
                      {varPctLabel(pct)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr
              className="font-bold text-white"
              style={{ backgroundColor: theme.tableFoot }}
            >
              <td className="px-4 py-2.5">
                Acumulado (Ene–{lastMesLabel})
              </td>
              {personasHistorico.years.map((y) => {
                const formatted = formatMetricCell(
                  personasHistorico.ytdByYear[y]
                );
                return (
                  <td
                    key={y}
                    className="border-l border-white/20 px-3 py-2.5 text-right tabular-nums"
                  >
                    {formatted.label}
                  </td>
                );
              })}
              {showVar && (
                <td
                  className={`border-l border-white/20 px-3 py-2.5 text-right tabular-nums ${
                    ytdChangePct == null
                      ? 'text-slate-300'
                      : ytdChangePct >= 0
                        ? 'text-emerald-200'
                        : 'text-rose-200'
                  }`}
                >
                  {varPctLabel(ytdChangePct)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      {showVar && primaryYear != null && (
        <Text className="mt-2 text-xs text-slate-500">
          Var. % = {primaryYear} vs {compareYear} (mismo mes). Acumulado hasta el
          mes en curso.
        </Text>
      )}
    </Card>
  );
}
