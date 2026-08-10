'use client';

import { useCallback, useEffect, useState } from 'react';
import { SUITE } from '@/app/lib/themes';
import { moneyMx, todayCdmxIso } from '@/app/lib/tpv-cortes';
import type { EventosGlobalPayload } from '@/app/lib/eventos-global';

export function EventosGlobal() {
  const defaultYear = Number(todayCdmxIso().slice(0, 4));
  const [year, setYear] = useState(defaultYear);
  const [data, setData] = useState<EventosGlobalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/eventos/global?year=${year}`, {
        cache: 'no-store',
      });
      const json = (await res.json()) as EventosGlobalPayload & {
        error?: string;
      };
      if (!res.ok) {
        setError(String(json.error || 'No se pudo cargar Global'));
        setData(null);
        return;
      }
      setData(json);
      // Soft notes (fallback Sheets→ingest) no se muestran en UI.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = data?.rows || [];
  const sumVenta = rows.reduce((a, r) => a + r.venta, 0);
  const sumExtra = rows.reduce((a, r) => a + r.ventaExtra, 0);
  const sumTotal = rows.reduce((a, r) => a + r.total, 0);

  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
            Global
          </h2>
          <label className="text-sm font-medium text-slate-700">
            Año{' '}
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5"
            >
              {[defaultYear, defaultYear - 1, defaultYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-xl px-3 py-1.5 text-sm font-bold text-white"
            style={{ backgroundColor: SUITE.navy }}
          >
            Actualizar
          </button>
          {rows.length > 0 ? (
            <span className="text-xs text-slate-500">{rows.length} filas</span>
          ) : null}
        </div>
      </header>

      {error && !data?.rows?.length ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {error}
        </p>
      ) : null}

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-xs text-slate-500">VENTA (OS)</p>
          <p className="font-bold" style={{ color: SUITE.navy }}>
            {moneyMx(sumVenta)}
          </p>
        </div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-xs text-slate-500">VENTA EXTRA</p>
          <p className="font-bold" style={{ color: SUITE.navy }}>
            {moneyMx(sumExtra)}
          </p>
        </div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-xs text-slate-500">Total</p>
          <p className="font-bold" style={{ color: SUITE.navy }}>
            {moneyMx(sumTotal)}
          </p>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Cargando Global…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            Sin filas con monto en Global para {year}.
          </p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Evento</th>
                <th className="px-3 py-2 text-right">VENTA (OS)</th>
                <th className="px-3 py-2 text-right">VENTA EXTRA</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.fecha || r.rawFecha}-${r.evento}-${r.total}`}
                  className="border-b border-slate-100"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {r.fecha || r.rawFecha || '—'}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {r.evento}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyMx(r.venta)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {moneyMx(r.ventaExtra)}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-semibold tabular-nums"
                    style={{ color: SUITE.navy }}
                  >
                    {moneyMx(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
