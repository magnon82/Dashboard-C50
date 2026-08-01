'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_TERMINALS,
  computeNetoBanco,
  estimateSharpnessFromImageData,
  moneyMx,
  todayCdmxIso,
  validateTpvImageQuality,
  type TpvCorteUpload,
  type TpvDayCompleteness,
  type TpvTerminalNumber,
  type TpvWeekVerify,
  buildDayCompleteness,
  buildTpvWeekVerify,
} from '@/app/lib/tpv-cortes';
import type { FinancialRecord } from '@/app/lib/ventas-semana';
import { SUITE } from '@/app/lib/themes';

type Tab = 'captura' | 'revisar';

async function loadImageMetrics(file: File): Promise<{
  width: number;
  height: number;
  sharpness: number;
  previewUrl: string;
}> {
  const previewUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('No se pudo leer la imagen'));
    el.src = previewUrl;
  });

  const maxProbe = 320;
  const scale = Math.min(1, maxProbe / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { width: img.width, height: img.height, sharpness: 999, previewUrl };
  }
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const sharpness = estimateSharpnessFromImageData(data);
  return { width: img.width, height: img.height, sharpness, previewUrl };
}

function statusLabel(u: TpvCorteUpload | null, state: string): string {
  if (state === 'missing') return 'Falta';
  if (state === 'unused') return 'No se usó';
  if (!u) return 'Falta';
  if (u.status === 'verified') return 'Verificado';
  if (u.status === 'parsed') return 'Con montos';
  if (u.status === 'pending') return 'Foto sin montos';
  if (u.status === 'rejected') return 'Rechazado';
  return u.status;
}

