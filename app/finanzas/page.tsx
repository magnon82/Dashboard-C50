'use client';

import { useEffect, useMemo, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import { SaldosAlDia } from '@/app/components/SaldosAlDia';
import { ResumenBancosSemanal } from '@/app/components/ResumenBancosSemanal';
import { PresupuestoRubros } from '@/app/components/PresupuestoRubros';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { buildSaldosAlDia } from '@/app/lib/saldos';
import {
  availablePresupuestoMonths,
  buildPresupuestoRubros,
  buildResumenBancosSemanal,
} from '@/app/lib/presupuesto';
import { MESES } from '@/app/lib/ventas-semana';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

export default function FinanzasPage() {
  const now = new Date();
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(
          '/api/financial-records?sources=presupuesto_mensual,presupuesto_saldos,presupuesto_rubro,presupuesto_semana,flujo_efectivo_saldo,cxp_por_pagar',
          { cache: 'no-store' }
        );
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setError(json.error || `Error ${res.status}`);
            setRecords([]);
          }
          return;
        }
        if (!cancelled) setRecords(json.records || []);
      } catch {
        if (!cancelled) {
          setError('No se pudo conectar con la API de registros');
          setRecords([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const monthsAvailable = useMemo(
    () => availablePresupuestoMonths(records),
    [records]
  );

  const yearsAvailable = useMemo(() => {
    const ys = new Set(monthsAvailable.map((m) => m.year));
    if (ys.size === 0) ys.add(year);
    return Array.from(ys).sort((a, b) => b - a);
  }, [monthsAvailable, year]);

  const monthsForYear = useMemo(() => {
    const ms = monthsAvailable.filter((m) => m.year === year).map((m) => m.month);
    return ms.length ? ms.sort((a, b) => a - b) : [month];
  }, [monthsAvailable, year, month]);

  useEffect(() => {
    if (!monthsAvailable.length) return;
    const has = monthsAvailable.some((m) => m.year === year && m.month === month);
    if (!has) {
      const latest = monthsAvailable[0];
      setYear(latest.year);
      setMonth(latest.month);
    }
  }, [monthsAvailable, year, month]);

  const saldos = useMemo(() => buildSaldosAlDia(records), [records]);
  const weeks = useMemo(
    () => buildResumenBancosSemanal(records, year, month),
    [records, year, month]
  );
  const { rows: rubros, meta } = useMemo(
    () => buildPresupuestoRubros(records, year, month),
    [records, year, month]
  );

  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <SuiteShell title="Finanzas" subtitle={`Actualizado al ${hoy}`}>
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">No se cargaron los datos</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <SaldosAlDia data={saldos} loading={loading} />

      <ResumenBancosSemanal
        weeks={weeks}
        loading={loading}
        filters={
          <>
            <label className={filterControlClass}>
              <span className="text-slate-500">Año</span>
              <select
                className={filterSelectClass}
                value={year}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setYear(y);
                  const first = monthsAvailable.find((m) => m.year === y);
                  if (first) setMonth(first.month);
                }}
              >
                {yearsAvailable.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Mes</span>
              <select
                className={filterSelectClass}
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {monthsForYear.map((m) => (
                  <option key={m} value={m}>
                    {MESES[m - 1]}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />
      <PresupuestoRubros rows={rubros} meta={meta} loading={loading} />
    </SuiteShell>
  );
}
