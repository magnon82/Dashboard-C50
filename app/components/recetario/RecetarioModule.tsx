'use client';

import { useEffect, useMemo, useState } from 'react';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { getTheme, SUITE } from '@/app/lib/themes';
import type { Ficha, RecetaArea } from '@/app/lib/recetario-types';
import type { MenuRowView, MenuStatus, RecetarioView } from '@/app/lib/recetario';

const theme = getTheme('suite');

const STATUS: Record<MenuStatus, string> = {
  enlazada: 'Con receta',
  parcial: 'Costo parcial',
  sin_costo: 'Sin costo',
  sin_receta: 'Sin receta',
  sin_insumo: 'Sin insumo',
};

function money(value: number | null) {
  if (value == null || Number.isNaN(value)) return '—';
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${digits}`;
}

function pct(value: number | null) {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
}

function qty(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(value < 1 ? 3 : 2);
}

export function RecetarioModule({ area }: { area: RecetaArea }) {
  const title = area === 'cocina' ? 'Cocina' : 'Barra';
  const [data, setData] = useState<RecetarioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<'menu' | 'consumo'>('menu');
  const [category, setCategory] = useState('Todas');
  const [query, setQuery] = useState('');
  const [sku, setSku] = useState<string | null>(null);
  const [mes, setMes] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    const params = new URLSearchParams({ area });
    if (mes) params.set('mes', mes);
    fetch(`/api/recetario?${params}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'No se pudo cargar');
        if (!cancel) {
          setData(json);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [area, mes]);

  const items = data?.items || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'Todas' && item.category !== category) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q);
    });
  }, [items, category, query]);

  const selected = items.find((item) => item.sku === sku) || filtered[0] || null;

  async function saveFicha(ficha: Ficha) {
    if (!selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/recetario/ficha', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area, sku: selected.sku, ficha }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se guardó');
      setSaveMsg('Ficha guardada');
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.sku === selected.sku ? { ...item, ficha } : item
              ),
            }
          : prev
      );
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'No se guardó');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SuiteShell
      title={title}
      subtitle="Menú vigente · receta estándar · ficha técnica"
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .ficha-print, .ficha-print * { visibility: visible; }
          .ficha-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
      <p className="mb-4 text-sm" style={{ color: theme.muted }}>
        {data?.sourceNote ||
          'Copia local del recetario. El costo del insumo se actualiza con el precio de factura.'}
      </p>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        {(['menu', 'consumo'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className="rounded-xl px-3.5 py-2 text-sm font-semibold"
            style={
              section === id
                ? { backgroundColor: SUITE.navy, color: '#fff' }
                : { backgroundColor: '#fff', color: SUITE.navy, boxShadow: SUITE.shadow }
            }
          >
            {id === 'menu' ? 'Menú vigente' : 'Consumo teórico'}
          </button>
        ))}
      </div>
      {loading ? <p className="text-sm">Cargando recetario…</p> : null}
      {error ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          {error}
        </p>
      ) : null}
      {data && section === 'menu' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <SuiteCard>
            <div className="no-print mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: category === 'Todas' ? SUITE.navy : '#f1f5f9',
                  color: category === 'Todas' ? '#fff' : SUITE.navy,
                }}
                onClick={() => setCategory('Todas')}
              >
                Todas
              </button>
              {data.categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: category === cat ? SUITE.navy : '#f1f5f9',
                    color: category === cat ? '#fff' : SUITE.navy,
                  }}
                  onClick={() => setCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <input
              className="no-print mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Buscar en el menú"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead>
                  <tr
                    className="text-[10px] font-bold uppercase tracking-[0.12em]"
                    style={{ color: theme.muted }}
                  >
                    <th className="pb-2 pr-3">Platillo</th>
                    <th className="pb-2 pr-3 text-right">Carta</th>
                    <th className="pb-2 pr-3 text-right">Costo</th>
                    <th className="pb-2 pr-3 text-right">%</th>
                    <th className="pb-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.sku}
                      className="cursor-pointer border-t border-slate-100"
                      onClick={() => setSku(item.sku)}
                      style={{
                        backgroundColor: selected?.sku === item.sku ? '#f8fafc' : undefined,
                      }}
                    >
                      <td className="py-2 pr-3">
                        <span className="font-semibold" style={{ color: theme.title }}>
                          {item.name}
                        </span>
                        <span className="mt-0.5 block text-xs" style={{ color: theme.muted }}>
                          {item.category}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(item.sellPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {money(item.cost)}
                        {item.cost != null && item.status === 'parcial' ? (
                          <span className="mt-0.5 block text-[10px] font-semibold" style={{ color: theme.muted }}>
                            parcial
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(item.costPct)}</td>
                      <td className="py-2 text-xs font-semibold">{STATUS[item.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SuiteCard>
          {selected ? (
            <Detail
              item={selected}
              saving={saving}
              saveMsg={saveMsg}
              onSave={saveFicha}
            />
          ) : null}
        </div>
      ) : null}
      {data && section === 'consumo' ? (
        <SuiteCard>
          <div className="no-print mb-3 flex flex-wrap gap-2">
            {data.consumo.meses.map((name) => (
              <button
                key={name}
                type="button"
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: data.consumo.mes === name ? SUITE.navy : '#f1f5f9',
                  color: data.consumo.mes === name ? '#fff' : SUITE.navy,
                }}
                onClick={() => setMes(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <h2 className="text-lg font-bold" style={{ color: theme.title }}>
            Consumo teórico {data.consumo.mes || ''}
          </h2>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            Unidades vendidas del costo por venta, multiplicadas por la receta. No es existencia.
          </p>
          {data.consumo.aviso ? (
            <p className="mt-3 text-sm">{data.consumo.aviso}</p>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
                  <th className="pb-2">Insumo</th>
                  <th className="pb-2 text-right">Cantidad</th>
                  <th className="pb-2 text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {data.consumo.lineas.map((row) => (
                  <tr key={row.insumo} className="border-t border-slate-100">
                    <td className="py-2 font-semibold">{row.insumo}</td>
                    <td className="py-2 text-right tabular-nums">
                      {qty(row.qty)} {row.unidad}
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(row.costo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.consumo.sinEmpate.length ? (
            <p className="mt-4 text-sm" style={{ color: theme.muted }}>
              Sin empate con el menú: {data.consumo.sinEmpate.join(' · ')}
            </p>
          ) : null}
          {data.consumo.sinCosto.length ? (
            <p className="mt-2 text-sm" style={{ color: theme.muted }}>
              Vendidos sin costo completo: {data.consumo.sinCosto.join(' · ')}
            </p>
          ) : null}
        </SuiteCard>
      ) : null}
    </SuiteShell>
  );
}

function Detail({
  item,
  saving,
  saveMsg,
  onSave,
}: {
  item: MenuRowView;
  saving: boolean;
  saveMsg: string | null;
  onSave: (ficha: Ficha) => void;
}) {
  const [ficha, setFicha] = useState(item.ficha);
  useEffect(() => setFicha(item.ficha), [item.sku, item.ficha]);

  function field(key: keyof Ficha, label: string) {
    return (
      <label className="block text-sm">
        <span className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
          {label}
        </span>
        <textarea
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          rows={key === 'descripcion' || key === 'procesos' || key === 'historia' ? 3 : 2}
          value={ficha[key] || ''}
          onChange={(e) => setFicha({ ...ficha, [key]: e.target.value })}
        />
      </label>
    );
  }

  return (
    <div className="ficha-print">
      <SuiteCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: theme.muted }}>
              Ficha técnica
            </p>
            <h2 className="text-xl font-bold" style={{ color: theme.title }}>
              {item.name}
            </h2>
            <p className="text-sm" style={{ color: theme.muted }}>
              {item.category}
              {item.portionLabel ? ` · ${item.portionLabel}` : ''} · Carta {money(item.sellPrice)} · Costo{' '}
              {money(item.cost)} · {pct(item.costPct)}
            </p>
          </div>
          <button
            type="button"
            className="no-print rounded-xl px-3 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: SUITE.navy }}
            onClick={() => window.print()}
          >
            Imprimir
          </button>
        </div>
        {item.missing.length ? (
          <p className="no-print mt-3 text-sm" style={{ color: theme.muted }}>
            Sin precio: {item.missing.join(' · ')}
          </p>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
                <th className="pb-2">Ingrediente</th>
                <th className="pb-2 text-right">Cantidad</th>
                <th className="pb-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {item.lines.length === 0 ? (
                <tr>
                  <td className="py-2" colSpan={3} style={{ color: theme.muted }}>
                    {STATUS[item.status]}. No hay receta enlazada.
                  </td>
                </tr>
              ) : (
                item.lines.map((line, i) => (
                  <tr key={`${line.name}-${i}`} className="border-t border-slate-100">
                    <td className="py-2">
                      <span className="font-semibold">{line.name}</span>
                      <span className="mt-0.5 block text-xs" style={{ color: theme.muted }}>
                        {line.detail}
                        {line.priceSource === 'factura' ? ' · precio de factura' : ''}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {qty(line.qty)} {line.unit}
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(line.lineCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3">
          {field('version', 'Versión')}
          {field('descripcion', 'Descripción')}
          {field('alergenos', 'Alérgenos')}
          {field('tiempoCiclo', 'Tiempo de ciclo')}
          {field('tipoCocina', 'Tipo de cocina')}
          {field('presentacion', 'Presentación')}
          {field('equipo', 'Equipo')}
          {field('acompanamientos', 'Acompañamientos')}
          {field('procesos', 'Procesos')}
          {field('historia', 'Historia')}
        </div>
        <div className="no-print mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={saving}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: SUITE.orange }}
            onClick={() => onSave(ficha)}
          >
            {saving ? 'Guardando…' : 'Guardar ficha'}
          </button>
          {saveMsg ? (
            <span className="text-sm" style={{ color: theme.muted }}>
              {saveMsg}
            </span>
          ) : null}
        </div>
      </SuiteCard>
    </div>
  );
}