export function TpvCorteClient() {
  const [tab, setTab] = useState<Tab>('captura');
  const [corteDate, setCorteDate] = useState(todayCdmxIso);
  const [day, setDay] = useState<TpvDayCompleteness | null>(null);
  const [uploads, setUploads] = useState<TpvCorteUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTerminal, setBusyTerminal] = useState<number | null>(null);
  const [activeTerminal, setActiveTerminal] = useState<TpvTerminalNumber>(1);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tpvRes, finRes] = await Promise.all([
        fetch(
          `/api/tpv-cortes?date=${encodeURIComponent(corteDate)}&urls=1&day=1`,
          { cache: 'no-store' }
        ),
        fetch('/api/financial-records?sources=infocaja,presupuesto_ingreso', {
          cache: 'no-store',
        }),
      ]);
      const tpvJson = await tpvRes.json();
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
        tpvJson.day ||
          buildDayCompleteness(list, corteDate)
      );

      let records: FinancialRecord[] = [];
      if (finRes.ok) {
        const finJson = await finRes.json();
        records = finJson.records || [];
      }

      const weekRes = await fetch(`/api/tpv-cortes?week=1&urls=0`, {
        cache: 'no-store',
      });
      const weekJson = weekRes.ok ? await weekRes.json() : { uploads: list };
      setVerify(
        buildTpvWeekVerify(
          (weekJson.uploads || list) as TpvCorteUpload[],
          records,
          corteDate
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
      const metrics = await loadImageMetrics(file);
      const quality = validateTpvImageQuality({
        width: metrics.width,
        height: metrics.height,
        byteSize: file.size,
        sharpness: metrics.sharpness,
      });
      if (!quality.ok) {
        URL.revokeObjectURL(metrics.previewUrl);
        setError(quality.errors[0]);
        clearPending();
        return;
      }
      if (preview) URL.revokeObjectURL(preview);
      setPreview(metrics.previewUrl);
      setPendingFile({
        file,
        width: metrics.width,
        height: metrics.height,
        sharpness: metrics.sharpness,
      });
    } catch {
      setError('No se pudo analizar la foto. Vuelve a tomar la foto.');
    }
  }

  async function submitPhoto() {
    if (!pendingFile) {
      setError('Primero toma o elige la foto del corte.');
      return;
    }
    setBusyTerminal(activeTerminal);
    setError(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set('file', pendingFile.file);
      fd.set('terminal_number', String(activeTerminal));
      fd.set('corte_date', corteDate);
      fd.set('width_px', String(pendingFile.width));
      fd.set('height_px', String(pendingFile.height));
      fd.set('sharpness', String(pendingFile.sharpness));
      if (cobrado.trim()) fd.set('total_cobrado', cobrado.trim());
      if (propina.trim()) fd.set('propina', propina.trim());
      const neto = computeNetoBanco(
        cobrado.trim() ? Number(cobrado) : null,
        propina.trim() ? Number(propina) : null
      );
      if (neto != null) fd.set('neto_banco', String(neto));

      const res = await fetch('/api/tpv-cortes', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.error ||
            'No se pudo subir. Vuelve a tomar la foto si salió borrosa.'
        );
        return;
      }
      clearPending();
      if (json.day) setDay(json.day);
      setMsg(
        json.day?.complete
          ? 'Proceso concluido correctamente. Las 3 terminales ya están listas.'
          : `Terminal ${activeTerminal}: foto guardada.`
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir');
    } finally {
      setBusyTerminal(null);
    }
  }

  async function markUnused(terminal: TpvTerminalNumber) {
    if (
      !confirm(
        `¿Confirmas que no se utilizó la terminal ${terminal} el ${corteDate}?`
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
          corte_date: corteDate,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo marcar como no utilizada');
        return;
      }
      if (json.day) setDay(json.day);
      setMsg(
        json.day?.complete
          ? 'Proceso concluido correctamente. Las 3 terminales ya están listas.'
          : `Terminal ${terminal}: marcada como no utilizada.`
      );
      await refresh();
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
      const cob = prompt('Total cobrado (tarjetas)', String(u.total_cobrado ?? ''));
      if (cob === null) return;
      const tip = prompt('Propina', String(u.propina ?? '0'));
      if (tip === null) return;
      const neto = computeNetoBanco(
        cob === '' ? null : Number(cob),
        tip === '' ? null : Number(tip)
      );
      const res = await fetch(`/api/tpv-cortes/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_cobrado: cob === '' ? null : Number(cob),
          propina: tip === '' ? null : Number(tip),
          neto_banco: neto,
          status: 'parsed',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se guardaron montos');
        return;
      }
      setMsg(`Terminal ${u.terminal_number}: montos actualizados.`);
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
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo verificar');
        return;
      }
      await refresh();
    } finally {
      setBusyTerminal(null);
    }
  }

  const netoPreview = computeNetoBanco(
    cobrado.trim() ? Number(cobrado) : null,
    propina.trim() ? Number(propina) : null
  );

  const dayComplete = Boolean(day?.complete);

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
            ? `Las 3 terminales del ${corteDate} ya están contabilizadas (foto o «No se utilizó»).`
            : 'Hay 3 terminales. Cada una necesita foto nítida o «No se utilizó».'}
        </p>
      </header>

      <label className="mb-4 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <span className="text-sm font-medium text-slate-600">Fecha</span>
        <input
          type="date"
          className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 text-base"
          value={corteDate}
          onChange={(e) => {
            clearPending();
            setCorteDate(e.target.value || todayCdmxIso());
          }}
        />
      </label>

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
            No hace falta volver a Ventas. Puedes revisar montos abajo o cerrar
            esta pantalla.
          </p>
          <Link
            href="/ventas"
            className="mt-4 inline-block text-xs text-white/60 underline underline-offset-2"
          >
            Ir a Ventas
          </Link>
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
              }}
              className="min-h-[72px] rounded-2xl px-2 py-3 text-center shadow-sm"
              style={{ backgroundColor: bg, border: `3px solid ${border}` }}
            >
              <span className="block text-sm font-bold" style={{ color: SUITE.navy }}>
                T{n}
              </span>
              <span className="mt-1 block text-xs text-slate-600">
                {statusLabel(slot?.upload || null, state)}
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
              Foto del ticket: prioridad{' '}
              <strong className="font-semibold text-slate-700">
                Reporte de propinas
              </strong>
              ; también sirve la{' '}
              <strong className="font-semibold text-slate-700">
                Totalización
              </strong>{' '}
              (ventas). Encuadre completo · mín. {TPV_MIN_LONG_SIDE}px · nitidez ≥{' '}
              {TPV_MIN_SHARPNESS}.
            </p>
            <Link
              href="/ventas/corte-tpv/guia"
              className="mt-2 inline-block text-sm font-semibold underline underline-offset-2"
              style={{ color: SUITE.orange }}
            >
              Ver guía con ejemplos de foto
            </Link>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-4 flex min-h-14 w-full items-center justify-center rounded-2xl text-base font-bold text-white"
              style={{ backgroundColor: SUITE.orange }}
            >
              Tomar / elegir foto
            </button>

            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt={`Vista previa terminal ${activeTerminal}`}
                className="mt-4 max-h-64 w-full rounded-xl object-contain bg-slate-100"
              />
            ) : null}

            {pendingFile ? (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-500">
                  {pendingFile.width}×{pendingFile.height}px · nitidez{' '}
                  {pendingFile.sharpness.toFixed(0)}
                </p>
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">
                    Total cobrado (opcional ahora)
                  </span>
                  <input
                    inputMode="decimal"
                    className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-lg"
                    placeholder="0.00"
                    value={cobrado}
                    onChange={(e) => setCobrado(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">
                    Propina (opcional ahora)
                  </span>
                  <input
                    inputMode="decimal"
                    className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-lg"
                    placeholder="0.00"
                    value={propina}
                    onChange={(e) => setPropina(e.target.value)}
                  />
                </label>
                <p className="text-sm text-slate-600">
                  Neto a banco:{' '}
                  <strong>{netoPreview != null ? moneyMx(netoPreview) : '—'}</strong>
                </p>
                <button
                  type="button"
                  disabled={busyTerminal === activeTerminal}
                  onClick={() => void submitPhoto()}
                  className="min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-60"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  {busyTerminal === activeTerminal
                    ? 'Subiendo…'
                    : `Guardar foto · Terminal ${activeTerminal}`}
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
              const u = slot?.upload || null;
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
                        {statusLabel(u, slot?.state || 'missing')}
                        {u ? ` · ${u.uploader_username}` : ''}
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
                              : '#DCFCE7',
                        color: SUITE.navy,
                      }}
                    >
                      {slot?.state === 'missing'
                        ? 'Falta'
                        : slot?.state === 'unused'
                          ? 'No usada'
                          : 'Foto'}
                    </span>
                  </div>

                  {u?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.image_url}
                      alt={`Corte terminal ${n}`}
                      className="mt-3 max-h-48 w-full rounded-xl object-contain bg-slate-50"
                    />
                  ) : null}

                  {u && u.entry_kind === 'photo' ? (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                      <div>
                        <p className="text-xs text-slate-500">Cobrado</p>
                        <p className="font-semibold">{moneyMx(u.total_cobrado)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Propina</p>
                        <p className="font-semibold">{moneyMx(u.propina)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Neto banco</p>
                        <p className="font-semibold">{moneyMx(u.neto_banco)}</p>
                      </div>
                    </div>
                  ) : null}

                  {u && u.entry_kind === 'photo' ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        type="button"
                        className="min-h-12 rounded-xl bg-slate-100 text-sm font-bold"
                        style={{ color: SUITE.navy }}
                        onClick={() => void saveAmounts(u)}
                      >
                        Editar montos
                      </button>
                      {u.status !== 'verified' ? (
                        <button
                          type="button"
                          className="min-h-12 rounded-xl text-sm font-bold text-white"
                          style={{ backgroundColor: '#0F766E' }}
                          onClick={() => void markVerified(u)}
                        >
                          Marcar verificado
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {slot?.state === 'missing' ? (
                    <button
                      type="button"
                      className="mt-3 min-h-12 w-full rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: SUITE.orange }}
                      onClick={() => {
                        setActiveTerminal(n);
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
                {verify.tpv.unusedCount} · OCR: manual (stub)
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

      {!dayComplete ? (
        <p className="mt-8 text-center text-xs text-slate-400">
          <Link
            href="/ventas/corte-tpv/guia"
            className="underline underline-offset-2"
            style={{ color: SUITE.navy }}
          >
            Guía de fotos
          </Link>
          <span className="mx-2 text-slate-300">·</span>
          <Link
            href="/ventas"
            className="underline underline-offset-2"
            style={{ color: SUITE.navy }}
          >
            Ventas
          </Link>
        </p>
      ) : (
        <p className="mt-8 text-center text-xs text-slate-400">
          <Link
            href="/ventas/corte-tpv/guia"
            className="underline underline-offset-2"
            style={{ color: SUITE.navy }}
          >
            Guía de fotos
          </Link>
        </p>
      )}
    </div>
  );
}
