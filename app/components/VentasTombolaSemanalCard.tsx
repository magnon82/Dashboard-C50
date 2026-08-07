'use client';

import { useEffect, useState } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { getTheme, SUITE } from '@/app/lib/themes';
import { formatShort } from '@/app/lib/ventas-semana';
import { moneyMx } from '@/app/lib/tpv-cortes';

const theme = getTheme('suite');

type TombolaDay = {
  date: string;
  tombola: number;
  efectivo: number | null;
  propinas_tpv: number;
  source: 'formula' | 'depositado';
};

type TombolaPayload = {
  ready: boolean;
  week: number | null;
  year: number | null;
  from: string;
  to: string;
  asOf: string;
  total: number;
  days: TombolaDay[];
  daysWithCorte: number;
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

/**
 * Tómbola semanal en Ventas: suma de (efectivo Infocaja − propinas TPV)
 * de los cortes cerrados lun–dom (o lun–hoy si la semana está en curso).
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
          setError(json.error || 'No se pudo cargar la tómbola');
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

  return (
    <Card
      className={`${className} rounded-[24px] border-0 p-5 md:p-6`}
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.orange}`,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Text
            className="text-xs font-bold uppercase tracking-wide"
            style={{ color: theme.kpi[2]?.label ?? theme.kpi[0].label }}
          >
            Tómbola semanal{weekLabel}
          </Text>
          {loading ? (
            <p className="mt-2 text-sm" style={{ color: theme.muted }}>
              Cargando…
            </p>
          ) : error && !data?.ready ? (
            <p className="mt-2 text-sm text-red-700">{error}</p>
          ) : (
            <>
              <Metric className="mt-1 text-3xl font-bold text-slate-900 md:text-4xl">
                {data && data.daysWithCorte > 0
                  ? moneyMx(data.total)
                  : '—'}
              </Metric>
              <Text className="mt-1 text-sm text-slate-500">
                {rangeLabel}
                {data
                  ? ` · ${data.daysWithCorte} día${
                      data.daysWithCorte !== 1 ? 's' : ''
                    } con corte`
                  : null}
              </Text>
              <Text className="mt-1 text-xs text-slate-400">
                Efectivo recibido − propinas pagadas en tarjeta (TPV)
              </Text>
            </>
          )}
        </div>
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
                <th className="px-3 py-2 text-right font-semibold">Tómbola</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d, i) => (
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
                    className="px-3 py-2 text-right font-semibold tabular-nums"
                    style={{ color: theme.tableTotal }}
                  >
                    {moneyMx(d.tombola)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                className="font-bold text-white"
                style={{ backgroundColor: theme.tableFoot }}
              >
                <td className="px-3 py-2.5" colSpan={3}>
                  {isWtd ? 'Total (lun–hoy)' : 'Total (lun–dom)'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyMx(data.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
