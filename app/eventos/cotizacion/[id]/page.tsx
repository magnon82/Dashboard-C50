'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventosCotizacionDocument } from '@/app/components/eventos/EventosCotizacionDocument';
import type { CotizacionDoc } from '@/app/lib/eventos-cotizacion-doc';
import { SUITE } from '@/app/lib/themes';

export default function CotizacionByIdPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [doc, setDoc] = useState<CotizacionDoc | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/eventos/quotes/${id}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setErr(json.error || 'No se pudo cargar la cotización');
          }
          return;
        }
        if (!cancelled) setDoc(json.doc as CotizacionDoc);
      } catch {
        if (!cancelled) setErr('Error de red al cargar la cotización');
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
      <EventosCotizacionDocument doc={doc} />
    </div>
  );
}
