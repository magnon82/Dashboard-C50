'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventosCotizacionDocument } from '@/app/components/eventos/EventosCotizacionDocument';
import { EventosPublicAcceptPanel } from '@/app/components/eventos/EventosPublicAcceptPanel';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';
import type { BbvaTransferDetails } from '@/app/lib/eventos-quote-payment';
import { SUITE } from '@/app/lib/themes';

/**
 * Cotización pública compartible — sin login ni chrome de Suite.
 * URL: /c/{public_token}
 * El cliente puede aceptar y elegir método de pago.
 */
export default function PublicCotizacionPage() {
  const params = useParams();
  const token = String(params?.token || '');
  const [doc, setDoc] = useState<CotizacionDoc | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [canAccept, setCanAccept] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [paymentLabel, setPaymentLabel] = useState<string | null>(null);
  const [bbva, setBbva] = useState<BbvaTransferDetails>({
    bank: 'BBVA',
    beneficiary: 'Carranza 50',
    clabe: null,
    account: null,
    referenceHint: null,
    configured: false,
  });

  useEffect(() => {
    if (!token) {
      setErr('Enlace inválido');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/eventos/quotes/public/${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setErr(json.error || 'No se pudo cargar la cotización');
          setDoc(null);
          return;
        }
        setDoc(json.doc as CotizacionDoc);
        setCanAccept(Boolean(json.can_accept));
        setAccepted(Boolean(json.accepted));
        setPaymentLabel(
          typeof json.payment_method_label === 'string'
            ? json.payment_method_label
            : null
        );
        if (json.bbva && typeof json.bbva === 'object') {
          setBbva(json.bbva as BbvaTransferDetails);
        }
        setErr('');
      } catch {
        if (!cancelled) {
          setErr('Error de red al cargar la cotización');
          setDoc(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <p className="px-4 py-16 text-center text-sm text-slate-500">
        Cargando cotización…
      </p>
    );
  }

  if (err || !doc) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium" style={{ color: SUITE.navy }}>
          {err || 'Cotización no encontrada'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Si el enlace te lo envió Carranza 50, pide uno nuevo al equipo de
          Eventos.
        </p>
      </div>
    );
  }

  const blockedReason =
    doc.status === 'rechazada'
      ? 'Esta cotización fue rechazada y ya no está disponible para aceptar.'
      : doc.status === 'vencida'
        ? 'Esta cotización está vencida. Contacta a Eventos para una nueva propuesta.'
        : null;

  return (
    <div style={{ backgroundColor: SUITE.pageBg, minHeight: '100vh' }}>
      <EventosCotizacionDocument doc={doc} publicShare />
      <EventosPublicAcceptPanel
        token={token}
        initiallyAccepted={accepted}
        initialPaymentMethod={doc.payment_method}
        initialPaymentLabel={paymentLabel}
        initialPaymentLinkUrl={doc.payment_link_url}
        initialAcceptedAt={doc.accepted_at}
        bbva={bbva}
        blockedReason={canAccept || accepted ? null : blockedReason}
      />
    </div>
  );
}
