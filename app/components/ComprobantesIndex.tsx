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
const PAGE_SIZE = 10;

type ComprobanteItem = {
  filename: string;
  path: string;
  rel_path: string;
  bank: string;
  amount: number;
  date: string;
  year: number;
  month: number | null;
  week: number | null;
  vendor: string;
  body: string;
  concepto: string;
  kind: 'comprobante' | 'estado';
  source: 'index' | 'scan';
  mtimeMs?: number | null;
};

/** Newest → oldest: file mtime, then calendar date, then filename. */
function sortByRecency(a: ComprobanteItem, b: ComprobanteItem): number {
  const ma = a.mtimeMs ?? 0;
  const mb = b.mtimeMs ?? 0;
  if (ma !== mb) return mb - ma;
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return a.filename.localeCompare(b.filename, 'es');
}

function money(v: number) {
  if (!v) return '—';
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function openUrl(filePath: string) {
  return `/api/comprobantes?open=${encodeURIComponent(filePath)}`;
}

type ComprobantesIndexProps = {
  /** Start expanded (also used by standalone consultation page). */
  defaultOpen?: boolean;
  /** Full-page tool chrome: always open, no collapse toggle. */
  standalone?: boolean;
};

export function ComprobantesIndex({
  defaultOpen = false,
  standalone = false,
}: ComprobantesIndexProps = {}) {
  const [open, setOpen] = useState(defaultOpen || standalone);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | 'all'>('all');
  const [day, setDay] = useState<number | 'all'>('all');
  const [bank, setBank] = useState<'all' | 'MIFEL' | 'BBVA'>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ComprobanteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [rootExists, setRootExists] = useState(false);
  /** When true, force Supabase index even if I: is mounted (sparse). Default: disk scan. */
  const [preferIndex, setPreferIndex] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('year', String(year));
      if (month !== 'all') params.set('month', String(month));
      if (day !== 'all') params.set('day', String(day));
      if (bank !== 'all') params.set('bank', bank);
      params.set('kind', 'comprobante');
      if (query.trim()) params.set('q', query.trim());
      if (preferIndex) params.set('index', '1');
      // Limit disk walk to the selected year (hundreds of PDFs per year).
      params.set('years', String(year));

      const res = await fetch(`/api/comprobantes?${params}`, {
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
      setError('No se pudo cargar el índice de comprobantes');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day, bank, query, preferIndex]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void load(), query ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, query, open]);

  useEffect(() => {
    setShowAll(false);
  }, [year, month, day, bank, query, preferIndex]);

  const years = useMemo(() => [2026, 2025, 2024, 2023], []);

  const sortedItems = useMemo(
    () => [...items].sort(sortByRecency),
    [items]
  );

  const visibleItems = useMemo(
    () => (showAll ? sortedItems : sortedItems.slice(0, PAGE_SIZE)),
    [sortedItems, showAll]
  );
  const hasMore = sortedItems.length > PAGE_SIZE && !showAll;

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
                  setBank(e.target.value as 'all' | 'MIFEL' | 'BBVA')
                }
              >
                <option value="all">Todos</option>
                <option value="MIFEL">MIFEL</option>
                <option value="BBVA">BBVA</option>
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Buscar</span>
              <input
                className={filterSelectClass}
                style={{ minWidth: 180 }}
                placeholder="Concepto, proveedor, IMSS, SAT…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
              onClick={() => setPreferIndex((v) => !v)}
              title={
                preferIndex
                  ? 'Volver a listar desde la carpeta local I: (completo, más reciente primero)'
                  : 'Forzar índice Supabase (puede estar incompleto)'
              }
            >
              {preferIndex ? 'Escanear disco' : 'Usar índice'}
            </button>
          </div>

          <p className="mb-3 text-sm" style={{ color: theme.muted }}>
            PDFs de pagos (comprobantes), no estados de cuenta. Incluye IMSS,
            impuestos SAT/SHCP y Secretaría de Hacienda. Fuente:{' '}
            {source === 'scan'
              ? 'escaneo local de COMPROBANTES BANCARIOS'
              : source === 'index'
                ? 'índice Supabase (estado_pdf_index)'
                : source === 'index+scan'
                  ? 'disco + índice'
                  : source || '—'}
            {rootExists ? '' : ' · carpeta I: no visible en este servidor'}.
            {!showAll && sortedItems.length > PAGE_SIZE
              ? ` · mostrando ${PAGE_SIZE} de ${sortedItems.length}`
              : sortedItems.length
                ? ` · ${sortedItems.length} comprobantes`
                : ''}
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
                Cargando comprobantes…
              </p>
            ) : sortedItems.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Sin resultados. Ejecuta{' '}
                <code className="text-xs">
                  ingest_estados_cuenta.py --index-pdfs --pdf-only
                </code>{' '}
                o usa «Escanear disco» en local.
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr
                    style={{ backgroundColor: theme.tableHead, color: '#fff' }}
                  >
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Fecha
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Concepto
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Proveedor
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Banco
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Monto
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((it) => (
                    <tr
                      key={`${it.path}-${it.filename}`}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                        {it.date}
                        {it.week != null && (
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            Sem {it.week}
                          </span>
                        )}
                      </td>
                      <td
                        className="max-w-[260px] px-3 py-2"
                        style={{ color: SUITE.navy }}
                      >
                        <span className="font-medium">
                          {it.concepto || it.body || '—'}
                        </span>
                      </td>
                      <td className="max-w-[180px] px-3 py-2 text-slate-700">
                        {it.vendor || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">
                        {it.bank || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {money(it.amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {rootExists && (it.path || it.rel_path) ? (
                            <a
                              className="text-xs font-semibold underline-offset-2 hover:underline"
                              style={{ color: SUITE.orangeDeep }}
                              href={openUrl(it.path || it.rel_path)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                style={{ boxShadow: SUITE.shadow }}
                onClick={() => setShowAll(true)}
              >
                Mostrar más ({sortedItems.length - PAGE_SIZE} restantes)
              </button>
            </div>
          )}
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
              Comprobantes de Pago
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
          PDFs de pagos en COMPROBANTES BANCARIOS · más recientes primero.
          Usa Abrir para consultar en la plataforma.
        </p>
      )}

      {!open && !standalone ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Directorio de PDFs de pagos en COMPROBANTES BANCARIOS (colapsado).
        </p>
      ) : (
        content
      )}
    </section>
  );
}
