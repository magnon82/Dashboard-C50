'use client';

import { useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import {
  HrDocViewer,
  type HrViewerTarget,
} from '@/app/components/rrhh/HrDocViewer';
import { RrhhCulturaView } from '@/app/components/rrhh/RrhhCulturaView';
import {
  HR_DOC_CATEGORY_LABELS,
  isHrBibliotecaHiddenDoc,
  type HrDocCategory,
  type HrDocLink,
} from '@/app/lib/hr';
import {
  HR_CULTURA_FOLDER_PATH,
  isHrCulturaConsultDoc,
} from '@/app/lib/hr-cultura';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type DocEnriched = HrDocLink & {
  kind?: 'file' | 'folder' | 'missing' | 'unknown';
  ext?: string | null;
  exists?: boolean;
  mtimeMs?: number | null;
  sizeBytes?: number | null;
  preview?: 'pdf' | 'docx' | 'download' | 'folder' | 'none';
  openable?: boolean;
};

type Payload = {
  ready: boolean;
  source?: string;
  docs: DocEnriched[];
  message?: string;
  error?: string;
  root?: string;
  rootExists?: boolean;
};

type CategoryFilter = 'all' | HrDocCategory;

const CATEGORY_ORDER: HrDocCategory[] = [
  'cultura',
  'manuales',
  'politicas',
  'perfiles',
  'examenes',
  'otro',
];

function formatBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(mtimeMs: number | null | undefined): string | null {
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

function extBadge(doc: DocEnriched) {
  if (doc.kind === 'folder') return 'CARPETA';
  if (doc.preview === 'pdf') return 'PDF';
  if (doc.preview === 'docx') return 'DOCX';
  const ext = (doc.ext || '').replace(/^\./, '').toUpperCase();
  return ext || 'DOC';
}

function previewHint(doc: DocEnriched): string {
  if (isHrCulturaConsultDoc(doc)) return 'Consulta en pantalla';
  if (!doc.exists && doc.drive_url) return 'Abrir en Suite o Drive';
  if (!doc.exists) return 'Solo metadatos en servidor';
  switch (doc.preview) {
    case 'pdf':
      return 'Vista previa en pantalla';
    case 'docx':
      return 'Texto + descargar';
    case 'folder':
      return 'Explorar carpeta';
    case 'download':
      return 'Descargar / abrir';
    default:
      return 'Solo ruta';
  }
}

function toViewerTarget(doc: DocEnriched): HrViewerTarget | null {
  if (!doc.local_path) return null;
  const kind =
    doc.kind === 'folder' ? 'folder' : doc.kind === 'file' ? 'file' : 'file';
  const preview =
    doc.preview && doc.preview !== 'none'
      ? doc.preview
      : kind === 'folder'
        ? 'folder'
        : 'download';
  return {
    title: doc.title,
    path: doc.local_path,
    kind,
    preview,
    description: doc.description,
    driveUrl: doc.drive_url,
    ext: doc.ext,
    sizeLabel: formatBytes(doc.sizeBytes),
    mtimeLabel: formatMtime(doc.mtimeMs),
  };
}

export function RrhhBiblioteca({
  data,
  loading,
}: {
  data: Payload | null;
  loading: boolean;
}) {
  const docs = useMemo(
    () => (data?.docs ?? []).filter((d) => !isHrBibliotecaHiddenDoc(d)),
    [data?.docs]
  );
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [viewer, setViewer] = useState<HrViewerTarget | null>(null);
  const [culturaOpen, setCulturaOpen] = useState(false);
  const [culturaDoc, setCulturaDoc] = useState<DocEnriched | null>(null);

  const openCultura = (doc?: DocEnriched) => {
    setCulturaDoc(doc ?? null);
    setCulturaOpen(true);
  };

  const exploreCulturaFolder = () => {
    const folderDoc =
      culturaDoc?.kind === 'folder' && culturaDoc.local_path
        ? culturaDoc
        : docs.find(
            (d) =>
              d.category === 'cultura' &&
              d.kind === 'folder' &&
              d.local_path
          ) ?? null;
    const path = folderDoc?.local_path || HR_CULTURA_FOLDER_PATH;
    setCulturaOpen(false);
    setViewer({
      title: folderDoc?.title || 'Cultura organizacional',
      path,
      kind: 'folder',
      preview: 'folder',
      description: folderDoc?.description,
      driveUrl: folderDoc?.drive_url ?? culturaDoc?.drive_url,
    });
  };

  const counts = useMemo(() => {
    const by = Object.fromEntries(
      CATEGORY_ORDER.map((c) => [c, 0])
    ) as Record<HrDocCategory, number>;
    for (const d of docs) {
      const cat = d.category as HrDocCategory;
      if (cat in by) by[cat] += 1;
      else by.otro += 1;
    }
    return { ...by, total: docs.length };
  }, [docs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (category !== 'all' && d.category !== category) return false;
      if (!q) return true;
      const hay = [
        d.title,
        d.description || '',
        d.local_path || '',
        HR_DOC_CATEGORY_LABELS[d.category as HrDocCategory] || d.category,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [docs, category, query]);

  const groups = useMemo(() => {
    const map = new Map<HrDocCategory, DocEnriched[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const d of filtered) {
      const cat = (CATEGORY_ORDER.includes(d.category as HrDocCategory)
        ? d.category
        : 'otro') as HrDocCategory;
      map.get(cat)!.push(d);
    }
    return CATEGORY_ORDER.filter((cat) => (map.get(cat)?.length ?? 0) > 0).map(
      (cat) => ({
        category: cat,
        label: HR_DOC_CATEGORY_LABELS[cat],
        items: [...(map.get(cat) || [])].sort(
          (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'es')
        ),
      })
    );
  }, [filtered]);

  const tabs = (
    [
      { id: 'all' as const, label: 'Todos', count: counts.total },
      { id: 'cultura' as const, label: 'Cultura', count: counts.cultura },
      { id: 'manuales' as const, label: 'Manuales', count: counts.manuales },
      { id: 'politicas' as const, label: 'Políticas', count: counts.politicas },
      { id: 'perfiles' as const, label: 'Perfiles', count: counts.perfiles },
      { id: 'examenes' as const, label: 'Exámenes', count: counts.examenes },
    ] satisfies { id: CategoryFilter; label: string; count: number }[]
  ).filter((t) => t.id === 'all' || t.count > 0);

  return (
    <div className="space-y-5">
      {data?.error ||
      (data?.message && data?.source !== 'supabase' && !data?.ready) ? (
        <p
          className={`text-xs rounded-lg px-3 py-2 ${
            data?.ready
              ? 'text-slate-600 bg-slate-50 border border-slate-100'
              : 'text-amber-800 bg-amber-50'
          }`}
        >
          {data.error || data.message}
        </p>
      ) : null}

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
            placeholder="Política, manual, carpeta…"
          />
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {loading
            ? 'Cargando…'
            : `${filtered.length} doc${filtered.length === 1 ? '' : 's'}`}
          {data?.source
            ? ` · ${data.source === 'supabase' ? 'supabase' : 'defaults'}`
            : ''}
        </span>
      </div>

      {loading && docs.length === 0 ? (
        <SuiteCard>
          <p className="text-sm text-slate-500">Cargando biblioteca…</p>
        </SuiteCard>
      ) : filtered.length === 0 ? (
        <SuiteCard>
          <p className="text-sm text-slate-500">
            Sin documentos con este filtro o búsqueda.
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
                {group.items.map((doc) => {
                  const isCultura = isHrCulturaConsultDoc(doc);
                  const canConsultLocal =
                    Boolean(doc.local_path) &&
                    (doc.exists === true || Boolean(doc.drive_url)) &&
                    (doc.openable ||
                      doc.preview === 'folder' ||
                      doc.preview === 'pdf' ||
                      doc.preview === 'docx' ||
                      doc.preview === 'download');
                  const canConsult = isCultura || canConsultLocal;
                  const missingLocal =
                    !isCultura &&
                    !doc.drive_url &&
                    Boolean(doc.local_path) &&
                    doc.exists === false;
                  const updated = formatMtime(doc.mtimeMs);
                  const size = formatBytes(doc.sizeBytes);
                  const canExploreFolder =
                    Boolean(doc.local_path) &&
                    (doc.exists === true || Boolean(doc.drive_url)) &&
                    (doc.kind === 'folder' || doc.preview === 'folder');

                  return (
                    <article
                      key={doc.id}
                      className="flex flex-col rounded-[20px] bg-white p-4"
                      style={{ boxShadow: SUITE.shadow }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className="text-[10px] font-bold uppercase tracking-[0.14em]"
                          style={{ color: SUITE.orangeDeep }}
                        >
                          {HR_DOC_CATEGORY_LABELS[doc.category as HrDocCategory] ||
                            doc.category}
                        </p>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          {isCultura ? 'GUÍA' : extBadge(doc)}
                        </span>
                      </div>
                      <h5
                        className="mt-1.5 text-[15px] font-bold leading-snug"
                        style={{ color: theme.title }}
                      >
                        {doc.title}
                      </h5>
                      {doc.description ? (
                        <p className="mt-1.5 text-sm leading-snug text-slate-500">
                          {doc.description}
                        </p>
                      ) : null}
                      <p className="mt-2 text-[11px] text-slate-400">
                        {previewHint(doc)}
                        {!isCultura && size ? ` · ${size}` : ''}
                        {!isCultura && updated ? ` · ${updated}` : ''}
                      </p>
                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                        {canConsult ? (
                          <button
                            type="button"
                            className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                            style={{ backgroundColor: SUITE.orangeDeep }}
                            onClick={() => {
                              if (isCultura) {
                                openCultura(doc);
                                return;
                              }
                              const t = toViewerTarget(doc);
                              if (t) setViewer(t);
                            }}
                          >
                            Consultar
                          </button>
                        ) : null}
                        {canExploreFolder ? (
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              const t = toViewerTarget(doc);
                              if (t) setViewer(t);
                            }}
                          >
                            Abrir carpeta
                          </button>
                        ) : null}
                        {doc.drive_url ? (
                          <a
                            href={doc.drive_url}
                            target="_blank"
                            rel="noreferrer"
                            className={
                              canConsult
                                ? 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                                : 'rounded-lg px-3 py-1.5 text-xs font-bold text-white'
                            }
                            style={
                              canConsult
                                ? undefined
                                : { backgroundColor: SUITE.orangeDeep }
                            }
                          >
                            Abrir en Drive
                          </a>
                        ) : null}
                        {missingLocal ? (
                          <span className="text-xs font-semibold text-slate-500">
                            Solo metadatos
                          </span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {culturaOpen ? (
        <RrhhCulturaView
          onClose={() => {
            setCulturaOpen(false);
            setCulturaDoc(null);
          }}
          onExploreFolder={exploreCulturaFolder}
          folderPath={
            culturaDoc?.kind === 'folder'
              ? culturaDoc.local_path
              : HR_CULTURA_FOLDER_PATH
          }
          driveUrl={culturaDoc?.drive_url}
        />
      ) : null}

      {viewer ? (
        <HrDocViewer target={viewer} onClose={() => setViewer(null)} />
      ) : null}
    </div>
  );
}
