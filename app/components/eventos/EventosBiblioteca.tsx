'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { EventosPoliticaModal } from '@/app/components/eventos/EventosPoliticaModal';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  resolvePoliticaDocId,
  type PoliticaDocId,
} from '@/app/lib/eventos-politicas-content';

const theme = getTheme('suite');

type BibliotecaCategory =
  | 'alimentos'
  | 'bebidas'
  | 'politicas'
  | 'manuales'
  | 'publicidad';

type BibliotecaItem = {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  category: BibliotecaCategory;
  path: string;
  rel_path: string;
  ext: string;
  mtimeMs: number;
  openable: boolean;
  source: 'scan' | 'seed';
  sortOrder: number;
};

type CategoryFilter = 'all' | BibliotecaCategory;

const CATEGORY_LABEL: Record<BibliotecaCategory, string> = {
  alimentos: 'Menús de alimentos',
  bebidas: 'Bebidas / barra libre',
  politicas: 'Políticas y contrato',
  manuales: 'Manuales',
  publicidad: 'Publicidad',
};

const CATEGORY_ORDER: BibliotecaCategory[] = [
  'manuales',
  'alimentos',
  'bebidas',
  'politicas',
  'publicidad',
];

function isFeaturedDoc(it: BibliotecaItem) {
  return (
    it.category === 'manuales' &&
    /manual de seguimiento/i.test(it.name || it.filename)
  );
}

/** Página in-app del Manual de seguimiento (no el .docx crudo). */
export const MANUAL_SEGUIMIENTO_HREF = '/eventos/manual-seguimiento';

function openUrl(filePath: string) {
  return `/api/eventos/biblioteca?open=${encodeURIComponent(filePath)}`;
}

