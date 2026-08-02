'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_TERMINALS,
  computeNetoBanco,
  moneyMx,
  defaultCorteDateCdmx,
  TPV_CORTE_DATE_HELP,
  photoKindLabel,
  type TpvCorteUpload,
  type TpvDayCompleteness,
  type TpvPhotoKind,
  type TpvTerminalNumber,
  type TpvWeekVerify,
  buildDayCompleteness,
  buildTpvWeekVerify,
} from '@/app/lib/tpv-cortes';
import {
  prepareTpvPhotoForUpload,
  readTpvApiJson,
} from '@/app/lib/tpv-upload-client';
import type { FinancialRecord } from '@/app/lib/ventas-semana';
import { SUITE } from '@/app/lib/themes';

type Tab = 'captura' | 'revisar';

function statusLabel(
  slot: {
    state: string;
    venta: TpvCorteUpload | null;
    propinaUpload: TpvCorteUpload | null;
  } | null
): string {
  if (!slot || slot.state === 'missing') return 'Falta';
  if (slot.state === 'unused') return 'No se usó';
  if (slot.state === 'partial') {
    if (slot.venta && !slot.propinaUpload) return 'Falta propinas';
    if (!slot.venta && slot.propinaUpload) return 'Falta venta';
    return 'Parcial';
  }
  const u = slot.venta || slot.propinaUpload;
  if (!u) return 'Fotos OK';
  if (u.status === 'verified') return 'Verificado';
  if (
    (slot.venta?.total_cobrado != null || slot.venta?.status === 'parsed') &&
    slot.propinaUpload?.propina != null
  ) {
    return 'Con montos';
  }
  if (slot.venta || slot.propinaUpload) return 'Fotos OK';
  return 'Pendiente';
}

