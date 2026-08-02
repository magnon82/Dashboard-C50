'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventosOrdenServicioDocument } from '@/app/components/eventos/EventosOrdenServicioDocument';
import {
  serviceOrderToDoc,
  type OrdenServicioDoc,
} from '@/app/lib/eventos-os-doc';
import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderRow,
} from '@/app/lib/eventos-service-order';
import { useSession } from '@/app/lib/useSession';
import { SUITE } from '@/app/lib/themes';

const STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  en_curso: 'En curso',
  cerrada: 'Cerrada',
};

export default function OrdenServicioByIdPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [doc, setDoc] = useState<OrdenServicioDoc | null>(null);
  const [order, setOrder] = useState<ServiceOrderRow | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/eventos/os/${id}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo cargar la OS');
        setHint(json.hint || '');
        return;
      }
      const row = json.order as ServiceOrderRow;
      setOrder(row);
      setDoc(serviceOrderToDoc(row));
      setQuoteId(row.quote_id);
      setErr('');
      setHint('');
    } catch {
      setErr('Error de red al cargar la OS');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patchStatus(status: string) {
    if (!canEdit || !id) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch(`/api/eventos/os/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo actualizar estado');
        return;
      }
      const row = json.order as ServiceOrderRow;
      setOrder(row);
      setDoc(serviceOrderToDoc(row));
      setMsg(`Estado → ${STATUS_LABELS[status] || status}`);
    } catch {
      setErr('Error de red al actualizar');
    } finally {
      setBusy(false);
    }
  }

  async function refreshFromQuote() {
    if (!canEdit || !quoteId) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch('/api/eventos/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quoteId, refresh: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(
          [json.error, json.hint].filter(Boolean).join(' — ') ||
            'No se pudo refrescar'
        );
        return;
      }
      setMsg('OS actualizada desde la cotización');
      await load();
    } catch {
      setErr('Error de red al refrescar');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="px-4 py-16 text-center text-sm text-slate-500">
        Cargando orden de servicio…
      </p>
    );
  }

  if (err || !doc) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium" style={{ color: SUITE.navy }}>
          {err || 'OS no encontrada'}
        </p>
        {hint && (
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            {hint}
          </p>
        )}
        <a
          href="/eventos"
          className="mt-4 inline-block text-sm font-semibold"
          style={{ color: SUITE.orangeDeep }}
        >
          Ir a Eventos
        </a>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: SUITE.pageBg, minHeight: '100vh' }}>
      {(canEdit || msg || err) && (
        <div className="mx-auto flex max-w-[820px] flex-wrap items-center gap-2 px-4 pt-6 print:hidden">
          {canEdit && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Estado
              <select
                value={order?.status || doc.status || 'emitida'}
                disabled={busy}
                onChange={(e) => void patchStatus(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-800"
              >
                {SERVICE_ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s] || s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canEdit && quoteId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void refreshFromQuote()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Refrescar desde cotización
            </button>
          )}
          {msg && <p className="text-xs font-medium text-emerald-700">{msg}</p>}
          {err && <p className="text-xs font-medium text-red-700">{err}</p>}
        </div>
      )}
      <EventosOrdenServicioDocument
        doc={doc}
        quoteHref={quoteId ? `/eventos/cotizacion/${quoteId}` : null}
      />
    </div>
  );
}
