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
  weekBoundsFromIso,
  type StaffPropinasStored,
  type TipHeadcount,
  type TipPeriodMode,
  type TipRoleId,
} from '@/app/lib/staff-propinas';
import { defaultCorteDateCdmx, moneyMx } from '@/app/lib/tpv-cortes';
import { SUITE } from '@/app/lib/themes';

function pctLabel(frac: number): string {
  const n = frac * 100;
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;
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
  const [hydrated, setHydrated] = useState(false);
  const manualRef = useRef<{
    date: string;
    ventasWi: string;
    ventasEventos: string;
  } | null>(null);

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
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [calendarToday]);

  useEffect(() => {
    if (!hydrated) return;
    const isManual =
      mode === 'hoy' && (ventasWi !== '' || ventasEventos !== '');
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

  const modes: { id: TipPeriodMode; label: string }[] = [
    { id: 'hoy', label: 'Hoy' },
    { id: 'semana', label: 'Semana' },
    { id: 'rango', label: 'Rango' },
  ];

  const inputClass =
    'min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-lg';

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
            <label className="flex h-full flex-col gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Desde</span>
              <input
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="mt-auto min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3"
              />
            </label>
            <label className="flex h-full flex-col gap-1.5">
              <span className="text-sm font-semibold text-slate-700">Hasta</span>
              <input
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                className="mt-auto min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3"
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
        <h2 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Ventas del periodo
        </h2>
        <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
          Captura a mano las ventas WI y Eventos para calcular la repartición.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex h-full flex-col gap-1.5">
            <div>
              <span className="text-sm font-semibold text-slate-700">
                Ventas WI / C50 ($)
              </span>
              <p className="mt-0.5 text-xs leading-snug text-slate-500">
                Base propinas walk-in {pctLabel(TIP_TOTAL_WI)}
              </p>
            </div>
            <input
              inputMode="decimal"
              value={ventasWi}
              onChange={(e) => setVentasWi(e.target.value)}
              placeholder="0.00"
              className={`${inputClass} mt-auto`}
            />
          </label>
          <label className="flex h-full flex-col gap-1.5">
            <div>
              <span className="text-sm font-semibold text-slate-700">
                Ventas Eventos ($)
              </span>
              <p className="mt-0.5 text-xs leading-snug text-slate-500">
                Servicio eventos {pctLabel(TIP_TOTAL_EVENTOS)}
              </p>
            </div>
            <input
              inputMode="decimal"
              value={ventasEventos}
              onChange={(e) => setVentasEventos(e.target.value)}
              placeholder="0.00"
              className={`${inputClass} mt-auto`}
            />
          </label>
        </div>
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
            <label key={role.id} className="flex h-full flex-col gap-1.5">
              <div>
                <span className="text-sm font-semibold text-slate-700">
                  {role.label}
                </span>
                {role.note ? (
                  <p className="mt-0.5 text-xs leading-snug text-slate-500">
                    {role.note}
                  </p>
                ) : null}
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={headcount[role.id]}
                onChange={(e) => setCount(role.id, e.target.value)}
                className="mt-auto min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-lg"
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
