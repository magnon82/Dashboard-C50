'use client';

import { formatShort } from '@/app/lib/ventas-semana';
import { getTheme, SUITE } from '@/app/lib/themes';
import type { SaldosAlDiaData } from '@/app/lib/saldos';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

interface Props {
  data: SaldosAlDiaData;
  loading?: boolean;
}

export function SaldosAlDia({ data, loading }: Props) {
  return (
    <section className="mb-8">
      <p
        className="mb-3 text-xs font-bold uppercase tracking-[0.16em]"
        style={{ color: theme.muted }}
      >
        Saldos al día
      </p>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando saldos…
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-[24px] bg-white px-5 py-5" style={{ boxShadow: SUITE.shadow }}>
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: theme.muted }}
            >
              Efectivo
            </p>
            <p className="mt-2 text-2xl font-bold md:text-3xl" style={{ color: theme.title }}>
              {data.efectivo != null ? money(data.efectivo) : '—'}
            </p>
            <p className="mt-2 text-xs" style={{ color: theme.muted }}>
              {data.efectivoFecha ? `Al ${formatShort(data.efectivoFecha)}` : 'Sin datos'}
            </p>
          </div>

          <div className="rounded-[24px] bg-white px-5 py-5" style={{ boxShadow: SUITE.shadow }}>
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: theme.muted }}
            >
              Bancos
            </p>
            <p className="mt-2 text-2xl font-bold md:text-3xl" style={{ color: theme.title }}>
              {data.bancos > 0 ? money(data.bancos) : '—'}
            </p>
            <p className="mt-2 text-xs" style={{ color: theme.muted }}>
              {data.bancos > 0 ? (
                <>
                  Mifel {money(data.mifel)} + BBVA {money(data.bbva)}
                </>
              ) : (
                'Sin datos'
              )}
            </p>
          </div>

          <div
            className="rounded-[24px] px-5 py-5 text-white"
            style={{ backgroundColor: SUITE.navy, boxShadow: SUITE.shadow }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
              Total
            </p>
            <p className="mt-2 text-2xl font-bold md:text-3xl">
              {data.totalDisponible > 0 ? money(data.totalDisponible) : '—'}
            </p>
            <p className="mt-2 text-xs text-white/55">
              Efectivo + bancos
            </p>
          </div>

          <div className="rounded-[24px] bg-white px-5 py-5" style={{ boxShadow: SUITE.shadow }}>
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: theme.muted }}
            >
              Cuentas por pagar
            </p>
            <p className="mt-2 text-2xl font-bold md:text-3xl" style={{ color: theme.title }}>
              {data.cxpTotal != null ? money(data.cxpTotal) : '—'}
            </p>
            <p className="mt-2 text-xs" style={{ color: theme.muted }}>
              {data.cxpTotal != null ? (
                <>
                  Programados{' '}
                  {data.cxpProgramado != null ? money(data.cxpProgramado) : '—'}
                  <span className="mx-1.5 text-slate-300">·</span>
                  Saldo x pagar{' '}
                  <span className="font-semibold" style={{ color: SUITE.orangeDeep }}>
                    {data.cxpSaldo != null ? money(data.cxpSaldo) : '—'}
                  </span>
                </>
              ) : (
                'Sin datos'
              )}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
