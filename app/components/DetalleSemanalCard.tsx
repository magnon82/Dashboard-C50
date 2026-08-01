'use client';

import { useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import {
  SectionHeader,
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  buildWeeklySalesByYear,
  weeklyAverage,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type DetalleSemanalCardProps = {
  records: FinancialRecord[];
  /** Years for the Año select (newest first preferred). */
  years: number[];
  /** Year set passed to buildWeeklySalesByYear. */
  weeklyDataYears: number[];
  /** Collapsed by default (matches Ventas). */
  defaultCollapsed?: boolean;
  className?: string;
};

/** Tabla semanal filtrable: Mes, Semana, Rango, Eventos, Venta WI, Total. */
export function DetalleSemanalCard({
  records,
  years,
  weeklyDataYears,
  defaultCollapsed = true,
  className = 'mb-8',
}: DetalleSemanalCardProps) {
  const defaultYear = years[0] ?? new Date().getFullYear();
  const [detalleYear, setDetalleYear] = useState(defaultYear);
  const [detalleWeekFrom, setDetalleWeekFrom] = useState<number | null>(null);
  const [detalleWeekTo, setDetalleWeekTo] = useState<number | null>(null);
  const [detalleCollapsed, setDetalleCollapsed] = useState(defaultCollapsed);

  const weeklyByYear = useMemo(
    () => buildWeeklySalesByYear(records, weeklyDataYears),
    [records, weeklyDataYears]
  );

  const weekRowsDisplay = useMemo(() => {
    const wm = weeklyByYear.get(detalleYear);
    if (!wm) return [];
    let weeks = Array.from(wm.values())
      .filter((w) => w.total > 0)
      .sort((a, b) => a.week - b.week);
    if (detalleWeekFrom != null) weeks = weeks.filter((w) => w.week >= detalleWeekFrom);
    if (detalleWeekTo != null) weeks = weeks.filter((w) => w.week <= detalleWeekTo);
    return weeks;
  }, [weeklyByYear, detalleYear, detalleWeekFrom, detalleWeekTo]);

  const detalleWeekOptions = useMemo(() => {
    const wm = weeklyByYear.get(detalleYear);
    if (!wm) return [];
    return Array.from(wm.values())
      .filter((w) => w.total > 0)
      .sort((a, b) => a.week - b.week)
      .map((w) => ({
        week: w.week,
        label: `S${w.week} · ${w.mes} · ${w.label}`,
      }));
  }, [weeklyByYear, detalleYear]);

  const totalesDetalle = useMemo(() => {
    return weekRowsDisplay.reduce(
      (acc, w) => ({
        total: acc.total + w.total,
        eventos: acc.eventos + w.eventos,
        ventaWi: acc.ventaWi + w.ventaWi,
      }),
      { total: 0, eventos: 0, ventaWi: 0 }
    );
  }, [weekRowsDisplay]);

  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';
  const cardStyle = {
    backgroundColor: theme.cardBg,
    boxShadow: SUITE.shadow,
  } as const;

  return (
    <Card className={`${className} ${cardClass}`} style={cardStyle}>
      <SectionHeader title="Detalle de venta semanal" className="mb-0">
        <button
          type="button"
          aria-expanded={!detalleCollapsed}
          aria-controls="detalle-semanal-panel"
          onClick={() => setDetalleCollapsed((v) => !v)}
          className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-white"
        >
          {detalleCollapsed ? 'Mostrar' : 'Ocultar'}
        </button>
      </SectionHeader>
      {!detalleCollapsed ? (
        <div id="detalle-semanal-panel" className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className={filterControlClass}>
              <span className="text-slate-500">Año</span>
              <select
                className={filterSelectClass}
                value={detalleYear}
                onChange={(e) => {
                  setDetalleYear(Number(e.target.value));
                  setDetalleWeekFrom(null);
                  setDetalleWeekTo(null);
                }}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${filterControlClass} min-w-[220px] flex-1`}>
              <span className="shrink-0 text-slate-500">Desde</span>
              <select
                className={`${filterSelectClass} w-full`}
                value={detalleWeekFrom ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setDetalleWeekFrom(v);
                  if (v != null && detalleWeekTo != null && v > detalleWeekTo) {
                    setDetalleWeekTo(v);
                  }
                }}
              >
                <option value="">Inicio</option>
                {detalleWeekOptions.map((o) => (
                  <option key={o.week} value={o.week}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${filterControlClass} min-w-[220px] flex-1`}>
              <span className="shrink-0 text-slate-500">Hasta</span>
              <select
                className={`${filterSelectClass} w-full`}
                value={detalleWeekTo ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setDetalleWeekTo(v);
                  if (v != null && detalleWeekFrom != null && v < detalleWeekFrom) {
                    setDetalleWeekFrom(v);
                  }
                }}
              >
                <option value="">Fin</option>
                {detalleWeekOptions.map((o) => (
                  <option key={o.week} value={o.week}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {(detalleWeekFrom != null || detalleWeekTo != null) && (
              <button
                type="button"
                onClick={() => {
                  setDetalleWeekFrom(null);
                  setDetalleWeekTo(null);
                }}
                className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Limpiar rango
              </button>
            )}
          </div>
          {weekRowsDisplay.length === 0 ? (
            <p className="py-8 text-center text-slate-400">Sin semanas en el periodo.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr
                    className="text-center text-xs uppercase tracking-wide text-white"
                    style={{ backgroundColor: theme.tableHead }}
                  >
                    <th className="px-4 py-3">Mes</th>
                    <th className="px-4 py-3">Semana</th>
                    <th className="px-4 py-3">Rango (lun – dom)</th>
                    <th className="px-4 py-3">Eventos</th>
                    <th className="px-4 py-3">Venta WI</th>
                    <th className="px-4 py-3">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRowsDisplay.map((w, i) => (
                    <tr key={w.week} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-4 py-2.5 text-slate-700">{w.mes}</td>
                      <td
                        className="px-4 py-2.5 font-semibold"
                        style={{ color: theme.tableWeek }}
                      >
                        S{w.week}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{w.label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">
                        {w.eventos > 0 ? money(w.eventos) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                        {money(w.ventaWi)}
                      </td>
                      <td
                        className="px-4 py-2.5 text-right font-semibold"
                        style={{ color: theme.tableTotal }}
                      >
                        {money(w.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr
                    className="font-bold text-white"
                    style={{ backgroundColor: theme.tableFoot }}
                  >
                    <td className="px-4 py-3" colSpan={3}>
                      Total {detalleYear}
                      {detalleWeekFrom != null || detalleWeekTo != null
                        ? ` · S${detalleWeekFrom ?? '…'}–S${detalleWeekTo ?? '…'}`
                        : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {money(totalesDetalle.eventos)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {money(totalesDetalle.ventaWi)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {money(totalesDetalle.total)}
                    </td>
                  </tr>
                  <tr className="bg-slate-100 text-slate-600">
                    <td className="px-4 py-2.5 font-semibold" colSpan={5}>
                      Promedio semanal ({weekRowsDisplay.length} semanas)
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {weeklyAverage(weekRowsDisplay) > 0
                        ? money(weeklyAverage(weekRowsDisplay))
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}
