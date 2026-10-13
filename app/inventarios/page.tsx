'use client';

import { useEffect, useState } from 'react';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { SectionHeader, yearChipClass } from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import type { CostoLado, CostoProducto, CostosDashboard } from '@/app/lib/costos-venta';
import type { CostosPagosDashboard, SemanaPago } from '@/app/lib/costos-pagos';

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

function pts(delta: number) {
  const rounded = Math.round(delta * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} pts`;
}

function vsMetaColor(costoPct: number | null, meta: number) {
  if (costoPct == null) return theme.title;
  if (costoPct - meta > 0.05) return SUITE.orangeDeep;
  return theme.title;
}

function MonthChips({
  meses,
  active,
  onSelect,
}: {
  meses: string[];
  active: string | null;
  onSelect: (mes: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {meses.map((mes) => {
        const on = mes === active;
        return (
          <button
            key={mes}
            type="button"
            className={yearChipClass(on)}
            style={{
              backgroundColor: on ? SUITE.navy : undefined,
              color: on ? '#fff' : undefined,
              border: on ? `2px solid ${SUITE.navy}` : '2px solid #e2e8f0',
            }}
            onClick={() => onSelect(mes)}
          >
            {mes}
          </button>
        );
      })}
    </div>
  );
}

function PagosLinea({
  nombre,
  venta,
  pago,
  costoPct,
  meta,
  emphasize,
}: {
  nombre: string;
  venta: number | null;
  pago: number;
  costoPct: number | null;
  meta: number | null;
  emphasize?: boolean;
}) {
  const delta = costoPct != null && meta != null ? costoPct - meta : null;
  return (
    <tr className="border-t border-slate-100">
      <td className={`py-2 pr-3 ${emphasize ? 'font-bold' : 'font-semibold'}`} style={{ color: theme.title }}>
        {nombre}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{venta == null ? '—' : money(venta)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{money(pago)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{pct(costoPct)}</td>
      <td
        className="py-2 text-right font-semibold tabular-nums"
        style={{ color: delta == null ? theme.muted : vsMetaColor(costoPct, meta || 0) }}
      >
        {delta == null ? '—' : pts(delta)}
      </td>
    </tr>
  );
}

function PagosSemanas({ semanas }: { semanas: SemanaPago[] }) {
  if (!semanas.length) {
    return (
      <p className="mt-3 text-sm" style={{ color: theme.muted }}>
        Sin semanas con venta o pago en este mes.
      </p>
    );
  }
  const showEventos = semanas.some((row) => Math.abs(row.eventos) > 0.004);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
            <th className="pb-2 pr-3 font-bold">Semana</th>
            <th className="pb-2 pr-3 text-right font-bold">Venta alim.</th>
            <th className="pb-2 pr-3 text-right font-bold">Pago cocina</th>
            <th className="pb-2 pr-3 text-right font-bold">%</th>
            <th className="pb-2 pr-3 text-right font-bold">Venta beb.</th>
            <th className="pb-2 pr-3 text-right font-bold">Pago barra</th>
            <th className="pb-2 pr-3 text-right font-bold">%</th>
            {showEventos ? <th className="pb-2 pr-3 text-right font-bold">Eventos</th> : null}
            <th className="pb-2 pr-3 text-right font-bold">Pago directo</th>
            <th className="pb-2 pr-3 text-right font-bold">%</th>
            <th className="pb-2 pr-3 text-right font-bold">Pago total</th>
            <th className="pb-2 text-right font-bold">% global</th>
          </tr>
        </thead>
        <tbody>
          {semanas.map((row) => (
            <tr key={row.semana} className="border-t border-slate-100">
              <td className="py-2 pr-3 font-semibold" style={{ color: theme.title }}>
                {row.semana}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(row.ventaAlimentos)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(row.compraCocina)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{pct(row.costoCocina)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(row.ventaBebidas)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(row.compraBarra)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{pct(row.costoBarra)}</td>
              {showEventos ? (
                <td className="py-2 pr-3 text-right tabular-nums">{money(row.eventos)}</td>
              ) : null}
              <td className="py-2 pr-3 text-right tabular-nums">{money(row.compraDirecta)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{pct(row.costoDirecto)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(row.compraTotal)}</td>
              <td className="py-2 text-right tabular-nums">{pct(row.costoGlobal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [selectedPagos, setSelectedPagos] = useState<string | null>(null);
  const [pagos, setPagos] = useState<CostosPagosDashboard | null>(null);
  const [loadingPagos, setLoadingPagos] = useState(true);
  const [errorPagos, setErrorPagos] = useState<string | null>(null);

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

  useEffect(() => {
    let cancel = false;
    async function loadPagos() {
      setLoadingPagos(true);
      setErrorPagos(null);
      const q = selectedPagos ? `?mes=${encodeURIComponent(selectedPagos)}` : '';
      try {
        const res = await fetch(`/api/inventarios/costos-pagos${q}`, { cache: 'no-store' });
        const json = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setErrorPagos(json.error || 'No se pudo cargar el costo vs pagos');
          return;
        }
        setPagos(json as CostosPagosDashboard);
      } catch (e) {
        if (cancel) return;
        setPagos(null);
        setErrorPagos(e instanceof Error ? e.message : 'Error de red al cargar datos');
      } finally {
        if (!cancel) setLoadingPagos(false);
      }
    }
    loadPagos();
    return () => {
      cancel = true;
    };
  }, [selectedPagos]);

  const mesActivo = selected || data?.mes || null;
  const mesPagos = selectedPagos || pagos?.mes || null;

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
        <MonthChips meses={data?.meses || []} active={mesActivo} onSelect={setSelected} />
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

      <div className="mb-4 mt-10">
        <SectionHeader title="Costo vs pagos ejercidos" className="mb-3" />
        <MonthChips meses={pagos?.meses || []} active={mesPagos} onSelect={setSelectedPagos} />
      </div>

      {loadingPagos && !pagos ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando costo vs pagos…
        </p>
      ) : errorPagos && !pagos ? (
        <SuiteCard accent className="max-w-3xl">
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            No se pudo cargar el apartado
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
            {errorPagos}
          </p>
        </SuiteCard>
      ) : pagos ? (
        <SuiteCard>
          {loadingPagos ? (
            <p className="mb-3 text-sm" style={{ color: theme.muted }}>
              Actualizando mes…
            </p>
          ) : null}
          {errorPagos ? (
            <p className="mb-3 text-sm" style={{ color: theme.muted }}>
              {errorPagos}
            </p>
          ) : null}
          <h2 className="text-lg font-bold" style={{ color: theme.title }}>
            {pagos.mes}
          </h2>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            El pago ejercido es la compra registrada. El % de costo es ese pago contra la venta. Meta de la hoja: {pct(pagos.metaPct)}.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Venta" value={money(pagos.global.venta)} />
            <Kpi label="Pago directo" value={money(pagos.directo.pago)} />
            <Kpi label="% directo" value={pct(pagos.directo.costoPct)} />
            <Kpi label="% global" value={pct(pagos.global.costoPct)} />
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
                  <th className="pb-2 pr-3 font-bold">Línea</th>
                  <th className="pb-2 pr-3 text-right font-bold">Venta</th>
                  <th className="pb-2 pr-3 text-right font-bold">Pago ejercido</th>
                  <th className="pb-2 pr-3 text-right font-bold">% de costo</th>
                  <th className="pb-2 text-right font-bold">vs meta</th>
                </tr>
              </thead>
              <tbody>
                <PagosLinea nombre="Cocina" venta={pagos.cocina.venta} pago={pagos.cocina.pago} costoPct={pagos.cocina.costoPct} meta={pagos.metaPct} />
                <PagosLinea nombre="Barra" venta={pagos.barra.venta} pago={pagos.barra.pago} costoPct={pagos.barra.costoPct} meta={pagos.metaPct} />
                <PagosLinea nombre="Directo" venta={pagos.directo.venta} pago={pagos.directo.pago} costoPct={pagos.directo.costoPct} meta={pagos.metaPct} />
                <PagosLinea nombre="Indirecto" venta={null} pago={pagos.indirecto.pago} costoPct={pagos.indirecto.costoPct} meta={null} />
                <PagosLinea nombre="Global" venta={pagos.global.venta} pago={pagos.global.pago} costoPct={pagos.global.costoPct} meta={pagos.metaPct} emphasize />
              </tbody>
            </table>
          </div>
          <h3 className="mt-8 text-sm font-bold" style={{ color: theme.title }}>
            Por semana
          </h3>
          <PagosSemanas semanas={pagos.semanas} />
        </SuiteCard>
      ) : null}
    </SuiteShell>
  );
}
