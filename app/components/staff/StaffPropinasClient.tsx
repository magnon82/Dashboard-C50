'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { parseMoneyInput } from '@/app/lib/staff-rpt';
import {
  DEFAULT_HEADCOUNT,
  STAFF_PROPINAS_LS_KEY,
  TIP_ROLES,
  TIP_TOTAL_EVENTOS,
  TIP_TOTAL_WI,
  calcTipPools,
  formatIsoDateEs,
  normalizeTipHeadcount,
  tipSalesSourceNote,
  weekBoundsFromIso,
  type StaffPropinasStored,
  type TipHeadcount,
  type TipPeriodMode,
  type TipRoleId,
  type TipSalesRangeResult,
} from '@/app/lib/staff-propinas';
import { defaultCorteDateCdmx, moneyMx } from '@/app/lib/tpv-cortes';
import { SUITE } from '@/app/lib/themes';

function pctLabel(frac: number): string {
  const n = frac * 100;
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;
}

function moneyField(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return String(Math.round(n * 100) / 100);
}

export function StaffPropinasClient() {
  const calendarToday = defaultCorteDateCdmx();
  const [mode, setMode] = useState<TipPeriodMode>('hoy');
  const [hoyDate, setHoyDate] = useState(calendarToday);
  const [rangeFrom, setRangeFrom] = useState(calendarToday);
  const [rangeTo, setRangeTo] = useState(calendarToday);
  const [ventasWi, setVentasWi] = useState('');
  const [ventasEventos, setVentasEventos] = useState('');
  const [headcount, setHeadcount] = useState<TipHeadcount>({
    ...DEFAULT_HEADCOUNT,
  });
  const [salesMsg, setSalesMsg] = useState<string | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [salesMeta, setSalesMeta] = useState<TipSalesRangeResult | null>(null);
  const [appliedFromSystem, setAppliedFromSystem] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const manualRef = useRef<{
    date: string;
    ventasWi: string;
    ventasEventos: string;
  } | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    try {
      const keys = [
        STAFF_PROPINAS_LS_KEY,
        'staff_propinas_calc_v2',
        'staff_propinas_calc_v1',
      ];
      let parsed: StaffPropinasStored | null = null;
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        parsed = JSON.parse(raw) as StaffPropinasStored;
        break;
      }
      if (parsed?.headcount) {
        setHeadcount(
          normalizeTipHeadcount(
            parsed.headcount as Partial<Record<string, unknown>>
          )
        );
      }
      if (
        parsed?.manualHoy &&
        parsed.manualHoy.date === calendarToday &&
        typeof parsed.manualHoy.ventasWi === 'string' &&
        typeof parsed.manualHoy.ventasEventos === 'string'
      ) {
        manualRef.current = parsed.manualHoy;
        setHoyDate(parsed.manualHoy.date);
        setVentasWi(parsed.manualHoy.ventasWi);
        setVentasEventos(parsed.manualHoy.ventasEventos);
        setAppliedFromSystem(false);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [calendarToday]);

  useEffect(() => {
    if (!hydrated) return;
    const isManual =
      mode === 'hoy' && !appliedFromSystem && (ventasWi !== '' || ventasEventos !== '');
    const payload: StaffPropinasStored = {
      headcount,
      manualHoy: isManual
        ? {
            date: hoyDate,
            ventasWi,
            ventasEventos,
          }
        : manualRef.current?.date === calendarToday
          ? manualRef.current
          : null,
    };
    if (isManual) {
      manualRef.current = payload.manualHoy ?? null;
    }
    try {
      localStorage.setItem(STAFF_PROPINAS_LS_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [
    hydrated,
    headcount,
    ventasWi,
    ventasEventos,
    appliedFromSystem,
    mode,
    hoyDate,
    calendarToday,
  ]);

  const period = useMemo(() => {
    if (mode === 'hoy') {
      return { from: hoyDate, to: hoyDate, label: formatIsoDateEs(hoyDate) };
    }
    if (mode === 'semana') {
      const w = weekBoundsFromIso(calendarToday);
      return {
        from: w.from,
        to: w.to,
        label: `${formatIsoDateEs(w.from)} → ${formatIsoDateEs(w.to)}`,
      };
    }
    const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
    const to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    return {
      from,
      to,
      label: `${formatIsoDateEs(from)} → ${formatIsoDateEs(to)}`,
    };
  }, [mode, hoyDate, calendarToday, rangeFrom, rangeTo]);

  function availabilityNote(data: TipSalesRangeResult): string {
    const note = tipSalesSourceNote(data.primarySource, data.sourceCounts);
    if (data.daysWithData === 0) {
      return `${note}. Captura WI y Eventos a mano, o vuelve cuando haya corte / Infocaja.`;
    }
    if (data.dayCount > 1) {
      return `${note} · ${data.daysWithData}/${data.dayCount} días con dato · WI ${moneyMx(data.ventasWi)} · Eventos ${moneyMx(data.ventasEventos)}.`;
    }
    return `${note} · WI ${moneyMx(data.ventasWi)} · Eventos ${moneyMx(data.ventasEventos)}.`;
  }

  async function fetchAvailableSales(): Promise<TipSalesRangeResult | null> {
    const seq = ++loadSeq.current;
    setSalesLoading(true);
    setSalesMsg(null);
    try {
      const res = await fetch(
        `/api/staff-propinas?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`
      );
      const data = (await res.json()) as TipSalesRangeResult & {
        error?: string;
      };
      if (seq !== loadSeq.current) return null;
      if (!res.ok) {
        setSalesMsg(data.error || 'No se pudieron consultar las ventas');
        setSalesMeta(null);
        return null;
      }
      setSalesMeta(data);
      let msg = availabilityNote(data);
      if (data.rptError) msg = `${msg} (${data.rptError})`;
      setSalesMsg(msg);
      return data;
    } catch {
      if (seq !== loadSeq.current) return null;
      setSalesMsg('Error de red al consultar ventas');
      setSalesMeta(null);
      return null;
    } finally {
      if (seq === loadSeq.current) setSalesLoading(false);
    }
  }

  function applySalesToFields(data: TipSalesRangeResult) {
    setVentasWi(moneyField(data.ventasWi));
    setVentasEventos(moneyField(data.ventasEventos));
    setAppliedFromSystem(true);
    if (mode === 'hoy') {
      manualRef.current = null;
    }
    const note = tipSalesSourceNote(data.primarySource, data.sourceCounts);
    setSalesMsg(
      data.daysWithData === 0
        ? `${note}. Sin dato en sistema — campos en 0; puedes editar a mano.`
        : `${note}. Aplicado a la calculadora · editable si necesitas ajustar.`
    );
  }

  /** Opt-in: trae ventas del Corte / Infocaja y las usa para calcular propinas. */
  async function calcularConVentasDisponibles() {
    setApplying(true);
    try {
      const data = await fetchAvailableSales();
      if (!data) return;
      applySalesToFields(data);
    } finally {
      setApplying(false);
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    setSalesMeta(null);
    setAppliedFromSystem(false);
    // Solo consulta disponibilidad; no rellena ventas (opt-in).
    void fetchAvailableSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional period sync
  }, [hydrated, period.from, period.to, mode]);

  const wiNum = parseMoneyInput(ventasWi) ?? 0;
  const evNum = parseMoneyInput(ventasEventos) ?? 0;
  const result = useMemo(
    () => calcTipPools(wiNum, evNum, headcount),
    [wiNum, evNum, headcount]
  );

  function setCount(id: TipRoleId, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setHeadcount((prev) => ({ ...prev, [id]: n }));
  }

  function onEditWi(raw: string) {
    setVentasWi(raw);
    setAppliedFromSystem(false);
  }

  function onEditEventos(raw: string) {
    setVentasEventos(raw);
    setAppliedFromSystem(false);
  }

  const modes: { id: TipPeriodMode; label: string }[] = [
    { id: 'hoy', label: 'Hoy' },
    { id: 'semana', label: 'Semana' },
    { id: 'rango', label: 'Rango' },
  ];

  const applyLabel =
    mode === 'hoy'
      ? 'Calcular con ventas del día'
      : 'Calcular con ventas del periodo';

  const hasAvailable =
    salesMeta != null &&
    (salesMeta.daysWithData > 0 ||
      salesMeta.ventasWi > 0 ||
      salesMeta.ventasEventos > 0);

  const inputClass =
    'mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-lg';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href="/staff"
          className="font-semibold underline-offset-2 hover:underline"
          style={{ color: SUITE.navy }}
        >
          ← Staff
        </Link>
        <span style={{ color: SUITE.muted }}>·</span>
        <Link
          href="/staff/corte"
          className="underline-offset-2 hover:underline"
          style={{ color: SUITE.muted }}
        >
          Corte del día
        </Link>
      </div>

      {/* Periodo */}
      <SuiteCard>
        <h2 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Periodo
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {modes.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className="min-h-11 rounded-xl px-4 text-sm font-bold transition-colors"
                style={{
                  backgroundColor: active ? SUITE.navy : SUITE.pageBg,
                  color: active ? '#fff' : SUITE.navy,
                  border: `1px solid ${active ? SUITE.navy : SUITE.border}`,
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm" style={{ color: SUITE.muted }}>
          {period.label}
        </p>
        {mode === 'hoy' ? (
          <label className="mt-3 block max-w-xs">
            <span className="text-sm font-semibold text-slate-700">Fecha</span>
            <input
              type="date"
              value={hoyDate}
              onChange={(e) => setHoyDate(e.target.value || calendarToday)}
              className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3"
            />
          </label>
        ) : null}
        {mode === 'rango' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Desde</span>
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Hasta</span>
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3"
              />
            </label>
          </div>
        ) : null}
        {mode === 'semana' ? (
          <p className="mt-2 text-xs" style={{ color: SUITE.muted }}>
            Semana calendario lun–dom (CDMX) que contiene hoy.
          </p>
        ) : null}
      </SuiteCard>

      {/* Ventas */}
      <SuiteCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold" style={{ color: SUITE.navy }}>
              Ventas del periodo
            </h2>
            <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
              Captura a mano o, si quieres, usa las ventas del Corte / Infocaja.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={salesLoading || applying}
              onClick={() => void calcularConVentasDisponibles()}
              className="min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold disabled:opacity-50"
              style={{
                backgroundColor: SUITE.navy,
                color: '#fff',
                border: `1px solid ${SUITE.navy}`,
              }}
            >
              {applying || salesLoading ? 'Cargando…' : applyLabel}
            </button>
            <button
              type="button"
              disabled={salesLoading || applying}
              onClick={() => void fetchAvailableSales()}
              className="min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold disabled:opacity-50"
              style={{
                backgroundColor: SUITE.orangeSoft,
                color: SUITE.navy,
                border: `1px solid ${SUITE.border}`,
              }}
            >
              Consultar disponibles
            </button>
          </div>
        </div>
        {salesMsg ? (
          <p className="mt-3 text-sm" style={{ color: SUITE.navySoft }}>
            {salesMsg}
          </p>
        ) : null}
        {hasAvailable && !appliedFromSystem ? (
          <p className="mt-2 text-xs font-semibold" style={{ color: SUITE.orangeDeep }}>
            Hay ventas en sistema — pulsa «{applyLabel}» para llenar la
            calculadora (no se aplica sola).
          </p>
        ) : null}
        {appliedFromSystem ? (
          <p className="mt-2 text-xs" style={{ color: SUITE.muted }}>
            Valores del sistema aplicados. Puedes editarlos a mano en cualquier
            momento.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Ventas WI / C50 ($)
            </span>
            <p className="mt-0.5 text-xs text-slate-500">
              Base propinas walk-in {pctLabel(TIP_TOTAL_WI)}
            </p>
            <input
              inputMode="decimal"
              value={ventasWi}
              onChange={(e) => onEditWi(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Ventas Eventos ($)
            </span>
            <p className="mt-0.5 text-xs text-slate-500">
              Servicio eventos {pctLabel(TIP_TOTAL_EVENTOS)}
            </p>
            <input
              inputMode="decimal"
              value={ventasEventos}
              onChange={(e) => onEditEventos(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </label>
        </div>
        {salesMeta && salesMeta.dayCount > 1 && salesMeta.daysWithData > 0 ? (
          <details className="mt-4">
            <summary
              className="cursor-pointer text-sm font-semibold"
              style={{ color: SUITE.navy }}
            >
              Desglose por día ({salesMeta.daysWithData} con dato)
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-600">
              {salesMeta.days
                .filter((d) => d.source !== 'ninguno')
                .map((d) => (
                  <li key={d.date} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold tabular-nums">
                      {formatIsoDateEs(d.date)}
                    </span>
                    <span>
                      WI {moneyMx(d.ventasWi)} · Ev. {moneyMx(d.ventasEventos)}
                    </span>
                    <span className="text-slate-400">({d.label})</span>
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </SuiteCard>

      {/* Headcount */}
      <SuiteCard>
        <h2 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Personal que trabajó
        </h2>
        <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
          Gerente y Capitán inician en 1 (editables). Se guarda en este
          dispositivo.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TIP_ROLES.map((role) => (
            <label key={role.id} className="block">
              <span className="text-sm font-semibold text-slate-700">
                {role.label}
              </span>
              {role.note ? (
                <p className="mt-0.5 text-xs text-slate-500">{role.note}</p>
              ) : null}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={headcount[role.id]}
                onChange={(e) => setCount(role.id, e.target.value)}
                className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-lg"
              />
            </label>
          ))}
        </div>
      </SuiteCard>

      {/* Resultados */}
      <SuiteCard accent>
        <h2 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Repartición
        </h2>
        <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
          Pool = venta × % · Por persona = pool ÷ headcount
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Pool WI
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(result.poolWiTotal)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Pool Eventos
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(result.poolEventosTotal)}
            </p>
          </div>
          <div
            className="rounded-xl px-3 py-3"
            style={{ backgroundColor: SUITE.orangeSoft }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Total propinas
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(result.poolGrandTotal)}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
                <th className="rounded-tl-lg px-3 py-2.5 text-left font-semibold">
                  Rol
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">% WI</th>
                <th className="px-3 py-2.5 text-right font-semibold">% Ev.</th>
                <th className="px-3 py-2.5 text-right font-semibold">Pool WI</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Pool Ev.
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Pool</th>
                <th className="px-3 py-2.5 text-center font-semibold">Pers.</th>
                <th className="rounded-tr-lg px-3 py-2.5 text-right font-semibold">
                  Por persona
                </th>
              </tr>
            </thead>
            <tbody>
              {result.roles.map((row, i) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100"
                  style={{
                    backgroundColor: i % 2 === 0 ? '#fff' : '#F8FAFC',
                  }}
                >
                  <td className="px-3 py-2.5 font-semibold text-slate-800">
                    {row.label}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600">
                    {pctLabel(row.rateWi)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600">
                    {pctLabel(row.rateEventos)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {moneyMx(row.poolWi)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {moneyMx(row.poolEventos)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {moneyMx(row.poolTotal)}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">
                    {row.headcount}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-bold tabular-nums"
                    style={{ color: SUITE.navy }}
                  >
                    {row.perPerson == null ? '—' : moneyMx(row.perPerson)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: SUITE.navySoft, color: '#fff' }}>
                <td className="rounded-bl-lg px-3 py-2.5 font-bold" colSpan={3}>
                  Totales
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                  {moneyMx(result.poolWiTotal)}
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                  {moneyMx(result.poolEventosTotal)}
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                  {moneyMx(result.poolGrandTotal)}
                </td>
                <td className="px-3 py-2.5" />
                <td className="rounded-br-lg px-3 py-2.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </SuiteCard>
    </div>
  );
}
