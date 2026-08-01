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
import { getTheme, SUITE } from '@/app/lib/themes';
import { MESES } from '@/app/lib/ventas-semana';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

const FINANZAS_SOURCES = [
  'presupuesto_mensual',
  'presupuesto_saldos',
  'saldos_bancos_manual',
  'presupuesto_rubro',
  'presupuesto_semana',
  'presupuesto_sem_detalle',
  'presupuesto_ajuste',
  'flujo_efectivo_saldo',
  'flujo_efectivo_semana',
  'flujo_efectivo_mov',
  'cxp',
  'cxp_por_pagar',
  'estado_mifel',
  'estado_bbva',
  'estado_pdf_index',
  'estado_cuenta_pdf_index',
].join(',');

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

function openConsultaWindow(path: string, title: string) {
  const w = 1100;
  const h = 780;
  const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  window.open(
    path,
    title,
    `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener,noreferrer`
  );
}

export default function FinanzasPage() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [didSnapMonth, setDidSnapMonth] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(isInitial: boolean) {
      if (isInitial) setError(null);
      try {
        const res = await fetch(
          `/api/financial-records?sources=${FINANZAS_SOURCES}`,
          { cache: 'no-store' }
        );
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled && isInitial) {
            setError(json.error || `Error ${res.status}`);
            setRecords([]);
          }
          return;
        }
        if (!cancelled) setRecords(json.records || []);
      } catch {
        if (!cancelled && isInitial) {
          setError('No se pudo conectar con la API de registros');
          setRecords([]);
        }
      } finally {
        if (!cancelled && isInitial) setLoading(false);
      }
    }

    void load(true);
    const id = window.setInterval(() => void load(false), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const monthsAvailable = useMemo(
    () => availablePresupuestoMonths(records),
    [records]
  );

  const yearsAvailable = useMemo(() => {
    const ys = new Set(monthsAvailable.map((m) => m.year));
    ys.add(CURRENT_YEAR);
    if (ys.size === 0) ys.add(year);
    return Array.from(ys).sort((a, b) => b - a);
  }, [monthsAvailable, year]);

  const monthsWithData = useMemo(() => {
    return new Set(
      monthsAvailable.filter((m) => m.year === year).map((m) => m.month)
    );
  }, [monthsAvailable, year]);

  // Solo al cargar: si el mes actual no tiene datos, ir al más reciente con datos.
  // Después el usuario puede elegir cualquier mes Ene–Dic (incl. sin datos).
  useEffect(() => {
    if (didSnapMonth || !monthsAvailable.length) return;
    const has = monthsAvailable.some((m) => m.year === year && m.month === month);
    if (!has) {
      const latest = monthsAvailable[0];
      setYear(latest.year);
      setMonth(latest.month);
    }
    setDidSnapMonth(true);
  }, [monthsAvailable, year, month, didSnapMonth]);

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
                onChange={(e) => setYear(Number(e.target.value))}
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
                {ALL_MONTHS.map((m) => {
                  const hasData = monthsWithData.has(m);
                  return (
                    <option
                      key={m}
                      value={m}
                      style={hasData ? undefined : { color: '#94a3b8' }}
                    >
                      {MESES[m - 1]}
                      {hasData ? '' : ' · sin datos'}
                    </option>
                  );
                })}
              </select>
            </label>
          </>
        }
      />
      <PresupuestoRubros
        rows={rubros}
        meta={meta}
        loading={loading}
        records={records}
        year={year}
        month={month}
      />

      <section className="mb-8">
        <p
          className="mb-3 text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: theme.muted }}
        >
          Consultas
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
            style={{
              backgroundColor: SUITE.navy,
              boxShadow: SUITE.shadow,
            }}
            onClick={() =>
              openConsultaWindow(
                '/finanzas/comprobantes',
                'finanzas-comprobantes'
              )
            }
          >
            Consultar comprobantes
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
            style={{
              backgroundColor: SUITE.orangeDeep,
              boxShadow: SUITE.shadow,
            }}
            onClick={() =>
              openConsultaWindow(
                '/finanzas/estados-cuenta',
                'finanzas-estados-cuenta'
              )
            }
          >
            Consultar estados de cuenta
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
            style={{
              backgroundColor: '#0F766E',
              boxShadow: SUITE.shadow,
            }}
            onClick={() =>
              openConsultaWindow('/finanzas/gastos', 'finanzas-gastos')
            }
          >
            Gastos
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
            style={{
              backgroundColor: '#1D4ED8',
              boxShadow: SUITE.shadow,
            }}
            onClick={() =>
              openConsultaWindow('/finanzas/ingresos', 'finanzas-ingresos')
            }
          >
            Ingresos
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: theme.muted }}>
          Se abren en una ventana independiente con búsqueda y filtros.
        </p>
      </section>
    </SuiteShell>
  );
}
