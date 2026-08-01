'use client';

import { useEffect, useState } from 'react';
import { EventosCotizacionDocument } from '@/app/components/eventos/EventosCotizacionDocument';
import {
  COTIZACION_DRAFT_STORAGE_KEY,
  type CotizacionDoc,
} from '@/app/lib/eventos-cotizacion-doc';
import { SUITE } from '@/app/lib/themes';

export default function CotizacionPreviewPage() {
  const [doc, setDoc] = useState<CotizacionDoc | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(COTIZACION_DRAFT_STORAGE_KEY);
      if (!raw) {
        setErr(
          'No hay borrador de cotización. Arma líneas en Cotizador y pulsa «Vista previa».'
        );
        return;
      }
      setDoc(JSON.parse(raw) as CotizacionDoc);
    } catch {
      setErr('No se pudo leer el borrador de cotización.');
    }
  }, []);

  if (err) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium" style={{ color: SUITE.navy }}>
          {err}
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

  if (!doc) {
    return (
      <p className="px-4 py-16 text-center text-sm text-slate-500">
        Cargando vista previa…
      </p>
    );
  }

  return (
    <div style={{ backgroundColor: SUITE.pageBg, minHeight: '100vh' }}>
      <EventosCotizacionDocument doc={doc} />
    </div>
  );
}
