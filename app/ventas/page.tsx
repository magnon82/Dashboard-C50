'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { WeeklyComparisonChart, colorForYear } from '@/app/components/WeeklyComparisonChart';
import { MonthlyComparisonChart, MonthlyTotalComparisonChart } from '@/app/components/MonthlyCharts';
import { PaymentMixPie } from '@/app/components/PaymentMixPie';
import { SuiteShell } from '@/app/components/SuiteShell';
import {
  SectionHeader,
  filterControlClass,
  filterSelectClass,
  yearChipClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  MESES,
  parseIsoDate,
  formatShort,
  buildWeeklySalesByYear,
  buildWeeklyComparisonChart,
  buildMonthlySalesByYear,
  buildMonthlyWeeklyAverageByYear,
  buildMonthlyAvgChartRows,
  buildMonthlyTotalChartRows,
  yearWeeklyAverageFromMonthly,
  monthlyAverageForYear,
  monthlyTotalForYear,
  weeklyAverage,
  buildWeekToDateSales,
  buildPaymentMix,
  buildCorteCancelacionesDescuentos,
  weekRangeLabel,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

const theme = getTheme('suite');

/** Años disponibles en comparativo semanal (Acumulado + Infocaja) */
const COMPARE_YEAR_MIN = 2021;
const COMPARE_YEAR_MAX = 2026;
const COMPARE_YEARS = Array.from(
  { length: COMPARE_YEAR_MAX - COMPARE_YEAR_MIN + 1 },
  (_, i) => COMPARE_YEAR_MAX - i
);

export default function Dashboard() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState<number | null>(null);
  const [compareYears, setCompareYears] = useState<number[]>([2026, 2025]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [mixMonth, setMixMonth] = useState<number | null>(new Date().getMonth() + 1);
  const MIX_YEAR = 2026;
  const [corteFilter, setCorteFilter] = useState<'todos' | 'descuentos' | 'cancelaciones'>(
    'todos'
  );
  const [corteCollapsed, setCorteCollapsed] = useState(true);
  const [corteMonth, setCorteMonth] = useState(new Date().getMonth() + 1);
  const [corteOpenId, setCorteOpenId] = useState<string | null>(null);
  const CORTE_YEAR = new Date().getFullYear();
  const [detalleYear, setDetalleYear] = useState(2026);
  const [detalleWeekFrom, setDetalleWeekFrom] = useState<number | null>(null);
  const [detalleWeekTo, setDetalleWeekTo] = useState<number | null>(null);
  const [weekFrom, setWeekFrom] = useState<number | null>(null);
  const [weekTo, setWeekTo] = useState<number | null>(null);

  useEffect(() => {
    async function fetchRecords() {
      setDataError(null);
      try {
        const res = await fetch('/api/financial-records', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) {
          setDataError(json.error || 'No se pudieron cargar los datos');
          setRecords([]);
          return;
        }
        setRecords(json.records || []);
      } catch (e) {
        setDataError(e instanceof Error ? e.message : 'Error de red al cargar datos');
        setRecords([]);
      } finally {
        setLoading(false);
      }
    }
    fetchRecords();
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<number>(COMPARE_YEARS);
    records.forEach((r) => {
      const p = parseIsoDate(r.date);
      if (p && p.y >= COMPARE_YEAR_MIN && p.y <= COMPARE_YEAR_MAX) years.add(p.y);
      const m = r.description?.match(/^(\d{4})\s+Semana/);
      if (m) {
        const y = Number(m[1]);
        if (y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX) years.add(y);
      }
    });
    return Array.from(years)
      .filter((y) => y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX)
      .sort((a, b) => b - a);
  }, [records]);

  const weeklyDataYears = useMemo(() => {
    const fromData = new Set<number>(COMPARE_YEARS);
    records.forEach((r) => {
      if (r.source_file === 'ventas_semana') {
        const m = r.description?.match(/^(\d{4})\s+Semana/);
        if (m) {
          const y = Number(m[1]);
          if (y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX) fromData.add(y);
        }
      }
    });
    return Array.from(fromData)
      .filter((y) => y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX)
      .sort((a, b) => b - a);
  }, [records]);

  useEffect(() => {
    setCompareYears((prev) => {
      const valid = prev.filter((y) => COMPARE_YEARS.includes(y));
      if (valid.includes(year)) return valid.length ? valid : [year];
      return [year, ...valid.filter((y) => y !== year)].slice(0, 3);
    });
  }, [year]);

  const weeklyByYear = useMemo(
    () => buildWeeklySalesByYear(records, weeklyDataYears),
    [records, weeklyDataYears]
  );

  const monthlyByYear = useMemo(
    () => buildMonthlySalesByYear(records, weeklyByYear, COMPARE_YEARS),
    [records, weeklyByYear]
  );

  const monthlyAvgByYear = useMemo(
    () => buildMonthlyWeeklyAverageByYear(weeklyByYear, COMPARE_YEARS),
    [weeklyByYear]
  );

  const yearWeeks = useMemo(() => {
    const wm = weeklyByYear.get(year);
    if (!wm) return [];
    return Array.from(wm.values())
      .filter((w) => w.total > 0)
      .sort((a, b) => a.week - b.week);
  }, [weeklyByYear, year]);

  const detalleWeeks = useMemo(() => {
    const wm = weeklyByYear.get(detalleYear);
    if (!wm) return [];
    let weeks = Array.from(wm.values())
      .filter((w) => w.total > 0)
      .sort((a, b) => a.week - b.week);
    if (detalleWeekFrom != null) weeks = weeks.filter((w) => w.week >= detalleWeekFrom);
    if (detalleWeekTo != null) weeks = weeks.filter((w) => w.week <= detalleWeekTo);
    return weeks;
  }, [weeklyByYear, detalleYear, detalleWeekFrom, detalleWeekTo]);

  const weekRowsDisplay = detalleWeeks;

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

  /** Totales del detalle semanal (año del filtro de detalle) */
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

  /** Totales KPI (filtro header año/mes) */
  const weekRowsKpi = useMemo(() => {
    let weeks = yearWeeks;
    if (month !== null) {
      weeks = weeks.filter((w) => w.mes === MESES[month - 1]);
    }
    return weeks;
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

  const ventasAcumuladas = totalesPeriodo.total;
  const eventosPeriodo = totalesPeriodo.eventos;
  const ventaWiPeriodo = totalesPeriodo.ventaWi;

  const promedioSemanal = useMemo(() => weeklyAverage(weekRowsKpi), [weekRowsKpi]);

  const semanasTranscurridas = weekRowsKpi.length;

  const weeklyComparison = useMemo(
    () => buildWeeklyComparisonChart(weeklyByYear, compareYears, year, weekFrom, weekTo),
    [weeklyByYear, compareYears, year, weekFrom, weekTo]
  );

  const compareMaxWeek = useMemo(() => {
    let max = 0;
    compareYears.forEach((y) => {
      weeklyByYear.get(y)?.forEach((_, w) => {
        if (w > max) max = w;
      });
    });
    return max || 53;
  }, [weeklyByYear, compareYears]);

  const weekOptions = useMemo(() => {
    const refYear = compareYears[0] ?? year;
    return Array.from({ length: compareMaxWeek }, (_, i) => {
      const w = i + 1;
      return { week: w, label: weekRangeLabel(refYear, w) };
    });
  }, [compareMaxWeek, compareYears, year]);

  /** Gráficas comparativas NO usan el filtro mes/año del header */
  const monthlyTotalChartRows = useMemo(
    () => buildMonthlyTotalChartRows(monthlyByYear, compareYears, null),
    [monthlyByYear, compareYears]
  );

  const monthlyAvgChartRows = useMemo(
    () => buildMonthlyAvgChartRows(monthlyAvgByYear, compareYears),
    [monthlyAvgByYear, compareYears]
  );

  const periodoLabel = month === null ? `${year}` : `${MESES[month - 1]} ${year}`;
  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const weekToDate = useMemo(() => buildWeekToDateSales(records), [records]);

  const paymentMix = useMemo(
    () => buildPaymentMix(records, MIX_YEAR, mixMonth),
    [records, mixMonth]
  );

  /** Cancelaciones/descuentos: mes del año en curso (default mes actual) */
  const corteMesActual = useMemo(
    () => buildCorteCancelacionesDescuentos(records, CORTE_YEAR, corteMonth),
    [records, corteMonth]
  );

  const corteMesesConDatos = useMemo(() => {
    const set = new Set<number>();
    for (const r of records) {
      if (r.source_file !== 'corte_caja') continue;
      if (r.category !== 'Corte Cancelacion' && r.category !== 'Corte Descuento') continue;
      const p = parseIsoDate(r.date);
      if (!p || p.y !== CORTE_YEAR) continue;
      set.add(p.m);
    }
    return set;
  }, [records]);

  const corteMesLabel = `${MESES[corteMonth - 1]} ${CORTE_YEAR}`;

  const mixPeriodoLabel =
    mixMonth === null ? `${MIX_YEAR}` : `${MESES[mixMonth - 1]} ${MIX_YEAR}`;

  const corteItemsFiltrados = useMemo(() => {
    const items = corteMesActual.days.flatMap((d) => d.items);
    if (corteFilter === 'descuentos') return items.filter((i) => i.kind === 'descuento');
    if (corteFilter === 'cancelaciones') return items.filter((i) => i.kind === 'cancelacion');
    return items;
  }, [corteMesActual, corteFilter]);

  const corteTotalFiltrado = useMemo(
    () => corteItemsFiltrados.reduce((a, i) => a + i.amount, 0),
    [corteItemsFiltrados]
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

  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';
  const cardStyle = {
    backgroundColor: theme.cardBg,
    boxShadow: SUITE.shadow,
  } as const;

  return (
    <SuiteShell title="Ventas" subtitle={`Actualizado al ${hoy}`}>
        {dataError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">No se cargaron los datos</p>
            <p className="mt-1">{dataError}</p>
          </div>
        )}
        {loading && (
          <p className="mb-6 text-center" style={{ color: theme.muted }}>Cargando datos…</p>
        )}
        <Card
          className={`mb-8 ${cardClass}`}
          style={{ ...cardStyle, borderTop: `4px solid ${SUITE.orange}` }}
        >

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="px-2 py-1">
              <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
                <Text
                  className="text-xs font-bold uppercase tracking-wide"
                  style={{ color: theme.kpi[0].label }}
                >
                  Venta total
                </Text>
                <div className="flex flex-wrap items-center gap-2">
                  <label className={filterControlClass}>
                    <span className="text-slate-500">Año</span>
                    <select
                      className={filterSelectClass}
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value))}
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
                        setMonth(e.target.value === '' ? null : Number(e.target.value))
                      }
                    >
                      <option value="">Todo el año</option>
                      {MESES.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <Metric className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">
                {money(ventasAcumuladas)}
              </Metric>
              <Text className="mt-2 text-sm text-slate-500">
                <span className="font-medium text-slate-700">WI</span> {money(ventaWiPeriodo)}
                <span className="mx-2 text-slate-300">|</span>
                <span className="font-medium text-slate-700">Eventos</span> {money(eventosPeriodo)}
              </Text>
            </div>
            <div
              className="rounded-[20px] px-5 py-4 text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              <Text className="text-xs font-bold uppercase tracking-wide text-white/70">
                Promedio semanal
              </Text>
              <Metric className="mt-2 text-3xl font-bold text-white md:text-4xl">
                {promedioSemanal > 0 ? money(promedioSemanal) : '—'}
              </Metric>
              <Text className="mt-2 text-sm text-white/55">
                {semanasTranscurridas} semana{semanasTranscurridas !== 1 ? 's' : ''} transcurridas
                {month !== null ? ` · ${MESES[month - 1]}` : ''}
              </Text>
            </div>
          </div>
        </Card>

        {/* Ventas de la semana en curso */}
        <Card
          className={`mb-8 ${cardClass}`}
          style={{ ...cardStyle, borderTop: `4px solid ${SUITE.navy}` }}
        >
          <div className="mb-4">
            <Text
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: theme.kpi[2]?.label ?? theme.kpi[0].label }}
            >
              Ventas de la semana en curso
              {weekToDate.weekNumber > 0 ? ` · S${weekToDate.weekNumber}` : ''}
            </Text>
            <Metric className="mt-1 text-3xl font-bold text-slate-900 md:text-4xl">
              {weekToDate.total > 0 ? money(weekToDate.total) : '—'}
            </Metric>
            <Text className="mt-1 text-sm text-slate-500">
              {formatShort(weekToDate.mondayKey)} – {formatShort(weekToDate.asOf)}
              {' · '}
              {weekToDate.days.filter((d) => d.total > 0).length} día
              {weekToDate.days.filter((d) => d.total > 0).length !== 1 ? 's' : ''} con venta
            </Text>
          </div>
          {weekToDate.days.length === 0 ? (
            <p className="py-4 text-center text-slate-400">Sin datos Infocaja esta semana.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase tracking-wide text-white"
                    style={{ backgroundColor: theme.tableHead }}
                  >
                    <th className="px-4 py-2.5">Día</th>
                    <th className="px-4 py-2.5">Fecha</th>
                    <th className="px-4 py-2.5 text-right">Venta</th>
                    <th className="px-4 py-2.5 text-right">Venta {weekToDate.prevYear}</th>
                    <th className="px-4 py-2.5 text-right">Var. %</th>
                    <th className="px-4 py-2.5 text-right">Desc. / Canc.</th>
                  </tr>
                </thead>
                <tbody>
                  {weekToDate.days.map((d, i) => (
                    <tr key={d.date} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-4 py-2 capitalize text-slate-700">{d.weekday}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {d.label}
                        {d.prevLabel ? (
                          <span className="ml-1 text-xs text-slate-400">· {d.prevLabel}</span>
                        ) : null}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-semibold"
                        style={{ color: d.total > 0 ? theme.tableTotal : '#94a3b8' }}
                      >
                        {d.total > 0 ? money(d.total) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-slate-600">
                        {(d.prevTotal ?? 0) > 0 ? money(d.prevTotal!) : '—'}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-semibold ${
                          d.changePct == null
                            ? 'text-slate-400'
                            : d.changePct >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                        }`}
                      >
                        {d.changePct == null
                          ? '—'
                          : `${d.changePct >= 0 ? '▲' : '▼'} ${Math.abs(d.changePct).toFixed(1)}%`}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-medium"
                        style={{ color: d.cortes > 0 ? '#b45309' : '#94a3b8' }}
                      >
                        {d.cortes > 0 ? money(d.cortes) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold text-white" style={{ backgroundColor: theme.tableFoot }}>
                    <td className="px-4 py-2.5" colSpan={2}>
                      Total (lun–hoy)
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {weekToDate.total > 0 ? money(weekToDate.total) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {weekToDate.prevTotal > 0 ? money(weekToDate.prevTotal) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {weekToDate.changePct == null
                        ? '—'
                        : `${weekToDate.changePct >= 0 ? '▲' : '▼'} ${Math.abs(weekToDate.changePct).toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {weekToDate.totalCortes > 0 ? money(weekToDate.totalCortes) : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {/* Cancelaciones y descuentos — mes del año en curso */}
        <Card className={`mb-8 ${cardClass}`} style={cardStyle}>
          <SectionHeader title={`Cancelaciones y descuentos · ${corteMesLabel}`}>
            <label className={`${filterControlClass} bg-white shadow-sm`}>
              <span className="shrink-0 text-slate-500">Mes</span>
              <select
                className={`${filterSelectClass} min-w-[9.5rem] cursor-pointer bg-white`}
                value={corteMonth}
                onChange={(e) => {
                  setCorteMonth(Number(e.target.value));
                  setCorteOpenId(null);
                }}
                aria-label="Mes de cancelaciones y descuentos"
              >
                {MESES.map((m, i) => {
                  const mesNum = i + 1;
                  const tiene = corteMesesConDatos.has(mesNum);
                  return (
                    <option key={m} value={mesNum}>
                      {m}
                      {tiene ? '' : ' (sin datos)'}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              type="button"
              aria-label="Mes anterior"
              disabled={corteMonth <= 1}
              onClick={() => {
                setCorteMonth((m) => Math.max(1, m - 1));
                setCorteOpenId(null);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Mes siguiente"
              disabled={corteMonth >= 12}
              onClick={() => {
                setCorteMonth((m) => Math.min(12, m + 1));
                setCorteOpenId(null);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
            <label className={filterControlClass}>
              <span className="text-slate-500">Ver</span>
              <select
                className={`${filterSelectClass} min-w-[10rem] cursor-pointer`}
                value={corteFilter}
                onChange={(e) => {
                  setCorteFilter(e.target.value as 'todos' | 'descuentos' | 'cancelaciones');
                  setCorteOpenId(null);
                }}
              >
                <option value="todos">Todos</option>
                <option value="descuentos">Solo descuentos</option>
                <option value="cancelaciones">Solo cancelaciones</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setCorteCollapsed((v) => !v);
                setCorteOpenId(null);
              }}
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {corteCollapsed ? 'Mostrar desglose' : 'Ocultar desglose'}
            </button>
          </SectionHeader>
          <Text className="-mt-2 mb-4 text-sm text-slate-500">
            Clic en un renglón para ver el motivo
          </Text>
          <div className="mb-3 text-sm text-slate-600">
            <span className="font-semibold text-rose-700">
              Canc. {money(corteMesActual.totalCancelaciones)}
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-semibold text-amber-700">
              Desc. {money(corteMesActual.totalDescuentos)}
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-bold text-slate-800">
              Total {money(corteMesActual.total)}
            </span>
          </div>
          {!corteCollapsed && (
            <>
              {corteItemsFiltrados.length === 0 ? (
                <p className="py-8 text-center text-slate-400">
                  Sin registros para el filtro seleccionado.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr
                        className="text-left text-xs uppercase tracking-wide text-white"
                        style={{ backgroundColor: theme.tableHead }}
                      >
                        <th className="px-4 py-3">Fecha</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Detalle</th>
                        <th className="px-4 py-3 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corteItemsFiltrados.map((item, i) => {
                        const isOpen = corteOpenId === item.id;
                        const detalle =
                          item.producto ||
                          item.persona ||
                          item.motivo ||
                          item.grupo ||
                          (item.kind === 'descuento' ? 'Descuento' : 'Cancelación');
                        const motivoLines = [
                          item.motivo && `Motivo: ${item.motivo}`,
                          item.grupo && `Grupo: ${item.grupo}`,
                          item.persona && `Persona: ${item.persona}`,
                          item.producto && `Producto: ${item.producto}`,
                          item.mesero && `Mesero: ${item.mesero}`,
                          item.autorizo && `Autorizó: ${item.autorizo}`,
                          item.mesa && `Mesa: ${item.mesa}`,
                          item.hora && `Hora: ${item.hora}`,
                        ].filter(Boolean) as string[];
                        return (
                          <Fragment key={item.id}>
                            <tr
                              onClick={() =>
                                setCorteOpenId((cur) => (cur === item.id ? null : item.id))
                              }
                              className={`cursor-pointer ${
                                i % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                              } ${isOpen ? 'bg-amber-50' : 'hover:bg-amber-50/70'}`}
                            >
                              <td className="px-4 py-2.5 text-slate-600">
                                {formatShort(item.date)}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                    item.kind === 'cancelacion'
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {item.kind === 'cancelacion' ? 'Cancelación' : 'Descuento'}
                                </span>
                              </td>
                              <td className="max-w-xs truncate px-4 py-2.5 text-slate-700">
                                {detalle}
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-slate-800">
                                {money(item.amount)}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr
                                className="bg-amber-50"
                                onClick={() => setCorteOpenId(null)}
                              >
                                <td colSpan={4} className="px-4 py-3">
                                  <div className="cursor-pointer rounded-lg border border-amber-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                      Motivo · clic para cerrar
                                    </p>
                                    {motivoLines.length > 0 ? (
                                      <ul className="space-y-0.5">
                                        {motivoLines.map((line) => (
                                          <li key={line}>{line}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p>Sin detalle de motivo</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr
                        className="font-bold text-white"
                        style={{ backgroundColor: theme.tableFoot }}
                      >
                        <td className="px-4 py-3" colSpan={3}>
                          Total filtrado · {corteMesLabel}
                        </td>
                        <td className="px-4 py-3 text-right">{money(corteTotalFiltrado)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        <Card className={`mb-8 ${cardClass}`} style={cardStyle}>
          <SectionHeader title="Promedio venta semanal por mes">
            {COMPARE_YEARS.map((y) => {
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
          ) : monthlyAvgChartRows.some((r) =>
              compareYears.some((y) => r[String(y)] != null && Number(r[String(y)]) > 0)
            ) ? (
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
                      className="text-left text-xs uppercase tracking-wide text-white"
                      style={{ backgroundColor: theme.tableHead }}
                    >
                      <th className="sticky left-0 px-4 py-3" style={{ backgroundColor: theme.tableHead }}>
                        Año
                      </th>
                      {MESES.map((m) => (
                        <th key={m} className="px-3 py-3 text-right whitespace-nowrap">
                          {m.slice(0, 3)}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right">Prom. anual</th>
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
                          const val = monthlyAvgByYear.get(y)?.get(mi + 1)?.promSemanal ?? 0;
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

        {/* Mix de cobro: efectivo / bancos — debajo de promedio semanal */}
        <Card className={`mb-8 ${cardClass}`} style={cardStyle}>
          <SectionHeader title={`Pagos Efectivo vs bancos · ${mixPeriodoLabel}`}>
            <label className={filterControlClass}>
              <span className="text-slate-500">Mes</span>
              <select
                className={filterSelectClass}
                value={mixMonth ?? ''}
                onChange={(e) =>
                  setMixMonth(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">Todo el año</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </SectionHeader>
          <PaymentMixPie mix={paymentMix} periodoLabel={mixPeriodoLabel} />
        </Card>

        {/* Detalle semanal — antes del comparativo */}
        <Card className={`mb-8 ${cardClass}`} style={cardStyle}>
          <div className="mb-4 flex flex-col gap-3">
            <SectionHeader title="Detalle semanal" className="mb-0">
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
                  {COMPARE_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </SectionHeader>
            <div className="flex flex-wrap items-center gap-2">
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
          </div>
          {weekRowsDisplay.length === 0 ? (
            <p className="py-8 text-center text-slate-400">Sin semanas en el periodo.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase tracking-wide text-white"
                    style={{ backgroundColor: theme.tableHead }}
                  >
                    <th className="px-4 py-3">Mes</th>
                    <th className="px-4 py-3">Semana</th>
                    <th className="px-4 py-3">Rango (lun – dom)</th>
                    <th className="px-4 py-3 text-right">Eventos</th>
                    <th className="px-4 py-3 text-right">Venta WI</th>
                    <th className="px-4 py-3 text-right">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRowsDisplay.map((w, i) => (
                    <tr key={w.week} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-4 py-2.5 text-slate-700">{w.mes}</td>
                      <td className="px-4 py-2.5 font-semibold" style={{ color: theme.tableWeek }}>
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
                  <tr className="font-bold text-white" style={{ backgroundColor: theme.tableFoot }}>
                    <td className="px-4 py-3" colSpan={3}>
                      Total {detalleYear}
                      {detalleWeekFrom != null || detalleWeekTo != null
                        ? ` · S${detalleWeekFrom ?? '…'}–S${detalleWeekTo ?? '…'}`
                        : ''}
                    </td>
                    <td className="px-4 py-3 text-right">{money(totalesDetalle.eventos)}</td>
                    <td className="px-4 py-3 text-right">{money(totalesDetalle.ventaWi)}</td>
                    <td className="px-4 py-3 text-right">{money(totalesDetalle.total)}</td>
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
        </Card>

        <Card className={`mb-8 ${cardClass}`} style={cardStyle}>
          <div className="mb-4 flex flex-col gap-3">
            <SectionHeader title="Comparativo semanal" className="mb-0">
              {COMPARE_YEARS.map((y) => {
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
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${filterControlClass} min-w-[220px] flex-1`}>
                <span className="shrink-0 text-slate-500">Desde</span>
                <select
                  className={`${filterSelectClass} w-full`}
                  value={weekFrom ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    setWeekFrom(v);
                    if (v != null && weekTo != null && v > weekTo) setWeekTo(v);
                  }}
                >
                  <option value="">Inicio</option>
                  {weekOptions.map((o) => (
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
                  value={weekTo ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    setWeekTo(v);
                    if (v != null && weekFrom != null && v < weekFrom) setWeekFrom(v);
                  }}
                >
                  <option value="">Fin</option>
                  {weekOptions.map((o) => (
                    <option key={o.week} value={o.week}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {(weekFrom != null || weekTo != null) && (
                <button
                  type="button"
                  onClick={() => {
                    setWeekFrom(null);
                    setWeekTo(null);
                  }}
                  className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Limpiar rango
                </button>
              )}
            </div>
          </div>
          {loading ? (
            <p className="py-16 text-center text-slate-400">Cargando...</p>
          ) : weeklyComparison.rows.length === 0 ? (
            <p className="py-16 text-center text-slate-400">Sin datos semanales</p>
          ) : (
            <>
              {/* Leyenda con círculos por año */}
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
                  </div>
                ))}
              </div>
              <WeeklyComparisonChart rows={weeklyComparison.rows} years={compareYears} />
              <div className="mt-3 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                {compareYears.map((y) => {
                  const weeks = Array.from(weeklyByYear.get(y)?.values() ?? []).filter((w) => {
                    if (w.total <= 0) return false;
                    if (weekFrom != null && w.week < weekFrom) return false;
                    if (weekTo != null && w.week > weekTo) return false;
                    return true;
                  });
                  const avg = weeklyAverage(weeks);
                  const total = weeks.reduce((a, w) => a + w.total, 0);
                  return (
                    <div key={y} className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForYear(y) }}
                      />
                      <span className="font-bold" style={{ color: theme.title }}>
                        {y}:
                      </span>
                      <span className="text-slate-500">
                        prom. {money(avg)} · {weeks.length} sem. · {money(total)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <Card className={`mb-8 ${cardClass}`} style={{ ...cardStyle, borderTop: `4px solid ${colorForYear(year)}` }}>
          <SectionHeader title="Ventas por mes">
            {COMPARE_YEARS.map((y) => {
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
          ) : !monthlyTotalChartRows.some((r) =>
              compareYears.some((y) => Number(r[String(y)] ?? 0) > 0)
            ) ? (
            <p className="py-16 text-center text-slate-400">Sin datos</p>
          ) : (
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
          )}
        </Card>
    </SuiteShell>
  );
}
