'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CristaleriaConciliacionSummary } from '@/app/lib/cristaleria-conciliacion';
import { SUITE } from '@/app/lib/themes';

function money(n: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(n);
}

function pct(n: number | null) {
  if (n == null) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  bajo: 'Bajo 2%',
  sobre: 'Sobre 2%',
  falta_abono: 'Sin abono',
  abono_sin_venta: 'Abono sin venta',
};

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  bajo: 'bg-amber-50 text-amber-900 border-amber-200',
  sobre: 'bg-sky-50 text-sky-900 border-sky-200',
  falta_abono: 'bg-red-50 text-red-800 border-red-200',
  abono_sin_venta: 'bg-violet-50 text-violet-900 border-violet-200',
};

export function CristaleriaConciliacionCard({ year }: { year: number }) {
  const [data, setData] = useState<CristaleriaConciliacionSummary | null>(null);
  const [formula, setFormula] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/finanzas/cristaleria-conciliacion?year=${year}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setData(json);
      setFormula(String(json.formula || ''));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Conciliación cristalería…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        No se pudo cargar conciliación cristalería: {error || 'sin datos'}
      </div>
    );
  }

  const problem = data.weeks.filter((w) => w.status !== 'ok');
  const { totals, counts } = data;

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          Ingreso cristalería vs 2% venta
        </h2>
        <p className="mt-1 text-xs text-slate-600">{formula}</p>
      </div>

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Venta total {year}
          </p>
          <p className="text-lg font-semibold tabular-nums">{money(totals.ventaTotal)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Abonos flujo
          </p>
          <p className="text-lg font-semibold tabular-nums">{money(totals.abonoFlujo)}</p>
          <p className="text-[11px] text-slate-500">{pct(totals.pctReal)} real</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Esperado 2%
          </p>
          <p className="text-lg font-semibold tabular-nums">{money(totals.esperado2pct)}</p>
        </div>
        <div
          className="rounded-xl px-3 py-2"
          style={{ backgroundColor: `${SUITE.navy}12` }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Faltante vs 2%
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              totals.deltaVs2pct < -100 ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {money(totals.deltaVs2pct)}
          </p>
          <p className="text-[11px] text-slate-500">
            Excel hoy ≈ {money(totals.excelActual)} (0.2%)
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5 pb-3 text-xs">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
          OK {counts.ok}
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
          Bajo {counts.bajo}
        </span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">
          Sin abono {counts.falta_abono}
        </span>
      </div>

      {problem.length > 0 && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Semana</th>
                <th className="px-4 py-2 text-right">Venta</th>
                <th className="px-4 py-2 text-right">Abono</th>
                <th className="px-4 py-2 text-right">2% esp.</th>
                <th className="px-4 py-2 text-right">Δ</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {problem.map((w) => (
                <tr key={`${w.year}-${w.week}`} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{w.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(w.ventaTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(w.abonoFlujo)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(w.esperado2pct)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(w.delta)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[w.status] || ''}`}
                    >
                      {STATUS_LABEL[w.status] || w.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
