'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import type { CalendarEventItem } from '@/app/lib/eventos-calendario-shared';
import { isAnticipoSinOs } from '@/app/lib/eventos-calendario-shared';
import { mexicoTodayIso } from '@/app/lib/eventos';
import { useSession } from '@/app/lib/useSession';
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
  source: 'scan' | 'activity_seed' | string;
  matched_client_name?: string | null;
  kind?: 'pdf' | 'digital';
  digital_id?: string | null;
  celebration?: string | null;
  pax?: number | null;
  total?: number | null;
  status?: string | null;
  /** Evento cancelado en Calendario / reservas (tachado en listado). */
  cancelled?: boolean;
  /** UUID en event_os_documents (PDF en BMS) */
  doc_id?: string | null;
  storage_path?: string | null;
  openable?: boolean;
};

type PendingOsRow = {
  id: string;
  event_date: string;
  title: string;
  client: string | null;
  source_label: string;
  has_anticipo: boolean;
  quote_id?: string | null;
  lead_id?: string | null;
  cancelled?: boolean;
};

type WhenFilter = 'proximas' | 'pasadas' | 'todas';

type TableRow =
  | { kind: 'os'; item: OsItem }
  | { kind: 'pending'; item: PendingOsRow };

function folioKey(folio: string | null | undefined): string {
  return String(folio || '')
    .trim()
    .toLowerCase();
}

/** Marca cancelados del Calendario sobre filas OS (por OS digital, fecha+nombre o folio). */
function markCancelledOsItems(
  osItems: OsItem[],
  events: CalendarEventItem[]
): OsItem[] {
  const byDigital = new Set<string>();
  const byName = new Set<string>();
  const byFolio = new Set<string>();
  for (const ev of events) {
    if (ev.status !== 'cancelado') continue;
    if (ev.digital_os_id) byDigital.add(ev.digital_os_id);
    const who = clientKey(ev.client || ev.title);
    if (ev.event_date && who) byName.add(`${ev.event_date}|${who}`);
    const folio = folioKey(ev.folio);
    if (ev.event_date && folio) byFolio.add(`${ev.event_date}|${folio}`);
  }
  if (!byDigital.size && !byName.size && !byFolio.size) {
    return osItems.map((it) => ({ ...it, cancelled: false }));
  }
  return osItems.map((it) => {
    let cancelled = false;
    if (it.digital_id && byDigital.has(it.digital_id)) cancelled = true;
    if (!cancelled && it.event_date) {
      const who = clientKey(it.matched_client_name || it.label);
      if (who && byName.has(`${it.event_date}|${who}`)) cancelled = true;
      const folio = folioKey(it.folio);
      if (!cancelled && folio && byFolio.has(`${it.event_date}|${folio}`)) {
        cancelled = true;
      }
    }
    return { ...it, cancelled };
  });
}

function openUrl(filePath: string) {
  return `/api/eventos/os?open=${encodeURIComponent(filePath)}`;
}

function downloadUrl(filePath: string) {
  return `/api/eventos/os?open=${encodeURIComponent(filePath)}&download=1`;
}

/** URL de consulta/descarga para PDF en BMS (Storage) o FS local. */
function pdfOpenUrls(it: OsItem): { view: string; download: string } | null {
  if (it.doc_id) {
    return {
      view: `/api/eventos/os?id=${encodeURIComponent(it.doc_id)}`,
      download: `/api/eventos/os?id=${encodeURIComponent(it.doc_id)}&download=1`,
    };
  }
  if (it.rel_path) {
    return {
      view: `/api/eventos/os?rel=${encodeURIComponent(it.rel_path)}`,
      download: `/api/eventos/os?rel=${encodeURIComponent(it.rel_path)}&download=1`,
    };
  }
  if (it.path) {
    return { view: openUrl(it.path), download: downloadUrl(it.path) };
  }
  return null;
}

