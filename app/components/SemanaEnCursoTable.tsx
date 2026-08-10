'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { SemanaEnCursoChart } from '@/app/components/SemanaEnCursoChart';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  formatShort,
  withEventosStaffRptFallback,
  type DaySale,
} from '@/app/lib/ventas-semana';

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

/** Resalta Total vs WI/Eventos (suite: orange soft + navy, estilo Venta día). */
const totalColBodyStyle: CSSProperties = {
  backgroundColor: SUITE.orangeSoft,
  boxShadow: `inset 1px 0 0 ${SUITE.orange}, inset -1px 0 0 ${SUITE.orange}`,
};
const totalColHeadStyle: CSSProperties = {
  backgroundColor: SUITE.orange,
  color: SUITE.navy,
};
const totalColFootStyle: CSSProperties = {
  backgroundColor: SUITE.orange,
  color: SUITE.navy,
};

function moneyCell(
  v: number | null | undefined,
  opts?: { muted?: boolean; totalCol?: boolean }
) {
  const n = v ?? 0;
  const empty = n <= 0;
  const totalCol = opts?.totalCol === true;
  const color = empty
    ? '#94a3b8'
    : totalCol
      ? SUITE.navy
      : opts?.muted
        ? undefined
        : theme.tableTotal;
  return (
    <td
      className={`px-2 py-2 text-right tabular-nums ${
        totalCol ? 'font-bold' : 'font-medium'
      } ${opts?.muted && !empty && !totalCol ? 'text-slate-600' : ''}`}
      style={{
        ...(color != null ? { color } : {}),
        ...(totalCol ? totalColBodyStyle : {}),
      }}
    >
      {empty ? '—' : money(n)}
    </td>
  );
}

export type WeekToDateData = {
  days: DaySale[];
  total: number;
  totalEventos: number;
  totalVentaWi: number;
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
  prevTotalEventos: number;
  prevTotalVentaWi: number;
  prevTotalComensales: number;
  prevChequePromedio?: number | null;
  changePct: number | null;
  comensalesChangePct: number | null;
  prevMondayKey?: string;
  prevAsOfKey?: string;
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
  /**
   * Eventos staff_rpt ya cargados en la página (YTD).
   * Si se pasa, no se hace fetch propio del rango de la semana.
   */
  eventosFallbackByDate?: Record<string, number> | null;
};

