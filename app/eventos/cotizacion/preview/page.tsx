'use client';

import { useEffect, useMemo, useState } from 'react';
import { EventosCotizacionDocument } from '@/app/components/eventos/EventosCotizacionDocument';
import {
  EVENTOS_NO_HOLD_WITHIN_DAYS,
  EVENTOS_QUOTE_LOCK_WITHIN_DAYS,
  canPlaceHold,
  isQuoteLockedByEventDate,
  quoteLockMessage,
  validatePaxAllocation,
  validateQuotePax,
} from '@/app/lib/eventos';
import {
  COTIZACION_DRAFT_SAVE_KEY,
  COTIZACION_DRAFT_SAVED_PING_KEY,
  COTIZACION_DRAFT_STORAGE_KEY,
  type CotizacionDoc,
  type CotizacionDraftSavePayload,
} from '@/app/lib/eventos-cotizacion-doc';
import { useSession } from '@/app/lib/useSession';
import { SUITE } from '@/app/lib/themes';

export default function CotizacionPreviewPage() {
  const { user } = useSession();
  const canEdit = !!user?.canEdit;
  const [doc, setDoc] = useState<CotizacionDoc | null>(null);
  const [savePayload, setSavePayload] =
    useState<CotizacionDraftSavePayload | null>(null);
  const [err, setErr] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      // Same key as Cotizador; localStorage so a new preview tab can read the draft.
      const raw = localStorage.getItem(COTIZACION_DRAFT_STORAGE_KEY);
      if (!raw) {
        setErr(
          'No hay borrador de cotización. Arma líneas en Cotizador y pulsa «Vista previa».'
        );
        return;
      }
      setDoc(JSON.parse(raw) as CotizacionDoc);

      const saveRaw = localStorage.getItem(COTIZACION_DRAFT_SAVE_KEY);
      if (saveRaw) {
        setSavePayload(JSON.parse(saveRaw) as CotizacionDraftSavePayload);
      }
    } catch {
      setErr('No se pudo leer el borrador de cotización.');
    }
  }, []);

  const blockReason = useMemo(() => {
    if (!savePayload) {
      return 'Vuelve al Cotizador y pulsa «Vista previa» de nuevo para poder guardar.';
    }
    if (!canEdit) return 'Sesión de solo lectura: no se puede guardar.';
    if (isQuoteLockedByEventDate(savePayload.event_date)) {
      return (
        quoteLockMessage(savePayload.event_date) ||
        `Bloqueada: faltan ${EVENTOS_QUOTE_LOCK_WITHIN_DAYS} días o menos para el evento.`
      );
    }
    if (!savePayload.client_id) {
      return 'Falta el cliente. Selecciónalo en el Cotizador.';
    }
    if (!savePayload.lines.length) {
      return 'Sin líneas para guardar.';
    }
    const paxErr = validateQuotePax(
      savePayload.pax,
      savePayload.lines.map((l) => ({
        category: l.category,
        requiresFood: l.requires_food,
        min_pax: l.min_pax,
      }))
    );
    if (paxErr) return paxErr;
    const allocErr = validatePaxAllocation(savePayload.pax, savePayload.lines);
    if (allocErr) return allocErr;
    if (savePayload.place_hold && !canPlaceHold(savePayload.event_date)) {
      return `Hold no disponible (<${EVENTOS_NO_HOLD_WITHIN_DAYS} días). Desactívalo en el Cotizador.`;
    }
    return null;
  }, [savePayload, canEdit]);

  async function saveQuote() {
    if (!savePayload || blockReason || busy || saved) return;
    setBusy(true);
    setSaveErr('');
    try {
      const res = await fetch('/api/eventos/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: savePayload.client_id,
          event_date: savePayload.event_date,
          pax: savePayload.pax,
          celebration: savePayload.celebration,
          notes: savePayload.notes,
          phone: savePayload.phone,
          email: savePayload.email,
          contact_name: savePayload.contact_name,
          apply_servicio: savePayload.apply_servicio,
          place_hold: savePayload.place_hold,
          lines: savePayload.lines,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveErr(
          json.hint
            ? `${json.error || 'No se pudo guardar'} — ${json.hint}`
            : json.error || 'No se pudo guardar'
        );
        return;
      }

      const savedId = json.quote?.id as string | undefined;
      const leadId =
        (json.lead_id as string | undefined) ||
        (json.quote?.lead_id as string | undefined);

      if (savePayload.place_hold && savedId) {
        try {
          await fetch('/api/eventos/holds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: savePayload.celebration || 'Cotización Eventos',
              event_date: savePayload.event_date,
              quote_id: savedId,
              lead_id: leadId || null,
              hold_until: json.quote?.hold_until || null,
              notes: savePayload.notes,
            }),
          });
        } catch {
          /* hold opcional; la cotización ya quedó guardada */
        }
      }

      localStorage.removeItem(COTIZACION_DRAFT_STORAGE_KEY);
      localStorage.removeItem(COTIZACION_DRAFT_SAVE_KEY);
      localStorage.setItem(
        COTIZACION_DRAFT_SAVED_PING_KEY,
        JSON.stringify({
          id: savedId,
          quote_number: json.quote?.quote_number || null,
          total: json.quote?.total ?? null,
          ts: Date.now(),
        })
      );

      setSaved(true);
      if (savedId) {
        window.location.href = `/eventos/cotizacion/${savedId}`;
      }
    } catch {
      setSaveErr('Error de red al guardar cotización');
    } finally {
      setBusy(false);
    }
  }

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

  const canSave = Boolean(savePayload) && !blockReason && canEdit && !saved;

  return (
    <div style={{ backgroundColor: SUITE.pageBg, minHeight: '100vh' }}>
      <EventosCotizacionDocument
        doc={doc}
        actionsExtra={
          canEdit ? (
            <>
              <button
                type="button"
                disabled={!canSave || busy}
                onClick={() => void saveQuote()}
                title={blockReason || undefined}
                className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: SUITE.orange }}
              >
                {busy
                  ? 'Guardando…'
                  : saved
                    ? 'Guardada'
                    : 'Guardar cotización'}
              </button>
              {(blockReason || saveErr) && (
                <p className="basis-full text-xs text-slate-600">
                  {saveErr || blockReason}
                </p>
              )}
            </>
          ) : (
            <p className="basis-full text-xs text-slate-500">
              Solo lectura: no se puede guardar en la Suite desde esta sesión.
            </p>
          )
        }
      />
    </div>
  );
}
