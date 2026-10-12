'use client';

import { useEffect, useState } from 'react';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { SectionHeader, yearChipClass } from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import type { CostoLado, CostoProducto, CostosDashboard } from '@/app/lib/costos-venta';

const theme = getTheme('suite');

function money(v: number) {
  const rounded = Math.round(v);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}`;
}

function units(v: number) {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

function pct(v: number | null) {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

function Kpi({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
      <p
        className="text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: theme.muted }}
      >
        {label}
      </p>
      <p className="mt-1 text-lg font-bold leading-none" style={{ color: theme.title }}>
        {value}
      </p>
    </div>
  );
}

function ProductTable({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint?: string;
  rows: CostoProducto[];
  empty: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold" style={{ color: theme.title }}>
        {title}
      </h3>
      {hint ? (
        <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
          {hint}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: theme.muted }}>
          {empty}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr
                className="text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: theme.muted }}
              >
                <th className="pb-2 pr-3 font-bold">Producto</th>
                <th className="pb-2 pr-3 text-right font-bold">Uds</th>
                <th className="pb-2 pr-3 text-right font-bold">Venta</th>
                <th className="pb-2 pr-3 text-right font-bold">% costo</th>
                <th className="pb-2 text-right font-bold">Utilidad</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.producto}-${i}`} className="border-t border-slate-100">
                  <td className="py-2 pr-3">
                    <span className="font-semibold" style={{ color: theme.title }}>
                      {i + 1}. {row.producto}
                    </span>
                    {row.grupo ? (
                      <span className="mt-0.5 block text-xs" style={{ color: theme.muted }}>
                        {row.grupo}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{units(row.unidades)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(row.venta)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{pct(row.costoPct)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(row.utilidad)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LadoCard({ title, lado }: { title: string; lado: CostoLado }) {
  return (
    <SuiteCard className="h-full">
      <h2 className="text-lg font-bold" style={{ color: theme.title }}>
        {title}
      </h2>
      {lado.aviso ? (
        <p className="mt-2 text-sm" style={{ color: theme.muted }}>
          {lado.aviso}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Kpi label="Venta" value={money(lado.kpis.venta)} />
        <Kpi label="Costo" value={money(lado.kpis.costo)} />
        <Kpi label="% de costo" value={pct(lado.kpis.costoPct)} />
        <Kpi label="Utilidad" value={money(lado.kpis.utilidad)} />
      </div>
      <div className="mt-6 space-y-6">
        <ProductTable
          title="Top 5 por unidades"
          rows={lado.topUnidades}
          empty="Sin productos con venta en este mes."
        />
        <ProductTable
          title="Top 5 por rentabilidad"
          hint="Utilidad del mes en pesos"
          rows={lado.topRentabilidad}
          empty="Sin productos con venta en este mes."
        />
        <ProductTable
          title="Productos estratégicos"
          hint="% de costo de 25 o menos y al menos 10 unidades, por utilidad"
          rows={lado.estrategicos}
          empty="Ningún producto con % de costo de 25 o menos y al menos 10 unidades."
        />
      </div>
    </SuiteCard>
  );
}

export default function InventariosPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<CostosDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      setError(null);
      const q = selected ? `?mes=${encodeURIComponent(selected)}` : '';
      try {
        const res = await fetch(`/api/inventarios/costos${q}`, { cache: 'no-store' });
        const json = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setError(json.error || 'No se pudo cargar el costo por venta');
          return;
        }
        setData(json as CostosDashboard);
      } catch (e) {
        if (cancel) return;
        setData(null);
        setError(e instanceof Error ? e.message : 'Error de red al cargar datos');
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [selected]);

  const mesActivo = selected || data?.mes || null;

  return (
    <SuiteShell
      title="Costos e Inventarios"
      subtitle={
        data?.mes
          ? `Costo por venta · ${data.mes}`
          : 'Costo por venta · alimentos y bebidas'
      }
    >
      <div className="mb-4">
        <SectionHeader title="Costo por venta" className="mb-3" />
        <div className="flex flex-wrap gap-2">
          {(data?.meses || []).map((mes) => {
            const active = mes === mesActivo;
            return (
              <button
                key={mes}
                type="button"
                className={yearChipClass(active)}
                style={{
                  backgroundColor: active ? SUITE.navy : undefined,
                  color: active ? '#fff' : undefined,
                  border: active ? `2px solid ${SUITE.navy}` : '2px solid #e2e8f0',
                }}
                onClick={() => setSelected(mes)}
              >
                {mes}
              </button>
            );
          })}
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando costo por venta…
        </p>
      ) : error && !data ? (
        <SuiteCard accent className="max-w-3xl">
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            No se pudo cargar el tablero
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
            {error}
          </p>
        </SuiteCard>
      ) : data ? (
        <div>
          {loading ? (
            <p className="mb-3 text-sm" style={{ color: theme.muted }}>
              Actualizando mes…
            </p>
          ) : null}
          {error ? (
            <p className="mb-3 text-sm" style={{ color: theme.muted }}>
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <LadoCard title="Alimentos" lado={data.alimentos} />
            <LadoCard title="Bebidas" lado={data.bebidas} />
          </div>
        </div>
      ) : null}
    </SuiteShell>
  );
}