/** Comparativo semana en curso: año actual | año anterior | Var. */
export function SemanaEnCursoTable({
  weekToDate: weekToDateProp,
  showDescCanc = true,
  className = 'mb-8',
  weekOptions,
  selectedWeek,
  onWeekChange,
  eventosFallbackByDate: eventosFallbackFromParent,
}: SemanaEnCursoTableProps) {
  const [staffRptEventos, setStaffRptEventos] = useState<
    Record<string, number>
  >({});

  const parentProvidesFallback = eventosFallbackFromParent != null;

  useEffect(() => {
    if (parentProvidesFallback) return;
    let cancelled = false;
    async function load() {
      const ranges: Array<{ from: string; to: string }> = [
        { from: weekToDateProp.mondayKey, to: weekToDateProp.asOf },
      ];
      if (
        weekToDateProp.prevMondayKey &&
        weekToDateProp.prevAsOfKey &&
        weekToDateProp.prevMondayKey <= weekToDateProp.prevAsOfKey
      ) {
        ranges.push({
          from: weekToDateProp.prevMondayKey,
          to: weekToDateProp.prevAsOfKey,
        });
      }

      const merged: Record<string, number> = {};
      await Promise.all(
        ranges.map(async ({ from, to }) => {
          try {
            const qs = new URLSearchParams({ from, to });
            const res = await fetch(`/api/ventas/staff-rpt-eventos?${qs}`, {
              cache: 'no-store',
            });
            const json = (await res.json()) as {
              byDate?: Record<string, number>;
            };
            if (!res.ok || !json.byDate) return;
            Object.assign(merged, json.byDate);
          } catch {
            /* staff_rpt opcional: sin fallback se queda Sheets/0 */
          }
        })
      );
      if (!cancelled) setStaffRptEventos(merged);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    parentProvidesFallback,
    weekToDateProp.mondayKey,
    weekToDateProp.asOf,
    weekToDateProp.prevMondayKey,
    weekToDateProp.prevAsOfKey,
  ]);

  const weekToDate = useMemo(
    () =>
      withEventosStaffRptFallback(
        weekToDateProp,
        parentProvidesFallback
          ? eventosFallbackFromParent
          : staffRptEventos
      ),
    [
      weekToDateProp,
      parentProvidesFallback,
      eventosFallbackFromParent,
      staffRptEventos,
    ]
  );

  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';
  const cardStyle = {
    backgroundColor: theme.cardBg,
    boxShadow: SUITE.shadow,
  } as const;

  // Fecha + WI + Eventos + Total + Personas + Cheque [+ Desc]
  const yearColSpan = showDescCanc ? 7 : 6;
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
                  className="border-b border-white/15 px-3 py-2.5 text-left align-bottom"
                >
                  Día
                </th>
                <th
                  colSpan={yearColSpan}
                  className="border-b border-white/15 border-l border-l-white/25 px-3 py-2 text-center"
                >
                  {weekToDate.year}
                </th>
                <th
                  colSpan={6}
                  className="border-b border-white/15 border-l border-l-white/25 px-3 py-2 text-center"
                >
                  {weekToDate.prevYear}
                </th>
                <th
                  colSpan={2}
                  className="border-b border-white/15 border-l border-l-white/25 px-3 py-2 text-center"
                >
                  Var.
                </th>
              </tr>
              <tr
                className="text-[10px] uppercase tracking-wide text-white/95"
                style={{ backgroundColor: theme.tableFoot }}
              >
                <th className="border-l border-l-white/25 px-2 py-2 text-left font-semibold">
                  Fecha
                </th>
                <th className="px-2 py-2 text-right font-semibold" title="Walk-in">
                  WI
                </th>
                <th className="px-2 py-2 text-right font-semibold">Eventos</th>
                <th
                  className="px-2 py-2 text-right font-bold"
                  style={totalColHeadStyle}
                >
                  Total
                </th>
                <th className="px-2 py-2 text-right font-semibold">Pers.</th>
                <th className="px-2 py-2 text-right font-semibold">Ch. prom.</th>
                {showDescCanc && (
                  <th className="px-2 py-2 text-right font-semibold">Desc./Canc.</th>
                )}
                <th className="border-l border-l-white/25 px-2 py-2 text-left font-semibold">
                  Fecha
                </th>
                <th className="px-2 py-2 text-right font-semibold" title="Walk-in">
                  WI
                </th>
                <th className="px-2 py-2 text-right font-semibold">Eventos</th>
                <th
                  className="px-2 py-2 text-right font-bold"
                  style={totalColHeadStyle}
                >
                  Total
                </th>
                <th className="px-2 py-2 text-right font-semibold">Pers.</th>
                <th className="px-2 py-2 text-right font-semibold">Ch. prom.</th>
                <th className="border-l border-l-white/25 px-2 py-2 text-right font-semibold">
                  % venta
                </th>
                <th className="px-2 py-2 text-right font-semibold">% pers.</th>
              </tr>
            </thead>
            <tbody>
              {weekToDate.days.map((d, i) => (
                <tr key={d.date} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-3 py-2 capitalize text-slate-700">{d.weekday}</td>
                  <td className="border-l border-slate-200 px-2 py-2 text-slate-600">
                    {d.label}
                  </td>
                  {moneyCell(d.ventaWi)}
                  {moneyCell(d.eventos)}
                  {moneyCell(d.total, { totalCol: true })}
                  <td
                    className="px-2 py-2 text-right font-medium tabular-nums"
                    style={{
                      color: d.comensales > 0 ? theme.tableTotal : '#94a3b8',
                    }}
                  >
                    {d.comensales > 0 ? pax(d.comensales) : '—'}
                  </td>
                  <td
                    className="px-2 py-2 text-right font-medium tabular-nums"
                    style={{
                      color: d.chequePromedio != null ? theme.tableTotal : '#94a3b8',
                    }}
                  >
                    {d.chequePromedio != null ? money(d.chequePromedio) : '—'}
                  </td>
                  {showDescCanc && (
                    <td
                      className="px-2 py-2 text-right font-medium tabular-nums"
                      style={{ color: d.cortes > 0 ? '#b45309' : '#94a3b8' }}
                    >
                      {d.cortes > 0 ? money(d.cortes) : '—'}
                    </td>
                  )}
                  <td className="border-l border-slate-200 px-2 py-2 text-slate-500">
                    {d.prevLabel ?? '—'}
                  </td>
                  {moneyCell(d.prevVentaWi, { muted: true })}
                  {moneyCell(d.prevEventos, { muted: true })}
                  {moneyCell(d.prevTotal, { muted: true, totalCol: true })}
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-slate-600">
                    {(d.prevComensales ?? 0) > 0 ? pax(d.prevComensales!) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums text-slate-600">
                    {d.prevChequePromedio != null
                      ? money(d.prevChequePromedio)
                      : '—'}
                  </td>
                  <td
                    className={`border-l border-slate-200 px-2 py-2 text-right font-semibold tabular-nums ${varPctClass(
                      d.changePct
                    )}`}
                  >
                    {varPctLabel(d.changePct)}
                  </td>
                  <td
                    className={`px-2 py-2 text-right font-semibold tabular-nums ${varPctClass(
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
                <td className="px-3 py-2.5" colSpan={2}>
                  {totalLabel}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.totalVentaWi > 0
                    ? money(weekToDate.totalVentaWi)
                    : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.totalEventos > 0
                    ? money(weekToDate.totalEventos)
                    : '—'}
                </td>
                <td
                  className="px-2 py-2.5 text-right tabular-nums font-bold"
                  style={totalColFootStyle}
                >
                  {weekToDate.total > 0 ? money(weekToDate.total) : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.totalComensales > 0
                    ? pax(weekToDate.totalComensales)
                    : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.chequePromedio != null
                    ? money(weekToDate.chequePromedio)
                    : '—'}
                </td>
                {showDescCanc && (
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {weekToDate.totalCortes > 0 ? money(weekToDate.totalCortes) : '—'}
                  </td>
                )}
                <td className="border-l border-white/20 px-2 py-2.5 text-slate-200">—</td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.prevTotalVentaWi > 0
                    ? money(weekToDate.prevTotalVentaWi)
                    : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.prevTotalEventos > 0
                    ? money(weekToDate.prevTotalEventos)
                    : '—'}
                </td>
                <td
                  className="px-2 py-2.5 text-right tabular-nums font-bold"
                  style={totalColFootStyle}
                >
                  {weekToDate.prevTotal > 0 ? money(weekToDate.prevTotal) : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.prevTotalComensales > 0
                    ? pax(weekToDate.prevTotalComensales)
                    : '—'}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  {weekToDate.prevChequePromedio != null
                    ? money(weekToDate.prevChequePromedio)
                    : '—'}
                </td>
                <td className="border-l border-white/20 px-2 py-2.5 text-right tabular-nums">
                  {varPctLabel(weekToDate.changePct)}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
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
