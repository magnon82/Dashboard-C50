'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import type { CalendarEventItem } from '@/app/lib/eventos-calendario';
import { mexicoTodayIso } from '@/app/lib/eventos';
import { getTheme, SUITE } from '@/app/lib/themes';

function clientKey(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

type PendingOsRow = {
  id: string;
  event_date: string;
  title: string;
  client: string | null;
  source_label: string;
};

type WhenFilter = 'proximas' | 'pasadas' | 'todas';

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
      <span
        className="text-slate-400"
        title="Sin fecha de evento; mtime del archivo"
      >
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
  const [when, setWhen] = useState<WhenFilter>('proximas');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<OsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [rootExists, setRootExists] = useState(false);
  const [root, setRoot] = useState<string>('');
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<PendingOsRow[]>([]);

  const today = useMemo(() => mexicoTodayIso(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year !== 'all') params.set('year', String(year));
      if (query.trim()) params.set('q', query.trim());
      const [osRes, calRes] = await Promise.all([
        fetch(`/api/eventos/os?${params}`, { cache: 'no-store' }),
        fetch('/api/eventos/calendario', { cache: 'no-store' }),
      ]);
      const json = await osRes.json();
      if (!osRes.ok) {
        setError(json.error || `Error ${osRes.status}`);
        setItems([]);
        setPending([]);
        return;
      }
      const osItems: OsItem[] = json.items || [];
      setItems(osItems);
      setSource(json.source || '');
      setRootExists(Boolean(json.rootExists));
      setRoot(json.root || '');
      setNote(json.note || null);

      // Próximas en Calendario (Anticipos/CRM) sin PDF → “Sin OS / pendiente”
      try {
        const calJson = calRes.ok ? await calRes.json() : { events: [] };
        const events: CalendarEventItem[] = calJson.events || [];
        const osKeys = new Set<string>();
        for (const it of osItems) {
          if (!it.event_date) continue;
          const who = clientKey(it.matched_client_name || it.label);
          if (who) osKeys.add(`${it.event_date}|${who}`);
        }
        const pendingRows: PendingOsRow[] = [];
        for (const ev of events) {
          if (ev.os_path) continue;
          if (ev.source === 'os') continue;
          const who = clientKey(ev.client || ev.title);
          if (who && osKeys.has(`${ev.event_date}|${who}`)) continue;
          if (
            year !== 'all' &&
            Number(ev.event_date.slice(0, 4)) !== year
          ) {
            continue;
          }
          if (query.trim()) {
            const hay = [ev.title, ev.client, ev.source_label]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            if (!hay.includes(query.trim().toLowerCase())) continue;
          }
          pendingRows.push({
            id: `pending:${ev.id}`,
            event_date: ev.event_date,
            title: ev.title,
            client: ev.client,
            source_label: ev.source_label,
          });
        }
        setPending(pendingRows);
      } catch {
        setPending([]);
      }
    } catch {
      setError('No se pudo cargar el índice de OS');
      setItems([]);
      setPending([]);
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
  }, [year, query, when]);

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    const fromItems = [
      ...new Set(
        items.map((it) => it.year).filter((n): n is number => n != null)
      ),
    ].sort((a, b) => b - a);
    const base = [y + 1, y, y - 1, y - 2, y - 3];
    return [...new Set([...base, ...fromItems])].sort((a, b) => b - a);
  }, [items]);

  const counts = useMemo(() => {
    let proximas = 0;
    let pasadas = 0;
    let sinFecha = 0;
    for (const it of items) {
      if (!it.event_date) {
        sinFecha += 1;
        continue;
      }
      if (it.event_date >= today) proximas += 1;
      else pasadas += 1;
    }
    return {
      proximas: proximas + pending.length,
      pasadas,
      sinFecha,
      total: items.length,
      pending: pending.length,
    };
  }, [items, today, pending.length]);

  const filtered = useMemo(() => {
    let list: OsItem[];
    if (when === 'todas') list = items;
    else if (when === 'proximas') {
      list = items.filter((it) => it.event_date && it.event_date >= today);
    } else {
      list = items.filter((it) => it.event_date && it.event_date < today);
    }
    // Próximas: pronto primero; Pasadas/Todas: más reciente primero (API ya trae desc)
    if (when === 'proximas') {
      return [...list].sort((a, b) =>
        String(a.event_date).localeCompare(String(b.event_date))
      );
    }
    return list;
  }, [items, when, today]);

  const visible = useMemo(
    () => (showAll ? filtered : filtered.slice(0, PAGE_SIZE)),
    [filtered, showAll]
  );
  const hasMore = filtered.length > PAGE_SIZE && !showAll;

  const whenTabs: { id: WhenFilter; label: string; count: number }[] = [
    { id: 'proximas', label: 'Próximas', count: counts.proximas },
    { id: 'pasadas', label: 'Pasadas', count: counts.pasadas },
    { id: 'todas', label: 'Todas', count: counts.total },
  ];

  return (
    <div className="space-y-5">
      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: theme.title }}>
          Órdenes de servicio
        </h3>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>
          PDFs en Drive. <strong>Próximas</strong> = hoy CDMX en adelante,
          ordenadas por fecha del evento (la más cercana primero). Pasadas /
          Todas: más reciente primero. Sin fecha → pestaña «Todas».
        </p>
        <p className="mt-2 text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
          Solo PDFs de Drive. Eventos solo en Anticipos (p. ej. Cena G7,
          Rompehielos) aparecen en Calendario hasta generar OS.
        </p>
        {counts.sinFecha > 0 && when === 'proximas' && (
          <p className="mt-1 text-xs text-slate-500">
            {counts.sinFecha} OS sin fecha de evento — verlas en «Todas».
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Ruta local:{' '}
          <code className="text-[11px]">
            {root || 'I:\\Mi unidad\\Eventos\\Ordenes de servicio'}
          </code>
          {rootExists ? ' · montada' : ' · no montada en este servidor'}
        </p>
        {(note || (!rootExists && source === 'activity_seed')) && (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            {note ||
              'Usando seed de actividad (carpeta Drive no disponible en este servidor).'}
          </p>
        )}
      </SuiteCard>

      <div className="flex flex-wrap gap-2">
        {whenTabs.map((t) => {
          const active = when === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setWhen(t.id)}
              className="rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors"
              style={
                active
                  ? { backgroundColor: SUITE.navy, color: '#fff' }
                  : {
                      backgroundColor: '#fff',
                      color: SUITE.navy,
                      boxShadow: SUITE.shadow,
                    }
              }
            >
              {t.label}
              <span
                className={`ml-1.5 text-xs font-bold ${
                  active ? 'text-white/80' : 'text-slate-400'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

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
            : `${filtered.length} OS${
                when === 'proximas' && pending.length
                  ? ` · ${pending.length} sin OS`
                  : ''
              }${
                !showAll && filtered.length > PAGE_SIZE
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
                <th className="px-4 py-3 font-semibold">Año</th>
                <th className="px-4 py-3 font-semibold">Cliente / evento</th>
                <th className="px-4 py-3 font-semibold">Folio</th>
                <th className="px-4 py-3 font-semibold">CRM</th>
                <th className="px-4 py-3 font-semibold">Archivo</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && pending.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-slate-500">
                    Escaneando órdenes de servicio…
                  </td>
                </tr>
              ) : filtered.length === 0 &&
                !(when === 'proximas' && pending.length > 0) ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-slate-500">
                    {items.length === 0 ? (
                      <>
                        Sin PDFs de OS. Monta{' '}
                        <code className="text-xs">
                          I:\Mi unidad\Eventos\Ordenes de servicio
                        </code>
                        . Eventos solo en Anticipos viven en Calendario hasta
                        generar OS.
                      </>
                    ) : when === 'proximas' ? (
                      'No hay OS próximas con los filtros actuales. Prueba «Pasadas» o «Todas», o revisa Calendario.'
                    ) : when === 'pasadas' ? (
                      'No hay OS pasadas con los filtros actuales.'
                    ) : (
                      'Sin resultados para la búsqueda / año.'
                    )}
                  </td>
                </tr>
              ) : (
                <>
                  {visible.map((it) => (
                    <tr
                      key={it.id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                        {formatWhen(
                          it.event_date,
                          it.mtimeMs,
                          Boolean(it.event_date)
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                        {it.year ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        {it.label ||
                          (it.folio
                            ? `OS ${it.folio}`
                            : 'Sin nombre en archivo')}
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
                            title={it.path}
                          >
                            {it.filename}
                          </a>
                        ) : (
                          <span
                            className="text-xs text-slate-500"
                            title={it.rel_path || undefined}
                          >
                            {it.filename}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {when === 'proximas' &&
                    pending.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-dashed border-slate-200 bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">
                          {formatWhen(row.event_date, 0, true)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                          {row.event_date.slice(0, 4)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <span className="font-medium">{row.title}</span>
                          {row.client &&
                            clientKey(row.client) !==
                              clientKey(row.title) && (
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {row.client}
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400">—</td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {row.source_label}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="inline-flex rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
                            title="Visible en Calendario; aún no hay PDF de OS en Drive"
                          >
                            Sin OS / pendiente
                          </span>
                        </td>
                      </tr>
                    ))}
                </>
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
              Mostrar más ({filtered.length - PAGE_SIZE} restantes)
            </button>
          </div>
        )}
      </SuiteCard>
    </div>
  );
}
