'use client';

import { useEffect, useMemo, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import { EstadosCuenta } from '@/app/components/EstadosCuenta';
import { buildPresupuestoRubros } from '@/app/lib/presupuesto';
import { SUITE } from '@/app/lib/themes';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

const INGRESOS_SOURCES = [
  'flujo_efectivo_mov',
  'estado_mifel',
  'estado_bbva',
  'presupuesto_ingreso',
].join(',');

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

export default function IngresosConsultaPage() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const year = CURRENT_YEAR;
  const month = CURRENT_MONTH;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const res = await fetch(
          `/api/financial-records?sources=${INGRESOS_SOURCES}`,
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
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const { rows: rubros } = useMemo(
    () => buildPresupuestoRubros(records, year, month),
    [records, year, month]
  );

  return (
    <SuiteShell
      title="Ingresos"
      subtitle="Consulta · efectivo, presupuesto bancario (Mifel/BBVA) y abonos de estado"
      actions={
        <button
          type="button"
          className="hidden h-9 rounded-xl px-3 text-xs font-semibold text-white sm:inline-flex sm:items-center"
          style={{ backgroundColor: SUITE.navy }}
          onClick={() => window.close()}
        >
          Cerrar ventana
        </button>
      }
    >
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">No se cargaron los datos</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <EstadosCuenta
        records={records}
        rubroRows={rubros}
        year={year}
        month={month}
        loading={loading}
        standalone
        defaultOpen
        mode="ingresos"
        canEdit={false}
      />
    </SuiteShell>
  );
}
