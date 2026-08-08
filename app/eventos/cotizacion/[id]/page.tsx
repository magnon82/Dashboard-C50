'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventosCotizacionDocument } from '@/app/components/eventos/EventosCotizacionDocument';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';
import {
  QUOTE_PAYMENT_METHOD_LABELS,
  browserPublicQuoteUrl,
  type QuotePaymentMethod,
} from '@/app/lib/eventos-quote-payment';
import { useSession } from '@/app/lib/useSession';
import { SUITE } from '@/app/lib/themes';

export default function CotizacionByIdPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [doc, setDoc] = useState<CotizacionDoc | null>(null);
  const [serviceOrderId, setServiceOrderId] = useState<string | null>(null);
  const [publicShareUrl, setPublicShareUrl] = useState<string | null>(null);
  const [paymentLinkDraft, setPaymentLinkDraft] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [perdidaOpen, setPerdidaOpen] = useState(false);
  const [perdidaNote, setPerdidaNote] = useState('');

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/eventos/quotes/${id}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo cargar la cotización');
        return;
      }
      const loaded = json.doc as CotizacionDoc;
      setDoc(loaded);
      setServiceOrderId(json.service_order_id || null);
      setPaymentLinkDraft(loaded.payment_link_url || '');
      const path =
        typeof json.public_path === 'string' ? json.public_path : null;
      setPublicShareUrl(path ? browserPublicQuoteUrl(path) : null);
      setErr('');
    } catch {
      setErr('Error de red al cargar la cotización');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function generateOs() {
    if (!canEdit || !id) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch('/api/eventos/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(
          [json.error, json.hint].filter(Boolean).join(' — ') ||
            'No se pudo generar OS'
        );
        return;
      }
      setServiceOrderId(json.order?.id || null);
      setMsg(
        json.created
          ? `OS ${json.order?.os_number || ''} generada`
          : `OS ${json.order?.os_number || ''} actualizada`
      );
      await load();
      if (json.href) {
        window.open(json.href, '_blank', 'noopener,noreferrer');
      }
    } catch {
      setErr('Error de red al generar OS');
    } finally {
      setBusy(false);
    }
  }

  async function savePaymentLink() {
    if (!canEdit || !id) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch(`/api/eventos/quotes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_link_url: paymentLinkDraft.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo guardar el link de pago');
        return;
      }
      setMsg('Link de pago guardado');
      await load();
    } catch {
      setErr('Error de red al guardar link de pago');
    } finally {
      setBusy(false);
    }
  }

  async function confirmClosePerdida() {
    if (!canEdit || !id) return;
    const note = perdidaNote.trim();
    if (!note) {
      setErr('Escribe el motivo para cerrar como perdida');
      return;
    }
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch(`/api/eventos/quotes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'perdida', perdida_note: note }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || 'No se pudo cerrar como perdida');
        return;
      }
      setMsg('Cotización marcada como perdida');
      setPerdidaOpen(false);
      setPerdidaNote('');
      await load();
    } catch {
      setErr('Error de red al cerrar como perdida');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="px-4 py-16 text-center text-sm text-slate-500">
        Cargando cotización…
      </p>
    );
  }

  if (err && !doc) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium" style={{ color: SUITE.navy }}>
          {err || 'Cotización no encontrada'}
        </p>
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

  if (!doc) return null;

  const payLabel =
    doc.payment_method &&
    (QUOTE_PAYMENT_METHOD_LABELS[
      doc.payment_method as QuotePaymentMethod
    ] ||
      doc.payment_method);
  const showPaymentLinkEditor =
    canEdit &&
    (doc.payment_method === 'tarjeta_link' ||
      doc.status === 'aceptada');
  const isPerdida = doc.status === 'perdida';
  const canMarkPerdida =
    canEdit &&
    !serviceOrderId &&
    !isPerdida &&
    doc.status !== 'aceptada';
  const canGenerateOs =
    canEdit &&
    !serviceOrderId &&
    !isPerdida &&
    doc.status !== 'rechazada' &&
    doc.status !== 'vencida';

  return (
    <div style={{ backgroundColor: SUITE.pageBg, minHeight: '100vh' }}>
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center gap-2 px-4 pt-6 print:hidden">
        {serviceOrderId ? (
          <a
            href={`/eventos/os/${serviceOrderId}`}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white"
            style={{ backgroundColor: SUITE.navy }}
          >
            Ver OS digital
          </a>
        ) : canGenerateOs ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void generateOs()}
            className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: SUITE.navy }}
          >
            {busy ? 'Generando…' : 'Aceptar y generar OS'}
          </button>
        ) : null}
        {canMarkPerdida ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPerdidaOpen(true);
              setPerdidaNote('');
              setErr('');
            }}
            className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50"
          >
            Cerrar perdida
          </button>
        ) : null}
        {msg && <p className="text-xs font-medium text-emerald-700">{msg}</p>}
        {err && <p className="text-xs font-medium text-red-700">{err}</p>}
      </div>

      {isPerdida ? (
        <div className="mx-auto max-w-[820px] px-4 pt-3 print:hidden">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
            <p className="font-semibold">
              Cotización perdida
              {doc.perdida_at
                ? ` · ${new Date(doc.perdida_at).toLocaleString('es-MX', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </p>
            {doc.perdida_note ? (
              <p className="mt-1 text-slate-700">Motivo: {doc.perdida_note}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {doc.status === 'aceptada' || doc.accepted_at ? (
        <div className="mx-auto max-w-[820px] px-4 pt-3 print:hidden">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
            <p className="font-semibold">
              Cotización aceptada
              {doc.accepted_at
                ? ` · ${new Date(doc.accepted_at).toLocaleString('es-MX', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : ''}
            </p>
            {payLabel ? (
              <p className="mt-1">Método de pago: {payLabel}</p>
            ) : null}
            {doc.client_accept_note ? (
              <p className="mt-1 text-slate-700">
                Nota del cliente: {doc.client_accept_note}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showPaymentLinkEditor ? (
        <div className="mx-auto max-w-[820px] px-4 pt-3 print:hidden">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <p className="font-semibold" style={{ color: SUITE.navy }}>
              Link de pago (tarjeta)
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Pega aquí el link de Stripe/MercadoPago u otro. El cliente lo
              verá en /c/… si eligió «Tarjeta por link de pago».
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="url"
                value={paymentLinkDraft}
                onChange={(e) => setPaymentLinkDraft(e.target.value)}
                placeholder="https://…"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void savePaymentLink()}
                className="rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: SUITE.navy }}
              >
                Guardar link
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <EventosCotizacionDocument doc={doc} shareUrl={publicShareUrl} />

      {perdidaOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cotizacion-detail-perdida-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/45"
            aria-label="Cerrar"
            disabled={busy}
            onClick={() => {
              if (!busy) setPerdidaOpen(false);
            }}
          />
          <div
            className="relative z-10 w-full max-w-md rounded-t-[24px] bg-white p-5 sm:rounded-[24px]"
            style={{ boxShadow: SUITE.shadow }}
          >
            <h4
              id="cotizacion-detail-perdida-title"
              className="text-base font-bold"
              style={{ color: SUITE.navy }}
            >
              Cerrar como perdida
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              {doc.quote_number || id.slice(0, 8)}
              {doc.client_name ? ` · ${doc.client_name}` : ''}
            </p>
            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Motivo (obligatorio)
              <textarea
                value={perdidaNote}
                onChange={(e) => setPerdidaNote(e.target.value)}
                rows={3}
                placeholder="Ej. eligieron otro venue / presupuesto / sin respuesta…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800"
                autoFocus
              />
            </label>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPerdidaOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !perdidaNote.trim()}
                onClick={() => void confirmClosePerdida()}
                className="rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: '#9f1239' }}
              >
                {busy ? 'Guardando…' : 'Confirmar perdida'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
