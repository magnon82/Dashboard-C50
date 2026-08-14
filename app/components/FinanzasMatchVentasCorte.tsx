'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import { MESES } from '@/app/lib/ventas-semana';
import { moneyMx, todayCdmxIso } from '@/app/lib/tpv-cortes';
import { formatIsoDateEs } from '@/app/lib/staff-propinas';
import {
  MATCH_VENTAS_CORTE_EPOCH,
  clampMatchMonth,
  type MatchVentasCorteDay,
  type MatchVentasCortePayload,
  type MatchVentasCorteStatus,
} from '@/app/lib/finanzas-match-ventas-corte';

const theme = getTheme('suite');

const STATUS_LABEL: Record<MatchVentasCorteStatus, string> = {
  ok: 'OK',
  faltante: 'Faltante',
  recuperacion: 'Recuperación',
  mismatch: 'Mismatch',
  sin_corte: 'Sin corte',
  sin_infocaja: 'Sin Infocaja',
  pendiente: 'Pendiente',
};

const STATUS_STYLE: Record<
  MatchVentasCorteStatus,
  { bg: string; fg: string; border: string }
> = {
  ok: { bg: '#ECFDF5', fg: '#065F46', border: '#6EE7B7' },
  faltante: { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  recuperacion: { bg: '#EFF6FF', fg: '#1E3A8A', border: '#93C5FD' },
  mismatch: { bg: '#FEF2F2', fg: '#991B1B', border: '#FECACA' },
  sin_corte: { bg: '#F8FAFC', fg: '#475569', border: '#CBD5E1' },
  sin_infocaja: { bg: '#F8FAFC', fg: '#475569', border: '#CBD5E1' },
  pendiente: { bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0' },
};

function moneyCell(v: number | null | undefined, mutedNeg = false) {
  if (v == null || !Number.isFinite(Number(v))) {
    return <span className="text-slate-400">—</span>;
  }
  const n = Number(v);
  const cls =
    n < 0
      ? mutedNeg
        ? 'font-semibold text-amber-800'
        : 'font-semibold text-red-700'
      : 'tabular-nums text-slate-800';
  return <span className={cls}>{moneyMx(n)}</span>;
}

function StatusBadge({ status }: { status: MatchVentasCorteStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        backgroundColor: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function defaultMonth(): { year: number; month: number } {
  const today = todayCdmxIso();
  return clampMatchMonth(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7))
  );
}

export function FinanzasMatchVentasCorte() {
  const initial = useMemo(() => defaultMonth(), []);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [data, setData] = useState<MatchVentasCortePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const yearOptions = useMemo(() => {
    const y0 = Number(MATCH_VENTAS_CORTE_EPOCH.slice(0, 4));
    const yNow = Number(todayCdmxIso().slice(0, 4));
    const ys: number[] = [];
    for (let y = yNow; y >= y0; y--) ys.push(y);
    return ys;
  }, []);

  const monthOptions = useMemo(() => {
    const out: number[] = [];
    for (let m = 1; m <= 12; m++) {
      if (year === 2026 && m < 8) continue;
      out.push(m);
    }
    return out;
  }, [year]);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/finanzas/match-ventas-corte?year=${y}&month=${m}`,
        { cache: 'no-store' }
      );
      const json = (await res.json()) as MatchVentasCortePayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`);
        setData(json.days ? json : null);
        return;
      }
      setData(json);
    } catch {
      setError('No se pudo cargar el match');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year, month);
  }, [year, month, load]);

  const days: MatchVentasCorteDay[] = data?.days ?? [];

  return (
    <div
      className="rounded-[24px] border-0 p-5 md:p-6"
      style={{
        backgroundColor: theme.cardBg,
        boxShadow: SUITE.shadow,
        borderTop: `4px solid ${SUITE.navy}`,
      }}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="text-lg font-bold tracking-tight"
            style={{ color: SUITE.navy }}
          >
            Match ventas vs corte
          </h2>
          <p className="mt-1 max-w-2xl text-xs" style={{ color: theme.muted }}>
            {data?.formula ||
              'Tómbola = efectivo - propinas TPV; deficit se recupera en días siguientes. Desde ago 2026.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${filterControlClass} bg-white shadow-sm`}>
            <span className="text-slate-500">Año</span>
            <select
              className={filterSelectClass}
              value={year}
              onChange={(e) => {
                const y = Number(e.target.value);
                setYear(y);
                if (y === 2026 && month < 8) setMonth(8);
              }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className={`${filterControlClass} bg-white shadow-sm`}>
            <span className="text-slate-500">Mes</span>
            <select
              className={filterSelectClass}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {MESES[m - 1]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {data && (
        <div className="mb-4 flex flex-wrap gap-3 text-xs text-slate-600">
          <span>
            Déficit previo:{' '}
            <strong>{moneyMx(data.deficit_before)}</strong>
          </span>
          <span>
            Déficit al cierre:{' '}
            <strong>{moneyMx(data.deficit_remaining)}</strong>
          </span>
          <span>
            OK {data.counts.ok} · Faltante {data.counts.faltante} · Recup.{' '}
            {data.counts.recuperacion} · Mismatch {data.counts.mismatch}
          </span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-[1100px] w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-semibold">Fecha</th>
              <th className="px-3 py-2 font-semibold">Venta Infocaja</th>
              <th className="px-3 py-2 font-semibold">Tarjetas</th>
              <th className="px-3 py-2 font-semibold">Efectivo venta</th>
              <th className="px-3 py-2 font-semibold">Propinas TPV</th>
              <th className="px-3 py-2 font-semibold">Tómbola dep.</th>
              <th className="px-3 py-2 font-semibold">Recuperación</th>
              <th className="px-3 py-2 font-semibold">Deficit</th>
              <th className="px-3 py-2 font-semibold">Match</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && days.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                  Sin dias con Infocaja o corte en este mes.
                </td>
              </tr>
            )}
            {!loading &&
              days.map((d) => (
                <tr
                  key={d.date}
                  className="border-t border-slate-100 hover:bg-slate-50/80"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
                    {formatIsoDateEs(d.date)}
                  </td>
                  <td className="px-3 py-2">
                    <div>{moneyCell(d.venta_reportada)}</div>
                    {(d.info_efectivo != null || d.info_bancarias != null) && (
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        Efe {moneyMx(d.info_efectivo)} · Ban{' '}
                        {moneyMx(d.info_bancarias)}
                        {d.info_propina != null && d.info_propina > 0
                          ? ` · Tip ${moneyMx(d.info_propina)}`
                          : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {moneyCell(d.tarjetas)}
                    {d.delta_bancarias != null &&
                      Math.abs(d.delta_bancarias) > 1 &&
                      !d.servicio_gap && (
                        <div className="text-[10px] text-red-600">
                          Δ {moneyMx(d.delta_bancarias)}
                        </div>
                      )}
                    {d.servicio_gap && (
                      <div className="text-[10px] text-blue-700">
                        reclasif. servicio
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {moneyCell(d.efectivo_venta)}
                    {d.delta_efectivo != null &&
                      Math.abs(d.delta_efectivo) > 1 && (
                        <div className="text-[10px] text-red-600">
                          Δ vs Info {moneyMx(d.delta_efectivo)}
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-2">
                    {moneyCell(d.propinas_tpv)}
                    {d.delta_propina != null &&
                      Math.abs(d.delta_propina) > 1 &&
                      !d.servicio_gap && (
                        <div className="text-[10px] text-red-600">
                          Δ {moneyMx(d.delta_propina)}
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-2">
                    {moneyCell(d.tombola_depositada, true)}
                    {d.tombola_esperada != null &&
                      d.tombola_depositada != null &&
                      Math.abs(d.tombola_esperada - d.tombola_depositada) >
                        1 && (
                        <div className="text-[10px] text-slate-500">
                          esp. {moneyMx(d.tombola_esperada)}
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-2">
                    {d.recovery > 0 ? (
                      <span className="font-semibold text-blue-800">
                        {moneyMx(d.recovery)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {d.deficit_after > 0 ? (
                      <span className="font-semibold text-amber-800">
                        {moneyMx(d.deficit_after)}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={d.status} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
