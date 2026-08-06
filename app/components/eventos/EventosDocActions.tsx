'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { EVENTOS_CONTACT } from '@/app/lib/eventos';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';
import { downloadCotizacionPdf } from '@/app/lib/eventos-cotizacion-pdf';
import { SUITE } from '@/app/lib/themes';

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Acciones de descarga PDF / enlace / envío para cotización u OS. */
export function EventosDocActions({
  kind,
  folio,
  clientName,
  celebration,
  eventDate,
  recipientEmail,
  recipientPhone,
  /** URL pública (/c/…) — si falta, usa la URL actual (vista interna). */
  shareUrl,
  publicShare = false,
  /** Documento de cotización: genera PDF real (sin diálogo de impresión). */
  cotizacionDoc,
  extra,
}: {
  kind: 'cotizacion' | 'os';
  folio?: string | null;
  clientName?: string | null;
  celebration?: string | null;
  eventDate?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  shareUrl?: string | null;
  /** Vista pública: sin «Volver» a la Suite ni texto de sesión. */
  publicShare?: boolean;
  cotizacionDoc?: CotizacionDoc | null;
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [resolvedShare, setResolvedShare] = useState(shareUrl || '');
  const [pdfBusy, setPdfBusy] = useState(false);

  /** Tabs abiertos con window.open(+noopener) no tienen historial útil; back() queda en blanco. */
  function goBack() {
    if (typeof window === 'undefined') {
      router.push('/eventos');
      return;
    }
    const sameOriginReferrer =
      Boolean(document.referrer) &&
      document.referrer.startsWith(window.location.origin);
    if (sameOriginReferrer && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/eventos');
  }

  useEffect(() => {
    if (shareUrl) {
      setResolvedShare(shareUrl);
      return;
    }
    if (typeof window !== 'undefined') {
      const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
      const path = window.location.pathname;
      setResolvedShare(
        env && path.startsWith('/c/')
          ? `${env}${path}`
          : window.location.href.split('?')[0]
      );
    }
  }, [shareUrl]);

  async function handleDownloadPdf() {
    if (kind === 'cotizacion' && cotizacionDoc) {
      setPdfBusy(true);
      setShareNote('');
      try {
        await downloadCotizacionPdf(cotizacionDoc);
        setShareNote('PDF descargado');
        window.setTimeout(() => setShareNote(''), 2000);
      } catch {
        setShareNote('No se pudo generar el PDF');
      } finally {
        setPdfBusy(false);
      }
      return;
    }
    // OS digital: sigue el flujo de impresión del navegador
    window.print();
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== '1' && params.get('download') !== '1') return;

    if (kind === 'cotizacion' && cotizacionDoc) {
      const t = window.setTimeout(() => {
        void downloadCotizacionPdf(cotizacionDoc).catch(() => {
          setShareNote('No se pudo generar el PDF');
        });
      }, 400);
      return () => window.clearTimeout(t);
    }

    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [kind, cotizacionDoc]);

  const label = kind === 'cotizacion' ? 'cotización' : 'orden de servicio';
  const who = clientName || 'cliente';
  const subjectBits = [
    kind === 'cotizacion' ? 'Cotización' : 'Orden de servicio',
    folio || null,
    celebration || who,
  ].filter(Boolean);
  const subject = `${subjectBits.join(' · ')} · Carranza 50`;

  const pageUrl = resolvedShare;

  const bodyLines =
    kind === 'cotizacion'
      ? [
          `Hola${who !== 'cliente' ? ` ${who}` : ''},`,
          '',
          `Adjunto / enlace a su ${label}${folio ? ` (${folio})` : ''} para ${celebration || 'su evento'} en Carranza 50.`,
          eventDate ? `Fecha del evento: ${eventDate}` : null,
          '',
          pageUrl ? `Ver cotización: ${pageUrl}` : null,
          '',
          'En la página puede usar «Descargar PDF» para obtener el archivo.',
          '',
          'Saludos,',
          'Eventos · Carranza 50',
          EVENTOS_CONTACT.email,
        ].filter((x): x is string => x != null)
      : [
          `Hola${who !== 'cliente' ? ` ${who}` : ''},`,
          '',
          `Adjunto / enlace a su ${label}${folio ? ` (${folio})` : ''} para ${celebration || 'su evento'} en Carranza 50.`,
          eventDate ? `Fecha del evento: ${eventDate}` : null,
          '',
          pageUrl ? `Ver / imprimir PDF: ${pageUrl}` : null,
          '',
          'En el navegador use «Imprimir → Guardar como PDF» si necesita el archivo.',
          '',
          'Saludos,',
          'Eventos · Carranza 50',
          EVENTOS_CONTACT.email,
        ].filter((x): x is string => x != null);

  const mailtoHref = recipientEmail
    ? `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`
    : `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;

  const waDigits = recipientPhone ? digitsOnly(recipientPhone) : '';
  const waText = [
    `Hola — le comparto la ${label}${folio ? ` ${folio}` : ''} de Carranza 50.`,
    celebration ? `Evento: ${celebration}` : null,
    eventDate ? `Fecha: ${eventDate}` : null,
    pageUrl || null,
  ]
    .filter(Boolean)
    .join('\n');
  const waHref = waDigits
    ? `https://wa.me/${waDigits.startsWith('52') ? waDigits : `52${waDigits}`}?text=${encodeURIComponent(waText)}`
    : `https://wa.me/?text=${encodeURIComponent(waText)}`;

  async function copyLink() {
    const url =
      shareUrl ||
      (typeof window !== 'undefined'
        ? window.location.href.split('?')[0]
        : resolvedShare);
    if (!url) {
      setShareNote('Enlace aún no disponible');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareNote('Enlace público copiado');
      window.setTimeout(() => {
        setCopied(false);
        setShareNote('');
      }, 2000);
    } catch {
      setShareNote('No se pudo copiar; copia la URL del navegador');
    }
  }

  const canDirectPdf = kind === 'cotizacion' && !!cotizacionDoc;
  const hint = publicShare
    ? canDirectPdf
      ? '«Descargar PDF» guarda el archivo en tu dispositivo.'
      : 'En el diálogo de impresión elige «Guardar como PDF».'
    : kind === 'cotizacion'
      ? canDirectPdf
        ? '«Descargar PDF» genera el archivo; no guarda la cotización en la Suite.'
        : 'Falta el documento para generar PDF.'
      : 'En el diálogo de impresión elige «Guardar como PDF». El enlace abre este documento en la Suite (sesión requerida).';
  const statusText = shareNote || hint;

  const pdfButtonLabel = canDirectPdf
    ? pdfBusy
      ? 'Generando PDF…'
      : 'Descargar PDF'
    : 'Imprimir / guardar PDF';

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        disabled={pdfBusy || (kind === 'cotizacion' && !cotizacionDoc)}
        onClick={() => void handleDownloadPdf()}
        className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        style={{ backgroundColor: SUITE.navy }}
      >
        {pdfButtonLabel}
      </button>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        {copied ? 'Copiado' : 'Copiar enlace'}
      </button>
      <a
        href={mailtoHref}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        Enviar por correo
      </a>
      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        WhatsApp
      </a>
      {!publicShare && (
        <button
          type="button"
          onClick={goBack}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Volver
        </button>
      )}
      {extra}
      {statusText ? (
        <p className="basis-full text-xs text-slate-500">{statusText}</p>
      ) : null}
    </div>
  );
}
