'use client';

import { useEffect, useState } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { getTheme, SUITE } from '@/app/lib/themes';
import { formatShort } from '@/app/lib/ventas-semana';
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
};

export type VentasTombolaSemanalCardProps = {
  /** Lunes ISO de la semana (alineado a SemanaEnCursoTable). */
  mondayKey: string;
  /** Domingo ISO de la semana. */
  sundayKey: string;
  /** Nº de semana Acumulado (solo UI). */
  weekNumber?: number;
  className?: string;
};

function daySaldoEfe(d: TombolaDay): number {
  if (typeof d.saldo_efe === 'number' && Number.isFinite(d.saldo_efe)) {
    return d.saldo_efe;
  }
  // Fallback: payload antiguo usaba `tombola` como fórmula.
  return Number(d.tombola_legacy ?? d.tombola) || 0;
}

function dayTombola(d: TombolaDay): number {
  if (typeof d.saldo_efe === 'number' && Number.isFinite(d.saldo_efe)) {
    return Math.max(0, Number(d.tombola) || 0);
  }
  // Sin recovery en payload viejo: no entregar negativos.
  return Math.max(0, Number(d.tombola) || 0);
}

/**
 * Saldo efe / Tómbola semanal en Ventas.
 * Saldo efe = Infocaja − propinas TPV; Tómbola = remanente tras recuperar déficits.
 */
export function VentasTombolaSemanalCard({
  mondayKey,
  sundayKey,
  weekNumber,
  className = 'mb-8',
}: VentasTombolaSemanalCardProps) {
  const [data, setData] = useState<TombolaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          from: mondayKey,
          to: sundayKey,
        });
        const res = await fetch(`/api/ventas/tombola-semana?${qs}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as TombolaPayload;
        if (cancelled) return;
        if (!res.ok && json.total == null) {
          setError(json.error || 'No se pudo cargar Saldo efe / tómbola');
          setData(json);
          return;
        }
        setData(json);
        if (json.error && !json.ready) setError(json.error);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Error de red');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mondayKey, sundayKey]);

  const isWtd = data != null && data.asOf < data.to;
  const rangeLabel = data
    ? `${formatShort(data.from)} – ${formatShort(isWtd ? data.asOf : data.to)}`
    : `${formatShort(mondayKey)} – ${formatShort(sundayKey)}`;

  const weekLabel =
    weekNumber != null && weekNumber > 0 ? ` · S${weekNumber}` : '';

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
      ) : null}
    </Card>
  );
}
