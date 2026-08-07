'use client';

import { useEffect, useState } from 'react';
import { Card } from '@tremor/react';
import {
  SectionHeader,
  filterControlClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import { moneyMx } from '@/app/lib/tpv-cortes';

const theme = getTheme('suite');

type CorteCancDescLine = {
  id: string;
  date: string;
  kind: 'cancelacion' | 'descuento';
  amount: number;
  motivo: string;
  grupo?: string;
  persona?: string;
  producto?: string;
  mesero?: string;
  autorizo?: string;
  mesa?: string;
  hora?: string;
};

type CortePayload = {
  ready: boolean;
  mode: 'date' | 'yesterday' | 'latest' | 'none';
  requestedDate: string | null;
  yesterdayDate: string;
  todayDate?: string;
  date: string | null;
  isYesterday: boolean;
  hasCorte: boolean;
  corte: {
    rpt_date: string;
    wi_amount: number;
    eventos_amount: number;
    eventos_os_amount: number;
    eventos_extra_amount: number;
    propinas: number;
    efectivo_tombola: number;
    efectivo_contado: number | null;
    efectivo_infocaja: number | null;
    bancos_neto_tpv: number | null;
    bancos_cobrado_tpv: number | null;
    bancos_propina_tpv: number | null;
    tpv_accounted: number;
    tpv_complete: boolean;
    notes: string | null;
    created_by: string;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  tombola?: {
    amount: number;
    source: 'formula' | 'depositado' | 'infocaja';
    efectivo: number | null;
    propinas_tpv: number;
  } | null;
  cancDesc: {
    cancelacionesCount: number;
    cancelacionesAmount: number;
    descuentosCount: number;
    descuentosAmount: number;
    cancelaciones?: CorteCancDescLine[];
    descuentos?: CorteCancDescLine[];
  };
  error?: string;
  hint?: string;
};

type CancDescPanel = 'cancelaciones' | 'descuentos' | null;

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
  highlight,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
  tone?: 'rose' | 'amber' | 'default';
}) {
  const bg =
    highlight
      ? SUITE.orangeSoft
      : tone === 'rose'
        ? '#FFF1F2'
        : tone === 'amber'
          ? '#FFFBEB'
          : '#F8FAFC';
  const border =
    highlight
      ? `2px solid ${SUITE.orange}`
      : tone === 'rose'
        ? '1px solid #FECDD3'
        : tone === 'amber'
          ? '1px solid #FDE68A'
          : undefined;
  const labelColor =
    highlight
      ? SUITE.orangeDeep
      : tone === 'rose'
        ? '#BE123C'
        : tone === 'amber'
          ? '#B45309'
          : theme.muted;

  return (
    <div
      className="rounded-2xl px-3 py-3 sm:px-4"
      style={{
        backgroundColor: bg,
        border,
        boxShadow: highlight ? `0 0 0 1px ${SUITE.orangeSoft}` : undefined,
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: labelColor }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-base font-bold tabular-nums sm:text-lg"
        style={{ color: highlight ? SUITE.navy : theme.title }}
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

function moneyOrDash(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return moneyMx(v);
}

function lineTitle(item: CorteCancDescLine): string {
  return (
    item.producto ||
    item.persona ||
    item.motivo ||
    item.grupo ||
    (item.kind === 'descuento' ? 'Descuento' : 'Cancelación')
  );
}

function lineMeta(item: CorteCancDescLine): string[] {
  return [
    item.motivo ? `Motivo: ${item.motivo}` : null,
    item.grupo ? `Grupo: ${item.grupo}` : null,
    item.persona ? `Persona: ${item.persona}` : null,
    item.producto ? `Producto: ${item.producto}` : null,
    item.mesero ? `Mesero: ${item.mesero}` : null,
    item.autorizo ? `Autorizó: ${item.autorizo}` : null,
    item.mesa ? `Mesa: ${item.mesa}` : null,
    item.hora ? `Hora: ${item.hora}` : null,
  ].filter(Boolean) as string[];
}

function CancDescToggle({
  label,
  count,
  amount,
  open,
  tone,
  onToggle,
}: {
  label: string;
  count: number;
  amount: number;
  open: boolean;
  tone: 'rose' | 'amber';
  onToggle: () => void;
}) {
  const labelColor = tone === 'rose' ? '#BE123C' : '#B45309';
  const toneClasses =
    tone === 'rose'
      ? open
        ? 'border-rose-400 bg-rose-50 hover:bg-rose-100'
        : 'border-rose-300 bg-rose-50 hover:bg-rose-100'
      : open
        ? 'border-amber-400 bg-amber-50 hover:bg-amber-100'
        : 'border-amber-300 bg-amber-50 hover:bg-amber-100';
  const chevron = open ? '▴' : '▾';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`group w-full cursor-pointer rounded-2xl border-[1.5px] px-3 py-3 text-left shadow-sm transition-[background-color,box-shadow,transform,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4 ${toneClasses}`}
      style={{ outlineColor: labelColor }}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: labelColor }}
        >
          {label}
        </p>
        <span
          className="text-xs font-semibold tabular-nums transition-transform duration-150 group-hover:scale-110"
          style={{ color: labelColor }}
          aria-hidden
        >
          {chevron}
        </span>
      </div>
      <p
        className="mt-1 text-base font-bold tabular-nums sm:text-lg"
        style={{ color: theme.title }}
      >
        {count}
      </p>
      <p className="mt-0.5 text-[11px]" style={{ color: theme.muted }}>
        {count > 0
          ? `Monto ${moneyMx(amount)} · clic para ${open ? 'ocultar' : 'ver'} detalle`
          : tone === 'rose'
            ? 'Sin cancelaciones'
            : 'Sin descuentos'}
      </p>
    </button>
  );
}

