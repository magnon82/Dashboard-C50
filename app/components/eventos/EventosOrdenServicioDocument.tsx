'use client';

import type { ReactNode } from 'react';
import {
  Cormorant_Garamond,
  Source_Sans_3,
} from 'next/font/google';
import { EventosDocActions } from '@/app/components/eventos/EventosDocActions';
import {
  EVENTOS_CONTACT,
  formatEventDateEs,
  formatIssuedAtEs,
  formatMxn,
  optionEntries,
  type OrdenServicioDoc,
} from '@/app/lib/eventos-os-doc';
import { SUITE } from '@/app/lib/themes';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const body = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

const STATUS_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  en_curso: 'En curso',
  cerrada: 'Cerrada',
};

export function EventosOrdenServicioDocument({
  doc,
  showActions = true,
  quoteHref,
  actionsExtra,
}: {
  doc: OrdenServicioDoc;
  showActions?: boolean;
  quoteHref?: string | null;
  actionsExtra?: ReactNode;
}) {
  return (
    <div
      className={`os-root mx-auto max-w-[820px] px-4 py-6 print:max-w-none print:px-0 print:py-0 ${body.className}`}
    >
      {showActions && (
        <EventosDocActions
          kind="os"
          folio={doc.os_number}
          clientName={doc.client_name || doc.contact_name}
          celebration={doc.celebration}
          eventDate={doc.event_date}
          recipientEmail={doc.email}
          recipientPhone={doc.phone}
          extra={
            <>
              {quoteHref && (
                <a
                  href={quoteHref}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
                  style={{ color: SUITE.orangeDeep }}
                >
                  Ver cotización
                </a>
              )}
              {actionsExtra}
            </>
          }
        />
      )}

      <article
        className="os-sheet overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none"
        style={{ color: SUITE.navy }}
      >
        <header
          className="relative px-8 pb-7 pt-8 text-white"
          style={{
            background: `linear-gradient(135deg, ${SUITE.navyDeep} 0%, ${SUITE.navy} 55%, ${SUITE.navySoft} 100%)`,
          }}
        >
          <div
            className="absolute inset-x-0 bottom-0 h-1"
            style={{ backgroundColor: SUITE.orange }}
          />
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: SUITE.orange }}
          >
            Orden de servicio
          </p>
          <h1
            className={`mt-2 text-3xl font-semibold tracking-tight md:text-4xl ${display.className}`}
          >
            {EVENTOS_CONTACT.brand}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
            Documento operativo para cocina, barra y piso · Confirmación del
            evento
          </p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/70">
            <span>
              Folio{' '}
              <strong className="text-white">
                {doc.os_number || 'Sin folio'}
              </strong>
            </span>
            <span>
              Estado{' '}
              <strong className="text-white">
                {STATUS_LABELS[doc.status || ''] || doc.status || '—'}
              </strong>
            </span>
            <span>
              Emitida{' '}
              <strong className="text-white">
                {formatIssuedAtEs(doc.issued_at)}
              </strong>
            </span>
            {doc.quote_number && (
              <span>
                Cotización{' '}
                <strong className="text-white">{doc.quote_number}</strong>
              </span>
            )}
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-100 px-8 py-6 md:grid-cols-2">
          <div>
            <h2
              className="text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: SUITE.orangeDeep }}
            >
              Cliente
            </h2>
            <p className={`mt-2 text-xl font-semibold ${display.className}`}>
              {doc.client_name || 'Cliente por asignar'}
            </p>
            {doc.contact_name && (
              <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
                Contacto: {doc.contact_name}
              </p>
            )}
            {(doc.phone || doc.email) && (
              <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
                {[doc.phone, doc.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Meta label="Celebración" value={doc.celebration || '—'} />
            <Meta
              label="Personas"
              value={doc.pax ? `${doc.pax} pax` : '—'}
            />
            <Meta
              label="Fecha del evento"
              value={formatEventDateEs(doc.event_date)}
              className="col-span-2"
            />
          </div>
        </section>

        <section className="border-b border-slate-100 px-8 py-5">
          <h2
            className="text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: SUITE.orangeDeep }}
          >
            Checklist operativo
          </h2>
          <ul
            className="mt-3 grid gap-2 text-sm sm:grid-cols-2"
            style={{ color: SUITE.muted }}
          >
            {[
              'Cocina: menú y tiempos confirmados',
              'Barra: bebidas / barra libre según líneas',
              'Piso: montaje y aforo (' +
                (doc.pax ? `${doc.pax} pax` : 'pax por confirmar') +
                ')',
              'Anticipo / liquidación según política',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span
                  className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded border border-slate-300"
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="px-8 py-6">
          <h2
            className="text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: SUITE.orangeDeep }}
          >
            Menú / conceptos
          </h2>
          {doc.lines.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: SUITE.muted }}>
              Sin líneas en el snapshot.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {doc.lines.map((line, idx) => {
                const opts = optionEntries(line.options);
                const importe =
                  Number(line.quantity) * Number(line.unit_price);
                return (
                  <li key={idx} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-lg font-semibold leading-snug ${display.className}`}
                        >
                          {line.description.split(' · ')[0]}
                        </p>
                        {opts.length > 0 ? (
                          <dl className="mt-2 space-y-1 text-sm">
                            {opts.map((o) => (
                              <div
                                key={o.key}
                                className="flex flex-wrap gap-x-2"
                              >
                                <dt
                                  className="font-semibold"
                                  style={{ color: SUITE.muted }}
                                >
                                  {o.label}
                                </dt>
                                <dd>{o.value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          line.description.includes(' · ') && (
                            <p
                              className="mt-1 text-sm"
                              style={{ color: SUITE.muted }}
                            >
                              {line.description
                                .split(' · ')
                                .slice(1)
                                .join(' · ')}
                            </p>
                          )
                        )}
                      </div>
                      <div className="text-right text-sm tabular-nums">
                        <p style={{ color: SUITE.muted }}>
                          {line.quantity} × {formatMxn(line.unit_price)}
                        </p>
                        <p className="mt-0.5 text-base font-bold">
                          {formatMxn(importe)}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="mx-8 mb-6 rounded-xl px-5 py-4"
          style={{ backgroundColor: SUITE.orangeSoft }}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt style={{ color: SUITE.muted }}>Subtotal</dt>
              <dd className="font-semibold tabular-nums">
                {formatMxn(doc.subtotal)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: SUITE.muted }}>
                Servicio {(doc.servicio_pct * 100).toFixed(0)}%
                {!doc.apply_servicio ? ' (no aplica)' : ''}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatMxn(doc.servicio_amount)}
              </dd>
            </div>
            <div
              className="flex justify-between gap-4 border-t pt-2 text-base"
              style={{ borderColor: 'rgba(232, 163, 23, 0.45)' }}
            >
              <dt className="font-bold">Total</dt>
              <dd className="font-bold tabular-nums">
                {formatMxn(doc.total)}
              </dd>
            </div>
          </dl>
        </section>

        {doc.notes && (
          <section className="border-t border-slate-100 px-8 py-5">
            <h2
              className="text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: SUITE.orangeDeep }}
            >
              Notas / requisiciones
            </h2>
            <p
              className="mt-2 whitespace-pre-wrap text-sm leading-relaxed"
              style={{ color: SUITE.muted }}
            >
              {doc.notes}
            </p>
          </section>
        )}

        <section className="border-t border-slate-100 px-8 py-5">
          <h2
            className="text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: SUITE.orangeDeep }}
          >
            Uso interno
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: SUITE.muted }}>
            Entregar a cocina / barra con al menos 1 semana de anticipación.
            Confirmar anticipos y liquidación según política de eventos.
            {doc.owner_username
              ? ` · Vendedor: ${doc.owner_username}`
              : ''}
          </p>
        </section>

        <footer
          className="border-t px-8 py-6 text-center text-xs leading-relaxed"
          style={{
            borderColor: SUITE.border,
            backgroundColor: '#F7F8FB',
            color: SUITE.muted,
          }}
        >
          <p className="font-semibold" style={{ color: SUITE.navy }}>
            {EVENTOS_CONTACT.brand}
          </p>
          <p className="mt-1">{EVENTOS_CONTACT.address}</p>
          <p className="mt-1">
            {EVENTOS_CONTACT.phone} · {EVENTOS_CONTACT.email}
          </p>
        </footer>
      </article>

      <style jsx global>{`
        @media print {
          @page {
            margin: 12mm;
            size: letter;
          }
          body {
            background: white !important;
          }
          .os-root {
            max-width: none !important;
            padding: 0 !important;
          }
          .os-sheet {
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function Meta({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p
        className="text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: SUITE.muted }}
      >
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold capitalize">{value}</p>
    </div>
  );
}
