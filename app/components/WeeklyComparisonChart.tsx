'use client';

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export const YEAR_HEX: Record<number, string> = {
  2026: '#2e75b6',
  2025: '#217346',
  2024: '#7030a0',
  2023: '#c55a11',
  2022: '#0d9488',
  2021: '#475569',
};

export function colorForYear(year: number): string {
  return YEAR_HEX[year] ?? '#64748b';
}

interface WeeklyComparisonChartProps {
  rows: Record<string, string | number>[];
  years: number[];
}

function formatMoney(v: number) {
  return `$${v.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
}

export function WeeklyComparisonChart({ rows, years }: WeeklyComparisonChartProps) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={rows}
          margin={{ top: 8, right: 12, left: 4, bottom: 48 }}
          barCategoryGap="12%"
          barGap={2}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="semana"
            tick={{ fontSize: 10, fill: '#64748b' }}
            interval={Math.max(0, Math.floor(rows.length / 16))}
            angle={-40}
            textAnchor="end"
            height={56}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => formatMoney(Number(v))}
            width={76}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatMoney(value), name]}
            contentStyle={{
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '12px',
            }}
          />
          {years.map((y) => (
            <Bar
              key={y}
              dataKey={String(y)}
              name={String(y)}
              fill={colorForYear(y)}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
