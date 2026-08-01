'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { filterControlClass, filterSelectClass } from '@/app/components/SectionHeader';
import type { CalendarEventItem, CalendarSource } from '@/app/lib/eventos-calendario';
import { daysUntilEvent } from '@/app/lib/eventos';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');
const PAGE_SIZE = 20;

const SOURCE_STYLE: Record<
  CalendarSource,
  { bg: string; color: string; label: string }
> = {
  crm: { bg: SUITE.orangeSoft, color: SUITE.orangeDeep, label: 'CRM' },
  os: { bg: '#E8EEF8', color: SUITE.navy, label: 'OS' },
  activity: { bg: '#F3F4F6', color: '#475569', label: 'Actividad' },
};

function formatEventDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function daysLabel(iso: string): string {
  const d = daysUntilEvent(iso);
  if (d === null) return '';
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  return `En ${d} días`;
}

function osOpenUrl(filePath: string) {
  return `/api/eventos/os?open=${encodeURIComponent(filePath)}`;
}

function ActionChip({
  href,
  label,
  disabled,
  disabledLabel,
  title,
}: {
  href?: string | null;
  label: string;
  disabled?: boolean;
  disabledLabel: string;
  title?: string;
}) {
  if (disabled || !href) {
    return (
      <span
        className="inline-flex cursor-default items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-400"
        title={title || disabledLabel}
      >
        {disabledLabel}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-slate-50"
      style={{ color: SUITE.navy }}
      title={title}
    >
      {label}
    </a>
  );
}

export function EventosCalendario() {
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [today, setToday] = useState<string>('');
  const [sources, setSources] = useState({
    activity: false,
    os: false,
    crm: false,
  });
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | CalendarSource>(
    'all'
  );
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/eventos/calendario', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`);
        setEvents([]);
        return;
      }
      setEvents(json.events || []);
      setToday(json.today || '');
      setSources(
        json.sources || { activity: false, os: false, crm: false }
      );
      setNote(json.note || null);
      if (json.error) setError(json.error);
    } catch {
      setError('No se pudo cargar el calendario local');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setShowAll(false);
  }, [query, sourceFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((ev) => {
      if (sourceFilter !== 'all' && ev.source !== sourceFilter) return false;
      if (!q) return true;
      const hay = [ev.title, ev.client, ev.source_label, ev.detail, ev.event_date]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [events, query, sourceFilter]);

  const visible = useMemo(
    () => (showAll ? filtered : filtered.slice(0, PAGE_SIZE)),
    [filtered, showAll]
  );
  const hasMore = filtered.length > PAGE_SIZE && !showAll;

  const sourceTabs: { id: 'all' | CalendarSource; label: string; count: number }[] =
    [
      { id: 'all', label: 'Todas', count: events.length },
      {
        id: 'crm',
        label: 'CRM',
        count: events.filter((e) => e.source === 'crm').length,
      },
      {
        id: 'os',
        label: 'OS',
        count: events.filter((e) => e.source === 'os').length,
      },
      {
        id: 'activity',
        label: 'Actividad',
        count: events.filter((e) => e.source === 'activity').length,
      },
    ];

  return (
    <div className="space-y-5">
      <SuiteCard accent>
        <h3 className="text-xl font-bold" style={{ color: theme.title }}>
          Calendario compartido
        </h3>
        <p
          className="mt-2 text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Horario local CDMX
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Próximas fechas desde actividad (Sheets/seed), órdenes de servicio y
          leads CRM. No se muestran eventos pasados.
        </p>
        <p className="mt-2 text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
          {note ||
            'Google Calendar sync: próximo — un calendario compartido, hold 72 h hábiles (sin hold si faltan &lt;15 días).'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Fuentes:{' '}
          {[
            sources.activity ? 'seed actividad' : null,
            sources.os ? 'OS' : null,
            sources.crm ? 'CRM' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'ninguna aún'}
          {today ? ` · hoy ${today}` : ''}
        </p>
      </SuiteCard>

      <div className="flex flex-wrap gap-2">
        {sourceTabs.map((t) => {
          const active = sourceFilter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSourceFilter(t.id)}
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
        <label className={`${filterControlClass} bg-white`}>
          <span className="text-slate-500">Buscar</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${filterSelectClass} min-w-[200px]`}
            placeholder="Cliente, evento, fuente…"
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
            : `${filtered.length} próximas${
                !showAll && filtered.length > PAGE_SIZE
                  ? ` · mostrando ${PAGE_SIZE}`
                  : ''
              }`}
        </span>
      </div>

      {error && (
        <p className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {loading && events.length === 0 ? (
        <SuiteCard>
          <p className="text-sm text-slate-500">Armando próximas fechas…</p>
        </SuiteCard>
      ) : filtered.length === 0 ? (
        <SuiteCard>
          <p className="text-sm" style={{ color: theme.muted }}>
            {events.length === 0
              ? 'Sin eventos futuros en seed, OS ni CRM. Crea un lead con fecha o regenera el seed de actividad.'
              : 'Sin resultados con los filtros actuales.'}
          </p>
        </SuiteCard>
      ) : (
        <ul className="space-y-3">
          {visible.map((ev) => {
            const badge = SOURCE_STYLE[ev.source];
            const showClient =
              ev.client &&
              ev.client.trim().toLowerCase() !==
                ev.title.trim().toLowerCase();
            return (
              <li key={ev.id}>
                <div
                  className="flex flex-col gap-3 rounded-[20px] bg-white p-4 sm:flex-row sm:items-stretch sm:gap-4"
                  style={{
                    boxShadow: SUITE.shadow,
                    borderLeft: `4px solid ${
                      ev.source === 'crm' ? SUITE.orange : SUITE.navy
                    }`,
                  }}
                >
                  <div
                    className="flex shrink-0 flex-col justify-center rounded-2xl px-4 py-3 text-center sm:w-[132px]"
                    style={{ backgroundColor: SUITE.navy }}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-white/70">
                      {daysLabel(ev.event_date)}
                    </p>
                    <p
                      className="mt-1 text-sm font-bold leading-snug"
                      style={{ color: SUITE.orange }}
                    >
                      {formatEventDate(ev.event_date)}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4
                        className="text-base font-bold"
                        style={{ color: theme.title }}
                      >
                        {ev.title}
                      </h4>
                      <span
                        className="rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: badge.bg,
                          color: badge.color,
                        }}
                        title={ev.source_label}
                      >
                        {ev.source_label}
                      </span>
                    </div>
                    {showClient && (
                      <p className="mt-1 text-sm text-slate-600">{ev.client}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      {ev.pax != null && (
                        <span className="font-semibold text-slate-700">
                          {ev.pax} pax
                        </span>
                      )}
                      {ev.detail && (
                        <span className="truncate" title={ev.detail}>
                          {ev.detail}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionChip
                        href={
                          ev.digital_os_id
                            ? `/eventos/os/${ev.digital_os_id}`
                            : ev.os_path
                              ? osOpenUrl(ev.os_path)
                              : null
                        }
                        label={ev.digital_os_id ? 'Ver OS' : 'Descargar OS'}
                        disabled={!ev.digital_os_id && !ev.os_path}
                        disabledLabel="Sin OS"
                        title={
                          ev.digital_os_id
                            ? 'Abrir orden de servicio digital'
                            : ev.os_path
                              ? ev.os_filename || 'Abrir PDF de orden de servicio'
                              : 'Sin OS digital ni PDF en Drive'
                        }
                      />
                      <ActionChip
                        href={
                          ev.quote_id
                            ? `/eventos/cotizacion/${ev.quote_id}`
                            : null
                        }
                        label="Ver cotización"
                        disabled={!ev.quote_id}
                        disabledLabel="Sin cotización"
                        title={
                          ev.quote_id
                            ? 'Abrir cotización de la plataforma'
                            : 'Aún no hay cotización guardada para este evento'
                        }
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded-xl px-3 py-2 text-sm font-bold text-white"
          style={{ backgroundColor: SUITE.navy }}
        >
          Mostrar más ({filtered.length - PAGE_SIZE} restantes)
        </button>
      )}

      <SuiteCard dark>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">
          Siguiente: Google Calendar
        </p>
        <p className="mt-2 text-sm text-white/90">
          Un calendario compartido (no uno por usuario) · hold 72 h hábiles ·
          sin hold si faltan &lt;15 días al evento · solo fechas futuras.
        </p>
      </SuiteCard>
    </div>
  );
}
