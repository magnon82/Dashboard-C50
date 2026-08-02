'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { EVENTOS_CONTACT } from '@/app/lib/eventos';
import { SUITE } from '@/app/lib/themes';

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Acciones de impresión / enlace / envío para cotización u OS (HTML → PDF). */
export function EventosDocActions({
  kind,
  folio,
  clientName,
  celebration,
  eventDate,
  recipientEmail,
  recipientPhone,
  extra,
}: {
  kind: 'cotizacion' | 'os';
  folio?: string | null;
  clientName?: string | null;
  celebration?: string | null;
  eventDate?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  extra?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') === '1') {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, []);

  const label = kind === 'cotizacion' ? 'cotización' : 'orden de servicio';
  const who = clientName || 'cliente';
  const subjectBits = [
    kind === 'cotizacion' ? 'Cotización' : 'Orden de servicio',
    folio || null,
    celebration || who,
  ].filter(Boolean);
  const subject = `${subjectBits.join(' · ')} · Carranza 50`;

  const pageUrl =
    typeof window !== 'undefined' ? window.location.href.split('?')[0] : '';

  const bodyLines = [
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
    const url = window.location.href.split('?')[0];
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareNote('Enlace copiado');
      window.setTimeout(() => {
        setCopied(false);
        setShareNote('');
      }, 2000);
    } catch {
      setShareNote('No se pudo copiar; copia la URL del navegador');
    }
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg px-4 py-2 text-sm font-bold text-white"
        style={{ backgroundColor: SUITE.navy }}
      >
        Imprimir / guardar PDF
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
      <button
        type="button"
        onClick={() => window.history.back()}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        Volver
      </button>
      {extra}
      <p className="basis-full text-xs text-slate-500">
        {shareNote ||
          'En el diálogo de impresión elige «Guardar como PDF». El enlace abre este documento en la Suite (sesión requerida).'}
      </p>
    </div>
  );
}
