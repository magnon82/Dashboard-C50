'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  acumuladoWeekForDate,
  formatShort,
  sundayOfWeek,
  todayMexicoIso,
  toIsoLocal,
  weekMondayIso,
} from '@/app/lib/ventas-semana';
import { moneyMx } from '@/app/lib/tpv-cortes';

const theme = getTheme('suite');

type TombolaDay = {
  date: string;
  /** Efectivo Infocaja − propinas TPV (puede ser negativo). */
  saldo_efe: number;
  /** Efectivo a entregar en tómbola tras recuperar déficits (≥ 0). */
  tombola: number;
  recovery?: number;
  deficit_after?: number;
  efectivo: number | null;
  propinas_tpv: number;
  source: 'formula' | 'depositado' | 'infocaja';
  has_corte?: boolean;
  /** Compat: APIs viejas enviaban la fórmula como `tombola`. */
  tombola_legacy?: number;
};

type TombolaPayload = {
  ready: boolean;
  week: number | null;
  year: number | null;
  from: string;
  to: string;
  asOf: string;
  /** Suma de tómbola a entregar. */
  total: number;
  total_saldo_efe?: number;
  deficit_remaining?: number;
  days: TombolaDay[];
  daysWithCorte: number;
  daysWithData?: number;
  formula?: string;
  error?: string;
  fellBackToLatest?: boolean;
};

export type VentasTombolaSemanalCardProps = {
  /** Lunes ISO de la semana (hint inicial; la tarjeta navega sola). */
  mondayKey?: string;
  /** Domingo ISO de la semana. */
  sundayKey?: string;
  /** Nº de semana Acumulado (hint inicial). */
  weekNumber?: number;
  className?: string;
};

function daySaldoEfe(d: TombolaDay): number {
  if (typeof d.saldo_efe === 'number' && Number.isFinite(d.saldo_efe)) {
    return d.saldo_efe;
  }
  return Number(d.tombola_legacy ?? d.tombola) || 0;
}

function dayTombola(d: TombolaDay): number {
  if (typeof d.saldo_efe === 'number' && Number.isFinite(d.saldo_efe)) {
    return Math.max(0, Number(d.tombola) || 0);
  }
  return Math.max(0, Number(d.tombola) || 0);
}

function shiftWeek(
  year: number,
  week: number,
  deltaWeeks: number
): { year: number; week: number; monday: string; sunday: string } {
  const mon = weekMondayIso(year, week);
  const [y, m, d] = mon.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaWeeks * 7);
  const monday = toIsoLocal(dt);
  const nextYear = Number(monday.slice(0, 4));
  const nextWeek = acumuladoWeekForDate(monday);
  return {
    year: nextYear,
    week: nextWeek > 0 ? nextWeek : 1,
    monday: weekMondayIso(nextYear, nextWeek > 0 ? nextWeek : 1),
    sunday: sundayOfWeek(
      weekMondayIso(nextYear, nextWeek > 0 ? nextWeek : 1)
    ),
  };
}

/**
 * Saldo efe / Tómbola semanal en Ventas.
 * Navegable por semana; si la actual no tiene datos, muestra la última con datos.
 */
