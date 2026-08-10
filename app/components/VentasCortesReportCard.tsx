'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import {
  SectionHeader,
  filterControlClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  EFECTIVO_TOLERANCE_MXN,
  expectedTombolaDeposit,
  type EfectivoInfocajaReconcile,
  type StaffRptEditHistoryEntry,
  type StaffRptInfocajaDay,
  type StaffRptValuesSnapshot,
} from '@/app/lib/staff-rpt';
import { computeNetoBanco, moneyMx } from '@/app/lib/tpv-cortes';

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
    edit_history?: StaffRptEditHistoryEntry[];
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
  /** Reporte Infocaja ingerido desde Gmail (mismo del cierre de terminales). */
  infocaja?: StaffRptInfocajaDay | null;
  /** Conciliación efectivo recibido (corte) vs Infocaja Efectivo. */
  cashCheck?: EfectivoInfocajaReconcile | null;
  /** Fechas con corte cerrado (ascendente). */
  availableDates?: string[];
  /** Último corte realizado (máximo navegable). */
  latestCorteDate?: string | null;
  /** Master: puede editar montos del corte cerrado. */
  canEditAdmin?: boolean;
  error?: string;
  hint?: string;
};

type CancDescPanel = 'cancelaciones' | 'descuentos' | null;

type EditFormState = {
  wi_amount: string;
  eventos_os_amount: string;
  eventos_extra_amount: string;
  efectivo_contado: string;
  efectivo_tombola: string;
  bancos_cobrado_tpv: string;
  bancos_propina_tpv: string;
  notes: string;
};

function moneyField(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '';
  return String(v);
}

function formFromCorte(corte: NonNullable<CortePayload['corte']>): EditFormState {
  const tip = corte.bancos_propina_tpv ?? corte.propinas;
  const proposed = expectedTombolaDeposit(corte.efectivo_contado, tip);
  return {
    wi_amount: moneyField(corte.wi_amount),
    eventos_os_amount: moneyField(corte.eventos_os_amount),
    eventos_extra_amount: moneyField(corte.eventos_extra_amount),
    efectivo_contado: moneyField(corte.efectivo_contado),
    efectivo_tombola: moneyField(proposed ?? corte.efectivo_tombola),
    bancos_cobrado_tpv: moneyField(corte.bancos_cobrado_tpv),
    bancos_propina_tpv: moneyField(tip),
    notes: corte.notes ?? '',
  };
}

function patchEditTombola(
  form: EditFormState,
  key: 'efectivo_contado' | 'bancos_propina_tpv',
  value: string
): EditFormState {
  const next = { ...form, [key]: value };
  const rec = Number(String(next.efectivo_contado).replace(/,/g, ''));
  const tip = Number(String(next.bancos_propina_tpv).replace(/,/g, ''));
  const proposed = expectedTombolaDeposit(
    Number.isFinite(rec) ? rec : null,
    Number.isFinite(tip) ? tip : 0
  );
  if (proposed != null) next.efectivo_tombola = moneyField(proposed);
  return next;
}

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

function lineDelta(
  corteVal: number | null | undefined,
  infoVal: number | null | undefined
): { ok: boolean; delta: number } | null {
  if (
    corteVal == null ||
    infoVal == null ||
    !Number.isFinite(Number(corteVal)) ||
    !Number.isFinite(Number(infoVal))
  ) {
    return null;
  }
  const delta =
    Math.round((Number(corteVal) - Number(infoVal)) * 100) / 100;
  return {
    ok: Math.abs(delta) <= EFECTIVO_TOLERANCE_MXN,
    delta,
  };
}

