'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  filterControlClass,
  filterSelectClass,
  SectionHeader,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import { MESES } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const ALL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

type EstadoPdfItem = {
  filename: string;
  path: string;
  rel_path: string;
  bank: string;
  date: string;
  year: number;
  month: number | null;
  day: number | null;
  source: 'index' | 'scan';
};

function openUrl(filePath: string) {
  return `/api/estados-cuenta-pdf?open=${encodeURIComponent(filePath)}`;
}

type EstadosCuentaPdfIndexProps = {
  /** Start expanded (also used by standalone consultation page). */
  defaultOpen?: boolean;
  /** Full-page tool chrome: always open, no collapse toggle. */
  standalone?: boolean;
};

export function EstadosCuentaPdfIndex({
  defaultOpen = false,
  standalone = false,
}: EstadosCuentaPdfIndexProps = {}) {
  const [open, setOpen] = useState(defaultOpen || standalone);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | 'all'>('all');
  const [day, setDay] = useState<number | 'all'>('all');
  const [bank, setBank] = useState<'all' | 'MIFEL' | 'BBVA' | 'AMEX'>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<EstadoPdfItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [rootExists, setRootExists] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [preferScan, setPreferScan] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('year', String(year));
      if (month !== 'all') params.set('month', String(month));
      if (day !== 'all') params.set('day', String(day));
      if (bank !== 'all') params.set('bank', bank);
      if (query.trim()) params.set('q', query.trim());
      if (preferScan) params.set('scan', '1');
      params.set('years', '2022,2023,2024,2025,2026');

      const res = await fetch(`/api/estados-cuenta-pdf?${params}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`);
        setItems([]);
        return;
      }
      setItems(json.items || []);
      setSource(json.source || '');
      setRootExists(Boolean(json.rootExists));
      setLoadedOnce(true);
    } catch {
      setError('No se pudo cargar el índice de estados de cuenta');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day, bank, query, preferScan]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void load(), query ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, query, open]);

  const years = useMemo(() => [2026, 2025, 2024, 2023, 2022], []);

  const grouped = useMemo(() => {
    const map = new Map<string, EstadoPdfItem[]>();
    for (const it of items) {
      const mo = it.month || 0;
      const key = `${it.year}-${String(mo).padStart(2, '0')}|${it.bank || '—'}`;
      const list = map.get(key) || [];
      list.push(it);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return a.filename.localeCompare(b.filename, 'es');
      });
    }
    // Year-month descending, then bank.
    return Array.from(map.entries()).sort((a, b) => {
      const ymA = a[0].split('|')[0];
      const ymB = b[0].split('|')[0];
      if (ymA !== ymB) return ymB.localeCompare(ymA);
      return a[0].localeCompare(b[0], 'es');
    });
  }, [items]);

  async function copyPath(p: string) {
    try {
      await navigator.clipboard.writeText(p);
      setCopied(p);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('No se pudo copiar la ruta');
    }
  }

  const content = (
        <>
          <div
            className={`mb-4 flex flex-wrap items-center gap-2 ${
              standalone ? 'rounded-[20px] bg-white p-4' : ''
            }`}
            style={standalone ? { boxShadow: SUITE.shadow } : undefined}
          >
            <label className={filterControlClass}>
              <span className="text-slate-500">Año</span>
              <select
                className={filterSelectClass}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {years.map((y) => (
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
                value={month === 'all' ? 'all' : String(month)}
                onChange={(e) => {
                  const v = e.target.value;
                  setMonth(v === 'all' ? 'all' : Number(v));
                  setDay('all');
                }}
              >
                <option value="all">Todos</option>
                {ALL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {MESES[m - 1]}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Día</span>
              <select
                className={filterSelectClass}
                value={day === 'all' ? 'all' : String(day)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDay(v === 'all' ? 'all' : Number(v));
                }}
                disabled={month === 'all'}
              >
                <option value="all">Todos</option>
                {ALL_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Banco</span>
              <select
                className={filterSelectClass}
                value={bank}
                onChange={(e) =>
                  setBank(
                    e.target.value as 'all' | 'MIFEL' | 'BBVA' | 'AMEX'
                  )
                }
              >
                <option value="all">Todos</option>
                <option value="MIFEL">MIFEL</option>
                <option value="BBVA">BBVA</option>
                <option value="AMEX">AMEX</option>
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Buscar</span>
              <input
                className={filterSelectClass}
                style={{ minWidth: 160 }}
                placeholder="Archivo o banco…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
              onClick={() => setPreferScan((v) => !v)}
              title="Releer carpeta local I:\Administración\Bancos"
            >
              {preferScan ? 'Usar índice' : 'Escanear disco'}
            </button>
          </div>

          <p className="mb-3 text-sm" style={{ color: theme.muted }}>
            Estados de cuenta bancarios (PDF). Fuente:{' '}
            {source === 'scan'
              ? 'escaneo local de Administración\\Bancos'
              : source === 'index'
                ? 'índice Supabase (estado_cuenta_pdf_index)'
                : source || '—'}
            {rootExists ? '' : ' · carpeta I: no visible en este servidor'}.
          </p>

          {error && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div
            className="overflow-x-auto rounded-[24px] bg-white"
            style={{ boxShadow: SUITE.shadow }}
          >
            {loading && !loadedOnce ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Cargando estados de cuenta…
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Sin resultados. Ejecuta{' '}
                <code className="text-xs">
                  ingest_estados_cuenta.py --index-estados-pdf --pdf-only
                </code>{' '}
                o usa «Escanear disco» en local.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {grouped.map(([key, rows]) => {
                  const [ym, bankLabel] = key.split('|');
                  const [yStr, mStr] = ym.split('-');
                  const mNum = Number(mStr);
                  const title = `${mNum >= 1 && mNum <= 12 ? MESES[mNum - 1] : 'Sin mes'} ${yStr} · ${bankLabel}`;
                  return (
                    <div key={key} className="px-4 py-3">
                      <p
                        className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: theme.muted }}
                      >
                        {title} · {rows.length} archivo
                        {rows.length === 1 ? '' : 's'}
                        {loading ? ' · actualizando…' : ''}
                      </p>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr style={{ color: theme.muted }}>
                            <th className="pb-1.5 text-center font-semibold">
                              Banco
                            </th>
                            <th className="pb-1.5 text-center font-semibold">
                              Fecha
                            </th>
                            <th className="pb-1.5 text-center font-semibold">
                              Archivo
                            </th>
                            <th className="pb-1.5 text-center font-semibold">
                              Acciones
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((it) => (
                            <tr
                              key={`${it.path}-${it.filename}`}
                              className="border-t border-slate-50 align-top"
                            >
                              <td
                                className="py-1.5 pr-3 font-medium"
                                style={{ color: SUITE.navy }}
                              >
                                {it.bank || '—'}
                              </td>
                              <td className="whitespace-nowrap py-1.5 tabular-nums text-slate-600">
                                {it.date}
                              </td>
                              <td
                                className="max-w-[360px] truncate py-1.5 text-xs text-slate-600"
                                title={it.path || it.rel_path}
                              >
                                {it.filename}
                              </td>
                              <td className="whitespace-nowrap py-1.5 text-right">
                                <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    className="text-xs font-semibold underline-offset-2 hover:underline"
                                    style={{ color: SUITE.navy }}
                                    onClick={() =>
                                      copyPath(it.path || it.rel_path)
                                    }
                                  >
                                    {copied === (it.path || it.rel_path)
                                      ? 'Copiado'
                                      : 'Copiar ruta'}
                                  </button>
                                  {rootExists && (it.path || it.rel_path) ? (
                                    <a
                                      className="text-xs font-semibold underline-offset-2 hover:underline"
                                      style={{ color: SUITE.orangeDeep }}
                                      href={openUrl(it.path || it.rel_path)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Abrir PDF
                                    </a>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
  );

  return (
    <section className={standalone ? 'mb-0' : 'mb-8'}>
      {!standalone && (
        <SectionHeader
          title={
            <h2
              className="m-0 text-xl font-semibold leading-tight"
              style={{ color: theme.title }}
            >
              Índice de estados de cuenta
            </h2>
          }
        >
          <button
            type="button"
            className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        </SectionHeader>
      )}

      {standalone && (
        <p className="mb-4 text-sm" style={{ color: theme.muted }}>
          PDFs mensuales en Administración\Bancos · más recientes primero.
          Usa Abrir PDF o Copiar ruta.
        </p>
      )}

      {!open && !standalone ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          PDFs mensuales en Administración\Bancos (colapsado).
        </p>
      ) : (
        content
      )}
    </section>
  );
}
