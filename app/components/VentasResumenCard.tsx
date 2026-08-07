'use client';

import { useMemo } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { WiEventosPie } from '@/app/components/WiEventosPie';
import { PaymentMixPie } from '@/app/components/PaymentMixPie';
import {
  filterControlClass,
  filterSelectClass,
  SectionHeader,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  MESES,
  buildWeeklySalesByYear,
  buildPaymentMix,
  weeklyAverage,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface VentasResumenCardProps {
  records: FinancialRecord[];
  year: number;
  month: number | null;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number | null) => void;
  availableYears: number[];
  /** Comparativo semanal / Infocaja year set used to build weekly maps. */
  weeklyDataYears: number[];
  /** staff_rpt OS+extra por día — fallback Eventos si Sheets vacío. */
  eventosFallbackByDate?: Record<string, number> | null;
  /** Show Efectivo / Tarjetas donut (Ventas page). Default false. */
  showPaymentMix?: boolean;
  /**
   * Place Año/Mes under the WI|Eventos line instead of beside "Venta total".
   * Used on Reportes Socios; Ventas keeps filters top-right by default.
   */
  filtersBelowBreakdown?: boolean;
  /** Optional section title (e.g. Reportes Socios embeds "Ventas"). */
  title?: string;
  subtitle?: string;
  className?: string;
}

/**
 * Bloque KPI superior de Ventas: total, WI|Eventos, promedio semanal, donut WI/Eventos.
 * El mix Efectivo/Tarjetas es opcional (oculto en Reportes Socios).
 */
export function VentasResumenCard({
  records,
  year,
  month,
  onYearChange,
  onMonthChange,
  availableYears,
  weeklyDataYears,
  eventosFallbackByDate,
  showPaymentMix = false,
  filtersBelowBreakdown = false,
  title,
  subtitle,
  className = '',
}: VentasResumenCardProps) {
  const weeklyByYear = useMemo(
    () =>
      buildWeeklySalesByYear(records, weeklyDataYears, {
        eventosFallbackByDate,
      }),
    [records, weeklyDataYears, eventosFallbackByDate]
  );

  const yearWeeks = useMemo(() => {
    const wm = weeklyByYear.get(year);
    if (!wm) return [];
    return Array.from(wm.values())
      .filter((w) => w.total > 0)
      .sort((a, b) => a.week - b.week);
  }, [weeklyByYear, year]);

  const weekRowsKpi = useMemo(() => {
    if (month === null) return yearWeeks;
    return yearWeeks.filter((w) => w.mes === MESES[month - 1]);
  }, [yearWeeks, month]);

  const totalesPeriodo = useMemo(() => {
    return weekRowsKpi.reduce(
      (acc, w) => ({
        total: acc.total + w.total,
        eventos: acc.eventos + w.eventos,
        ventaWi: acc.ventaWi + w.ventaWi,
      }),
      { total: 0, eventos: 0, ventaWi: 0 }
    );
  }, [weekRowsKpi]);

  const promedioSemanal = useMemo(() => weeklyAverage(weekRowsKpi), [weekRowsKpi]);
  const semanasTranscurridas = weekRowsKpi.length;

  const periodoLabel =
    month === null ? `${year} · acumulado` : `${MESES[month - 1]} ${year}`;

  const paymentMix = useMemo(
    () => (showPaymentMix ? buildPaymentMix(records, year, month) : null),
    [showPaymentMix, records, year, month]
  );

  const cardClass = `rounded-[24px] border-0 p-4 md:p-5 ${className}`;
  const cardStyle = {
    backgroundColor: theme.cardBg,
    boxShadow: SUITE.shadow,
    borderTop: `4px solid ${SUITE.orange}`,
  } as const;

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <label className={filterControlClass}>
        <span className="text-slate-500">Año</span>
        <select
          className={filterSelectClass}
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className={filterControlClass}>
        <span className="text-slate-500">Mes</span>
        <select
          className={filterSelectClass}
          value={month ?? ''}
          onChange={(e) =>
            onMonthChange(e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">Año (acumulado)</option>
          {MESES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const ventaTotalBlock = (
    <div className="flex min-h-0 flex-col justify-start px-3.5 py-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <Text
          className="text-xs font-bold uppercase tracking-wide"
          style={{ color: theme.kpi[0].label }}
        >
          Venta total
        </Text>
        {!filtersBelowBreakdown ? filters : null}
      </div>
      <Metric className="mt-1.5 text-3xl font-bold text-slate-900 md:text-[2.15rem] md:leading-tight">
        {money(totalesPeriodo.total)}
      </Metric>
      <Text className="mt-2 text-sm text-slate-500">
        <span className="font-medium text-slate-700">WI</span>{' '}
        {money(totalesPeriodo.ventaWi)}
        <span className="mx-2 text-slate-300">|</span>
        <span className="font-medium text-slate-700">Eventos</span>{' '}
        {money(totalesPeriodo.eventos)}
      </Text>
      {filtersBelowBreakdown ? <div className="mt-2.5">{filters}</div> : null}
    </div>
  );

  const promedioBlock = (
    <div
      className="flex min-h-0 flex-col justify-start rounded-[18px] px-3.5 py-3 text-white"
      style={{ backgroundColor: SUITE.navy }}
    >
      <Text className="text-xs font-bold uppercase tracking-wide text-white/70">
        Promedio semanal
      </Text>
      <Metric className="mt-1.5 text-3xl font-bold text-white md:text-[2.15rem] md:leading-tight">
        {promedioSemanal > 0 ? money(promedioSemanal) : '—'}
      </Metric>
      <Text className="mt-1.5 text-sm text-white/55">
        {semanasTranscurridas} semana{semanasTranscurridas !== 1 ? 's' : ''}{' '}
        transcurridas
        {month !== null ? ` · ${MESES[month - 1]}` : ''}
      </Text>
    </div>
  );

  const wiDonutBlock = (
    <div className="flex min-h-0 flex-col justify-start rounded-[18px] border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <p
        className="mb-1.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: SUITE.navy }}
      >
        WI / Eventos
      </p>
      <WiEventosPie wi={totalesPeriodo.ventaWi} eventos={totalesPeriodo.eventos} />
    </div>
  );

  return (
    <Card className={cardClass} style={cardStyle}>
      {title ? (
        <div className="mb-3.5">
          <SectionHeader title={title} className="mb-0" />
          {subtitle ? (
            <p className="mt-0.5 text-sm" style={{ color: theme.muted }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      {showPaymentMix ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            {ventaTotalBlock}
            {promedioBlock}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 sm:gap-6">
            {wiDonutBlock}
            {paymentMix ? (
              <div className="flex min-h-0 flex-col justify-start rounded-[18px] border border-slate-100 bg-slate-50/70 px-3.5 py-3">
                <p
                  className="mb-1.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: SUITE.navy }}
                >
                  Efectivo / Tarjetas · {periodoLabel}
                </p>
                <PaymentMixPie mix={paymentMix} periodoLabel={periodoLabel} />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">{ventaTotalBlock}</div>
          <div className="min-w-0">{promedioBlock}</div>
          <div className="min-w-0">{wiDonutBlock}</div>
        </div>
      )}
    </Card>
  );
}
