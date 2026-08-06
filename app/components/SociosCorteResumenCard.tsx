'use client';

import { useEffect, useState } from 'react';
import { Card } from '@tremor/react';
import { SectionHeader } from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import { moneyMx } from '@/app/lib/tpv-cortes';

const theme = getTheme('suite');

type SociosCortePayload = {
  ready: boolean;
  mode: 'yesterday' | 'latest' | 'none';
  yesterdayDate: string;
  date: string | null;
  isYesterday: boolean;
  corte: {
    rpt_date: string;
    wi_amount: number;
    eventos_amount: number;
    eventos_os_amount: number;
    eventos_extra_amount: number;
    propinas: number;
    efectivo_tombola: number;
    bancos_neto_tpv: number | null;
    bancos_cobrado_tpv: number | null;
    bancos_propina_tpv: number | null;
    tpv_complete: boolean;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  } | null;
  error?: string;
  hint?: string;
};

function formatCorteDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-2xl px-3 py-3 sm:px-4"
      style={{ backgroundColor: '#F8FAFC' }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: theme.muted }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-base font-bold tabular-nums sm:text-lg"
        style={{ color: theme.title }}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px]" style={{ color: theme.muted }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Resumen compacto del corte de ayer (o el más reciente) para Reportes Socios.
 */
export function SociosCorteResumenCard({
  className = 'mb-6',
}: {
  className?: string;
}) {
  const [data, setData] = useState<SociosCortePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/reportes-socios/corte', {
          cache: 'no-store',
        });
        const json = (await res.json()) as SociosCortePayload & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok && !json.corte) {
          setError(json.error || 'No se pudo cargar el corte');
          setData(json);
          return;
        }
        setData(json);
        if (json.error && !json.corte) setError(json.error);
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
  }, []);

  const corte = data?.corte ?? null;
  const isLatestFallback = data?.mode === 'latest';
  const title =
    data?.mode === 'yesterday'
      ? 'Corte de ayer'
      : data?.mode === 'latest'
        ? 'Corte más reciente'
        : 'Corte del día anterior';

  const dateLabel = corte
    ? formatCorteDateDisplay(corte.rpt_date)
    : data?.yesterdayDate
      ? formatCorteDateDisplay(data.yesterdayDate)
      : null;

  const eventosHint =
    corte &&
    (corte.eventos_os_amount > 0 || corte.eventos_extra_amount > 0)
      ? `OS ${moneyMx(corte.eventos_os_amount)} · Extra ${moneyMx(corte.eventos_extra_amount)}`
      : undefined;

  const ventaDia =
    corte != null
      ? Math.round((corte.wi_amount + corte.eventos_amount) * 100) / 100
      : null;

  return (
    <Card
      className={`${className} rounded-[24px] border-0 p-5 md:p-6`}
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.orange}`,
      }}
    >
      <SectionHeader
        title={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className="text-lg font-semibold leading-none"
              style={{ color: theme.title }}
            >
              {title}
            </span>
            {corte ? (
              <span
                className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold text-white"
                style={{ backgroundColor: SUITE.navy }}
              >
                Cerrado
              </span>
            ) : null}
            {isLatestFallback ? (
              <span
                className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold"
                style={{
                  backgroundColor: SUITE.orangeSoft,
                  color: SUITE.orangeDeep,
                }}
              >
                Informativo
              </span>
            ) : null}
          </div>
        }
      />

      {dateLabel ? (
        <p className="mb-4 text-sm capitalize" style={{ color: theme.muted }}>
          {dateLabel}
          {isLatestFallback
            ? ' · sin cierre registrado para ayer'
            : null}
        </p>
      ) : (
        <p className="mb-4 text-sm" style={{ color: theme.muted }}>
          Cierre diario de piso (WI, eventos, bancos TPV, tómbola).
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando corte…
        </p>
      ) : error && !corte ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : !corte ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Aún no hay cortes cerrados en el sistema.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Venta día" value={moneyMx(ventaDia)} hint="WI + Eventos" />
            <Kpi label="WI" value={moneyMx(corte.wi_amount)} />
            <Kpi
              label="Eventos"
              value={moneyMx(corte.eventos_amount)}
              hint={eventosHint}
            />
            <Kpi
              label="Bancos TPV"
              value={moneyMx(corte.bancos_neto_tpv)}
            />
            <Kpi label="Propinas" value={moneyMx(corte.propinas)} />
            <Kpi
              label="Tómbola"
              value={moneyMx(corte.efectivo_tombola)}
            />
          </div>
          {corte.notes ? (
            <p
              className="mt-3 text-xs leading-relaxed"
              style={{ color: theme.muted }}
            >
              Nota: {corte.notes}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
