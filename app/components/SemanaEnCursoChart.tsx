'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SUITE } from '@/app/lib/themes';
import {
  shouldExcludeSunday,
  todayMexicoIso,
  type DaySale,
} from '@/app/lib/ventas-semana';

type ChartRow = {
  dia: string;
  actual: number | null;
  anterior: number | null;
};

function formatMoney(v: number) {
  return `$${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

function formatMoneyExact(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lun–Dom abreviado: "lun." → "Lun" */
function shortWeekday(weekday: string) {
  const base = weekday.replace(/\.$/, '').trim();
  return capitalize(base.slice(0, 3));
}

type SemanaEnCursoChartProps = {
  days: DaySale[];
  year: number;
  prevYear: number;
};

function ChartTooltip({
  active,
  payload,
  label,
  year,
  prevYear,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number | null; color?: string }>;
  label?: string;
  year: number;
  prevYear: number;
}) {
  if (!active || !payload?.length) return null;
  const names: Record<string, number> = { actual: year, anterior: prevYear };
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
      style={{ fontSize: 12 }}
    >
      <p className="mb-1.5 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => {
        const key = String(p.dataKey ?? '');
        if (p.value == null) return null;
        return (
          <p key={key} className="tabular-nums" style={{ color: p.color }}>
            <span className="font-medium">{names[key] ?? key}: </span>
            {formatMoneyExact(Number(p.value))}
          </p>
        );
      })}
    </div>
  );
}

/** Puntos Lun–Dom: año actual (navy) vs año anterior (oro), con línea suave de apoyo.
 *  Año en curso: no grafica hoy ni días futuros (CDMX); año anterior sí muestra la semana completa
 *  salvo domingos <2026 (cerrado → null, no $0). */
export function SemanaEnCursoChart({
  days,
  year,
  prevYear,
}: SemanaEnCursoChartProps) {
  const todayMx = todayMexicoIso();
  const data: ChartRow[] = days.map((d) => {
    // Omitir punto (null): día en curso / futuros, o domingo cerrado <2026 — no dibujar $0
    const omitActual = d.date >= todayMx || shouldExcludeSunday(d.date);
    const omitAnterior =
      d.prevTotal == null ||
      (d.prevDate != null && shouldExcludeSunday(d.prevDate));
    return {
      dia: shortWeekday(d.weekday),
      actual: omitActual ? null : d.total,
      anterior: omitAnterior ? null : (d.prevTotal ?? null),
    };
  });

  const hasAny =
    data.some((r) => (r.actual != null && r.actual > 0) || (r.anterior != null && r.anterior > 0));

  if (!hasAny) return null;

  return (
    <div className="mb-5 h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="dia"
            tick={{ fontSize: 12, fill: '#64748b', fontWeight: 500 }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={72}
            domain={[0, 'auto']}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<ChartTooltip year={year} prevYear={prevYear} />}
            cursor={{ stroke: '#cbd5e1', strokeDasharray: '4 4' }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey="anterior"
            name={String(prevYear)}
            stroke={SUITE.orange}
            strokeWidth={1.5}
            strokeOpacity={0.45}
            dot={{
              fill: SUITE.orange,
              r: 6,
              strokeWidth: 2,
              stroke: '#fff',
            }}
            activeDot={{ r: 8, strokeWidth: 2, stroke: '#fff', fill: SUITE.orangeDeep }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            name={String(year)}
            stroke={SUITE.navy}
            strokeWidth={1.75}
            strokeOpacity={0.5}
            dot={{
              fill: SUITE.navy,
              r: 6.5,
              strokeWidth: 2,
              stroke: '#fff',
            }}
            activeDot={{ r: 8.5, strokeWidth: 2, stroke: '#fff', fill: SUITE.navyDeep }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
