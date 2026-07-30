'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PaymentMix } from '@/app/lib/ventas-semana';

const COLORS = {
  efectivo: '#217346',
  bancarias: '#2b579a',
  propina: '#c65911',
};

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(part: number, total: number) {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

interface Props {
  mix: PaymentMix;
  periodoLabel: string;
}

export function PaymentMixPie({ mix, periodoLabel }: Props) {
  const data = [
    { name: 'Efectivo', key: 'efectivo' as const, value: mix.efectivo, color: COLORS.efectivo },
    { name: 'Bancos', key: 'bancarias' as const, value: mix.bancarias, color: COLORS.bancarias },
    { name: 'Propinas', key: 'propina' as const, value: mix.propina, color: COLORS.propina },
  ].filter((d) => d.value > 0);

  if (mix.total <= 0 || data.length === 0) {
    return (
      <p className="py-12 text-center text-slate-400">
        Sin datos de efectivo/bancos para {periodoLabel}.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-2">
      <div className="relative mx-auto h-72 w-full max-w-md">
        {/* Capas de profundidad para efecto 3D */}
        <div
          className="pointer-events-none absolute inset-x-[18%] bottom-[8%] h-[22%] rounded-[50%] bg-slate-900/25 blur-md"
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
                  cy="46%"
                  innerRadius={42}
                  outerRadius={100}
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
                      `${money(Number(value))} (${pct(Number(value), mix.total)})`,
                      name,
                    ]}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {data.map((d) => (
          <div
            key={d.key}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: d.color }}
              />
              <span className="text-sm font-semibold text-slate-800">{d.name}</span>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-900">{money(d.value)}</p>
              <p className="text-xs text-slate-500">{pct(d.value, mix.total)}</p>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-slate-200 px-1 pt-2">
          <span className="text-sm font-semibold text-slate-600">Total cobrado</span>
          <span className="text-sm font-bold text-slate-900">{money(mix.total)}</span>
        </div>
      </div>
    </div>
  );
}