/** Muestra YYYY-MM-DD en español (UTC noon evita desfase de zona). */
function formatCorteDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function TpvCorteClient() {
  const [tab, setTab] = useState<Tab>('captura');
  const [corteDate, setCorteDate] = useState(defaultCorteDateCdmx);
  const [day, setDay] = useState<TpvDayCompleteness | null>(null);
  const [uploads, setUploads] = useState<TpvCorteUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTerminal, setBusyTerminal] = useState<number | null>(null);
  const [activeTerminal, setActiveTerminal] = useState<TpvTerminalNumber>(1);
  const [activeKind, setActiveKind] = useState<TpvPhotoKind>('venta');
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    width: number;
    height: number;
    sharpness: number;
  } | null>(null);
  const [cobrado, setCobrado] = useState('');
  const [propina, setPropina] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [verify, setVerify] = useState<TpvWeekVerify | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fecha fija por regla CDMX; recompute al montar y al recuperar foco (p. ej. tras medianoche).
  useEffect(() => {
    function syncCorteDate() {
      const next = defaultCorteDateCdmx();
      setCorteDate((prev) => (prev === next ? prev : next));
    }
    syncCorteDate();
    window.addEventListener('focus', syncCorteDate);
    return () => window.removeEventListener('focus', syncCorteDate);
  }, []);

  const refresh = useCallback(async (dateOverride?: string) => {
    const date = dateOverride ?? corteDate;
    setLoading(true);
    setError(null);
    try {
      const [tpvRes, finRes] = await Promise.all([
        fetch(
          `/api/tpv-cortes?date=${encodeURIComponent(date)}&urls=1&day=1`,
          { cache: 'no-store' }
        ),
        fetch('/api/financial-records?sources=infocaja,presupuesto_ingreso', {
          cache: 'no-store',
        }),
      ]);
      const tpvJson = await readTpvApiJson(tpvRes);
      if (!tpvRes.ok) {
        const detail = [tpvJson.error, tpvJson.hint].filter(Boolean).join(' — ');
        setError(
          detail ||
            'No se pudieron cargar los cortes. ¿Corriste supabase/tpv_cortes.sql?'
        );
        setUploads([]);
        setDay(null);
        return;
      }
      const list = (tpvJson.uploads || []) as TpvCorteUpload[];
      setUploads(list);
      setDay(
        (tpvJson.day as TpvDayCompleteness | undefined) ||
          buildDayCompleteness(list, date)
      );

      let records: FinancialRecord[] = [];
      if (finRes.ok) {
        const finJson = await readTpvApiJson(finRes);
        records = (finJson.records || []) as FinancialRecord[];
      }

      const weekRes = await fetch(`/api/tpv-cortes?week=1&urls=0`, {
        cache: 'no-store',
      });
      const weekJson = weekRes.ok
        ? await readTpvApiJson(weekRes)
        : { uploads: list };
      setVerify(
        buildTpvWeekVerify(
          ((weekJson.uploads || list) as TpvCorteUpload[]),
          records,
          date
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  }, [corteDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function clearPending() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setCobrado('');
    setPropina('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onPickFile(file: File | null) {
    setMsg(null);
    setError(null);
    if (!file) return;
    try {
      const prepared = await prepareTpvPhotoForUpload(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(prepared.previewUrl);
      setPendingFile({
        file: prepared.file,
        width: prepared.width,
        height: prepared.height,
        sharpness: prepared.sharpness,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'No se pudo analizar la foto. Vuelve a tomar la foto.'
      );
      clearPending();
    }
  }

  async function submitPhoto() {
    if (!pendingFile) {
      setError('Primero toma o elige la foto del corte.');
      return;
    }
    // Montos opcionales: el servidor lee el ticket (OCR). Manual solo como respaldo.
    setBusyTerminal(activeTerminal);
    setError(null);
    setMsg(null);
    try {
      const dateForUpload = defaultCorteDateCdmx();
      if (dateForUpload !== corteDate) setCorteDate(dateForUpload);
      const fd = new FormData();
      fd.set('file', pendingFile.file);
      fd.set('terminal_number', String(activeTerminal));
      fd.set('photo_kind', activeKind);
      fd.set('corte_date', dateForUpload);
      fd.set('width_px', String(pendingFile.width));
      fd.set('height_px', String(pendingFile.height));
      fd.set('sharpness', String(pendingFile.sharpness));
      if (activeKind === 'venta' && cobrado.trim()) {
        fd.set('total_cobrado', cobrado.trim());
      }
      if (activeKind === 'propina' && propina.trim() !== '') {
        fd.set('propina', propina.trim());
      }

      const res = await fetch('/api/tpv-cortes', { method: 'POST', body: fd });
      const json = await readTpvApiJson(res);
      if (!res.ok) {
        setError(
          String(
            json.error ||
              'No se pudo leer el ticket. Vuelve a tomar la foto.'
          )
        );
        return;
      }
      clearPending();
      const day = json.day as TpvDayCompleteness | undefined;
      if (day) setDay(day);
      const ocr = json.ocr as
        | {
            status?: string;
            total_cobrado?: number | null;
            propina?: number | null;
          }
        | undefined;
      const upload = json.upload as TpvCorteUpload | undefined;
      const ocrBit =
        ocr?.status === 'done'
          ? activeKind === 'venta'
            ? ` · cobrado ${moneyMx(ocr.total_cobrado ?? upload?.total_cobrado)}`
            : ` · propina ${moneyMx(ocr.propina ?? upload?.propina)}`
          : '';
      setMsg(
        day?.complete
          ? 'Proceso concluido correctamente. Las 3 terminales ya estan listas.'
          : `T${activeTerminal} · ${photoKindLabel(activeKind)} guardada${ocrBit}.`
      );
      const slotAfter = (day?.slots || []).find(
        (s) => s.terminal === activeTerminal
      );
      if (slotAfter?.state === 'partial') {
        setActiveKind(activeKind === 'venta' ? 'propina' : 'venta');
      }
      await refresh(dateForUpload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir');
    } finally {
      setBusyTerminal(null);
    }
  }

  async function markUnused(terminal: TpvTerminalNumber) {
    const dateForUpload = defaultCorteDateCdmx();
    if (dateForUpload !== corteDate) setCorteDate(dateForUpload);
    if (
      !confirm(
        `¿Confirmas que no se utilizó la terminal ${terminal} el ${dateForUpload}?`
      )
    ) {
      return;
    }
    setBusyTerminal(terminal);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/tpv-cortes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_kind: 'unused',
          terminal_number: terminal,
          corte_date: dateForUpload,
        }),
      });
      const json = await readTpvApiJson(res);
      if (!res.ok) {
        setError(String(json.error || 'No se pudo marcar como no utilizada'));
        return;
      }
      const dayUnused = json.day as TpvDayCompleteness | undefined;
      if (dayUnused) setDay(dayUnused);
      setMsg(
        dayUnused?.complete
          ? 'Proceso concluido correctamente. Las 3 terminales ya estan listas.'
          : `Terminal ${terminal}: marcada como no utilizada.`
      );
      await refresh(dateForUpload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusyTerminal(null);
    }
  }

  async function saveAmounts(u: TpvCorteUpload) {
    setBusyTerminal(u.terminal_number);
    setError(null);
    try {
      const kind = u.photo_kind === 'propina' ? 'propina' : 'venta';
      if (kind === 'venta') {
        const cob = prompt(
          'Total cobrado (TOTALIZACIÓN)',
          String(u.total_cobrado ?? '')
        );
        if (cob === null) return;
        const res = await fetch(`/api/tpv-cortes/${u.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            total_cobrado: cob === '' ? null : Number(cob),
            status: 'parsed',
          }),
        });
        const json = await readTpvApiJson(res);
        if (!res.ok) {
          setError(String(json.error || 'No se guardaron montos'));
          return;
        }
      } else {
        const tip = prompt('Propina (REPORTE)', String(u.propina ?? '0'));
        if (tip === null) return;
        const res = await fetch(`/api/tpv-cortes/${u.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propina: tip === '' ? 0 : Number(tip),
            status: 'parsed',
          }),
        });
        const json = await readTpvApiJson(res);
        if (!res.ok) {
          setError(String(json.error || 'No se guardaron montos'));
          return;
        }
      }
      setMsg(`Terminal ${u.terminal_number}: monto actualizado.`);
      await refresh();
    } finally {
      setBusyTerminal(null);
    }
  }

  async function markVerified(u: TpvCorteUpload) {
    setBusyTerminal(u.terminal_number);
    try {
      const res = await fetch(`/api/tpv-cortes/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'verified' }),
      });
      const json = await readTpvApiJson(res);
      if (!res.ok) {
        setError(String(json.error || 'No se pudo verificar'));
        return;
      }
      await refresh();
    } finally {
      setBusyTerminal(null);
    }
  }

  const netoPreview =
    activeKind === 'venta'
      ? computeNetoBanco(
          cobrado.trim() ? Number(cobrado.replace(/,/g, '')) : null,
          null
        )
      : null;

  const dayComplete = Boolean(day?.complete);
  const activeSlot = day?.slots.find((s) => s.terminal === activeTerminal);

  return (
    <div className="mx-auto max-w-lg px-3 pb-16 pt-3">
      <header className="mb-4">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: SUITE.orange }}
        >
          Cortes TPV · Carranza 50
        </p>
        <h1
          className="mt-1 text-2xl font-bold leading-tight"
          style={{ color: SUITE.navy }}
        >
          {dayComplete
            ? 'Proceso concluido correctamente'
            : 'Toma la foto del corte del día'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {dayComplete
            ? `Las 3 terminales del ${corteDate} ya están contabilizadas (2 fotos o «No se utilizó»).`
            : 'Hay 3 terminales. Cada una necesita foto de venta + foto de propinas, o «No se utilizó».'}
        </p>
      </header>

      <div className="mb-4 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Fecha</span>
          <input
            type="text"
            readOnly
            tabIndex={-1}
            aria-readonly="true"
            className="min-h-11 flex-1 cursor-default rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-800"
            value={formatCorteDateDisplay(corteDate)}
          />
        </div>
        <p
          className="mt-2 rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950"
          role="note"
        >
          {TPV_CORTE_DATE_HELP}
        </p>
      </div>

      {/* Completeness / success */}
      {dayComplete ? (
        <div
          className="mb-4 rounded-2xl px-4 py-5 text-center text-white"
          style={{ backgroundColor: '#0F766E' }}
          role="status"
        >
          <p className="text-3xl font-bold leading-none" aria-hidden>
            ✓
          </p>
          <p className="mt-2 text-lg font-bold">
            Proceso concluido correctamente
          </p>
          <p className="mt-1 text-sm text-white/85">
            3 / 3 terminales · {corteDate}
          </p>
          <p className="mt-3 text-sm text-white/75">
            Puedes revisar montos abajo o cerrar esta pantalla.
          </p>
        </div>
      ) : (
        <div
          className="mb-4 rounded-2xl px-4 py-3 text-white"
          style={{ backgroundColor: SUITE.navy }}
        >
          <p className="text-xs font-bold uppercase tracking-wide text-white/70">
            Completitud del día
          </p>
          <p className="mt-1 text-lg font-bold">
            {day ? `${day.accounted} / 3 terminales` : '— / 3'} · Incompleto
          </p>
          {day ? (
            <p className="mt-1 text-sm text-white/80">
              Faltan: {day.missing.map((n) => `T${n}`).join(', ')}
            </p>
          ) : null}
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {TPV_TERMINALS.map((n) => {
          const slot = day?.slots.find((s) => s.terminal === n);
          const state = slot?.state || 'missing';
          const bg =
            state === 'photo'
              ? '#DCFCE7'
              : state === 'unused'
                ? '#E2E8F0'
                : state === 'partial'
                  ? '#FEF3C7'
                  : '#FEF3C7';
          const border =
            activeTerminal === n ? SUITE.orange : 'transparent';
          return (
            <button
              key={n}
              type="button"
              onClick={() => {
                setActiveTerminal(n);
                setTab('captura');
                if (!slot?.venta) setActiveKind('venta');
                else if (!slot?.propinaUpload) setActiveKind('propina');
              }}
              className="min-h-[72px] rounded-2xl px-2 py-3 text-center shadow-sm"
              style={{ backgroundColor: bg, border: `3px solid ${border}` }}
            >
              <span className="block text-sm font-bold" style={{ color: SUITE.navy }}>
                T{n}
              </span>
              <span className="mt-1 block text-xs text-slate-600">
                {statusLabel(slot || null)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex gap-2">
        {(
          [
            ['captura', 'Captura'],
            ['revisar', 'Revisar'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="min-h-12 flex-1 rounded-2xl text-sm font-bold"
            style={{
              backgroundColor: tab === id ? SUITE.navy : '#fff',
              color: tab === id ? '#fff' : SUITE.navy,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Vuelve a tomar la foto</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}
      {msg ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {msg}
        </div>
      ) : null}

      {tab === 'captura' ? (
        <section className="space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
              Terminal {activeTerminal}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Dos fotos: <strong>Totalización</strong> (cobrado) y{' '}
              <strong>Reporte de propinas</strong>. Encuadre completo · mín.{' '}
              {TPV_MIN_LONG_SIDE}px · nitidez ≥ {TPV_MIN_SHARPNESS}.
            </p>

            <Link
              href="/ventas/corte-tpv/guia"
              className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 bg-white text-base font-bold shadow-sm"
              style={{ borderColor: SUITE.navy, color: SUITE.navy }}
            >
              Guía de fotos · ver ejemplos
            </Link>

            {activeSlot?.state !== 'unused' && !pendingFile ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-[11px] font-bold text-slate-600">
                    Venta{activeSlot?.venta ? ' ✓' : ''}
                  </p>
                  {activeSlot?.venta?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeSlot.venta.image_url}
                      alt="Venta"
                      className="mt-1 max-h-24 w-full rounded-lg object-contain"
                    />
                  ) : (
                    <p className="mt-2 text-center text-xs text-slate-400">
                      Sin foto
                    </p>
                  )}
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-[11px] font-bold text-slate-600">
                    Propinas{activeSlot?.propinaUpload ? ' ✓' : ''}
                  </p>
                  {activeSlot?.propinaUpload?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeSlot.propinaUpload.image_url}
                      alt="Propinas"
                      className="mt-1 max-h-24 w-full rounded-lg object-contain"
                    />
                  ) : (
                    <p className="mt-2 text-center text-xs text-slate-400">
                      Sin foto
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
            />

            {activeSlot?.state !== 'unused' ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveKind('venta');
                    fileRef.current?.click();
                  }}
                  className="flex min-h-14 items-center justify-center rounded-2xl px-2 text-sm font-bold text-white"
                  style={{ backgroundColor: SUITE.orange }}
                >
                  {activeSlot?.venta ? 'Retomar venta' : 'Foto venta'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveKind('propina');
                    fileRef.current?.click();
                  }}
                  className="flex min-h-14 items-center justify-center rounded-2xl px-2 text-sm font-bold text-white"
                  style={{ backgroundColor: '#0F9F9C' }}
                >
                  {activeSlot?.propinaUpload
                    ? 'Retomar propinas'
                    : 'Foto propinas'}
                </button>
              </div>
            ) : null}

            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={`Vista previa ${photoKindLabel(activeKind)}`}
                className="mt-4 max-h-64 w-full rounded-xl object-contain bg-slate-100"
              />
            ) : null}

            {pendingFile ? (
              <div className="mt-4 space-y-3">
                <p
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-white"
                  style={{
                    backgroundColor:
                      activeKind === 'venta' ? SUITE.orange : '#0F9F9C',
                  }}
                >
                  {photoKindLabel(activeKind)} · T{activeTerminal}
                </p>
                <p className="text-xs text-slate-500">
                  {pendingFile.width}×{pendingFile.height}px · nitidez{' '}
                  {pendingFile.sharpness.toFixed(0)}
                </p>
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Al guardar se lee el ticket automáticamente
                  {activeKind === 'venta'
                    ? ' (TOTAL GENERAL).'
                    : ' (total propina).'}{' '}
                  Si no se entiende, te pedirá volver a tomar la foto. Monto
                  manual solo si hace falta corregir:
                </p>
                {activeKind === 'venta' ? (
                  <label className="block">
                    <span className="text-sm font-medium text-slate-600">
                      Cobrado (opcional / corrección)
                    </span>
                    <input
                      inputMode="decimal"
                      className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-lg"
                      placeholder="Auto desde foto"
                      value={cobrado}
                      onChange={(e) => setCobrado(e.target.value)}
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="text-sm font-medium text-slate-600">
                      Propina (opcional / corrección)
                    </span>
                    <input
                      inputMode="decimal"
                      className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-lg"
                      placeholder="Auto desde foto"
                      value={propina}
                      onChange={(e) => setPropina(e.target.value)}
                    />
                  </label>
                )}
                {activeKind === 'venta' && netoPreview != null ? (
                  <p className="text-sm text-slate-600">
                    Vista previa: <strong>{moneyMx(netoPreview)}</strong>
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={busyTerminal === activeTerminal}
                  onClick={() => void submitPhoto()}
                  className="min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-60"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  {busyTerminal === activeTerminal
                    ? 'Leyendo ticket…'
                    : `Guardar ${activeKind === 'venta' ? 'venta' : 'propinas'} · T${activeTerminal}`}
                </button>
                <button
                  type="button"
                  onClick={clearPending}
                  className="min-h-12 w-full rounded-2xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  Descartar y volver a tomar
                </button>
              </div>
            ) : null}

            <button
              type="button"
              disabled={busyTerminal === activeTerminal}
              onClick={() => void markUnused(activeTerminal)}
              className="mt-4 min-h-14 w-full rounded-2xl border-2 text-base font-bold disabled:opacity-60"
              style={{ borderColor: SUITE.navy, color: SUITE.navy }}
            >
              No se utilizó la terminal {activeTerminal}
            </button>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {loading ? (
            <p className="text-center text-sm text-slate-500">Cargando…</p>
          ) : (
            TPV_TERMINALS.map((n) => {
              const slot = day?.slots.find((s) => s.terminal === n);
              const venta = slot?.venta || null;
              const propinaUp = slot?.propinaUpload || null;
              const terminalNeto = computeNetoBanco(
                venta?.total_cobrado ?? null,
                propinaUp?.propina ?? null
              );
              return (
                <div
                  key={n}
                  className="rounded-2xl bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold" style={{ color: SUITE.navy }}>
                        Terminal {n}
                      </p>
                      <p className="text-sm text-slate-500">
                        {statusLabel(slot || null)}
                        {venta || propinaUp
                          ? ` · ${(venta || propinaUp)!.uploader_username}`
                          : ''}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-3 py-1 text-xs font-bold"
                      style={{
                        backgroundColor:
                          slot?.state === 'missing'
                            ? '#FEF3C7'
                            : slot?.state === 'unused'
                              ? '#E2E8F0'
                              : slot?.state === 'partial'
                                ? '#FEF3C7'
                                : '#DCFCE7',
                        color: SUITE.navy,
                      }}
                    >
                      {slot?.state === 'missing'
                        ? 'Falta'
                        : slot?.state === 'unused'
                          ? 'No usada'
                          : slot?.state === 'partial'
                            ? 'Parcial'
                            : '2 fotos'}
                    </span>
                  </div>

                  {slot?.state !== 'unused' ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[11px] font-bold text-slate-500">
                          Venta
                        </p>
                        {venta?.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={venta.image_url}
                            alt={`Venta T${n}`}
                            className="mt-1 max-h-36 w-full rounded-xl object-contain bg-slate-50"
                          />
                        ) : (
                          <p className="mt-2 text-xs text-slate-400">Sin foto</p>
                        )}
                        {venta ? (
                          <button
                            type="button"
                            className="mt-1 w-full rounded-lg bg-slate-100 py-1.5 text-[11px] font-bold"
                            style={{ color: SUITE.navy }}
                            onClick={() => void saveAmounts(venta)}
                          >
                            Cobrado: {moneyMx(venta.total_cobrado)}
                          </button>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-500">
                          Propinas
                        </p>
                        {propinaUp?.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={propinaUp.image_url}
                            alt={`Propinas T${n}`}
                            className="mt-1 max-h-36 w-full rounded-xl object-contain bg-slate-50"
                          />
                        ) : (
                          <p className="mt-2 text-xs text-slate-400">Sin foto</p>
                        )}
                        {propinaUp ? (
                          <button
                            type="button"
                            className="mt-1 w-full rounded-lg bg-slate-100 py-1.5 text-[11px] font-bold"
                            style={{ color: SUITE.navy }}
                            onClick={() => void saveAmounts(propinaUp)}
                          >
                            Propina: {moneyMx(propinaUp.propina)}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {slot?.state === 'photo' ? (
                    <p className="mt-3 text-center text-sm">
                      Neto banco:{' '}
                      <strong style={{ color: SUITE.navy }}>
                        {moneyMx(terminalNeto)}
                      </strong>
                    </p>
                  ) : null}

                  {venta && venta.status !== 'verified' ? (
                    <button
                      type="button"
                      className="mt-3 min-h-12 w-full rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: '#0F766E' }}
                      onClick={() => void markVerified(venta)}
                    >
                      Marcar verificado
                    </button>
                  ) : null}

                  {slot?.state === 'missing' || slot?.state === 'partial' ? (
                    <button
                      type="button"
                      className="mt-3 min-h-12 w-full rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: SUITE.orange }}
                      onClick={() => {
                        setActiveTerminal(n);
                        setActiveKind(slot?.venta ? 'propina' : 'venta');
                        setTab('captura');
                      }}
                    >
                      Ir a captura T{n}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}

          {/* Week verify */}
          {verify ? (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p
                className="text-xs font-bold uppercase tracking-wide"
                style={{ color: SUITE.orange }}
              >
                Verificación vs semana
                {verify.weekNumber > 0 ? ` · S${verify.weekNumber}` : ''}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {verify.mondayKey} – {verify.sundayKey}
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">TPV cobrado</dt>
                  <dd className="font-semibold">{moneyMx(verify.tpv.cobrado)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">TPV propina</dt>
                  <dd className="font-semibold">{moneyMx(verify.tpv.propina)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">TPV neto a banco</dt>
                  <dd className="font-bold" style={{ color: SUITE.navy }}>
                    {moneyMx(verify.tpv.neto)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
                  <dt className="text-slate-500">
                    Presupuesto bancario
                    {verify.presupuesto.semLabel
                      ? ` (${verify.presupuesto.semLabel})`
                      : ''}
                  </dt>
                  <dd className="font-semibold">
                    {verify.presupuesto.hasData
                      ? moneyMx(verify.presupuesto.ventasBancarias)
                      : 'Sin dato'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Δ neto vs presupuesto</dt>
                  <dd
                    className="font-bold"
                    style={{
                      color:
                        verify.deltaNetoVsPresupuesto == null
                          ? '#94a3b8'
                          : Math.abs(verify.deltaNetoVsPresupuesto) < 1
                            ? '#0F766E'
                            : '#b45309',
                    }}
                  >
                    {verify.deltaNetoVsPresupuesto == null
                      ? '—'
                      : moneyMx(verify.deltaNetoVsPresupuesto)}
                  </dd>
                </div>
                {verify.infocaja.hasData ? (
                  <div className="flex justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                    <dt>Infocaja bancarias (ref.)</dt>
                    <dd>{moneyMx(verify.infocaja.bancarias)}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-3 text-xs text-slate-400">
                Fotos semana: {verify.tpv.photoCount} · No usadas:{' '}
                {verify.tpv.unusedCount} · OCR: auto (Mifel)
              </p>
            </div>
          ) : null}

          {uploads.length === 0 && !loading ? (
            <p className="text-center text-sm text-slate-400">
              Sin registros para esta fecha.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
