'use client';

import { useCallback, useEffect, useState } from 'react';
import { getTheme, SUITE } from '@/app/lib/themes';
import type { HrDocTypeId } from '@/app/lib/hr-employee-profile';

const theme = getTheme('suite');

type ReviewChoice = { id: HrDocTypeId; label: string };

type ReviewItem = {
  id: string;
  storagePath: string;
  pageIndex: number;
  pageCount: number;
  currentSlots: HrDocTypeId[];
  suggested: HrDocTypeId | null;
  uncertain: boolean;
  reasons: string[];
  previewMime: string | null;
  previewDataUrl: string | null;
  viewUrl: string | null;
};

type QueuePayload = {
  ready?: boolean;
  error?: string;
  hint?: string;
  message?: string;
  mode?: 'uncertain' | 'all';
  items?: ReviewItem[];
  uncertainCount?: number;
  totalPages?: number;
  choices?: ReviewChoice[];
};

const SLOT_LABEL: Record<string, string> = {
  ine: 'INE',
  acta_nacimiento: 'Acta',
  curp: 'CURP',
  comprobante_domicilio: 'Domicilio',
  cv: 'CV',
};

export function RrhhDocsReview({
  employeeId,
  onClose,
  onChanged,
}: {
  employeeId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [mode, setMode] = useState<'uncertain' | 'all'>('uncertain');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [choices, setChoices] = useState<ReviewChoice[]>([]);
  const [cursor, setCursor] = useState(0);
  const [emptyMsg, setEmptyMsg] = useState('');

  const load = useCallback(async (m: 'uncertain' | 'all') => {
    setLoading(true);
    setError('');
    setHint('');
    setToast('');
    setEmptyMsg('');
    try {
      const res = await fetch(
        `/api/hr/employees/${employeeId}/docs-review?mode=${m}`,
        { cache: 'no-store' }
      );
      const json = (await res.json()) as QueuePayload;
      if (!res.ok) {
        setError(json.error || 'No se pudo cargar la cola');
        setHint(json.hint || '');
        setItems([]);
        return;
      }
      const list = json.items || [];
      setItems(list);
      setChoices(json.choices || []);
      setCursor(0);
      if (!list.length) {
        setEmptyMsg(
          json.message ||
            (m === 'uncertain'
              ? 'No hay páginas dudosas'
              : 'Sin páginas para revisar')
        );
      }
    } catch {
      setError('Error de red');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load(mode);
  }, [load, mode]);

  const current = items[cursor] || null;
  const remaining = Math.max(0, items.length - cursor);

  async function answer(ans: string) {
    if (!current || busy) return;
    setBusy(true);
    setToast('');
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/docs-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath: current.storagePath,
          pageIndex: current.pageIndex,
          answer: ans,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo guardar');
        return;
      }
      setToast(json.message || 'Listo');
      if (ans !== 'omit' && ans !== 'ignore') {
        onChanged?.();
      }
      const next = cursor + 1;
      if (next >= items.length) {
        setCursor(next);
        setEmptyMsg('Cola terminada · gracias');
        onChanged?.();
      } else {
        setCursor(next);
      }
    } catch {
      setToast('Error de red');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Revisar documentos"
    >
      <div
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        style={{ border: `1px solid ${SUITE.orangeSoft}` }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
              Revisar documentos
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              ¿Qué es este documento? · confirma el tipo de cada página dudosa
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Cerrar
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-50 px-4 py-2">
          <button
            type="button"
            disabled={loading || busy}
            className="rounded-full px-3 py-1 text-[11px] font-bold disabled:opacity-50"
            style={{
              backgroundColor:
                mode === 'uncertain' ? SUITE.orangeSoft : '#f8fafc',
              color: SUITE.navy,
            }}
            onClick={() => setMode('uncertain')}
          >
            Solo dudosas
          </button>
          <button
            type="button"
            disabled={loading || busy}
            className="rounded-full px-3 py-1 text-[11px] font-bold disabled:opacity-50"
            style={{
              backgroundColor: mode === 'all' ? SUITE.orangeSoft : '#f8fafc',
              color: SUITE.navy,
            }}
            onClick={() => setMode('all')}
          >
            Revisar todas
          </button>
          <button
            type="button"
            disabled={loading || busy}
            className="ml-auto rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
            onClick={() => void load(mode)}
          >
            Recargar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {toast ? (
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {toast}
            </p>
          ) : null}
          {error ? (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">{error}</p>
              {hint ? <p className="mt-1 text-xs">{hint}</p> : null}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-500">Armando cola de páginas…</p>
          ) : !current ? (
            <p className="text-sm text-slate-600">
              {emptyMsg || 'Nada pendiente'}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p
                  className="text-sm font-semibold"
                  style={{ color: theme.title }}
                >
                  Página {current.pageIndex + 1} de {current.pageCount}
                  {current.uncertain ? (
                    <span className="ml-2 text-[11px] font-bold text-amber-800">
                      dudosa
                    </span>
                  ) : null}
                </p>
                <p className="text-[11px] text-slate-500">
                  {cursor + 1} / {items.length}
                  {remaining > 1 ? ` · quedan ${remaining - 1}` : ''}
                </p>
              </div>

              {current.reasons.length ? (
                <p className="text-[11px] text-slate-500">
                  {current.reasons.join(' · ')}
                </p>
              ) : null}

              <p className="text-[11px] text-slate-500">
                Ahora en checklist:{' '}
                {current.currentSlots.length
                  ? current.currentSlots
                      .map((s) => SLOT_LABEL[s] || s)
                      .join(', ')
                  : '—'}
                {current.suggested
                  ? ` · sugerido: ${SLOT_LABEL[current.suggested] || current.suggested}`
                  : ''}
              </p>

              <div
                className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                style={{ minHeight: 280 }}
              >
                {current.previewDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={current.previewDataUrl}
                    alt={`Vista previa página ${current.pageIndex + 1}`}
                    className="mx-auto max-h-[52vh] w-auto object-contain"
                  />
                ) : current.viewUrl ? (
                  <iframe
                    title={`PDF página ${current.pageIndex + 1}`}
                    src={`${current.viewUrl}#page=${current.pageIndex + 1}`}
                    className="h-[52vh] w-full border-0 bg-white"
                  />
                ) : (
                  <p className="p-6 text-center text-xs text-slate-400">
                    Sin vista previa · abre el archivo desde el checklist
                  </p>
                )}
              </div>

              <div>
                <p
                  className="mb-2 text-sm font-bold"
                  style={{ color: SUITE.navy }}
                >
                  ¿Qué es este documento?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {choices.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      className="rounded-full px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      style={{
                        backgroundColor:
                          current.suggested === c.id
                            ? '#0f766e'
                            : SUITE.navy,
                      }}
                      onClick={() => void answer(c.id)}
                    >
                      {c.label}
                      {current.suggested === c.id ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                    onClick={() => void answer('omit')}
                  >
                    Omitir
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-900 disabled:opacity-50"
                    onClick={() => void answer('ignore')}
                  >
                    No es documento de alta
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
