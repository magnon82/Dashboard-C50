'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');
const PAGE_SIZE = 10;

type OsItem = {
  id: string;
  filename: string;
  path: string;
  rel_path: string;
  label: string | null;
  folio: string | null;
  year: number | null;
  event_date: string | null;
  activity_date: string | null;
  mtimeMs: number;
  source: 'scan' | 'activity_seed';
  matched_client_name?: string | null;
};

function openUrl(filePath: string) {
  return `/api/eventos/os?open=${encodeURIComponent(filePath)}`;
}

function formatWhen(iso: string | null, mtimeMs: number, hasEventDate: boolean) {
  if (hasEventDate && iso) {
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      /* fall through */
    }
  }
  if (!hasEventDate && mtimeMs) {
    return (
      <span className="text-slate-400" title="Sin fecha de evento; mtime del archivo">
        {new Date(mtimeMs).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </span>
    );
  }
  return '—';
}

export function EventosOrdenesServicio() {
  const [year, setYear] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<OsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [rootExists, setRootExists] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year !== 'all') params.set('year', String(year));
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`/api/eventos/os?${params}`, {
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
      setNote(json.note || null);
    } catch {
      setError('No se pudo cargar el índice de OS');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [year, query]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), query ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  useEffect(() => {
    setShowAll(false);
  }, [year, query]);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y + 1, y, y - 1, y - 2, y - 3];
  }, []);

  const visible = useMemo(
    () => (showAll ? items : items.slice(0, PAGE_SIZE)),
    [items, showAll]
  );
  const hasMore = items.length > PAGE_SIZE && !showAll;

  return (
    <div className="space-y-5">
      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: theme.title }}>
          Órdenes de servicio
        </h3>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>
          PDFs en Drive (Ordenes de servicio), ordenados por fecha del evento
          (más reciente primero). Sin fecha de evento van al final. Se vinculan
          al CRM cuando el nombre del archivo coincide con un cliente.
        </p>
        {(note || (!rootExists && source === 'activity_seed')) && (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            {note ||
              'Usando seed de actividad (carpeta Drive no disponible en este servidor).'}
          </p>
        )}
      </SuiteCard>

      <div
        className="flex flex-wrap items-center gap-2 rounded-[20px] bg-white p-4"
        style={{ boxShadow: SUITE.shadow }}
      >
        <label className={filterControlClass}>
          <span className="text-slate-500">Año</span>
          <select
            value={year === 'all' ? 'all' : String(year)}
            onChange={(e) =>
              setYear(
                e.target.value === 'all' ? 'all' : Number(e.target.value)
              )
            }
            className={filterSelectClass}
          >
            <option value="all">Todos</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className={`${filterControlClass} bg-white`}>
          <span className="text-slate-500">Buscar</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${filterSelectClass} min-w-[180px]`}
            placeholder="Cliente, folio, archivo…"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Actualizar
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {loading
            ? 'Cargando…'
            : `${items.length} OS${
                !showAll && items.length > PAGE_SIZE
                  ? ` · mostrando ${PAGE_SIZE}`
                  : ''
              }`}
          {source ? ` · ${source === 'scan' ? 'disco' : 'seed'}` : ''}
        </span>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-700">{error}</p>
      )}

      <SuiteCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha evento</th>
                <th className="px-4 py-3 font-semibold">Cliente / evento</th>
                <th className="px-4 py-3 font-semibold">Folio</th>
                <th className="px-4 py-3 font-semibold">CRM</th>
                <th className="px-4 py-3 font-semibold">Archivo</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate-500">
                    Escaneando órdenes de servicio…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate-500">
                    Sin OS. Monta{' '}
                    <code className="text-xs">
                      I:\Mi unidad\Eventos\Ordenes de servicio
                    </code>{' '}
                    o corre{' '}
                    <code className="text-xs">
                      python ingestor/build_event_client_activity.py
                    </code>
                    .
                  </td>
                </tr>
              ) : (
                visible.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                      {formatWhen(it.event_date, it.mtimeMs, Boolean(it.event_date))}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      {it.label ||
                        (it.folio ? `OS ${it.folio}` : 'Sin nombre en archivo')}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {it.folio || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {it.matched_client_name ? (
                        <span className="font-semibold text-slate-700">
                          {it.matched_client_name}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {it.path && it.source === 'scan' ? (
                        <a
                          href={openUrl(it.path)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold underline-offset-2 hover:underline"
                          style={{ color: SUITE.navy }}
                        >
                          {it.filename}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500" title={it.rel_path}>
                          {it.filename}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="border-t border-slate-100 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded-xl px-3 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              Mostrar más ({items.length - PAGE_SIZE} restantes)
            </button>
          </div>
        )}
      </SuiteCard>
    </div>
  );
}
