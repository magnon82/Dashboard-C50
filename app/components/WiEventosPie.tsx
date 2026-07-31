'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { SUITE } from '@/app/lib/themes';

function pct(part: number, total: number) {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(0)}%`;
}

interface Props {
  wi: number;
  eventos: number;
}

/** Pastel compacto WI vs Eventos (bloque superior de Ventas). */
export function WiEventosPie({ wi, eventos }: Props) {
  const total = wi + eventos;
  const data = [
    { name: 'WI', value: wi, color: SUITE.navy },
    { name: 'Eventos', value: eventos, color: SUITE.orange },
  ].filter((d) => d.value > 0);

  if (total <= 0 || data.length === 0) {
    return (
      <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-400">
        Sin mix
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
            style={{ backgroundColor: SUITE.navy }}
          />
          WI {pct(wi, total)}
        </p>
        <p>
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: SUITE.orange }}
          />
          Eventos {pct(eventos, total)}
        </p>
      </div>
    </div>
  );
}