function CancDescDetailList({
  items,
  emptyLabel,
  tone,
}: {
  items: CorteCancDescLine[];
  emptyLabel: string;
  tone: 'rose' | 'amber';
}) {
  const border =
    tone === 'rose' ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60';
  const badge =
    tone === 'rose'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-amber-100 text-amber-800';

  if (items.length === 0) {
    return (
      <div
        className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${border}`}
        style={{ color: theme.muted }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`mt-3 overflow-hidden rounded-2xl border ${border}`}>
      <ul className="divide-y divide-slate-200/80">
        {items.map((item) => {
          const meta = lineMeta(item);
          return (
            <li
              key={item.id}
              className="flex flex-col gap-1 bg-white/80 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge}`}
                  >
                    {item.kind === 'cancelacion' ? 'Cancelación' : 'Descuento'}
                  </span>
                  {item.hora ? (
                    <span className="text-[11px] tabular-nums" style={{ color: theme.muted }}>
                      {item.hora}
                    </span>
                  ) : null}
                  {item.mesa ? (
                    <span className="text-[11px]" style={{ color: theme.muted }}>
                      Mesa {item.mesa}
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-1 text-sm font-semibold leading-snug"
                  style={{ color: theme.title }}
                >
                  {lineTitle(item)}
                </p>
                {meta.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-[12px]" style={{ color: theme.muted }}>
                    {meta.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <p
                className="shrink-0 text-sm font-bold tabular-nums sm:pt-0.5"
                style={{ color: theme.title }}
              >
                {moneyMx(item.amount)}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Reportes de cortes diarios en Ventas: cierre staff_rpt completo
 * + cancelaciones/descuentos Infocaja del día.
 */
export function VentasCortesReportCard({
  className = 'mb-8',
}: {
  className?: string;
}) {
  const [dateInput, setDateInput] = useState('');
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [data, setData] = useState<CortePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<CancDescPanel>(null);

  useEffect(() => {
    setOpenPanel(null);
  }, [activeDate]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const qs =
          activeDate != null
            ? `?date=${encodeURIComponent(activeDate)}`
            : '';
        const res = await fetch(`/api/ventas/corte${qs}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as CortePayload;
        if (cancelled) return;
        if (!res.ok && !json.corte && !json.date) {
          setError(json.error || 'No se pudo cargar el corte');
          setData(json);
          return;
        }
        setData(json);
        if (json.date) setDateInput(json.date);
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
  }, [activeDate]);

  const corte = data?.corte ?? null;
  const canc = data?.cancDesc;
  const tombola = data?.tombola ?? null;
  const displayDate = data?.date ?? activeDate ?? data?.yesterdayDate ?? null;

  const title =
    data?.mode === 'yesterday'
      ? 'Corte de ayer'
      : data?.mode === 'latest'
        ? 'Corte más reciente'
        : data?.mode === 'date'
          ? 'Corte del día'
          : 'Reportes de cortes';

  const dateLabel = displayDate ? formatCorteDateDisplay(displayDate) : null;

  const eventosHint =
    corte &&
    (corte.eventos_os_amount > 0 || corte.eventos_extra_amount > 0)
      ? `OS ${moneyMx(corte.eventos_os_amount)} · Extra ${moneyMx(corte.eventos_extra_amount)}`
      : undefined;

  const ventaDia =
    corte != null
      ? Math.round((corte.wi_amount + corte.eventos_amount) * 100) / 100
      : null;

  const bancosHint =
    corte &&
    (corte.bancos_cobrado_tpv != null || corte.bancos_propina_tpv != null)
      ? `Cobrado ${moneyOrDash(corte.bancos_cobrado_tpv)} · Propina TPV ${moneyOrDash(corte.bancos_propina_tpv)}`
      : undefined;

  const tombolaAmount =
    tombola?.amount ??
    (corte != null ? corte.efectivo_tombola : null);

  const tombolaHint =
    corte?.efectivo_tombola != null
      ? 'Depósito capturado en el corte'
      : tombola?.efectivo != null
        ? `Infocaja ${moneyMx(tombola.efectivo)} − propinas ${moneyMx(tombola.propinas_tpv)}`
        : corte?.efectivo_infocaja != null
          ? `Infocaja efectivo ${moneyMx(corte.efectivo_infocaja)}`
          : undefined;

  const recibidoVsInfocaja = (() => {
    if (!corte) return null;
    const r = corte.efectivo_contado;
    const i = corte.efectivo_infocaja;
    if (r == null || i == null) {
      if (r != null && i == null) {
        return {
          kind: 'pending' as const,
          message: 'Infocaja pendiente de conciliar',
        };
      }
      return null;
    }
    const delta = Math.round((Number(r) - Number(i)) * 100) / 100;
    if (Math.abs(delta) <= 1) {
      return { kind: 'match' as const, message: 'Coincide con Infocaja' };
    }
    return {
      kind: 'mismatch' as const,
      message: `vs Infocaja ${moneyMx(i)} · Δ ${moneyMx(delta)}`,
    };
  })();

  function applyDate() {
    if (!dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    setActiveDate(dateInput);
  }

  function goYesterday() {
    const y = data?.yesterdayDate;
    if (!y) return;
    setDateInput(y);
    setActiveDate(y);
  }

  function goLatestDefault() {
    setDateInput('');
    setActiveDate(null);
  }

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
              Cortes
            </span>
            <span
              className="text-sm font-medium"
              style={{ color: theme.muted }}
            >
              · {title}
            </span>
            {corte ? (
              <span
                className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold text-white"
                style={{ backgroundColor: SUITE.navy }}
              >
                Cerrado
              </span>
            ) : data && !loading ? (
              <span
                className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold"
                style={{
                  backgroundColor: '#FEE2E2',
                  color: '#B91C1C',
                }}
              >
                Sin cierre
              </span>
            ) : null}
            {data?.mode === 'latest' && activeDate == null ? (
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
      >
        <label className={`${filterControlClass} bg-white shadow-sm`}>
          <span className="shrink-0 text-slate-500">Día</span>
          <input
            type="date"
            className="h-full min-w-[9.5rem] cursor-pointer bg-transparent font-semibold text-slate-800 outline-none"
            value={dateInput}
            max={data?.todayDate || data?.yesterdayDate || undefined}
            onChange={(e) => setDateInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyDate();
            }}
            aria-label="Fecha del corte"
          />
        </label>
        <button
          type="button"
          onClick={applyDate}
          disabled={!dateInput}
          className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Ver
        </button>
        <button
          type="button"
          onClick={goYesterday}
          className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Ayer
        </button>
        <button
          type="button"
          onClick={goLatestDefault}
          className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Último
        </button>
      </SectionHeader>

      {dateLabel ? (
        <p className="mb-4 text-sm capitalize" style={{ color: theme.muted }}>
          {dateLabel}
          {data?.mode === 'latest' && activeDate == null
            ? ' · sin cierre registrado para ayer'
            : null}
        </p>
      ) : (
        <p className="mb-4 text-sm" style={{ color: theme.muted }}>
          Cierre diario de piso: WI, eventos, TPV, tómbola, cancelaciones y
          descuentos.
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando reporte de corte…
        </p>
      ) : error && !corte && !displayDate ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <>
          {!corte ? (
            <p className="mb-4 text-sm" style={{ color: theme.muted }}>
              {activeDate
                ? 'No hay cierre RPT guardado para este día.'
                : 'Aún no hay cortes cerrados en el sistema.'}
              {tombolaAmount != null
                ? ' Tómbola estimada desde Infocaja − propinas de tarjeta.'
                : ' Abajo: cancelaciones y descuentos Infocaja si existen.'}
            </p>
          ) : null}

          {corte ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Kpi label="WI" value={moneyMx(corte.wi_amount)} />
                <Kpi
                  label="Eventos"
                  value={moneyMx(corte.eventos_amount)}
                  hint={eventosHint}
                />
                <Kpi
                  label="Venta día"
                  value={moneyMx(ventaDia)}
                  hint="WI + Eventos"
                  highlight
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Kpi
                  label="Bancos neto TPV"
                  value={moneyOrDash(corte.bancos_neto_tpv)}
                  hint={bancosHint}
                />
                <Kpi
                  label="Propinas"
                  value={moneyMx(corte.propinas)}
                  hint={
                    corte.bancos_propina_tpv != null
                      ? `TPV ${moneyMx(corte.bancos_propina_tpv)}`
                      : undefined
                  }
                />
                <Kpi
                  label="Efectivo recibido"
                  value={moneyOrDash(corte.efectivo_contado)}
                  hint={
                    recibidoVsInfocaja
                      ? recibidoVsInfocaja.message
                      : corte.efectivo_infocaja != null
                        ? `Infocaja ${moneyMx(corte.efectivo_infocaja)}`
                        : 'Captura manual del corte'
                  }
                  tone={
                    recibidoVsInfocaja?.kind === 'mismatch'
                      ? 'rose'
                      : recibidoVsInfocaja?.kind === 'match'
                        ? 'default'
                        : 'default'
                  }
                />
                <Kpi
                  label="Tómbola"
                  value={moneyMx(tombolaAmount)}
                  hint={
                    tombolaAmount != null && tombolaAmount < 0
                      ? `${tombolaHint ?? 'Depósito'} · no alcanzó el efectivo`
                      : tombolaHint
                  }
                  tone={
                    tombolaAmount != null && tombolaAmount < 0
                      ? 'rose'
                      : 'default'
                  }
                />
                <Kpi
                  label="TPV"
                  value={
                    corte.tpv_complete
                      ? 'Completo'
                      : `${corte.tpv_accounted}/3`
                  }
                  hint={
                    corte.tpv_complete
                      ? 'Terminales listas'
                      : 'Terminales contabilizadas'
                  }
                />
              </div>
            </>
          ) : tombolaAmount != null ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Kpi
                label="Tómbola / efectivo"
                value={moneyMx(tombolaAmount)}
                hint={
                  tombolaAmount < 0
                    ? `${tombolaHint ?? 'Infocaja − propinas'} · no alcanzó el efectivo`
                    : tombolaHint
                }
                highlight={tombolaAmount >= 0}
                tone={tombolaAmount < 0 ? 'rose' : 'default'}
              />
              <Kpi
                label="Efectivo Infocaja"
                value={
                  tombola?.efectivo != null
                    ? moneyMx(tombola.efectivo)
                    : '—'
                }
              />
              <Kpi
                label="Propinas tarjeta"
                value={
                  tombola != null ? moneyMx(tombola.propinas_tpv) : '—'
                }
              />
            </div>
          ) : null}

          {canc ? (
            <div className="mt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CancDescToggle
                  label="Cancelaciones"
                  count={canc.cancelacionesCount}
                  amount={canc.cancelacionesAmount}
                  open={openPanel === 'cancelaciones'}
                  tone="rose"
                  onToggle={() =>
                    setOpenPanel((cur) =>
                      cur === 'cancelaciones' ? null : 'cancelaciones'
                    )
                  }
                />
                <CancDescToggle
                  label="Descuentos"
                  count={canc.descuentosCount}
                  amount={canc.descuentosAmount}
                  open={openPanel === 'descuentos'}
                  tone="amber"
                  onToggle={() =>
                    setOpenPanel((cur) =>
                      cur === 'descuentos' ? null : 'descuentos'
                    )
                  }
                />
              </div>
              {openPanel === 'cancelaciones' ? (
                <CancDescDetailList
                  items={canc.cancelaciones ?? []}
                  emptyLabel="Sin cancelaciones para este día."
                  tone="rose"
                />
              ) : null}
              {openPanel === 'descuentos' ? (
                <CancDescDetailList
                  items={canc.descuentos ?? []}
                  emptyLabel="Sin descuentos para este día."
                  tone="amber"
                />
              ) : null}
            </div>
          ) : null}

          {corte?.notes ? (
            <p
              className="mt-3 text-xs leading-relaxed"
              style={{ color: theme.muted }}
            >
              Nota: {corte.notes}
            </p>
          ) : null}

          {corte ? (
            <p className="mt-2 text-[11px]" style={{ color: theme.muted }}>
              Cerrado por {corte.created_by || '—'}
              {corte.updated_by ? ` · actualizó ${corte.updated_by}` : ''}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
