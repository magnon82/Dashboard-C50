'use client';

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { colorForYear } from '@/app/components/WeeklyComparisonChart';

function formatMoney(v: number, decimals = 0) {
  return `$${v.toLocaleString('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface MonthlyBarChartProps {
  rows: { mes: string; ventas: number }[];
  year: number;
}

interface YearTooltipPayloadItem {
  name?: string;
  value?: number | string | null;
  color?: string;
}

function YearCompareTooltip({
  active,
  payload,
  label,
  subtitle,
}: {
  active?: boolean;
  payload?: YearTooltipPayloadItem[];
  label?: string;
  subtitle: string;
}) {
  if (!active || !payload?.length) return null;

  const items = payload
    .filter((p) => p.value != null && Number(p.value) > 0)
    .sort((a, b) => Number(b.name) - Number(a.name));

  if (!items.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      <p className="mb-2 text-sm font-bold text-slate-800">{label}</p>
      <div className="space-y-1.5">
        {items.map((p) => {
          const y = Number(p.name);
          const c = colorForYear(y);
          return (
            <div key={p.name} className="flex items-center justify-between gap-6 text-sm">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c }}
                />
                <span className="font-semibold" style={{ color: c }}>
                  {p.name}
                </span>
              </span>
              <span className="font-bold tabular-nums text-slate-800">
                {formatMoney(Number(p.value), 0)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 border-t border-slate-100 pt-1.5 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

export function MonthlyBarChart({ rows, year }: MonthlyBarChartProps) {
  const fill = colorForYear(year);
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={76}
          />
          <Tooltip
            formatter={(value: number) => [formatMoney(value), String(year)]}
            contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
          />
          <Bar dataKey="ventas" fill={fill} radius={[4, 4, 0, 0]} maxBarSize={40} name={String(year)} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface MonthlyTotalComparisonChartProps {
  rows: Record<string, string | number>[];
  years: number[];
}

/** Barras agrupadas — ventas totales por mes, varios años */
export function MonthlyTotalComparisonChart({ rows, years }: MonthlyTotalComparisonChartProps) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={rows}
          margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
          barCategoryGap="18%"
          barGap={2}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="mesCorto" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={80}
          />
          <Tooltip
            content={
              <YearCompareTooltip subtitle="Ventas totales del mes · Acumulado + Infocaja" />
            }
          />
          {years.map((y) => (
            <Bar
              key={y}
              dataKey={String(y)}
              name={String(y)}
              fill={colorForYear(y)}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface MonthlyComparisonChartProps {
  rows: Record<string, string | number | null>[];
  years: number[];
}

interface TooltipPayloadItem {
  name?: string;
  value?: number | string | null;
  color?: string;
}

function MonthlyAvgTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const items = payload
    .filter((p) => p.value != null && Number(p.value) > 0)
    .sort((a, b) => Number(b.name) - Number(a.name));

  if (!items.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg">
      <p className="mb-2 text-sm font-bold text-slate-800">{label}</p>
      <div className="space-y-1.5">
        {items.map((p) => {
          const y = Number(p.name);
          const c = colorForYear(y);
          return (
            <div key={p.name} className="flex items-center justify-between gap-6 text-sm">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c }}
                />
                <span className="font-semibold" style={{ color: c }}>
                  {p.name}
                </span>
              </span>
              <span className="font-bold tabular-nums text-slate-800">
                {formatMoney(Number(p.value), 2)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
        Promedio venta semanal del mes
      </p>
    </div>
  );
}

/** Líneas con puntos — estilo Acumulado ventas x semana */
export function MonthlyComparisonChart({ rows, years }: MonthlyComparisonChartProps) {
  const chartRows = rows.map((row) => {
    const short = MES_CORTO[(Number(row.monthIdx) || 1) - 1] ?? String(row.mes).slice(0, 3);
    return { ...row, mesCorto: short };
  });

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartRows} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="mesCorto" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={80}
          />
          <Tooltip content={<MonthlyAvgTooltip />} />
          {years.map((y) => (
            <Line
              key={y}
              type="monotone"
              dataKey={String(y)}
              name={String(y)}
              stroke={colorForYear(y)}
              strokeWidth={2.5}
              dot={{ fill: colorForYear(y), r: 5, strokeWidth: 0 }}
              activeDot={{ r: 7, strokeWidth: 2, stroke: '#fff' }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
