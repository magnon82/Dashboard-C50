'use client';

import { Card, Metric, Text } from '@tremor/react';
import { SemanaEnCursoChart } from '@/app/components/SemanaEnCursoChart';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import { formatShort, type DaySale } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

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

export type WeekToDateData = {
  days: DaySale[];
  total: number;
  totalCortes: number;
  totalComensales: number;
  chequePromedio: number | null;
  mondayKey: string;
  sundayKey: string;
  asOf: string;
  weekNumber: number;
  year: number;
  prevYear: number;
  prevTotal: number;
  prevTotalComensales: number;
  changePct: number | null;
  comensalesChangePct: number | null;
};

export type SemanaWeekOption = {
  week: number;
  label: string;
};

export type SemanaEnCursoTableProps = {
  weekToDate: WeekToDateData;
  /** Show DESC./CANC. column (Ventas). Hide for Reportes Socios. Default true. */
  showDescCanc?: boolean;
  className?: string;
  /**
   * Selector de semanas del año en curso (más reciente primero).
   * Si no se pasa, no se muestra el control.
   */
  weekOptions?: SemanaWeekOption[];
  /** Semana seleccionada (Acumulado). Default = weekToDate.weekNumber. */
  selectedWeek?: number;
  onWeekChange?: (week: number) => void;
};