/** Banner de conciliación corte ↔ reporte Infocaja (Gmail). */
function InfocajaReconcilePanel({
  cashCheck,
  infocaja,
  corte,
}: {
  cashCheck: EfectivoInfocajaReconcile | null | undefined;
  infocaja: StaffRptInfocajaDay | null | undefined;
  corte: NonNullable<CortePayload['corte']>;
}) {
  const hasRecibido = cashCheck?.hasRecibido ?? corte.efectivo_contado != null;
  const hasInfocaja =
    cashCheck?.hasInfocaja ??
    Boolean(infocaja?.hasEfectivo || corte.efectivo_infocaja != null);

  // Solo comparar líneas Infocaja que vienen con monto (>0) para evitar falsas alertas.
  const propinasCmp =
    infocaja && infocaja.propina > 0
      ? lineDelta(corte.bancos_propina_tpv ?? corte.propinas, infocaja.propina)
      : null;
  // Infocaja Bancarias = venta con tarjeta sin propina.
  // En este repo `bancos_neto_tpv` = cobrado + propina (total al banco);
  // para conciliar hay que usar cobrado − propina (o cobrado si ya viniera neto).
  const bancariasDesdeTpv = (() => {
    const cob = corte.bancos_cobrado_tpv;
    const tip = corte.bancos_propina_tpv ?? corte.propinas;
    if (cob != null && Number.isFinite(cob)) {
      const tipN =
        tip != null && Number.isFinite(tip) ? Math.max(0, Number(tip)) : 0;
      return Math.round((Number(cob) - tipN) * 100) / 100;
    }
    return null;
  })();
  const bancosCmp =
    infocaja && infocaja.bancarias > 0
      ? lineDelta(bancariasDesdeTpv, infocaja.bancarias)
      : null;

  const secondaryMismatch =
    propinasCmp?.ok === false || bancosCmp?.ok === false;
  const mismatch = Boolean(cashCheck?.mismatch) || secondaryMismatch;
  const match =
    Boolean(cashCheck?.match) &&
    (propinasCmp == null || propinasCmp.ok) &&
    (bancosCmp == null || bancosCmp.ok);

  let tone: 'match' | 'mismatch' | 'pending' = 'pending';
  if (mismatch) tone = 'mismatch';
  else if (match) tone = 'match';
  else if (!hasInfocaja && hasRecibido) tone = 'pending';

  const styles =
    tone === 'match'
      ? {
          border: '1px solid #6EE7B7',
          bg: '#ECFDF5',
          title: '#065F46',
          body: '#047857',
        }
      : tone === 'mismatch'
        ? {
            border: '1px solid #FCA5A5',
            bg: '#FEF2F2',
            title: '#991B1B',
            body: '#B91C1C',
          }
        : {
            border: '1px solid #FDE68A',
            bg: '#FFFBEB',
            title: '#92400E',
            body: '#B45309',
          };

  const title =
    tone === 'match'
      ? 'Conciliación Infocaja · coincide'
      : tone === 'mismatch'
        ? 'Alerta · diferencias vs Infocaja'
        : 'Conciliación Infocaja · pendiente';

  const headline =
    tone === 'match'
      ? cashCheck?.message ||
        'Efectivo recibido del corte coincide con el reporte Infocaja del correo.'
      : tone === 'mismatch'
        ? cashCheck?.mismatch
          ? cashCheck.message ||
            'Efectivo del corte no coincide con Infocaja Efectivo.'
          : 'Hay diferencias en propinas o bancos vs el reporte Infocaja del correo.'
        : hasRecibido
          ? 'El reporte Infocaja del correo aún no está para este día; la conciliación se hará al sincronizar Gmail.'
          : 'Sin efectivo recibido en el corte ni reporte Infocaja para conciliar.';

  return (
    <div
      className="mt-3 rounded-2xl px-4 py-3"
      style={{ border: styles.border, backgroundColor: styles.bg }}
      role={tone === 'mismatch' ? 'alert' : 'status'}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: styles.title }}
      >
        {title}
      </p>
      <p className="mt-1 text-sm font-medium" style={{ color: styles.body }}>
        {headline}
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3 sm:block">
          <dt style={{ color: styles.body }}>Efectivo recibido (corte)</dt>
          <dd className="font-semibold tabular-nums" style={{ color: styles.title }}>
            {moneyOrDash(cashCheck?.recibido ?? corte.efectivo_contado)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt style={{ color: styles.body }}>Infocaja Efectivo (correo)</dt>
          <dd className="font-semibold tabular-nums" style={{ color: styles.title }}>
            {moneyOrDash(
              cashCheck?.infocaja ??
                infocaja?.efectivo ??
                corte.efectivo_infocaja
            )}
          </dd>
        </div>
        {cashCheck?.delta != null && !cashCheck.match ? (
          <div className="flex justify-between gap-3 sm:col-span-2 sm:block">
            <dt style={{ color: styles.body }}>Diferencia efectivo</dt>
            <dd className="font-semibold tabular-nums" style={{ color: styles.title }}>
              {moneyMx(cashCheck.delta)}
            </dd>
          </div>
        ) : null}
        {infocaja?.hasAny ? (
          <>
            <div className="flex justify-between gap-3 sm:block">
              <dt style={{ color: styles.body }}>
                Propinas TPV vs Infocaja Propina
              </dt>
              <dd
                className="font-semibold tabular-nums"
                style={{ color: styles.title }}
              >
                {moneyOrDash(corte.bancos_propina_tpv ?? corte.propinas)}
                {' · '}
                {moneyMx(infocaja.propina)}
                {propinasCmp
                  ? propinasCmp.ok
                    ? ' · ok'
                    : ` · Δ ${moneyMx(propinasCmp.delta)}`
                  : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-3 sm:block">
              <dt style={{ color: styles.body }}>
                Bancarias (cobrado − propina) vs Infocaja
              </dt>
              <dd
                className="font-semibold tabular-nums"
                style={{ color: styles.title }}
              >
                {moneyOrDash(bancariasDesdeTpv)}
                {' · '}
                {moneyMx(infocaja.bancarias)}
                {bancosCmp
                  ? bancosCmp.ok
                    ? ' · ok'
                    : ` · Δ ${moneyMx(bancosCmp.delta)}`
                  : ''}
              </dd>
              {corte.bancos_cobrado_tpv != null ? (
                <p className="mt-0.5 text-[11px]" style={{ color: styles.body }}>
                  Cobrado TPV {moneyMx(corte.bancos_cobrado_tpv)}
                  {corte.bancos_propina_tpv != null
                    ? ` − propina ${moneyMx(corte.bancos_propina_tpv)}`
                    : ''}
                  ; Infocaja Bancarias sin propina.
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </dl>
      <p className="mt-2 text-[11px]" style={{ color: styles.body }}>
        Fuente: reporte Infocaja por correo (misma sync post-cierre de
        terminales). Bancarias = cobrado TPV − propina; Propina aparte.
        Tolerancia ±{moneyMx(EFECTIVO_TOLERANCE_MXN)}.
      </p>
    </div>
  );
}

function moneyOrDash(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return moneyMx(Number(v));
}

function EditMoneyField({
  label,
  value,
  onChange,
  previous,
  hint,
  allowNegative,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  previous?: string;
  hint?: string;
  allowNegative?: boolean;
}) {
  return (
    <label className="block rounded-2xl border border-slate-200 bg-white px-3 py-3">
      <span
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: theme.muted }}
      >
        {label}
      </span>
      {previous ? (
        <span className="mt-0.5 block text-[11px]" style={{ color: theme.muted }}>
          Anterior: {previous}
        </span>
      ) : null}
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={allowNegative ? undefined : 0}
        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-base font-semibold tabular-nums text-slate-900 outline-none focus:border-slate-400"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: theme.muted }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
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
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editBaseline, setEditBaseline] =
    useState<StaffRptValuesSnapshot | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  useEffect(() => {
    setOpenPanel(null);
    setEditing(false);
    setEditForm(null);
    setEditBaseline(null);
    setEditMsg(null);
    setEditErr(null);
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
  const canEditAdmin = Boolean(data?.canEditAdmin && corte);
  const canc = data?.cancDesc;
  const tombola = data?.tombola ?? null;
  const cashCheck = data?.cashCheck ?? null;
  const infocaja = data?.infocaja ?? null;
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

  const propinaTpvForTombola =
    corte != null
      ? Number(corte.bancos_propina_tpv ?? corte.propinas) || 0
      : tombola?.propinas_tpv ?? 0;
  const tombolaFromRecibido =
    corte != null
      ? expectedTombolaDeposit(corte.efectivo_contado, propinaTpvForTombola)
      : null;
  const tombolaAmount =
    tombolaFromRecibido ??
    tombola?.amount ??
    (corte != null ? corte.efectivo_tombola : null);

  const tombolaHint =
    tombolaFromRecibido != null
      ? `Efectivo recibido − Propina TPV (${moneyMx(propinaTpvForTombola)})`
      : tombola?.efectivo != null
        ? `${tombola.source === 'infocaja' ? 'Infocaja' : 'Efectivo'} ${moneyMx(tombola.efectivo)} − propinas ${moneyMx(tombola.propinas_tpv)}`
        : corte?.efectivo_infocaja != null
          ? `Infocaja efectivo ${moneyMx(corte.efectivo_infocaja)}`
          : undefined;

  const recibidoVsInfocaja = (() => {
    if (!corte) return null;
    if (cashCheck?.mismatch) {
      return {
        kind: 'mismatch' as const,
        message: `vs Infocaja ${moneyOrDash(cashCheck.infocaja)} · Δ ${moneyMx(cashCheck.delta ?? 0)}`,
      };
    }
    if (cashCheck?.match) {
      return { kind: 'match' as const, message: 'Coincide con Infocaja' };
    }
    if (cashCheck?.hasRecibido && !cashCheck.hasInfocaja) {
      return {
        kind: 'pending' as const,
        message: 'Infocaja pendiente de conciliar',
      };
    }
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
    if (Math.abs(delta) <= EFECTIVO_TOLERANCE_MXN) {
      return { kind: 'match' as const, message: 'Coincide con Infocaja' };
    }
    return {
      kind: 'mismatch' as const,
      message: `vs Infocaja ${moneyMx(i)} · Δ ${moneyMx(delta)}`,
    };
  })();

  const availableDates = data?.availableDates ?? [];
  const latestCorteDate =
    data?.latestCorteDate ??
    (availableDates.length ? availableDates[availableDates.length - 1] : null);

  function navIndexFor(date: string | null): number {
    if (!date || !availableDates.length) return -1;
    const exact = availableDates.indexOf(date);
    if (exact >= 0) return exact;
    // Fecha sin corte: anclar al vecino más cercano hacia atrás.
    for (let i = availableDates.length - 1; i >= 0; i--) {
      if (availableDates[i] <= date) return i;
    }
    return 0;
  }

  const currentNavDate = displayDate;
  const currentNavIndex = navIndexFor(currentNavDate);
  const canGoOlder = currentNavIndex > 0;
  const canGoNewer =
    currentNavIndex >= 0 &&
    latestCorteDate != null &&
    currentNavDate != null &&
    currentNavDate < latestCorteDate &&
    currentNavIndex < availableDates.length - 1;

  function applyDate() {
    if (!dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    // No pasar del último corte realizado.
    if (latestCorteDate && dateInput > latestCorteDate) {
      setDateInput(latestCorteDate);
      setActiveDate(latestCorteDate);
      return;
    }
    setActiveDate(dateInput);
  }

  function goOlderCorte() {
    if (!canGoOlder) return;
    const d = availableDates[currentNavIndex - 1];
    setDateInput(d);
    setActiveDate(d);
  }

  function goNewerCorte() {
    if (!canGoNewer) return;
    const d = availableDates[currentNavIndex + 1];
    setDateInput(d);
    setActiveDate(d);
  }

  function goLatestDefault() {
    if (latestCorteDate) {
      setDateInput(latestCorteDate);
      setActiveDate(latestCorteDate);
      return;
    }
    setDateInput('');
    setActiveDate(null);
  }

  function startEdit() {
    if (!corte || !canEditAdmin) return;
    setEditBaseline({
      wi_amount: corte.wi_amount,
      eventos_amount: corte.eventos_amount,
      eventos_os_amount: corte.eventos_os_amount,
      eventos_extra_amount: corte.eventos_extra_amount,
      propinas: corte.propinas,
      efectivo_tombola: corte.efectivo_tombola,
      efectivo_contado: corte.efectivo_contado,
      bancos_neto_tpv: corte.bancos_neto_tpv,
      bancos_cobrado_tpv: corte.bancos_cobrado_tpv,
      bancos_propina_tpv: corte.bancos_propina_tpv,
      notes: corte.notes,
    });
    setEditForm(formFromCorte(corte));
    setEditMsg(null);
    setEditErr(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditForm(null);
    setEditBaseline(null);
    setEditErr(null);
  }

  const editLive = useMemo(() => {
    if (!editForm) return null;
    const wi = Number(editForm.wi_amount);
    const os = Number(editForm.eventos_os_amount);
    const extra = Number(editForm.eventos_extra_amount);
    const cob = Number(editForm.bancos_cobrado_tpv);
    const tip = Number(editForm.bancos_propina_tpv);
    const rec = Number(editForm.efectivo_contado);
    const venta =
      Number.isFinite(wi) && Number.isFinite(os) && Number.isFinite(extra)
        ? Math.round((wi + os + extra) * 100) / 100
        : null;
    const neto =
      Number.isFinite(cob) && Number.isFinite(tip)
        ? computeNetoBanco(cob, tip)
        : null;
    const tombolaRef =
      Number.isFinite(rec) && Number.isFinite(tip)
        ? expectedTombolaDeposit(rec, tip)
        : null;
    return { venta, neto, tombolaRef };
  }, [editForm]);

  async function saveEdit() {
    if (!corte || !editForm || !displayDate) return;
    setSavingEdit(true);
    setEditErr(null);
    setEditMsg(null);
    try {
      const res = await fetch('/api/ventas/corte', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: displayDate,
          wi_amount: editForm.wi_amount,
          eventos_os_amount: editForm.eventos_os_amount,
          eventos_extra_amount: editForm.eventos_extra_amount,
          efectivo_contado: editForm.efectivo_contado,
          efectivo_tombola: editForm.efectivo_tombola,
          bancos_cobrado_tpv: editForm.bancos_cobrado_tpv,
          bancos_propina_tpv: editForm.bancos_propina_tpv,
          notes: editForm.notes.trim() || null,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        hint?: string;
        ok?: boolean;
        corte?: CortePayload['corte'];
        cashCheck?: EfectivoInfocajaReconcile | null;
        infocaja?: StaffRptInfocajaDay | null;
      };
      if (!res.ok) {
        setEditErr(json.error || 'No se pudo guardar');
        return;
      }
      setData((prev) =>
        prev && json.corte
          ? {
              ...prev,
              hasCorte: true,
              corte: json.corte,
              cashCheck: json.cashCheck ?? prev.cashCheck,
              infocaja: json.infocaja ?? prev.infocaja,
            }
          : prev
      );
      setEditing(false);
      setEditForm(null);
      setEditBaseline(null);
      setEditMsg(
        json.hint
          ? `Corte actualizado. ${json.hint}`
          : 'Corte actualizado. Los valores anteriores quedaron en el historial.'
      );
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setSavingEdit(false);
    }
  }

  const lastHistory =
    corte?.edit_history && corte.edit_history.length > 0
      ? corte.edit_history[corte.edit_history.length - 1]
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
        <div className="inline-flex h-9 items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={goOlderCorte}
            disabled={!canGoOlder || loading}
            className="inline-flex w-9 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Corte anterior"
            title="Corte anterior"
          >
            <span aria-hidden className="text-lg leading-none">
              ←
            </span>
          </button>
          <label
            className={`${filterControlClass} border-x border-slate-200 bg-white shadow-none`}
          >
            <span className="shrink-0 text-slate-500">Día</span>
            <input
              type="date"
              className="h-full min-w-[9.5rem] cursor-pointer bg-transparent font-semibold text-slate-800 outline-none"
              value={dateInput}
              max={latestCorteDate || data?.todayDate || undefined}
              onChange={(e) => setDateInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyDate();
              }}
              aria-label="Fecha del corte"
            />
          </label>
          <button
            type="button"
            onClick={goNewerCorte}
            disabled={!canGoNewer || loading}
            className="inline-flex w-9 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Corte siguiente"
            title={
              latestCorteDate
                ? `Siguiente (máx. ${latestCorteDate})`
                : 'Corte siguiente'
            }
          >
            <span aria-hidden className="text-lg leading-none">
              →
            </span>
          </button>
        </div>
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
          onClick={goLatestDefault}
          disabled={!latestCorteDate || loading}
          className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          title={
            latestCorteDate
              ? `Último corte: ${latestCorteDate}`
              : 'Sin cortes'
          }
        >
          Último
        </button>
        {canEditAdmin && !editing ? (
          <button
            type="button"
            onClick={startEdit}
            disabled={loading}
            className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: SUITE.navy }}
            title="Editar montos del corte cerrado (Master)"
          >
            Editar
          </button>
        ) : null}
        {editing ? (
          <>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={savingEdit}
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={savingEdit}
              className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: SUITE.orange }}
            >
              {savingEdit ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        ) : null}
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
              {editMsg ? (
                <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {editMsg}
                </p>
              ) : null}
              {editErr ? (
                <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {editErr}
                </p>
              ) : null}
              {lastHistory && !editing ? (
                <p className="mb-3 text-xs" style={{ color: theme.muted }}>
                  Última edición Master: {lastHistory.edited_by} ·{' '}
                  {new Date(lastHistory.edited_at).toLocaleString('es-MX', {
                    timeZone: 'America/Mexico_City',
                  })}
                </p>
              ) : null}

              {editing && editForm && editBaseline ? (
                <div className="mb-4 space-y-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-sm font-semibold" style={{ color: theme.title }}>
                    Edición Master · se conservan los valores anteriores en historial
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <EditMoneyField
                      label="WI"
                      value={editForm.wi_amount}
                      previous={moneyMx(editBaseline.wi_amount)}
                      onChange={(v) =>
                        setEditForm((f) => (f ? { ...f, wi_amount: v } : f))
                      }
                    />
                    <EditMoneyField
                      label="Eventos · OS"
                      value={editForm.eventos_os_amount}
                      previous={moneyMx(editBaseline.eventos_os_amount)}
                      onChange={(v) =>
                        setEditForm((f) =>
                          f ? { ...f, eventos_os_amount: v } : f
                        )
                      }
                    />
                    <EditMoneyField
                      label="Eventos · Extra"
                      value={editForm.eventos_extra_amount}
                      previous={moneyMx(editBaseline.eventos_extra_amount)}
                      onChange={(v) =>
                        setEditForm((f) =>
                          f ? { ...f, eventos_extra_amount: v } : f
                        )
                      }
                    />
                    <Kpi
                      label="Venta día"
                      value={
                        editLive?.venta != null
                          ? moneyMx(editLive.venta)
                          : '—'
                      }
                      hint="WI + OS + Extra (calculado)"
                      highlight
                    />
                    <EditMoneyField
                      label="Bancos cobrado TPV"
                      value={editForm.bancos_cobrado_tpv}
                      previous={moneyOrDash(editBaseline.bancos_cobrado_tpv)}
                      onChange={(v) =>
                        setEditForm((f) =>
                          f ? { ...f, bancos_cobrado_tpv: v } : f
                        )
                      }
                    />
                    <EditMoneyField
                      label="Propina TPV"
                      value={editForm.bancos_propina_tpv}
                      previous={moneyOrDash(
                        editBaseline.bancos_propina_tpv ??
                          editBaseline.propinas
                      )}
                      onChange={(v) =>
                        setEditForm((f) =>
                          f ? patchEditTombola(f, 'bancos_propina_tpv', v) : f
                        )
                      }
                    />
                    <Kpi
                      label="Bancos neto TPV"
                      value={
                        editLive?.neto != null ? moneyMx(editLive.neto) : '—'
                      }
                      hint="Cobrado + propina (calculado)"
                    />
                    <EditMoneyField
                      label="Efectivo recibido"
                      value={editForm.efectivo_contado}
                      previous={moneyOrDash(editBaseline.efectivo_contado)}
                      hint={(() => {
                        const infoEfe =
                          infocaja?.hasEfectivo && infocaja.efectivo > 0
                            ? infocaja.efectivo
                            : corte.efectivo_infocaja != null &&
                                Number.isFinite(Number(corte.efectivo_infocaja))
                              ? Number(corte.efectivo_infocaja)
                              : null;
                        return infoEfe != null
                          ? `Referencia Infocaja (correo Fin de Día): ${moneyMx(infoEfe)}`
                          : 'Sin efectivo Infocaja del correo para este día';
                      })()}
                      onChange={(v) =>
                        setEditForm((f) =>
                          f ? patchEditTombola(f, 'efectivo_contado', v) : f
                        )
                      }
                    />
                    <EditMoneyField
                      label="Efectivo en tómbola"
                      value={editForm.efectivo_tombola}
                      previous={moneyMx(editBaseline.efectivo_tombola)}
                      hint={
                        editLive?.tombolaRef != null
                          ? `Propuesto: recibido − propina TPV = ${moneyMx(editLive.tombolaRef)}`
                          : undefined
                      }
                      allowNegative
                      onChange={(v) =>
                        setEditForm((f) =>
                          f ? { ...f, efectivo_tombola: v } : f
                        )
                      }
                    />
                  </div>
                  <label className="block rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <span
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: theme.muted }}
                    >
                      Nota
                    </span>
                    {editBaseline.notes ? (
                      <span
                        className="mt-0.5 block text-[11px]"
                        style={{ color: theme.muted }}
                      >
                        Anterior: {editBaseline.notes}
                      </span>
                    ) : null}
                    <textarea
                      rows={2}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      value={editForm.notes}
                      onChange={(e) =>
                        setEditForm((f) =>
                          f ? { ...f, notes: e.target.value } : f
                        )
                      }
                      maxLength={2000}
                    />
                  </label>
                </div>
              ) : (
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
                      : recibidoVsInfocaja?.kind === 'pending'
                        ? 'amber'
                        : 'default'
                  }
                />
                <Kpi
                  label="Efectivo en tómbola"
                  value={moneyMx(tombolaAmount)}
                  hint={
                    tombolaAmount != null && tombolaAmount < 0
                      ? `${tombolaHint ?? 'Efectivo − propina'} · no alcanzó el efectivo`
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
              )}

              {!editing ? (
              <InfocajaReconcilePanel
                cashCheck={cashCheck}
                infocaja={infocaja}
                corte={corte}
              />
              ) : null}
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
