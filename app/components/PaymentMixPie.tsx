'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PaymentMix } from '@/app/lib/ventas-semana';

const COLORS = {
  efectivo: '#0F9F9C', // teal — se diferencia del navy de barras
  bancarias: '#E8A317', // naranja suite
};

function pct(part: number, total: number) {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

interface Props {
  mix: PaymentMix;
  periodoLabel: string;
}

export function PaymentMixPie({ mix, periodoLabel }: Props) {
  const total = mix.total > 0 ? mix.total : mix.efectivo + mix.bancarias;
  const data = [
    { name: 'Efectivo', key: 'efectivo' as const, value: mix.efectivo, color: COLORS.efectivo },
    { name: 'Bancos', key: 'bancarias' as const, value: mix.bancarias, color: COLORS.bancarias },
  ].filter((d) => d.value > 0);

  if (total <= 0 || data.length === 0) {
    return (
      <p className="py-6 text-center text-slate-400">
        Sin datos de efectivo/bancos para {periodoLabel}.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
      <div className="relative h-64 w-full max-w-sm shrink-0 sm:h-72 sm:w-[340px]">
        <div
          className="pointer-events-none absolute inset-x-[14%] bottom-[4%] h-[18%] rounded-[50%] bg-slate-900/25 blur-md"
          aria-hidden
        />
        {[0, 1, 2, 3, 4].map((layer) => (
          <div
            key={layer}
            className="absolute inset-0"
            style={{
              transform: `translateY(${layer * 3}px) rotateX(52deg)`,
              transformOrigin: 'center 55%',
              opacity: layer === 4 ? 1 : 0.35,
              zIndex: layer,
            }}
            aria-hidden={layer < 4}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="48%"
                  innerRadius={52}
                  outerRadius={118}
                  paddingAngle={1.5}
                  stroke={layer === 4 ? '#fff' : 'transparent'}
                  strokeWidth={layer === 4 ? 2 : 0}
                  isAnimationActive={layer === 4}
                >
                  {data.map((d) => (
                    <Cell
                      key={`${d.key}-${layer}`}
                      fill={d.color}
                      style={{
                        filter:
                          layer < 4
                            ? `brightness(${0.55 + layer * 0.08})`
                            : 'drop-shadow(0 8px 12px rgba(15,23,42,0.25))',
                      }}
                    />
                  ))}
                </Pie>
                {layer === 4 && (
                  <Tooltip
                    formatter={(value: number | string, name: string) => [
                      pct(Number(value), total),
                      name,
                    ]}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2 sm:w-44">
        {data.map((d) => (
          <div
            key={d.key}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="truncate text-sm font-semibold text-slate-800">{d.name}</span>
            </div>
            <p className="shrink-0 text-sm font-bold text-slate-900">{pct(d.value, total)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