/** Comparativo semana en curso: año actual | año anterior | Var. */
export function SemanaEnCursoTable({
  weekToDate,
  showDescCanc = true,
  className = 'mb-8',
  weekOptions,
  selectedWeek,
  onWeekChange,
}: SemanaEnCursoTableProps) {
  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';
  const cardStyle = {
    backgroundColor: theme.cardBg,
    boxShadow: SUITE.shadow,
  } as const;

  const yearColSpan = showDescCanc ? 5 : 4;
  const daysWithSale = weekToDate.days.filter((d) => d.total > 0).length;
  const isCurrentWeekWtd = weekToDate.asOf < weekToDate.sundayKey;
  const showWeekSelect =
    Array.isArray(weekOptions) &&
    weekOptions.length > 1 &&
    typeof onWeekChange === 'function';
  const activeWeek = selectedWeek ?? weekToDate.weekNumber;
  const latestOptionWeek = weekOptions?.[0]?.week;
  const viewingPriorWeek =
    latestOptionWeek != null && activeWeek > 0 && activeWeek < latestOptionWeek;

  const title = viewingPriorWeek
    ? `Ventas de la semana${weekToDate.weekNumber > 0 ? ` · S${weekToDate.weekNumber}` : ''}`
    : `Ventas de la semana en curso${weekToDate.weekNumber > 0 ? ` · S${weekToDate.weekNumber}` : ''}`;

  const totalLabel = isCurrentWeekWtd ? 'Total (lun–hoy)' : 'Total (lun–dom)';

  return (
    <Card
      className={`${className} ${cardClass}`}
      style={{ ...cardStyle, borderTop: `4px solid ${SUITE.navy}` }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Text
            className="text-xs font-bold uppercase tracking-wide"
            style={{ color: theme.kpi[2]?.label ?? theme.kpi[0].label }}
          >
            {title}
          </Text>
          <Metric className="mt-1 text-3xl font-bold text-slate-900 md:text-4xl">
            {weekToDate.total > 0 ? money(weekToDate.total) : '—'}
          </Metric>
          <Text className="mt-1 text-sm text-slate-500">
            {formatShort(weekToDate.mondayKey)} – {formatShort(weekToDate.sundayKey)}
            {' · '}
            {daysWithSale} día{daysWithSale !== 1 ? 's' : ''} con venta
          </Text>
        </div>
        {showWeekSelect ? (
          <label className={`${filterControlClass} bg-white shadow-sm`}>
            <span className="shrink-0 text-slate-500">Semana</span>
            <select
              className={`${filterSelectClass} min-w-[12rem] max-w-[18rem] cursor-pointer bg-white`}
              value={activeWeek > 0 ? activeWeek : ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1) onWeekChange!(v);
              }}
              aria-label="Consultar semana del año en curso"
            >
              {weekOptions!.map((o) => (
                <option key={o.week} value={o.week}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {weekToDate.days.length === 0 ? (
        <p className="py-4 text-center text-slate-400">Sin datos Infocaja esta semana.</p>
      ) : (
        <>
          <SemanaEnCursoChart
            days={weekToDate.days}
            year={weekToDate.year}
            prevYear={weekToDate.prevYear}
          />
          <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr
                className="text-xs font-bold uppercase tracking-wide text-white"
                style={{ backgroundColor: theme.tableHead }}
              >
                <th
                  rowSpan={2}
                  className="border-b border-white/15 px-4 py-2.5 text-left align-bottom"
                >
                  Día
                </th>
                <th
                  colSpan={yearColSpan}
                  className="border-b border-white/15 border-l border-l-white/25 px-4 py-2 text-center"
                >
                  {weekToDate.year}
                </th>
                <th
                  colSpan={3}
                  className="border-b border-white/15 border-l border-l-white/25 px-4 py-2 text-center"
                >
                  {weekToDate.prevYear}
                </th>
                <th
                  colSpan={2}
                  className="border-b border-white/15 border-l border-l-white/25 px-4 py-2 text-center"
                >
                  Var.
                </th>
              </tr>
              <tr
                className="text-[11px] uppercase tracking-wide text-white/95"
                style={{ backgroundColor: theme.tableFoot }}
              >
                <th className="border-l border-l-white/25 px-3 py-2 text-left font-semibold">
                  Fecha
                </th>
                <th className="px-3 py-2 text-right font-semibold">Venta</th>
                <th className="px-3 py-2 text-right font-semibold">Personas</th>
                <th className="px-3 py-2 text-right font-semibold">Cheque prom.</th>
                {showDescCanc && (
                  <th className="px-3 py-2 text-right font-semibold">Desc./Canc.</th>
                )}
                <th className="border-l border-l-white/25 px-3 py-2 text-left font-semibold">
                  Fecha
                </th>
                <th className="px-3 py-2 text-right font-semibold">Venta</th>
                <th className="px-3 py-2 text-right font-semibold">Personas</th>
                <th className="border-l border-l-white/25 px-3 py-2 text-right font-semibold">
                  % venta
                </th>
                <th className="px-3 py-2 text-right font-semibold">% personas</th>
              </tr>
            </thead>
            <tbody>
              {weekToDate.days.map((d, i) => (
                <tr key={d.date} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-4 py-2 capitalize text-slate-700">{d.weekday}</td>
                  <td className="border-l border-slate-200 px-3 py-2 text-slate-600">
                    {d.label}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-semibold tabular-nums"
                    style={{ color: d.total > 0 ? theme.tableTotal : '#94a3b8' }}
                  >
                    {d.total > 0 ? money(d.total) : '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-medium tabular-nums"
                    style={{
                      color: d.comensales > 0 ? theme.tableTotal : '#94a3b8',
                    }}
                  >
                    {d.comensales > 0 ? pax(d.comensales) : '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-medium tabular-nums"
                    style={{
                      color: d.chequePromedio != null ? theme.tableTotal : '#94a3b8',
                    }}
                  >
                    {d.chequePromedio != null ? money(d.chequePromedio) : '—'}
                  </td>
                  {showDescCanc && (
                    <td
                      className="px-3 py-2 text-right font-medium tabular-nums"
                      style={{ color: d.cortes > 0 ? '#b45309' : '#94a3b8' }}
                    >
                      {d.cortes > 0 ? money(d.cortes) : '—'}
                    </td>
                  )}
                  <td className="border-l border-slate-200 px-3 py-2 text-slate-500">
                    {d.prevLabel ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-600">
                    {(d.prevTotal ?? 0) > 0 ? money(d.prevTotal!) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-600">
                    {(d.prevComensales ?? 0) > 0 ? pax(d.prevComensales!) : '—'}
                  </td>
                  <td
                    className={`border-l border-slate-200 px-3 py-2 text-right font-semibold tabular-nums ${varPctClass(
                      d.changePct
                    )}`}
                  >
                    {varPctLabel(d.changePct)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold tabular-nums ${varPctClass(
                      d.comensalesChangePct
                    )}`}
                  >
                    {varPctLabel(d.comensalesChangePct)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold text-white" style={{ backgroundColor: theme.tableFoot }}>
                <td className="px-4 py-2.5" colSpan={2}>
                  {totalLabel}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {weekToDate.total > 0 ? money(weekToDate.total) : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {weekToDate.totalComensales > 0
                    ? pax(weekToDate.totalComensales)
                    : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {weekToDate.chequePromedio != null
                    ? money(weekToDate.chequePromedio)
                    : '—'}
                </td>
                {showDescCanc && (
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {weekToDate.totalCortes > 0 ? money(weekToDate.totalCortes) : '—'}
                  </td>
                )}
                <td className="border-l border-white/20 px-3 py-2.5 text-slate-200">—</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {weekToDate.prevTotal > 0 ? money(weekToDate.prevTotal) : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {weekToDate.prevTotalComensales > 0
                    ? pax(weekToDate.prevTotalComensales)
                    : '—'}
                </td>
                <td className="border-l border-white/20 px-3 py-2.5 text-right tabular-nums">
                  {varPctLabel(weekToDate.changePct)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {varPctLabel(weekToDate.comensalesChangePct)}
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
