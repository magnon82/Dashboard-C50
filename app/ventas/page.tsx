'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import { WeeklyComparisonChart, colorForYear } from '@/app/components/WeeklyComparisonChart';
import { MonthlyTotalComparisonChart } from '@/app/components/MonthlyCharts';
import { SuiteShell } from '@/app/components/SuiteShell';
import { VentasResumenCard } from '@/app/components/VentasResumenCard';
import { SemanaEnCursoTable } from '@/app/components/SemanaEnCursoTable';
import { DetalleSemanalCard } from '@/app/components/DetalleSemanalCard';
import { ChequePromedioMensualCard } from '@/app/components/ChequePromedioMensualCard';
import { PromedioVentaSemanalPorMesCard } from '@/app/components/PromedioVentaSemanalPorMesCard';
import { InfocajaSyncBanner } from '@/app/components/InfocajaSyncBanner';
import {
  SectionHeader,
  filterControlClass,
  filterSelectClass,
  yearChipClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  parseIsoDate,
  buildWeeklySalesByYear,
  buildWeeklyComparisonChart,
  buildMonthlySalesByYear,
  buildMonthlyTotalChartRows,
  monthlyAverageForYear,
  monthlyTotalForYear,
  weeklyAverage,
  buildWeekToDateSales,
  weekRangeLabel,
  weekOptionsYearInCourse,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';
import { useStaffRptEventos } from '@/app/lib/use-staff-rpt-eventos';

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const [weekFrom, setWeekFrom] = useState<number | null>(null);
  const [weekTo, setWeekTo] = useState<number | null>(null);
  /** Semana a consultar en card «semana en curso» (null = semana actual WTD). */
  const [consultaSemana, setConsultaSemana] = useState<number | null>(null);

  /** Eventos ERP (staff_rpt) — mismo fallback que la tabla diaria, para acumulado semanal. */
  const staffRptEventos = useStaffRptEventos();

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
    () =>
      buildWeeklySalesByYear(records, weeklyDataYears, {
        eventosFallbackByDate: staffRptEventos,
      }),
    [records, weeklyDataYears, staffRptEventos]
  );

  const monthlyByYear = useMemo(
    () =>
      buildMonthlySalesByYear(records, weeklyByYear, COMPARE_YEARS, {
        eventosFallbackByDate: staffRptEventos,
      }),
    [records, weeklyByYear, staffRptEventos]
  );

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

  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const semanaEnCursoOptions = useMemo(() => weekOptionsYearInCourse(), []);

  const weekToDate = useMemo(
    () =>
      buildWeekToDateSales(records, undefined, {
        week: consultaSemana ?? undefined,
      }),
    [records, consultaSemana]
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
        <InfocajaSyncBanner />
        {dataError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">No se cargaron los datos</p>
            <p className="mt-1">{dataError}</p>
          </div>
        )}
        {loading && (
          <p className="mb-6 text-center" style={{ color: theme.muted }}>Cargando datos…</p>
        )}
        <VentasResumenCard
          className="mb-8"
          records={records}
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
          availableYears={availableYears}
          weeklyDataYears={weeklyDataYears}
          eventosFallbackByDate={staffRptEventos}
          showPaymentMix
        />

        <SemanaEnCursoTable
          weekToDate={weekToDate}
          showDescCanc
          eventosFallbackByDate={staffRptEventos}
          weekOptions={semanaEnCursoOptions}
          selectedWeek={consultaSemana ?? weekToDate.weekNumber}
          onWeekChange={(w) => {
            const current = semanaEnCursoOptions[0]?.week;
            setConsultaSemana(current != null && w === current ? null : w);
          }}
        />

        <p className="mb-8 text-sm">
          <Link href="/cortes" className="font-semibold hover:underline" style={{ color: SUITE.orangeDeep }}>
            Cortes y operación →
          </Link>
          <span className="text-slate-500"> cortes diarios, tómbola y cancelaciones</span>
        </p>

        <PromedioVentaSemanalPorMesCard
          records={records}
          years={COMPARE_YEARS}
          weeklyDataYears={weeklyDataYears}
          eventosFallbackByDate={staffRptEventos}
          loading={loading}
        />

        <ChequePromedioMensualCard records={records} years={COMPARE_YEARS} />

        <DetalleSemanalCard
          records={records}
          years={COMPARE_YEARS}
          weeklyDataYears={weeklyDataYears}
          eventosFallbackByDate={staffRptEventos}
        />

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
