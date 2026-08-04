'use client';

import { useState } from 'react';
import {
  QUOTE_PAYMENT_METHODS,
  QUOTE_PAYMENT_METHOD_LABELS,
  type BbvaTransferDetails,
  type QuotePaymentMethod,
} from '@/app/lib/eventos-quote-payment';
import { SUITE } from '@/app/lib/themes';

type AcceptResult = {
  ok?: boolean;
  already_accepted?: boolean;
  accepted_at?: string | null;
  payment_method?: string | null;
  payment_method_label?: string | null;
  payment_link_url?: string | null;
  message?: string;
  bbva?: BbvaTransferDetails;
  error?: string;
};

export function EventosPublicAcceptPanel({
  token,
  initiallyAccepted,
  initialPaymentMethod,
  initialPaymentLabel,
  initialPaymentLinkUrl,
  initialAcceptedAt,
  bbva,
  blockedReason,
}: {
  token: string;
  initiallyAccepted: boolean;
  initialPaymentMethod?: string | null;
  initialPaymentLabel?: string | null;
  initialPaymentLinkUrl?: string | null;
  initialAcceptedAt?: string | null;
  bbva: BbvaTransferDetails;
  /** p. ej. rechazada / vencida */
  blockedReason?: string | null;
}) {
  const [method, setMethod] = useState<QuotePaymentMethod | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [accepted, setAccepted] = useState(initiallyAccepted);
  const [paymentMethod, setPaymentMethod] = useState(initialPaymentMethod || '');
  const [paymentLabel, setPaymentLabel] = useState(
    initialPaymentLabel || ''
  );
  const [paymentLinkUrl, setPaymentLinkUrl] = useState(
    initialPaymentLinkUrl || ''
  );
  const [acceptedAt, setAcceptedAt] = useState(initialAcceptedAt || '');
  const [bbvaInfo, setBbvaInfo] = useState(bbva);
  const [confirmMsg, setConfirmMsg] = useState('');

  async function submit() {
    if (!method) {
      setErr('Elige un método de pago');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/eventos/quotes/public/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_method: method,
            client_note: note.trim() || undefined,
          }),
        }
      );
      const json = (await res.json()) as AcceptResult;
      if (!res.ok) {
        setErr(json.error || 'No se pudo aceptar la cotización');
        return;
      }
      setAccepted(true);
      setPaymentMethod(json.payment_method || method);
      setPaymentLabel(
        json.payment_method_label ||
          QUOTE_PAYMENT_METHOD_LABELS[method] ||
          method
      );
      setPaymentLinkUrl(json.payment_link_url || '');
      setAcceptedAt(json.accepted_at || new Date().toISOString());
      if (json.bbva) setBbvaInfo(json.bbva);
      setConfirmMsg(json.message || 'Cotización aceptada');
    } catch {
      setErr('Error de red al aceptar');
    } finally {
      setBusy(false);
    }
  }

  if (blockedReason) {
    return (
      <section
        className="mx-auto max-w-[820px] px-4 pb-10 print:hidden"
        aria-live="polite"
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          {blockedReason}
        </div>
      </section>
    );
  }

  if (accepted) {
    const methodKey = paymentMethod as QuotePaymentMethod;
    const showBbva = methodKey === 'transferencia_bbva';
    const showLink =
      methodKey === 'tarjeta_link' ||
      Boolean(paymentLinkUrl);

    return (
      <section
        className="mx-auto max-w-[820px] px-4 pb-10 print:hidden"
        aria-live="polite"
      >
        <div
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-5"
          style={{ color: SUITE.navy }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
            Cotización aceptada
          </p>
          <h2 className="mt-1 text-lg font-bold">¡Gracias!</h2>
          <p className="mt-2 text-sm text-slate-700">
            {confirmMsg ||
              'Registramos tu aceptación. El equipo de Eventos te contactará para coordinar el anticipo.'}
          </p>
          {paymentLabel ? (
            <p className="mt-3 text-sm">
              <span className="font-semibold">Método de pago: </span>
              {paymentLabel}
            </p>
          ) : null}
          {acceptedAt ? (
            <p className="mt-1 text-xs text-slate-500">
              {new Date(acceptedAt).toLocaleString('es-MX', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          ) : null}

          {showBbva ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <p className="font-semibold">Transferencia BBVA</p>
              <dl className="mt-2 space-y-1 text-slate-700">
                <div>
                  <dt className="inline text-slate-500">Beneficiario: </dt>
                  <dd className="inline font-medium">
                    {bbvaInfo.beneficiary}
                  </dd>
                </div>
                {bbvaInfo.clabe ? (
                  <div>
                    <dt className="inline text-slate-500">CLABE: </dt>
                    <dd className="inline font-mono font-medium">
                      {bbvaInfo.clabe}
                    </dd>
                  </div>
                ) : null}
                {bbvaInfo.account ? (
                  <div>
                    <dt className="inline text-slate-500">Cuenta: </dt>
                    <dd className="inline font-mono font-medium">
                      {bbvaInfo.account}
                    </dd>
                  </div>
                ) : null}
                {!bbvaInfo.configured ? (
                  <p className="text-amber-800">
                    Los datos bancarios te los confirmará el equipo de Eventos
                    al contactarte (aún no están publicados en este enlace).
                  </p>
                ) : null}
                {bbvaInfo.referenceHint ? (
                  <p className="pt-1 text-xs text-slate-500">
                    {bbvaInfo.referenceHint}
                  </p>
                ) : null}
              </dl>
            </div>
          ) : null}

          {showLink ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <p className="font-semibold">Pago con tarjeta por link</p>
              {paymentLinkUrl ? (
                <p className="mt-2">
                  <a
                    href={paymentLinkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: SUITE.orangeDeep }}
                  >
                    Abrir link de pago
                  </a>
                </p>
              ) : (
                <p className="mt-2 text-slate-700">
                  Te enviaremos el link de pago por correo o WhatsApp en breve.
                  No hay pasarela automática aún.
                </p>
              )}
            </div>
          ) : null}

          {methodKey === 'efectivo_restaurante' ||
          methodKey === 'tarjeta_terminal' ? (
            <p className="mt-4 text-sm text-slate-700">
              Coordina con Eventos la fecha de tu visita al restaurante para
              cubrir el anticipo
              {methodKey === 'tarjeta_terminal'
                ? ' en la terminal'
                : ' en efectivo'}
              .
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[820px] px-4 pb-10 print:hidden">
      <div
        className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm"
        style={{ color: SUITE.navy }}
      >
        <h2 className="text-lg font-bold">Aceptar cotización</h2>
        <p className="mt-1 text-sm text-slate-600">
          Confirma esta propuesta y elige cómo quieres pagar el anticipo.
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Método de pago
          </legend>
          {QUOTE_PAYMENT_METHODS.map((id) => (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                method === id
                  ? 'border-slate-800 bg-slate-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="payment_method"
                value={id}
                checked={method === id}
                onChange={() => setMethod(id)}
                className="mt-0.5"
              />
              <span className="font-medium">
                {QUOTE_PAYMENT_METHOD_LABELS[id]}
              </span>
            </label>
          ))}
        </fieldset>

        {method === 'tarjeta_link' ? (
          <p className="mt-3 text-xs text-slate-500">
            Tras aceptar, te enviaremos el link de pago. Si ya hay uno
            publicado, aparecerá en la confirmación.
          </p>
        ) : null}
        {method === 'transferencia_bbva' ? (
          <p className="mt-3 text-xs text-slate-500">
            Tras aceptar verás los datos de la cuenta BBVA (si están
            configurados) o el equipo te los enviará.
          </p>
        ) : null}

        <label className="mt-4 block text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Nota (opcional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Comentario para el equipo de Eventos"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
          />
        </label>

        {err ? (
          <p className="mt-3 text-sm font-medium text-red-700">{err}</p>
        ) : null}

        <button
          type="button"
          disabled={busy || !method}
          onClick={() => void submit()}
          className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:w-auto"
          style={{ backgroundColor: SUITE.navy }}
        >
          {busy ? 'Enviando…' : 'Aceptar cotización'}
        </button>
      </div>
    </section>
  );
}
