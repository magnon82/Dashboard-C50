'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

export type HrViewerTarget = {
  title: string;
  path: string;
  kind: 'file' | 'folder';
  preview: 'pdf' | 'docx' | 'download' | 'folder' | 'none';
  description?: string | null;
  driveUrl?: string | null;
  ext?: string | null;
  sizeLabel?: string | null;
  mtimeLabel?: string | null;
};

type BrowseItem = {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  ext: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
  preview: HrViewerTarget['preview'];
  openable: boolean;
};

function openUrl(filePath: string, download = false) {
  const q = new URLSearchParams({ open: filePath });
  if (download) q.set('download', '1');
  return `/api/hr/docs?${q}`;
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
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

function extBadge(ext: string | null | undefined, kind: string) {
  if (kind === 'folder') return 'CARPETA';
  return (ext || '').replace(/^\./, '').toUpperCase() || 'DOC';
}

export function HrDocViewer({
  target,
  onClose,
}: {
  target: HrViewerTarget;
  onClose: () => void;
}) {
  const [stack, setStack] = useState<HrViewerTarget[]>([target]);
  const current = stack[stack.length - 1]!;
  const [browseItems, setBrowseItems] = useState<BrowseItem[]>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [docxText, setDocxText] = useState<string | null>(null);
  const [docxTruncated, setDocxTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStack([target]);
  }, [target]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const loadFolder = useCallback(async (folderPath: string) => {
    setLoading(true);
    setError(null);
    setDocxText(null);
    try {
      const res = await fetch(
        `/api/hr/docs?browse=${encodeURIComponent(folderPath)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.code === 'local_fs_unavailable'
            ? 'Carpeta local no disponible en línea. Usa «Abrir en Drive».'
            : json.error || `Error ${res.status}`
        );
        setBrowseItems([]);
        return;
      }
      setBrowseItems(json.items || []);
      setBrowseParent(json.parent ?? null);
    } catch {
      setError('No se pudo listar la carpeta');
      setBrowseItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDocxText = useCallback(async (filePath: string) => {
    setLoading(true);
    setError(null);
    setBrowseItems([]);
    try {
      const res = await fetch(
        `/api/hr/docs?text=${encodeURIComponent(filePath)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.code === 'local_fs_unavailable'
            ? 'Documento local no disponible en línea. Usa «Abrir en Drive».'
            : json.error || `Error ${res.status}`
        );
        setDocxText(null);
        return;
      }
      setDocxText(json.text ?? null);
      setDocxTruncated(Boolean(json.truncated));
      if (!json.text && json.message) setError(json.message);
    } catch {
      setError('No se pudo leer el documento');
      setDocxText(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current.preview === 'folder' || current.kind === 'folder') {
      void loadFolder(current.path);
      return;
    }
    if (current.preview === 'docx') {
      void loadDocxText(current.path);
      return;
    }
    setBrowseItems([]);
    setDocxText(null);
    setError(null);
    setLoading(false);
  }, [current, loadFolder, loadDocxText]);

  const pushTarget = (next: HrViewerTarget) => {
    setStack((s) => [...s, next]);
  };

  const goBack = () => {
    if (stack.length > 1) {
      setStack((s) => s.slice(0, -1));
      return;
    }
    onClose();
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(current.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const isPdf = current.preview === 'pdf';
  const isDocx = current.preview === 'docx';
  const isFolder = current.preview === 'folder' || current.kind === 'folder';
  const canDownload =
    current.kind === 'file' &&
    (current.preview === 'pdf' ||
      current.preview === 'docx' ||
      current.preview === 'download');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hr-doc-viewer-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className={`relative z-10 flex w-full flex-col overflow-hidden rounded-t-[24px] bg-white sm:rounded-[24px] ${
          isPdf ? 'max-h-[94vh] max-w-5xl' : 'max-h-[92vh] max-w-2xl'
        }`}
        style={{ boxShadow: SUITE.shadow }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"
          style={{ backgroundColor: '#F8FAFC' }}
        >
          <div className="min-w-0">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: theme.muted }}
            >
              {current.description?.toLowerCase().includes('expediente')
                ? 'Expedientes · consulta'
                : 'Biblioteca RH · consulta'}
            </p>
            <h2
              id="hr-doc-viewer-title"
              className="mt-1 text-lg font-bold leading-snug"
              style={{ color: theme.title }}
            >
              {current.title}
            </h2>
            {current.description ? (
              <p className="mt-1 text-sm text-slate-500">{current.description}</p>
            ) : null}
            <p
              className="mt-1.5 truncate font-mono text-[11px] text-slate-400"
              title={current.path}
            >
              {current.path}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {extBadge(current.ext, current.kind)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5">
          {stack.length > 1 || isFolder ? (
            <button
              type="button"
              onClick={goBack}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← Volver
            </button>
          ) : null}
          {canDownload ? (
            <>
              <a
                href={openUrl(current.path, false)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white"
                style={{ backgroundColor: SUITE.orangeDeep }}
              >
                Abrir
              </a>
              <a
                href={openUrl(current.path, true)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Descargar
              </a>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void copyPath()}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {copied ? 'Ruta copiada' : 'Copiar ruta'}
          </button>
          {current.driveUrl ? (
            <a
              href={current.driveUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Abrir en Drive
            </a>
          ) : null}
          {(current.sizeLabel || current.mtimeLabel) && (
            <span className="ml-auto text-[11px] text-slate-400">
              {[current.sizeLabel, current.mtimeLabel].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : null}
          {error ? (
            <p className="mb-3 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              {error}
            </p>
          ) : null}

          {isPdf ? (
            <iframe
              title={current.title}
              src={openUrl(current.path)}
              className="h-[70vh] w-full rounded-xl border border-slate-200 bg-slate-50"
            />
          ) : null}

          {isDocx ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Vista de texto extraída del .docx (formato simplificado). Para el
                documento completo usa Abrir o Descargar.
              </p>
              {docxText ? (
                <pre
                  className="whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-relaxed text-slate-700"
                  style={{ fontFamily: 'inherit' }}
                >
                  {docxText}
                </pre>
              ) : !loading ? (
                <p className="text-sm text-slate-500">
                  Sin extracto disponible en este servidor.
                </p>
              ) : null}
              {docxTruncated ? (
                <p className="text-xs text-slate-400">
                  Extracto truncado · descarga el archivo para el texto completo.
                </p>
              ) : null}
            </div>
          ) : null}

          {isFolder ? (
            <div className="space-y-1">
              {browseParent && stack.length === 1 ? (
                <button
                  type="button"
                  className="mb-2 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  onClick={() =>
                    pushTarget({
                      title: browseParent.split(/[/\\]/).pop() || 'Carpeta',
                      path: browseParent,
                      kind: 'folder',
                      preview: 'folder',
                    })
                  }
                >
                  ↑ Carpeta superior
                </button>
              ) : null}
              {!loading && browseItems.length === 0 ? (
                <p className="text-sm text-slate-500">Carpeta vacía o sin archivos consultables.</p>
              ) : (
                browseItems.map((it) => {
                  const updated = formatMtime(it.mtimeMs);
                  return (
                    <button
                      key={it.path}
                      type="button"
                      disabled={!it.openable}
                      onClick={() => {
                        if (!it.openable) return;
                        pushTarget({
                          title: it.name,
                          path: it.path,
                          kind: it.kind,
                          preview: it.preview,
                          ext: it.ext,
                          sizeLabel:
                            it.kind === 'file'
                              ? formatBytes(it.sizeBytes)
                              : null,
                          mtimeLabel: updated,
                        });
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-40"
                    >
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {extBadge(it.ext, it.kind)}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-semibold"
                        style={{ color: theme.title }}
                      >
                        {it.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {it.kind === 'file'
                          ? formatBytes(it.sizeBytes)
                          : 'Abrir'}
                        {updated ? ` · ${updated}` : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}

          {!isPdf && !isDocx && !isFolder ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Este tipo de archivo se consulta descargándolo u abriéndolo en
                la app asociada (Excel, Word, etc.).
              </p>
              {canDownload ? (
                <a
                  href={openUrl(current.path, true)}
                  className="inline-flex rounded-lg px-3 py-2 text-sm font-bold text-white"
                  style={{ backgroundColor: SUITE.orangeDeep }}
                >
                  Descargar archivo
                </a>
              ) : (
                <p className="text-sm text-slate-500">
                  Archivo no disponible en este servidor. Copia la ruta y ábrela
                  en el Explorador si tienes Drive montado.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
