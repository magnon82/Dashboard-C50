'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PaymentMix } from '@/app/lib/ventas-semana';
import { SUITE } from '@/app/lib/themes';

const COLORS = {
  efectivo: SUITE.navy,
  tarjetas: SUITE.orange,
};

function pct(part: number, total: number) {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(0)}%`;
}

interface Props {
  mix: PaymentMix;
  periodoLabel: string;
}

/** Pastel compacto Efectivo vs Tarjetas (misma paleta WI / Eventos). */
export function PaymentMixPie({ mix, periodoLabel }: Props) {
  const total = mix.total > 0 ? mix.total : mix.efectivo + mix.bancarias;
  const data = [
    { name: 'Efectivo', value: mix.efectivo, color: COLORS.efectivo },
    { name: 'Tarjetas', value: mix.bancarias, color: COLORS.tarjetas },
  ].filter((d) => d.value > 0);

  if (total <= 0 || data.length === 0) {
    return (
      <div className="flex h-[88px] items-center text-xs text-slate-400">
        Sin datos de efectivo/tarjetas para {periodoLabel}.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="h-[88px] w-[88px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={22}
              outerRadius={40}
              paddingAngle={1.5}
              stroke="#fff"
              strokeWidth={1.5}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [
                `$${Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 })} (${pct(Number(value), total)})`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1 text-xs text-slate-600">
        <p>
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: COLORS.efectivo }}
          />
          Efectivo {pct(mix.efectivo, total)}
        </p>
        <p>
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: COLORS.tarjetas }}
          />
          Tarjetas {pct(mix.bancarias, total)}
        </p>
      </div>
    </div>
  );
}
