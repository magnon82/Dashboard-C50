'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import { MESES } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const ALL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const PAGE_SIZE = 10;

type FacturaRow = {
  id: string;
  date: string;
  amount: number;
  uuid: string | null;
  folio: string | null;
  serie: string | null;
  emisor_rfc: string | null;
  emisor_nombre: string | null;
  pdf_path: string | null;
  xml_path: string | null;
  has_pdf: boolean;
  has_xml: boolean;
  /** PDF/acuse sin CFDI — no cuenta como gasto. */
  es_comprobante_pago?: boolean;
  filename: string;
  comprobante_path: string | null;
  comprobante_filename: string | null;
};

type FaltanteRow = {
  id: string;
  date: string;
  amount: number;
  descripcion: string;
  razonSocial: string | null;
  folio: string | null;
  week: number | null;
  source_file: string;
  comprobante_path: string | null;
  comprobante_filename: string | null;
  gobierno?: boolean;
  nota?: string | null;
};

function money(v: number) {
  if (!v) return '—';
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function openFacturaView(id: string) {
  return `/api/facturas?id=${encodeURIComponent(id)}&format=pdf`;
}

function openFacturaDownload(id: string, format: 'pdf' | 'xml' = 'pdf') {
  return `/api/facturas?id=${encodeURIComponent(id)}&format=${format}&download=1`;
}

function openComprobante(filePath: string) {
  return `/api/facturas?openComprobante=${encodeURIComponent(filePath)}`;
}

export function FacturasIndex() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | 'all'>('all');
  const [day, setDay] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'facturas' | 'comprobantes' | 'faltantes'>(
    'facturas'
  );
  const [items, setItems] = useState<FacturaRow[]>([]);
  const [comprobantesPago, setComprobantesPago] = useState<FacturaRow[]>([]);
  const [faltantes, setFaltantes] = useState<FaltanteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rootExists, setRootExists] = useState(false);
  const [comprobantesRootExists, setComprobantesRootExists] = useState(false);
  const [localFsEnabled, setLocalFsEnabled] = useState(false);
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
      if (query.trim()) params.set('q', query.trim());

      const res = await fetch(`/api/facturas?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`);
        setItems([]);
        setComprobantesPago([]);
        setFaltantes([]);
        return;
      }
      setItems(json.items || []);
      setComprobantesPago(json.comprobantesPago || []);
      setFaltantes(json.faltantes || []);
      setRootExists(Boolean(json.rootExists));
      setComprobantesRootExists(Boolean(json.comprobantesRootExists));
      setLocalFsEnabled(Boolean(json.localFsEnabled));
      setLoadedOnce(true);
    } catch {
      setError('No se pudo cargar el índice de facturas');
      setItems([]);
      setComprobantesPago([]);
      setFaltantes([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day, query]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), query ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  useEffect(() => {
    setShowAll(false);
  }, [year, month, day, query, tab]);

  const years = useMemo(() => [2026, 2025, 2024, 2023], []);

  const activeList =
    tab === 'facturas'
      ? items
      : tab === 'comprobantes'
        ? comprobantesPago
        : faltantes;
  const visibleItems = useMemo(
    () => (showAll ? items : items.slice(0, PAGE_SIZE)),
    [items, showAll]
  );
  const visibleComprobantes = useMemo(
    () =>
      showAll ? comprobantesPago : comprobantesPago.slice(0, PAGE_SIZE),
    [comprobantesPago, showAll]
  );
  const visibleFaltantes = useMemo(
    () => (showAll ? faltantes : faltantes.slice(0, PAGE_SIZE)),
    [faltantes, showAll]
  );
  const hasMore = activeList.length > PAGE_SIZE && !showAll;

  return (
    <section className="mb-0">
      <p className="mb-4 text-sm" style={{ color: theme.muted }}>
        Facturas = CFDI con XML (I/E; sí cuentan como gasto) ·{' '}
        {FACTURACION_HINT}. Más recientes primero. La pestaña «Comprob. pago»
        son PDF/acuses sin XML (no son facturas; no suman a gastos para evitar
        doble conteo). Faltantes: gastos/CXP sin CFDI — también IMSS, impuestos
        y gobierno.
      </p>

      <div
        className="mb-4 flex flex-wrap items-center gap-2 rounded-[20px] bg-white p-4"
        style={{ boxShadow: SUITE.shadow }}
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
          <span className="text-slate-500">Buscar</span>
          <input
            className={filterSelectClass}
            style={{ minWidth: 180 }}
            placeholder="Emisor, RFC, IMSS, Impuestos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            className="h-8 rounded-[10px] px-3 text-xs font-semibold"
            style={
              tab === 'facturas'
                ? { backgroundColor: SUITE.navy, color: '#fff' }
                : { color: '#475569' }
            }
            onClick={() => setTab('facturas')}
          >
            Facturas ({items.length})
          </button>
          <button
            type="button"
            className="h-8 rounded-[10px] px-3 text-xs font-semibold"
            style={
              tab === 'comprobantes'
                ? { backgroundColor: '#0F766E', color: '#fff' }
                : { color: '#475569' }
            }
            onClick={() => setTab('comprobantes')}
            title="PDF/acuses sin CFDI XML — no cuentan como gasto"
          >
            Comprob. pago ({comprobantesPago.length})
          </button>
          <button
            type="button"
            className="h-8 rounded-[10px] px-3 text-xs font-semibold"
            style={
              tab === 'faltantes'
                ? { backgroundColor: SUITE.orangeDeep, color: '#fff' }
                : { color: '#475569' }
            }
            onClick={() => setTab('faltantes')}
          >
            Faltantes ({faltantes.length})
          </button>
        </div>
      </div>

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
            Cargando facturas…
          </p>
        ) : loading && loadedOnce ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Actualizando…
          </p>
        ) : tab === 'facturas' ? (
          items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Sin facturas CFDI (con XML) indexadas. Ejecuta{' '}
              <code className="text-xs">ingest_facturas_gmail.py</code> (mismo
              OAuth que Infocaja).
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: theme.tableHead, color: '#fff' }}>
                  <th className="px-3 py-2.5 text-center font-semibold">Fecha</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Emisor</th>
                  <th className="px-3 py-2.5 text-center font-semibold">RFC</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Folio</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Monto</th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    Archivos
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {it.date}
                    </td>
                    <td
                      className="max-w-[220px] px-3 py-2 font-medium"
                      style={{ color: SUITE.navy }}
                    >
                      {it.emisor_nombre || '—'}
                      {it.uuid && (
                        <span className="mt-0.5 block truncate text-[10px] font-normal text-slate-400">
                          {it.uuid}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                      {it.emisor_rfc || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {[it.serie, it.folio].filter(Boolean).join('-') || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {money(it.amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        {rootExists && it.pdf_path ? (
                          <>
                            <a
                              className="text-xs font-semibold underline-offset-2 hover:underline"
                              style={{ color: SUITE.orangeDeep }}
                              href={openFacturaView(it.id)}
                              target="_blank"
                              rel="noreferrer"
                              title={it.filename || 'Ver PDF en el navegador'}
                            >
                              Ver PDF
                            </a>
                            <a
                              className="text-xs font-semibold underline-offset-2 hover:underline"
                              style={{ color: SUITE.orangeDeep }}
                              href={openFacturaDownload(it.id, 'pdf')}
                              download
                              title="Descargar PDF"
                            >
                              PDF
                            </a>
                          </>
                        ) : null}
                        {rootExists && it.xml_path ? (
                          <a
                            className="text-xs font-semibold underline-offset-2 hover:underline"
                            style={{ color: SUITE.navy }}
                            href={openFacturaDownload(it.id, 'xml')}
                            download
                          >
                            XML
                          </a>
                        ) : null}
                        {comprobantesRootExists && it.comprobante_path ? (
                          <a
                            className="text-xs font-semibold underline-offset-2 hover:underline"
                            style={{ color: '#0F766E' }}
                            href={openComprobante(it.comprobante_path)}
                            target="_blank"
                            rel="noreferrer"
                            title={it.comprobante_filename || 'Comprobante'}
                          >
                            Comprobante
                          </a>
                        ) : null}
                        {rootExists && !it.pdf_path && !it.xml_path ? (
                          <span
                            className="text-xs text-slate-400"
                            title="Sin PDF/XML en el índice"
                          >
                            Sin archivo
                          </span>
                        ) : null}
                        {!rootExists && (it.has_pdf || it.has_xml) ? (
                          <span
                            className="text-xs text-slate-400"
                            title={
                              localFsEnabled
                                ? 'Configura FACTURAS_PATH o monta FACTURAS CFDI en este PC'
                                : 'PDF/XML indexados; vista previa en la nube requiere Storage o Drive API'
                            }
                          >
                            Solo índice
                          </span>
                        ) : null}
                        {!rootExists &&
                        !it.has_pdf &&
                        !it.has_xml &&
                        !it.comprobante_path ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === 'comprobantes' ? (
          comprobantesPago.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Sin comprobantes de pago fiscales (PDF/acuse sin XML) para este
              filtro. No son facturas y no cuentan como gasto.
            </p>
          ) : (
            <>
              <div
                className="border-b border-teal-100 px-4 py-2.5 text-xs"
                style={{ backgroundColor: 'rgba(15, 118, 110, 0.06)' }}
              >
                <span
                  className="mr-2 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: 'rgba(15, 118, 110, 0.15)',
                    color: '#0F766E',
                  }}
                >
                  No cuenta como gasto
                </span>
                <span className="text-slate-600">
                  Comprobantes de pago fiscales (PDF/acuse sin CFDI). El monto
                  suele coincidir con la factura real — no se suman para evitar
                  doble conteo.
                </span>
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr
                    style={{ backgroundColor: theme.tableHead, color: '#fff' }}
                  >
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Fecha
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Emisor / concepto
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Folio
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Monto
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Tipo
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Archivos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleComprobantes.map((it) => (
                    <tr
                      key={it.id}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {it.date}
                      </td>
                      <td
                        className="max-w-[220px] px-3 py-2 font-medium"
                        style={{ color: SUITE.navy }}
                      >
                        {it.emisor_nombre || '—'}
                        {it.filename && (
                          <span className="mt-0.5 block truncate text-[10px] font-normal text-slate-400">
                            {it.filename}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {[it.serie, it.folio].filter(Boolean).join('-') || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {money(it.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={{
                            backgroundColor: 'rgba(15, 118, 110, 0.12)',
                            color: '#0F766E',
                          }}
                          title="Comprobante de pago fiscal · sin CFDI XML · no es factura ni gasto"
                        >
                          Sin CFDI · no gasto
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {rootExists && it.pdf_path ? (
                            <>
                              <a
                                className="text-xs font-semibold underline-offset-2 hover:underline"
                                style={{ color: SUITE.orangeDeep }}
                                href={openFacturaView(it.id)}
                                target="_blank"
                                rel="noreferrer"
                                title={
                                  it.filename || 'Ver PDF comprobante de pago'
                                }
                              >
                                Ver PDF
                              </a>
                              <a
                                className="text-xs font-semibold underline-offset-2 hover:underline"
                                style={{ color: SUITE.orangeDeep }}
                                href={openFacturaDownload(it.id, 'pdf')}
                                download
                                title="Descargar PDF"
                              >
                                PDF
                              </a>
                            </>
                          ) : null}
                          {comprobantesRootExists && it.comprobante_path ? (
                            <a
                              className="text-xs font-semibold underline-offset-2 hover:underline"
                              style={{ color: '#0F766E' }}
                              href={openComprobante(it.comprobante_path)}
                              target="_blank"
                              rel="noreferrer"
                              title={it.comprobante_filename || 'Comprobante'}
                            >
                              Bancario
                            </a>
                          ) : null}
                          {!rootExists && it.has_pdf ? (
                            <span
                              className="text-xs text-slate-400"
                              title={
                                localFsEnabled
                                  ? 'Configura FACTURAS_PATH o monta FACTURAS CFDI en este PC'
                                  : 'PDF indexado; vista previa en la nube requiere Storage o Drive API'
                              }
                            >
                              Solo índice
                            </span>
                          ) : null}
                          {rootExists && !it.pdf_path ? (
                            <span className="text-xs text-slate-400">
                              Sin archivo
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        ) : faltantes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No hay gastos/CXP sin factura coincidente para este filtro
            (best-effort). Prueba buscar «IMSS» o «Impuestos».
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: theme.tableHead, color: '#fff' }}>
                <th className="px-3 py-2.5 text-center font-semibold">Fecha</th>
                <th className="px-3 py-2.5 text-center font-semibold">Concepto</th>
                <th className="px-3 py-2.5 text-center font-semibold">Fuente</th>
                <th className="px-3 py-2.5 text-center font-semibold">Sem</th>
                <th className="px-3 py-2.5 text-center font-semibold">Monto</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Comprobante pago
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleFaltantes.map((it) => (
                <tr
                  key={it.id}
                  className="border-t border-slate-100 align-top"
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {it.date}
                  </td>
                  <td className="max-w-[280px] px-3 py-2">
                    <span className="font-medium" style={{ color: SUITE.navy }}>
                      {it.descripcion || '—'}
                    </span>
                    {it.razonSocial && (
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {it.razonSocial}
                      </span>
                    )}
                    {it.folio && (
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        Fac {it.folio}
                      </span>
                    )}
                    {(it.nota || it.gobierno) && (
                      <span
                        className="mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor: it.gobierno
                            ? 'rgba(15, 118, 110, 0.1)'
                            : 'rgba(148, 163, 184, 0.25)',
                          color: it.gobierno ? '#0F766E' : '#64748B',
                        }}
                      >
                        {it.nota || 'Gobierno / impuestos'}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                    {it.source_file}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {it.week != null ? `SEM ${it.week}` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {money(it.amount)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {comprobantesRootExists && it.comprobante_path ? (
                      <a
                        className="text-xs font-semibold underline-offset-2 hover:underline"
                        style={{ color: '#0F766E' }}
                        href={openComprobante(it.comprobante_path)}
                        target="_blank"
                        rel="noreferrer"
                        title={it.comprobante_filename || 'Comprobante'}
                      >
                        Descargar
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">Sin match</span>
                    )}
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
            Mostrar más ({activeList.length - PAGE_SIZE} restantes)
          </button>
        </div>
      )}
    </section>
  );
}

const FACTURACION_HINT = 'facturacion@carranza50.com.mx';