function DocChip({
  href,
  label,
  title,
  primary,
  download,
}: {
  href: string;
  label: string;
  title?: string;
  primary?: boolean;
  download?: boolean | string;
}) {
  const forceFile = Boolean(download);
  return (
    <a
      href={href}
      target={forceFile ? undefined : '_blank'}
      rel={forceFile ? undefined : 'noreferrer'}
      download={forceFile ? download : undefined}
      title={title}
      className={
        primary
          ? 'inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold text-white'
          : 'inline-flex rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
      }
      style={primary ? { backgroundColor: SUITE.navy } : undefined}
    >
      {label}
    </a>
  );
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
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [year, setYear] = useState<number | 'all'>('all');
  const [when, setWhen] = useState<WhenFilter>('proximas');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<OsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [rootExists, setRootExists] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<PendingOsRow[]>([]);
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  const today = useMemo(() => mexicoTodayIso(), []);

  const load = useCallback(async (opts?: { sync?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      if (opts?.sync && canEdit) {
        setSyncBusy(true);
        try {
          const syncBody: Record<string, unknown> = {
            action: 'sync_pdfs',
            limit: 50,
          };
          if (year !== 'all') syncBody.year = year;
          if (query.trim()) syncBody.q = query.trim();
          const syncRes = await fetch('/api/eventos/os', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncBody),
          });
          const syncJson = await syncRes.json().catch(() => ({}));
          if (syncRes.ok && syncJson.message) {
            setGenMsg(String(syncJson.message));
          } else if (!syncRes.ok && syncJson.hint) {
            setNote(String(syncJson.hint));
          } else if (!syncRes.ok && syncJson.error) {
            setNote(String(syncJson.error));
          }
        } catch {
          /* listado sigue */
        } finally {
          setSyncBusy(false);
        }
      }

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
      const osItemsRaw: OsItem[] = json.items || [];
      setSource(json.source || '');
      setRootExists(Boolean(json.rootExists));
      setNote(json.note || null);

      // Próximas en Calendario (Anticipos/CRM) sin PDF → “Sin OS / pendiente”
      try {
        const calJson = calRes.ok ? await calRes.json() : { events: [] };
        const events: CalendarEventItem[] = calJson.events || [];
        setItems(markCancelledOsItems(osItemsRaw, events));
        const osKeys = new Set<string>();
        for (const it of osItemsRaw) {
          if (!it.event_date) continue;
          const who = clientKey(it.matched_client_name || it.label);
          if (who) osKeys.add(`${it.event_date}|${who}`);
        }
        const pendingRows: PendingOsRow[] = [];
        for (const ev of events) {
          if (ev.has_os || ev.os_path || ev.digital_os_id || ev.source === 'os') {
            continue;
          }
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
            has_anticipo: Boolean(ev.has_anticipo),
            quote_id: ev.quote_id,
            lead_id: ev.lead_id,
            cancelled: ev.status === 'cancelado',
          });
        }
        setPending(pendingRows);
      } catch {
        setItems(osItemsRaw.map((it) => ({ ...it, cancelled: false })));
        setPending([]);
      }
    } catch {
      setError('No se pudo cargar el índice de OS');
      setItems([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [year, query, canEdit]);

  async function generateOs(row: PendingOsRow) {
    if (!canEdit || (!row.quote_id && !row.lead_id)) return;
    setGenBusy(row.id);
    setGenMsg('');
    setError(null);
    try {
      const res = await fetch('/api/eventos/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          row.quote_id
            ? { quote_id: row.quote_id }
            : { lead_id: row.lead_id }
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          [json.error, json.hint].filter(Boolean).join(' — ') ||
            'No se pudo generar OS'
        );
        return;
      }
      setGenMsg(
        json.created
          ? `OS ${json.order?.os_number || ''} generada`
          : `OS ${json.order?.os_number || ''} ya existía`
      );
      await load();
      if (json.href) {
        window.open(json.href, '_blank', 'noopener,noreferrer');
      }
    } catch {
      setError('Error de red al generar OS');
    } finally {
      setGenBusy(null);
    }
  }

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
    for (const it of items) {
      if (!it.event_date) continue;
      if (it.event_date >= today) proximas += 1;
      else pasadas += 1;
    }
    return {
      proximas: proximas + pending.length,
      pasadas,
      total: items.length,
      pending: pending.length,
    };
  }, [items, today, pending.length]);

  const filteredOs = useMemo(() => {
    let list: OsItem[];
    if (when === 'todas') list = items;
    else if (when === 'proximas') {
      list = items.filter((it) => it.event_date && it.event_date >= today);
    } else {
      list = items.filter((it) => it.event_date && it.event_date < today);
    }
    if (when === 'proximas') {
      return [...list].sort((a, b) =>
        String(a.event_date).localeCompare(String(b.event_date))
      );
    }
    // Pasadas / Todas: más reciente primero (API ya trae desc; reafirmar)
    return [...list].sort((a, b) => {
      const ea = a.event_date || '';
      const eb = b.event_date || '';
      if (ea && eb && ea !== eb) return eb.localeCompare(ea);
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      return (b.mtimeMs || 0) - (a.mtimeMs || 0);
    });
  }, [items, when, today]);

  /** Próximas: OS + Anticipos/CRM sin OS en una sola lista cronológica (cercana → lejana). */
  const tableRows = useMemo((): TableRow[] => {
    const osRows: TableRow[] = filteredOs.map((item) => ({
      kind: 'os',
      item,
    }));
    if (when !== 'proximas' || pending.length === 0) return osRows;

    const pendingRows: TableRow[] = pending.map((item) => ({
      kind: 'pending',
      item,
    }));
    return [...osRows, ...pendingRows].sort((a, b) => {
      const da =
        a.kind === 'os' ? a.item.event_date || '' : a.item.event_date;
      const db =
        b.kind === 'os' ? b.item.event_date || '' : b.item.event_date;
      if (da !== db) return da.localeCompare(db);
      // Mismo día: OS antes que pendiente
      if (a.kind !== b.kind) return a.kind === 'os' ? -1 : 1;
      return 0;
    });
  }, [filteredOs, pending, when]);

  const filtered = filteredOs;
  const visible = useMemo(
    () => (showAll ? tableRows : tableRows.slice(0, PAGE_SIZE)),
    [tableRows, showAll]
  );
  const hasMore = tableRows.length > PAGE_SIZE && !showAll;

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
        {note ? (
          <p className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
            {note}
          </p>
        ) : null}
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
          disabled={loading || syncBusy}
          onClick={() => void load({ sync: canEdit })}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          title={
            canEdit
              ? 'Recargar y sincronizar PDFs faltantes al BMS (Storage)'
              : 'Recargar listado'
          }
        >
          {syncBusy ? 'Sincronizando…' : 'Actualizar'}
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {loading
            ? 'Cargando…'
            : `${filtered.length} OS${
                when === 'proximas' && pending.length
                  ? ` · ${pending.length} sin OS`
                  : ''
              }${
                !showAll && tableRows.length > PAGE_SIZE
                  ? ` · mostrando ${PAGE_SIZE}`
                  : ''
              }`}
          {source ? ` · ${source.includes('digital') ? 'digital' : source === 'scan' ? 'disco' : 'seed'}` : ''}
        </span>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-700">{error}</p>
      )}
      {genMsg && (
        <p className="text-sm font-medium text-emerald-700">{genMsg}</p>
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
                <th className="px-4 py-3 font-semibold">Documento</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && pending.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-slate-500">
                    Escaneando órdenes de servicio…
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-slate-500">
                    {items.length === 0 && pending.length === 0 ? (
                      <>
                        Sin OS digitales ni PDFs. Genera una desde Cotizador
                        (cotización aceptada) o monta{' '}
                        <code className="text-xs">
                          I:\Mi unidad\Eventos\Ordenes de servicio
                        </code>
                        .
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
                visible.map((row) => {
                  if (row.kind === 'pending') {
                    const p = row.item;
                    const cancelled = Boolean(p.cancelled);
                    const anticipoSinOs = isAnticipoSinOs({
                      has_anticipo: p.has_anticipo,
                      os_path: null,
                      digital_os_id: null,
                      status: cancelled ? 'cancelado' : null,
                    });
                    const strike = cancelled
                      ? 'text-slate-500 line-through'
                      : '';
                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-dashed ${
                          cancelled
                            ? 'border-rose-100 bg-rose-50/40'
                            : anticipoSinOs
                              ? 'border-amber-200 bg-amber-50/70'
                              : 'border-slate-200 bg-slate-50/80'
                        }`}
                      >
                        <td
                          className={`whitespace-nowrap px-4 py-2.5 font-medium ${
                            cancelled ? strike : 'text-slate-700'
                          }`}
                        >
                          {formatWhen(p.event_date, 0, true)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-2.5 ${
                            cancelled ? strike : 'text-slate-500'
                          }`}
                        >
                          {p.event_date.slice(0, 4)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <span
                            className={`font-medium ${
                              cancelled ? strike : ''
                            }`}
                          >
                            {p.title}
                          </span>
                          {p.client &&
                            clientKey(p.client) !== clientKey(p.title) && (
                              <span
                                className={`mt-0.5 block text-xs ${
                                  cancelled
                                    ? 'text-slate-400 line-through'
                                    : 'text-slate-500'
                                }`}
                              >
                                {p.client}
                              </span>
                            )}
                          {cancelled && (
                            <span className="mt-1 inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800 no-underline">
                              Cancelado
                            </span>
                          )}
                          {anticipoSinOs && (
                            <span
                              className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900"
                              title="Hay anticipo registrado pero aún no hay orden de servicio"
                            >
                              <span
                                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600"
                                aria-hidden
                              />
                              Anticipo sin OS
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-2.5 ${
                            cancelled ? strike : 'text-slate-400'
                          }`}
                        >
                          —
                        </td>
                        <td
                          className={`px-4 py-2.5 text-xs ${
                            cancelled ? strike : 'text-slate-500'
                          }`}
                        >
                          {p.source_label}
                        </td>
                        <td className="px-4 py-2.5">
                          {p.quote_id || p.lead_id ? (
                            canEdit ? (
                              <button
                                type="button"
                                disabled={genBusy === p.id || cancelled}
                                onClick={() => void generateOs(p)}
                                className="inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
                                style={{ backgroundColor: SUITE.navy }}
                                title={
                                  cancelled
                                    ? 'Evento cancelado'
                                    : 'Crea OS digital, marca cotización aceptada y lead ganado'
                                }
                              >
                                {genBusy === p.id ? 'Generando…' : 'Generar OS'}
                              </button>
                            ) : (
                              <a
                                href={
                                  p.quote_id
                                    ? `/eventos/cotizacion/${p.quote_id}`
                                    : '/eventos'
                                }
                                className="inline-flex rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                              >
                                Ver cotización
                              </a>
                            )
                          ) : (
                            <span
                              className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${
                                cancelled
                                  ? 'bg-rose-100 text-rose-800'
                                  : anticipoSinOs
                                    ? 'border border-amber-300 bg-amber-50 text-amber-900'
                                    : 'bg-amber-50 text-amber-900'
                              }`}
                              title={
                                cancelled
                                  ? 'Evento cancelado'
                                  : anticipoSinOs
                                    ? 'Anticipo registrado; falta generar o vincular la OS'
                                    : 'Visible en Calendario; aún no hay OS digital ni PDF'
                              }
                            >
                              {cancelled
                                ? 'Cancelado'
                                : anticipoSinOs
                                  ? 'Anticipo sin OS'
                                  : 'Sin OS / pendiente'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  }

                  const it = row.item;
                  const cancelled = Boolean(it.cancelled);
                  const strike = cancelled
                    ? 'text-slate-500 line-through'
                    : '';
                  return (
                    <tr
                      key={it.id}
                      className={`border-t hover:bg-slate-50 ${
                        cancelled
                          ? 'border-rose-100 bg-rose-50/30'
                          : 'border-slate-100'
                      }`}
                    >
                      <td
                        className={`whitespace-nowrap px-4 py-2.5 font-medium ${
                          cancelled ? strike : 'text-slate-800'
                        }`}
                      >
                        {formatWhen(
                          it.event_date,
                          it.mtimeMs,
                          Boolean(it.event_date)
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-2.5 ${
                          cancelled ? strike : 'text-slate-600'
                        }`}
                      >
                        {it.year ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-800">
                        <span className={cancelled ? strike : undefined}>
                          {it.label ||
                            (it.folio
                              ? `OS ${it.folio}`
                              : 'Sin nombre en archivo')}
                        </span>
                        {it.kind === 'digital' && it.pax != null && (
                          <span
                            className={`mt-0.5 block text-xs ${
                              cancelled
                                ? 'text-slate-400 line-through'
                                : 'text-slate-500'
                            }`}
                          >
                            {it.pax} pax
                            {it.celebration ? ` · ${it.celebration}` : ''}
                          </span>
                        )}
                        {cancelled && (
                          <span className="mt-1 inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800 no-underline">
                            Cancelado
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 ${
                          cancelled ? strike : 'text-slate-600'
                        }`}
                      >
                        {it.folio || '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-xs ${
                          cancelled ? strike : 'text-slate-500'
                        }`}
                      >
                        {it.matched_client_name ? (
                          <span
                            className={`font-semibold ${
                              cancelled ? '' : 'text-slate-700'
                            }`}
                          >
                            {it.matched_client_name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {it.kind === 'digital' && it.digital_id ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <DocChip
                              href={`/eventos/os/${it.digital_id}`}
                              label="Consultar"
                              title={
                                cancelled
                                  ? 'Consultar OS (evento cancelado)'
                                  : 'Abrir orden de servicio digital'
                              }
                            />
                            <DocChip
                              href={`/eventos/os/${it.digital_id}?print=1`}
                              label="Descargar"
                              title="Abrir diálogo para guardar PDF"
                              primary
                            />
                          </div>
                        ) : (() => {
                          const urls = pdfOpenUrls(it);
                          if (urls) {
                            return (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <DocChip
                                  href={urls.view}
                                  label="Consultar"
                                  title={
                                    cancelled
                                      ? 'Consultar OS (evento cancelado)'
                                      : it.storage_path
                                        ? it.filename || 'Ver PDF (BMS Storage)'
                                        : it.filename ||
                                          'Ver PDF (abre desde BMS; sync si falta)'
                                  }
                                />
                                <DocChip
                                  href={urls.download}
                                  label="Descargar"
                                  title={it.filename || 'Descargar PDF'}
                                  primary
                                  download={
                                    it.filename || 'orden-de-servicio.pdf'
                                  }
                                />
                              </div>
                            );
                          }
                          return (
                            <span
                              className="text-xs text-slate-500"
                              title="Sin archivo en BMS: falta rel_path o sync de PDF"
                            >
                              Solo índice
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })                })
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
              Mostrar más ({tableRows.length - PAGE_SIZE} restantes)
            </button>
          </div>
        )}
      </SuiteCard>
    </div>
  );
}