function formatMtime(mtimeMs: number) {
  if (!mtimeMs) return null;
  try {
    return new Date(mtimeMs).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function extBadge(ext: string) {
  return (ext || '').replace(/^\./, '').toUpperCase() || 'DOC';
}

export function EventosBiblioteca() {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<BibliotecaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [rootExists, setRootExists] = useState(false);
  const [root, setRoot] = useState('');
  const [menusRoot, setMenusRoot] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [politicaOpen, setPoliticaOpen] = useState<{
    docId: PoliticaDocId;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      const res = await fetch(`/api/eventos/biblioteca?${params}`, {
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
      setRoot(json.root || '');
      setMenusRoot(json.menusRoot || '');
      setNote(json.note || null);
    } catch {
      setError('No se pudo cargar la biblioteca');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), query ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);

  const counts = useMemo(() => {
    const by: Record<BibliotecaCategory, number> = {
      alimentos: 0,
      bebidas: 0,
      politicas: 0,
      manuales: 0,
      publicidad: 0,
    };
    for (const it of items) {
      by[it.category] = (by[it.category] || 0) + 1;
    }
    return { ...by, total: items.length };
  }, [items]);

  const filtered = useMemo(
    () =>
      category === 'all'
        ? items
        : items.filter((it) => it.category === category),
    [items, category]
  );

  const groups = useMemo(() => {
    const map = new Map<BibliotecaCategory, BibliotecaItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const it of filtered) {
      const list = map.get(it.category);
      if (list) list.push(it);
      else map.set(it.category, [it]);
    }
    return CATEGORY_ORDER.filter((cat) => (map.get(cat)?.length ?? 0) > 0).map(
      (cat) => {
        const items = [...(map.get(cat) || [])].sort((a, b) => {
          const fa = isFeaturedDoc(a) ? 0 : 1;
          const fb = isFeaturedDoc(b) ? 0 : 1;
          if (fa !== fb) return fa - fb;
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name, 'es');
        });
        return {
          category: cat,
          label: CATEGORY_LABEL[cat],
          items,
        };
      }
    );
  }, [filtered]);

  const tabs: { id: CategoryFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Todos', count: counts.total },
    { id: 'manuales', label: 'Manuales', count: counts.manuales },
    { id: 'alimentos', label: 'Alimentos', count: counts.alimentos },
    { id: 'bebidas', label: 'Bebidas', count: counts.bebidas },
    { id: 'politicas', label: 'Políticas', count: counts.politicas },
    { id: 'publicidad', label: 'Publicidad', count: counts.publicidad },
  ];

  const canOpen = source === 'scan';

  return (
    <div className="space-y-5">
      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: theme.title }}>
          Biblioteca de menús y políticas
        </h3>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>
          Documentos vigentes para consulta rápida. Manual de seguimiento y
          políticas se abren en pantalla; menús y PDFs usan Abrir.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {rootExists
            ? `Fuente local: ${menusRoot || 'Eventos/Menús'}`
            : source === 'seed'
              ? 'Catálogo en servidor (manual y políticas in-app)'
              : 'Biblioteca Eventos'}
        </p>
        {note && source !== 'seed' ? (
          <p className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
            {note}
          </p>
        ) : null}
      </SuiteCard>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = category === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setCategory(t.id)}
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
            placeholder="Menú, política, archivo…"
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
            : `${filtered.length} doc${filtered.length === 1 ? '' : 's'}`}
          {source
            ? ` · ${source === 'scan' ? 'disco' : 'seed'}`
            : ''}
        </span>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-700">{error}</p>
      )}

      {loading && items.length === 0 ? (
        <SuiteCard>
          <p className="text-sm text-slate-500">Escaneando biblioteca…</p>
        </SuiteCard>
      ) : filtered.length === 0 ? (
        <SuiteCard>
          <p className="text-sm text-slate-500">
            {items.length === 0 ? (
              <>
                Sin documentos. Monta{' '}
                <code className="text-xs">
                  I:\Mi unidad\Eventos\Menús\Menús eventos vigentes
                </code>
                .
              </>
            ) : (
              'Sin documentos en esta categoría con la búsqueda actual.'
            )}
          </p>
        </SuiteCard>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.category} className="space-y-3">
              <div className="flex items-baseline gap-2 px-0.5">
                <h4
                  className="text-sm font-bold tracking-wide"
                  style={{ color: theme.title }}
                >
                  {group.label}
                </h4>
                <span className="text-xs text-slate-400">
                  {group.items.length}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.items.map((it) => {
                  const featured = isFeaturedDoc(it);
                  const politicaId = featured
                    ? null
                    : resolvePoliticaDocId({
                        filename: it.filename,
                        name: it.name,
                        category: it.category,
                      });
                  const showManualOpen = featured;
                  const showFileOpen =
                    !featured &&
                    !politicaId &&
                    canOpen &&
                    it.openable &&
                    it.source === 'scan' &&
                    Boolean(it.path);
                  const updated = formatMtime(it.mtimeMs);
                  const hasOpenAction =
                    showManualOpen || Boolean(politicaId) || showFileOpen;
                  return (
                    <article
                      key={it.id}
                      className={`flex flex-col rounded-[20px] p-4 ${
                        featured
                          ? 'bg-gradient-to-br from-orange-50/90 to-white'
                          : 'bg-white'
                      }`}
                      style={{
                        boxShadow: SUITE.shadow,
                        ...(featured
                          ? {
                              border: `1px solid ${SUITE.orangeDeep}33`,
                            }
                          : {}),
                      }}
                    >
                      {featured ? (
                        <p
                          className="mb-2 text-[11px] font-bold uppercase tracking-wide"
                          style={{ color: SUITE.orangeDeep }}
                        >
                          Empieza aquí
                        </p>
                      ) : null}
                      <div className="flex items-start justify-between gap-2">
                        <h5
                          className="text-[15px] font-bold leading-snug"
                          style={{ color: theme.title }}
                        >
                          {it.name}
                        </h5>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          {featured
                            ? 'GUÍA'
                            : politicaId
                              ? 'TEXTO'
                              : extBadge(it.ext)}
                        </span>
                      </div>
                      {it.description ? (
                        <p className="mt-1.5 text-sm leading-snug text-slate-500">
                          {it.description}
                        </p>
                      ) : null}
                      <p
                        className="mt-2 truncate text-[11px] text-slate-400"
                        title={it.filename}
                      >
                        {it.filename}
                        {updated ? ` · ${updated}` : ''}
                      </p>
                      {hasOpenAction ? (
                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                          {showManualOpen ? (
                            <a
                              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                              style={{ backgroundColor: SUITE.orangeDeep }}
                              href={MANUAL_SEGUIMIENTO_HREF}
                            >
                              Abrir
                            </a>
                          ) : null}
                          {politicaId ? (
                            <button
                              type="button"
                              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                              style={{ backgroundColor: SUITE.orangeDeep }}
                              onClick={() =>
                                setPoliticaOpen({ docId: politicaId })
                              }
                            >
                              Abrir
                            </button>
                          ) : null}
                          {showFileOpen ? (
                            <a
                              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                              style={{ backgroundColor: SUITE.orangeDeep }}
                              href={openUrl(it.path)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {politicaOpen ? (
        <EventosPoliticaModal
          docId={politicaOpen.docId}
          onClose={() => setPoliticaOpen(null)}
        />
      ) : null}
    </div>
  );
}
