'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventosOrdenServicioDocument } from '@/app/components/eventos/EventosOrdenServicioDocument';
import {
  serviceOrderToDoc,
  type OrdenServicioDoc,
} from '@/app/lib/eventos-os-doc';
import type { ServiceOrderRow } from '@/app/lib/eventos-service-order';
import { SUITE } from '@/app/lib/themes';

export default function OrdenServicioByIdPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [doc, setDoc] = useState<OrdenServicioDoc | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/eventos/os/${id}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setErr(json.error || 'No se pudo cargar la OS');
            setHint(json.hint || '');
          }
          return;
        }
        const order = json.order as ServiceOrderRow;
        if (!cancelled) {
          setDoc(serviceOrderToDoc(order));
          setQuoteId(order.quote_id);
        }
      } catch {
        if (!cancelled) setErr('Error de red al cargar la OS');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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
      <EventosOrdenServicioDocument
        doc={doc}
        quoteHref={quoteId ? `/eventos/cotizacion/${quoteId}` : null}
      />
    </div>
  );
}
