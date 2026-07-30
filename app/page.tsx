'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/app/lib/supabase';
import { Card, Metric, Text, Title } from '@tremor/react';
import { WeeklyComparisonChart, colorForYear } from '@/app/components/WeeklyComparisonChart';
import { MonthlyBarChart, MonthlyComparisonChart } from '@/app/components/MonthlyCharts';
import { getTheme } from '@/app/lib/themes';
import {
  MESES,
  parseIsoDate,
  formatShort,
  buildWeeklySalesByYear,
  buildWeeklyComparisonChart,
  buildMonthlySalesByYear,
  buildMonthlyWeeklyAverageByYear,
  buildMonthlyAvgChartRows,
  yearWeeklyAverageFromMonthly,
  monthlyAverageForYear,
  weeklyAverage,
  lastCompleteWeekSunday,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

const theme = getTheme('excel');

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
  const [saldoVista, setSaldoVista] = useState<'desglose' | 'total'>('desglose');

  useEffect(() => {
    async function fetchRecords() {
      try {
        const all: FinancialRecord[] = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data, error } = await supabase
            .from('financial_records')
            .select('*')
            .order('date', { ascending: false })
            .range(from, from + pageSize - 1);
          if (error) {
            console.error(error.message);
            break;
          }
          if (!data?.length) break;
          all.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }
        setRecords(all);
      } finally {
        setLoading(false);
      }
    }
    fetchRecords();
    const channel = supabase
      .channel('financial_records_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_records' }, () =>
        fetchRecords()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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

  const weekRowsDisplay = useMemo(() => {
    let weeks = yearWeeks;
    if (month !== null) {
      weeks = weeks.filter((w) => w.mes === MESES[month - 1]);
    }
    return weeks;
  }, [yearWeeks, month]);

  /** Totales alineados a las filas del detalle semanal (Acumulado + Infocaja) */
  const totalesPeriodo = useMemo(() => {
    return weekRowsDisplay.reduce(
      (acc, w) => ({
        total: acc.total + w.total,
        eventos: acc.eventos + w.eventos,
        ventaWi: acc.ventaWi + w.ventaWi,
      }),
      { total: 0, eventos: 0, ventaWi: 0 }
    );
  }, [weekRowsDisplay]);

  const ventasAcumuladas = totalesPeriodo.total;
  const eventosPeriodo = totalesPeriodo.eventos;
  const ventaWiPeriodo = totalesPeriodo.ventaWi;

  const promedioSemanal = useMemo(() => {
    const weeks =
      month !== null ? yearWeeks.filter((w) => w.mes === MESES[month - 1]) : yearWeeks;
    return weeklyAverage(weeks);
  }, [yearWeeks, month]);

  const semanasTranscurridas = useMemo(() => {
    const weeks =
      month !== null ? yearWeeks.filter((w) => w.mes === MESES[month - 1]) : yearWeeks;
    return weeks.length;
  }, [yearWeeks, month]);

  /** Último saldo = último día del FLUJO EFECTIVO CARRANZA 50.xlsx (hoja año en curso) */
  const saldoEfectivoHoy = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const saldos = records
      .filter((r) => r.source_file === 'flujo_efectivo_saldo' && r.category === 'Saldo Efectivo')
      .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
      .filter((r) => r.parsed && r.parsed.y <= currentYear + 1);

    const delAnio = saldos.filter((r) => r.parsed!.y === currentYear);
    const pool = delAnio.length > 0 ? delAnio : saldos;
    if (!pool.length) return null;

    return pool.reduce((best, cur) => (cur.parsed!.key > best.parsed!.key ? cur : best));
  }, [records]);

  const saldosBancosHoy = useMemo(() => {
    const saldos = records
      .filter((r) => r.source_file === 'presupuesto_saldos')
      .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
      .filter((r) => r.parsed)
      .sort((a, b) => (a.parsed!.key < b.parsed!.key ? -1 : 1));
    if (!saldos.length) return { mifel: null, bbva: null, fecha: null as string | null };

    const ultimaFecha = saldos[saldos.length - 1].parsed!;
    const delMes = saldos.filter(
      (r) => r.parsed!.y === ultimaFecha.y && r.parsed!.m === ultimaFecha.m
    );
    return {
      mifel: delMes.find((r) => r.category === 'Saldo Mifel') ?? null,
      bbva: delMes.find((r) => r.category === 'Saldo BBVA') ?? null,
      fecha: `${ultimaFecha.y}-${String(ultimaFecha.m).padStart(2, '0')}-01`,
    };
  }, [records]);

  const totalBancosHoy =
    Number(saldosBancosHoy.mifel?.amount || 0) + Number(saldosBancosHoy.bbva?.amount || 0);

  const saldoTotalHoy =
    Number(saldoEfectivoHoy?.amount || 0) + totalBancosHoy;

  const ultimaSemanaCaptura = useMemo(() => {
    const y = new Date().getFullYear();
    return lastCompleteWeekSunday(records, y);
  }, [records]);

  const weeklyComparison = useMemo(
    () => buildWeeklyComparisonChart(weeklyByYear, compareYears, year),
    [weeklyByYear, compareYears, year]
  );

  const monthlyBarData = useMemo(() => {
    const monthMap = monthlyByYear.get(year);
    if (!monthMap) return [];
    return MESES.map((mes, i) => {
      const m = monthMap.get(i + 1);
      return { mes, ventas: m?.total ?? 0 };
    }).filter((_, i) => month === null || i + 1 === month);
  }, [monthlyByYear, year, month]);

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

  const bancosMesLabel = saldosBancosHoy.fecha
    ? MESES[parseIsoDate(saldosBancosHoy.fecha)!.m - 1]
    : null;

  function toggleCompareYear(y: number) {
    setCompareYears((prev) => {
      if (prev.includes(y)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== y);
      }
      return [...prev, y].sort((a, b) => b - a);
    });
  }

  const cardClass = 'shadow-md rounded-xl border border-slate-200/80 overflow-hidden';

  return (
    <main className="min-h-screen" style={{ backgroundColor: theme.pageBg }}>
      <header className="shadow-lg" style={{ backgroundColor: theme.headerBg }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6 md:flex-row md:items-center md:justify-between md:px-10">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: theme.headerSub }}
            >
              Cluster Culinario · Carranza 50
            </p>
            <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">
              Dashboard Ventas {year}
            </h1>
            <p className="mt-1 text-sm" style={{ color: theme.headerMuted }}>
              Actualizado al {hoy}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm backdrop-blur"
              style={{ backgroundColor: theme.selectBg }}
            >
              <span style={{ color: theme.headerMuted }}>Año</span>
              <select
                className="bg-transparent font-semibold text-white outline-none"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {availableYears.map((y) => (
                  <option key={y} value={y} className="text-slate-900">
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm backdrop-blur"
              style={{ backgroundColor: theme.selectBg }}
            >
              <span style={{ color: theme.headerMuted }}>Mes</span>
              <select
                className="bg-transparent font-semibold text-white outline-none"
                value={month ?? ''}
                onChange={(e) =>
                  setMonth(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="" className="text-slate-900">
                  Todo el año
                </option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1} className="text-slate-900">
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
              className="rounded-md px-3 py-2 text-sm font-semibold text-white backdrop-blur transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              Salir
            </button>
          </div>
        </div>

        {/* Saldos al día — fijos, no dependen de filtros */}
        <div
          className="border-t border-white/10"
          style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4 md:px-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-200">
                Saldos al día
              </p>
              <div className="flex rounded-md p-0.5" style={{ backgroundColor: theme.selectBg }}>
                <button
                  type="button"
                  onClick={() => setSaldoVista('desglose')}
                  className="rounded px-3 py-1 text-xs font-semibold transition-colors"
                  style={{
                    backgroundColor: saldoVista === 'desglose' ? 'rgba(255,255,255,0.2)' : 'transparent',
                    color: saldoVista === 'desglose' ? '#fff' : theme.headerMuted,
                  }}
                >
                  Desglose
                </button>
                <button
                  type="button"
                  onClick={() => setSaldoVista('total')}
                  className="rounded px-3 py-1 text-xs font-semibold transition-colors"
                  style={{
                    backgroundColor: saldoVista === 'total' ? 'rgba(255,255,255,0.2)' : 'transparent',
                    color: saldoVista === 'total' ? '#fff' : theme.headerMuted,
                  }}
                >
                  Total
                </button>
              </div>
            </div>

            {saldoVista === 'total' ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div>
                  <span className="text-xs text-blue-200">Efectivo + Bancos</span>
                  <p className="text-2xl font-bold text-white md:text-3xl">
                    {saldoTotalHoy > 0 ? money(saldoTotalHoy) : '—'}
                  </p>
                </div>
                <p className="text-xs text-blue-100/80">
                  {saldoEfectivoHoy && (
                    <>Efectivo al {formatShort(saldoEfectivoHoy.date)} · FLUJO EFECTIVO CARRANZA 50</>
                  )}
                  {saldoEfectivoHoy && totalBancosHoy > 0 && ' · '}
                  {totalBancosHoy > 0 && ultimaSemanaCaptura && (
                    <>Bancos · semana al {formatShort(ultimaSemanaCaptura)}</>
                  )}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg px-4 py-3" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">
                    Efectivo
                  </p>
                  <p className="mt-1 text-xl font-bold text-white md:text-2xl">
                    {saldoEfectivoHoy ? money(Number(saldoEfectivoHoy.amount)) : '—'}
                  </p>
                  <p className="mt-1 text-xs text-blue-100/70">
                    {saldoEfectivoHoy
                      ? `Actualizado al ${formatShort(saldoEfectivoHoy.date)} · FLUJO EFECTIVO CARRANZA 50`
                      : 'Sin datos'}
                  </p>
                </div>
                <div className="rounded-lg px-4 py-3" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">
                    Bancos
                  </p>
                  <p className="mt-1 text-xl font-bold text-white md:text-2xl">
                    {totalBancosHoy > 0 ? money(totalBancosHoy) : '—'}
                  </p>
                  <p className="mt-1 text-xs text-blue-100/70">
                    {totalBancosHoy > 0 ? (
                      <>
                        Mifel {money(Number(saldosBancosHoy.mifel?.amount || 0))} + BBVA{' '}
                        {money(Number(saldosBancosHoy.bbva?.amount || 0))}
                        {ultimaSemanaCaptura && (
                          <> · semana al {formatShort(ultimaSemanaCaptura)}</>
                        )}
                      </>
                    ) : (
                      'Sin datos'
                    )}
                  </p>
                </div>
                <div
                  className="rounded-lg px-4 py-3 sm:col-span-2 lg:col-span-1"
                  style={{ backgroundColor: 'rgba(33,115,70,0.35)', border: '1px solid rgba(33,115,70,0.5)' }}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-200">
                    Total disponible
                  </p>
                  <p className="mt-1 text-xl font-bold text-white md:text-2xl">
                    {saldoTotalHoy > 0 ? money(saldoTotalHoy) : '—'}
                  </p>
                  <p className="mt-1 text-xs text-green-100/70">
                    {bancosMesLabel ? `${bancosMesLabel} · ` : ''}Saldo al día · no afectado por filtros
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 md:px-10">
        <Card
          className={`mb-8 ${cardClass}`}
          style={{ backgroundColor: theme.cardBg, borderTop: `4px solid ${theme.kpi[0].border}` }}
        >
          <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="px-2 py-1 md:pr-8">
              <Text className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.kpi[0].label }}>
                Venta total · {periodoLabel}
              </Text>
              <Metric className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">
                {money(ventasAcumuladas)}
              </Metric>
              <Text className="mt-2 text-sm text-slate-500">
                <span className="font-medium text-slate-700">WI</span> {money(ventaWiPeriodo)}
                <span className="mx-2 text-slate-300">|</span>
                <span className="font-medium text-slate-700">Eventos</span> {money(eventosPeriodo)}
              </Text>
            </div>
            <div className="px-2 py-1 md:pl-8">
              <Text className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.kpi[1].label }}>
                Promedio semanal
              </Text>
              <Metric className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">
                {promedioSemanal > 0 ? money(promedioSemanal) : '—'}
              </Metric>
              <Text className="mt-2 text-sm text-slate-500">
                {semanasTranscurridas} semana{semanasTranscurridas !== 1 ? 's' : ''} transcurridas
                · {periodoLabel}
              </Text>
            </div>
          </div>
        </Card>

        {/* Detalle semanal — antes del comparativo */}
        <Card className={`mb-8 ${cardClass} bg-white`}>
          <Title style={{ color: theme.title }}>Detalle semanal ({periodoLabel})</Title>
          <Text className="mb-4 text-sm text-slate-500">
            Como Acumulado ventas x semana · Venta WI = Total − Eventos
          </Text>
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
                        {w.week}
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
                      Total {periodoLabel}
                    </td>
                    <td className="px-4 py-3 text-right">{money(eventosPeriodo)}</td>
                    <td className="px-4 py-3 text-right">{money(ventaWiPeriodo)}</td>
                    <td className="px-4 py-3 text-right">{money(ventasAcumuladas)}</td>
                  </tr>
                  <tr className="bg-slate-100 text-slate-600">
                    <td className="px-4 py-2.5 font-semibold" colSpan={5}>
                      Promedio semanal ({semanasTranscurridas} semanas transcurridas)
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {promedioSemanal > 0 ? money(promedioSemanal) : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card className={`mb-8 ${cardClass} bg-white`}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Title style={{ color: theme.title }}>Comparativo semanal</Title>
              <Text className="text-sm text-slate-500">
                Semanas # del Acumulado ventas x semana · TOTAL por semana
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              {COMPARE_YEARS.map((y) => {
                const active = compareYears.includes(y);
                const c = colorForYear(y);
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => toggleCompareYear(y)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: active ? c : '#f1f5f9',
                      color: active ? '#fff' : '#475569',
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
                  const weeks = Array.from(weeklyByYear.get(y)?.values() ?? []).filter(
                    (w) => w.total > 0
                  );
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

        <Card className={`mb-8 ${cardClass} bg-white`} style={{ borderTop: `4px solid ${colorForYear(year)}` }}>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Title style={{ color: theme.title }}>Ventas por mes ({year})</Title>
              <Text className="text-sm text-slate-500">
                Acumulado semanal + Infocaja diario · color {year}
              </Text>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: colorForYear(year) }}
              />
              <span className="text-sm font-semibold" style={{ color: colorForYear(year) }}>
                {year}
              </span>
              {monthlyAverageForYear(monthlyByYear, year) > 0 && (
                <span className="text-sm text-slate-500">
                  · prom. mensual {money(monthlyAverageForYear(monthlyByYear, year))}
                </span>
              )}
            </div>
          </div>
          {loading ? (
            <p className="py-16 text-center text-slate-400">Cargando...</p>
          ) : monthlyBarData.every((m) => m.ventas === 0) ? (
            <p className="py-16 text-center text-slate-400">Sin datos</p>
          ) : (
            <MonthlyBarChart rows={monthlyBarData} year={year} />
          )}
        </Card>

        <Card className={`${cardClass} bg-white`}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Title style={{ color: theme.title }}>Promedio venta semanal por mes</Title>
              <Text className="text-sm text-slate-500">
                Promedio semanal dentro de cada mes · Acumulado ventas x semana
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              {COMPARE_YEARS.map((y) => {
                const active = compareYears.includes(y);
                const c = colorForYear(y);
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => toggleCompareYear(y)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: active ? c : '#f1f5f9',
                      color: active ? '#fff' : '#475569',
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
            </div>
          </div>

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
      </div>
    </main>
  );
}