export function VentasTombolaSemanalCard({
  mondayKey,
  sundayKey: _sundayKey,
  weekNumber,
  className = 'mb-8',
}: VentasTombolaSemanalCardProps) {
  const today = useMemo(() => todayMexicoIso(), []);
  const currentWeek = useMemo(() => acumuladoWeekForDate(today), [today]);
  const currentYear = useMemo(() => Number(today.slice(0, 4)), [today]);

  const initialYear =
    mondayKey && /^\d{4}-\d{2}-\d{2}$/.test(mondayKey)
      ? Number(mondayKey.slice(0, 4))
      : currentYear;
  const initialWeek =
    weekNumber && weekNumber > 0
      ? weekNumber
      : mondayKey
        ? acumuladoWeekForDate(mondayKey)
        : currentWeek;

  const [year, setYear] = useState(initialYear);
  const [week, setWeek] = useState(initialWeek > 0 ? initialWeek : currentWeek);
  const [userPicked, setUserPicked] = useState(false);
  const [data, setData] = useState<TombolaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekOptions = useMemo(() => {
    const maxW =
      year === currentYear ? Math.max(currentWeek, 1) : 53;
    const opts: { week: number; label: string }[] = [];
    for (let w = maxW; w >= 1; w -= 1) {
      const mon = weekMondayIso(year, w);
      const sun = sundayOfWeek(mon);
      opts.push({
        week: w,
        label: `S${w} · ${formatShort(mon)} – ${formatShort(sun)}`,
      });
    }
    return opts;
  }, [year, currentYear, currentWeek]);

  const yearOptions = useMemo(() => {
    const ys = [currentYear, currentYear - 1, currentYear - 2];
    return [...new Set(ys)].filter((y) => y >= 2024);
  }, [currentYear]);

  const canGoNext = useMemo(() => {
    const next = shiftWeek(year, week, 1);
    if (next.year > currentYear) return false;
    if (next.year === currentYear && next.week > currentWeek) return false;
    return true;
  }, [year, week, currentYear, currentWeek]);

  const canGoPrev = useMemo(() => {
    const prev = shiftWeek(year, week, -1);
    return prev.year >= yearOptions[yearOptions.length - 1]!;
  }, [year, week, yearOptions]);

  const load = useCallback(
    async (opts: {
      year: number;
      week: number;
      fallbackLast?: boolean;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          year: String(opts.year),
          week: String(opts.week),
        });
        if (opts.fallbackLast) qs.set('fallback', 'last');
        const res = await fetch(`/api/ventas/tombola-semana?${qs}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as TombolaPayload;
        if (!res.ok && json.total == null) {
          setError(json.error || 'No se pudo cargar Saldo efe / tómbola');
          setData(json);
          return;
        }
        setData(json);
        if (
          json.fellBackToLatest &&
          json.week != null &&
          json.year != null &&
          (json.year !== opts.year || json.week !== opts.week)
        ) {
          setYear(json.year);
          setWeek(json.week);
        }
        if (json.error && !json.ready) setError(json.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de red');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load({
      year,
      week,
      fallbackLast: !userPicked,
    });
  }, [year, week, userPicked, load]);

  function goPrev() {
    if (!canGoPrev) return;
    const prev = shiftWeek(year, week, -1);
    setUserPicked(true);
    setYear(prev.year);
    setWeek(prev.week);
  }

  function goNext() {
    if (!canGoNext) return;
    const next = shiftWeek(year, week, 1);
    setUserPicked(true);
    setYear(next.year);
    setWeek(next.week);
  }

  const isWtd = data != null && data.asOf < data.to;
  const rangeLabel = data
    ? `${formatShort(data.from)} – ${formatShort(isWtd ? data.asOf : data.to)}`
    : '';

  const weekLabel =
    (data?.week ?? week) > 0 ? ` · S${data?.week ?? week}` : '';

  const hasDays =
    data != null && (data.daysWithData ?? data.days.length) > 0;

  const totalSaldoEfe =
    data?.total_saldo_efe != null
      ? data.total_saldo_efe
      : data
        ? Math.round(
            data.days.reduce((a, d) => a + daySaldoEfe(d), 0) * 100
          ) / 100
        : 0;

  const totalTombola =
    data?.total != null
      ? data.total
      : data
        ? Math.round(
            data.days.reduce((a, d) => a + dayTombola(d), 0) * 100
          ) / 100
        : 0;

  const deficitRemaining = data?.deficit_remaining ?? 0;

  return (
    <Card
      className={`${className} rounded-[24px] border-0 p-5 md:p-6`}
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.orange}`,
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoPrev || loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-40"
            aria-label="Semana anterior"
            title="Semana anterior"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext || loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-40"
            aria-label="Semana siguiente"
            title="Semana siguiente"
          >
            ›
          </button>
          <label className={`${filterControlClass} bg-white shadow-sm`}>
            <span className="shrink-0 text-slate-500">Año</span>
            <select
              className={`${filterSelectClass} min-w-[5rem] cursor-pointer bg-white`}
              value={year}
              onChange={(e) => {
                const y = Number(e.target.value);
                if (!Number.isFinite(y)) return;
                setUserPicked(true);
                setYear(y);
                const maxW = y === currentYear ? currentWeek : 53;
                setWeek((w) => Math.min(w, maxW));
              }}
              aria-label="Año de tómbola"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className={`${filterControlClass} bg-white shadow-sm`}>
            <span className="shrink-0 text-slate-500">Semana</span>
            <select
              className={`${filterSelectClass} min-w-[12rem] max-w-[18rem] cursor-pointer bg-white`}
              value={week}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 1) return;
                setUserPicked(true);
                setWeek(v);
              }}
              aria-label="Consultar semana de tómbola"
            >
              {weekOptions.map((o) => (
                <option key={o.week} value={o.week}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {data?.fellBackToLatest ? (
          <Text className="text-xs text-amber-800">
            Sin datos en la semana pedida · mostrando la última con datos
          </Text>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <Text
            className="text-xs font-bold uppercase tracking-wide"
            style={{ color: theme.kpi[2]?.label ?? theme.kpi[0].label }}
          >
            Saldo efe{weekLabel}
          </Text>
          {loading ? (
            <p className="mt-2 text-sm" style={{ color: theme.muted }}>
              Cargando…
            </p>
          ) : error && !data?.ready ? (
            <p className="mt-2 text-sm text-red-700">{error}</p>
          ) : (
            <>
              <Metric
                className={`mt-1 text-3xl font-bold md:text-4xl ${
                  hasDays && totalSaldoEfe < 0
                    ? 'text-rose-700'
                    : 'text-slate-900'
                }`}
              >
                {hasDays ? moneyMx(totalSaldoEfe) : '—'}
              </Metric>
              <Text className="mt-1 text-sm text-slate-500">
                {rangeLabel}
                {data
                  ? ` · ${data.daysWithData ?? data.days.length} día${
                      (data.daysWithData ?? data.days.length) !== 1 ? 's' : ''
                    }`
                  : null}
                {data && data.daysWithCorte > 0
                  ? ` · ${data.daysWithCorte} con corte`
                  : null}
              </Text>
              <Text className="mt-1 text-xs text-slate-400">
                Efectivo Infocaja − propinas de tarjeta
                {hasDays && totalSaldoEfe < 0
                  ? ' · negativo = propinas TPV cubiertas con efectivo'
                  : null}
              </Text>
            </>
          )}
        </div>

        {!loading && data?.ready ? (
          <div className="min-w-[9rem] text-right">
            <Text
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: theme.kpi[0]?.label ?? theme.muted }}
            >
              Tómbola
            </Text>
            <Metric className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">
              {hasDays ? moneyMx(totalTombola) : '—'}
            </Metric>
            <Text className="mt-1 text-xs text-slate-400">
              A entregar
              {deficitRemaining > 0
                ? ` · déficit pend. ${moneyMx(deficitRemaining)}`
                : null}
            </Text>
          </div>
        ) : null}
      </div>

      {!loading && data && data.days.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr
                className="text-[11px] uppercase tracking-wide text-white"
                style={{ backgroundColor: theme.tableHead }}
              >
                <th className="px-3 py-2 text-left font-semibold">Día</th>
                <th className="px-3 py-2 text-right font-semibold">
                  Efectivo
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  Propinas TPV
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  Saldo efe
                </th>
                <th className="px-3 py-2 text-right font-semibold">Tómbola</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d, i) => {
                const saldo = daySaldoEfe(d);
                const tombola = dayTombola(d);
                return (
                  <tr
                    key={d.date}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                  >
                    <td className="px-3 py-2 text-slate-700">
                      {formatShort(d.date)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {d.efectivo != null ? moneyMx(d.efectivo) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {moneyMx(d.propinas_tpv)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        saldo < 0 ? 'text-rose-700' : ''
                      }`}
                      style={
                        saldo < 0 ? undefined : { color: theme.tableTotal }
                      }
                    >
                      {moneyMx(saldo)}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-semibold tabular-nums"
                      style={{ color: theme.tableTotal }}
                      title={
                        (d.recovery ?? 0) > 0
                          ? `Recuperó ${moneyMx(d.recovery!)} de déficit previo`
                          : undefined
                      }
                    >
                      {moneyMx(tombola)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr
                className="font-bold text-white"
                style={{ backgroundColor: theme.tableFoot }}
              >
                <td className="px-3 py-2.5" colSpan={3}>
                  {isWtd ? 'Total (lun–hoy)' : 'Total (lun–dom)'}
                  {deficitRemaining > 0
                    ? ` · déficit pend. ${moneyMx(deficitRemaining)}`
                    : ''}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyMx(totalSaldoEfe)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyMx(totalTombola)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : !loading && data?.ready && !hasDays ? (
        <p className="mt-4 text-sm text-slate-500">
          Sin datos de efectivo / propinas TPV en esta semana. Elige otra con
          las flechas o el selector.
        </p>
      ) : null}
    </Card>
  );
}
