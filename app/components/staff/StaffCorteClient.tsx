'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_TERMINALS,
  TPV_CORTE_DATE_HELP,
  computeNetoBanco,
  defaultCorteDateCdmx,
  estimateSharpnessFromImageData,
  moneyMx,
  photoKindLabel,
  validateTpvImageQuality,
  type TpvCorteUpload,
  type TpvPhotoKind,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';
import type {
  StaffRptBancosFromTpv,
  StaffRptInfocajaDay,
  StaffRptRow,
  StaffCorteStatus,
} from '@/app/lib/staff-rpt';
import { parseMoneyInput } from '@/app/lib/staff-rpt';
import { SUITE } from '@/app/lib/themes';

type PendingFile = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  sharpness: number;
};

type DayPayload = {
  date: string;
  uploads: TpvCorteUpload[];
  bancos: StaffRptBancosFromTpv;
  infocaja: StaffRptInfocajaDay;
  infocajaError: string | null;
  rpt: StaffRptRow | null;
  rptError: string | null;
  status: StaffCorteStatus;
  cashCheck: {
    mismatch: boolean;
    belowInfocaja?: boolean;
    delta: number | null;
    message: string | null;
  };
  recent: StaffRptRow[];
};

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

function MoneyInput({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="flex h-full flex-col gap-1.5">
      <div>
        <span className="text-sm font-semibold text-slate-700">
          {label}
          {required ? ' *' : ''}
        </span>
        {hint ? (
          <p className="mt-0.5 text-xs leading-snug text-slate-500">{hint}</p>
        ) : null}
      </div>
      <input
        inputMode="decimal"
        className="mt-auto min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-lg"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function StaffCorteClient() {
  const corteDate = defaultCorteDateCdmx();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<DayPayload | null>(null);

  const [activeTerminal, setActiveTerminal] = useState<TpvTerminalNumber>(1);
  const [activeKind, setActiveKind] = useState<TpvPhotoKind>('venta');
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [cobrado, setCobrado] = useState('');
  const [propina, setPropina] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [wi, setWi] = useState('');
  const [eventos, setEventos] = useState('');
  /** Fuente de verdad: contado = tómbola (mismo depósito). */
  const [efectivoContado, setEfectivoContado] = useState('');
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff-corte?date=${encodeURIComponent(corteDate)}&recent=1`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo cargar el corte');
        setPayload(null);
        return;
      }
      setPayload(data as DayPayload);
      const rpt = data.rpt as StaffRptRow | null;
      if (rpt) {
        setWi(String(rpt.wi_amount ?? ''));
        setEventos(String(rpt.eventos_amount ?? ''));
        setEfectivoContado(
          rpt.efectivo_contado != null
            ? String(rpt.efectivo_contado)
            : rpt.efectivo_tombola != null
              ? String(rpt.efectivo_tombola)
              : ''
        );
        setNotes(rpt.notes || '');
      }
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
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setCobrado('');
    setPropina('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setError(null);
    setMsg(null);
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
        setError(quality.errors.join(' '));
        return;
      }
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      setPending({
        file,
        previewUrl: metrics.previewUrl,
        width: metrics.width,
        height: metrics.height,
        sharpness: metrics.sharpness,
      });
      setCobrado('');
      setPropina('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo validar la foto');
    }
  }

  async function submitPhoto() {
    if (!pending) return;

    setBusy(`t${activeTerminal}-${activeKind}`);
    setError(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set('file', pending.file);
      fd.set('terminal_number', String(activeTerminal));
      fd.set('photo_kind', activeKind);
      fd.set('corte_date', corteDate);
      fd.set('width_px', String(pending.width));
      fd.set('height_px', String(pending.height));
      fd.set('sharpness', String(pending.sharpness));
      if (activeKind === 'venta' && String(cobrado).trim()) {
        fd.set(
          'total_cobrado',
          String(Number(String(cobrado).replace(/,/g, '').trim()))
        );
      } else if (activeKind === 'propina' && String(propina).trim() !== '') {
        fd.set(
          'propina',
          String(Number(String(propina).replace(/,/g, '').trim()))
        );
      }

      const res = await fetch('/api/tpv-cortes', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error ||
            'No se pudo leer el ticket. Vuelve a tomar la foto.'
        );
        return;
      }
      clearPending();
      const ocrBit =
        data.ocr?.status === 'done'
          ? activeKind === 'venta'
            ? ` · ${moneyMx(data.ocr.total_cobrado ?? data.upload?.total_cobrado)}`
            : ` · propina ${moneyMx(data.ocr.propina ?? data.upload?.propina)}`
          : '';
      setMsg(
        `T${activeTerminal} · ${photoKindLabel(activeKind)} guardada${ocrBit}`
      );
      await refresh();
      const nextMissing = (data.day?.missing || []) as number[];
      // Si falta la otra foto de esta terminal, cambiar a esa
      const slotAfter = (data.day?.slots || []).find(
        (s: { terminal: number }) => s.terminal === activeTerminal
      );
      if (slotAfter?.state === 'partial') {
        setActiveKind(activeKind === 'venta' ? 'propina' : 'venta');
      } else if (nextMissing.length) {
        setActiveTerminal(nextMissing[0] as TpvTerminalNumber);
        setActiveKind('venta');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir');
    } finally {
      setBusy(null);
    }
  }

  async function markUnused(terminal: TpvTerminalNumber) {
    if (
      !confirm(
        `¿Confirmas que no se utilizó la Terminal ${terminal} en este corte? (no hace falta foto de venta ni de propinas)`
      )
    ) {
      return;
    }
    setBusy(`u${terminal}`);
    setError(null);
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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo marcar');
        return;
      }
      setMsg(`Terminal ${terminal}: no usada`);
      clearPending();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(null);
    }
  }

  async function savePhotoAmount(u: TpvCorteUpload) {
    const kind = u.photo_kind === 'propina' ? 'propina' : 'venta';
    if (kind === 'venta') {
      const cobStr = prompt(
        'Total ventas (TOTALIZACIÓN) — léelo de la foto',
        String(u.total_cobrado ?? '')
      );
      if (cobStr == null) return;
      const cob = cobStr.trim() === '' ? null : Number(cobStr.replace(/,/g, ''));
      if (cob == null || !Number.isFinite(cob) || cob < 0) {
        setError('Total inválido');
        return;
      }
      setBusy(`a${u.id}`);
      try {
        const res = await fetch(`/api/tpv-cortes/${u.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            total_cobrado: cob,
            status: 'parsed',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'No se pudo guardar el monto');
          return;
        }
        setMsg(`Cobrado T${u.terminal_number} actualizado`);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error');
      } finally {
        setBusy(null);
      }
      return;
    }

    const tipStr = prompt(
      'Propinas (REPORTE DE PROPINAS) — léelas de la foto; 0 si no hay',
      String(u.propina ?? '0')
    );
    if (tipStr == null) return;
    const tip = tipStr.trim() === '' ? 0 : Number(tipStr.replace(/,/g, ''));
    if (!Number.isFinite(tip) || tip < 0) {
      setError('Propina inválida');
      return;
    }
    setBusy(`a${u.id}`);
    try {
      const res = await fetch(`/api/tpv-cortes/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propina: tip,
          status: 'parsed',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo guardar el monto');
        return;
      }
      setMsg(`Propina T${u.terminal_number} actualizada`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(null);
    }
  }

  async function cerrarCorte() {
    setBusy('close');
    setError(null);
    setMsg(null);
    try {
      const info = payload?.infocaja;
      const contadoNum = parseMoneyInput(efectivoContado);
      if (contadoNum == null || contadoNum < 0) {
        setError('Indica el efectivo en tómbola (obligatorio)');
        return;
      }
      if (info?.hasEfectivo && contadoNum < info.efectivo) {
        setError(
          `Efectivo en tómbola (${moneyMx(contadoNum)}) es menor que Infocaja (${moneyMx(info.efectivo)}). Corrige el monto antes de cerrar.`
        );
        return;
      }
      const res = await fetch('/api/staff-corte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: corteDate,
          wi_amount: wi,
          eventos_amount: eventos === '' ? '0' : eventos,
          // Contado = tómbola (mismo monto depositado)
          efectivo_tombola: String(contadoNum),
          efectivo_contado: String(contadoNum),
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const blockers = Array.isArray(data.blockers)
          ? data.blockers.join(' ')
          : '';
        setError([data.error, blockers].filter(Boolean).join(' — '));
        return;
      }
      setMsg('Corte del día cerrado correctamente');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cerrar');
    } finally {
      setBusy(null);
    }
  }

  const bancos = payload?.bancos;
  const status = payload?.status;
  const infocaja = payload?.infocaja;
  const netoPreview =
    activeKind === 'venta'
      ? computeNetoBanco(
          cobrado.trim() ? Number(cobrado.replace(/,/g, '')) : null,
          null
        )
      : null;

  const liveCashDelta = (() => {
    if (!efectivoContado.trim() || !infocaja?.hasEfectivo) return null;
    const c = parseMoneyInput(efectivoContado);
    if (c == null) return null;
    return Math.round((c - infocaja.efectivo) * 100) / 100;
  })();

  const efectivoContadoNum = parseMoneyInput(efectivoContado);
  const efectivoContadoOk =
    efectivoContadoNum != null && efectivoContadoNum >= 0;
  const efectivoBelowInfocaja =
    efectivoContadoOk &&
    Boolean(infocaja?.hasEfectivo) &&
    (efectivoContadoNum as number) < (infocaja?.efectivo ?? 0);
  const canCerrarCorte =
    Boolean(bancos?.canSaveRpt) &&
    efectivoContadoOk &&
    !efectivoBelowInfocaja;

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
      {/* Fecha + progreso */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orange }}
        >
          Corte del día
        </p>
        <h2 className="mt-1 text-xl font-bold capitalize" style={{ color: SUITE.navy }}>
          {formatCorteDateDisplay(corteDate)}
        </h2>
        <p className="mt-1 text-xs text-slate-500">{TPV_CORTE_DATE_HELP}</p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-slate-50 px-2 py-3">
            <p className="font-bold text-slate-800">
              {bancos?.day.accounted ?? 0}/3
            </p>
            <p className="text-slate-500">Terminales</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-3">
            <p className="font-bold text-slate-800">
              {bancos?.amountsReady ? 'OK' : '…'}
            </p>
            <p className="text-slate-500">Bancos</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-2 py-3">
            <p className="font-bold text-slate-800">
              {status?.closeSaved ? 'OK' : '…'}
            </p>
            <p className="text-slate-500">Cierre</p>
          </div>
        </div>

        {status?.corteCompleto ? (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
            Corte completo
          </p>
        ) : status?.terminalsReady ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Terminales listas · completa WI / Eventos / tómbola y cierra el corte
          </p>
        ) : (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
            1) Por terminal: foto venta (Totalización) + foto propinas, o «no se
            usó» → 2) Cierre
          </p>
        )}
      </section>

      {error ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {msg}
        </div>
      ) : null}
      {payload?.rptError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {payload.rptError}
        </div>
      ) : null}

      {loading && !payload ? (
        <p className="text-center text-sm text-slate-500">Cargando corte…</p>
      ) : null}

      {/* 1. Terminales */}
      <section className="space-y-3">
        <h3 className="px-1 text-sm font-bold uppercase tracking-wide text-slate-600">
          1 · Terminales (bancos)
        </h3>

        <div className="flex gap-2">
          {TPV_TERMINALS.map((n) => {
            const slot = bancos?.terminals.find((t) => t.terminal === n);
            const done =
              slot &&
              (slot.state === 'unused' ||
                (slot.state === 'photo' && slot.hasAmounts));
            const partial = slot?.state === 'partial';
            return (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setActiveTerminal(n);
                  clearPending();
                  if (!slot?.hasVentaPhoto) setActiveKind('venta');
                  else if (!slot?.hasPropinaPhoto) setActiveKind('propina');
                  else setActiveKind('venta');
                }}
                className="min-h-12 flex-1 rounded-2xl text-sm font-bold"
                style={{
                  backgroundColor:
                    activeTerminal === n
                      ? SUITE.navy
                      : done
                        ? '#DCFCE7'
                        : partial
                          ? '#FEF3C7'
                          : '#fff',
                  color: activeTerminal === n ? '#fff' : SUITE.navy,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
              >
                T{n}
                {done ? ' ✓' : partial ? ' …' : ''}
              </button>
            );
          })}
        </div>

        {(() => {
          const slot = bancos?.terminals.find(
            (t) => t.terminal === activeTerminal
          );
          const ventaUpload =
            payload?.uploads.find(
              (u) =>
                Number(u.terminal_number) === activeTerminal &&
                u.entry_kind === 'photo' &&
                (u.photo_kind === 'venta' || u.photo_kind == null) &&
                u.status !== 'rejected'
            ) || null;
          const propinaUpload =
            payload?.uploads.find(
              (u) =>
                Number(u.terminal_number) === activeTerminal &&
                u.entry_kind === 'photo' &&
                u.photo_kind === 'propina' &&
                u.status !== 'rejected'
            ) || null;
          const unusedUpload =
            payload?.uploads.find(
              (u) =>
                Number(u.terminal_number) === activeTerminal &&
                u.entry_kind === 'unused'
            ) || null;

          const terminalNeto = computeNetoBanco(
            ventaUpload?.total_cobrado ?? null,
            propinaUpload?.propina ?? null
          );

          return (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="font-bold" style={{ color: SUITE.navy }}>
                Terminal {activeTerminal}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Dos fotos por terminal: <strong>Totalización</strong> (cobrado) y{' '}
                <strong>Reporte de propinas</strong>. O marca «No se utilizó».
              </p>

              <Link
                href="/ventas/corte-tpv/guia"
                className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 bg-white text-base font-bold shadow-sm transition-opacity hover:opacity-95"
                style={{ borderColor: SUITE.navy, color: SUITE.navy }}
              >
                Guía de fotografía
              </Link>

              {slot?.state === 'unused' || unusedUpload ? (
                <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
                  Marcada como no utilizada
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      ['venta', ventaUpload, 'Venta · Totalización'],
                      ['propina', propinaUpload, 'Propinas · Reporte'],
                    ] as const
                  ).map(([kind, up, label]) => (
                    <div
                      key={kind}
                      className="rounded-xl border border-slate-100 bg-slate-50/80 p-2"
                    >
                      <p className="text-[11px] font-bold text-slate-600">
                        {label}
                        {up ? ' ✓' : ''}
                      </p>
                      {up?.image_url && !pending ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={up.image_url}
                          alt={`${label} T${activeTerminal}`}
                          className="mt-1 max-h-28 w-full rounded-lg bg-white object-contain"
                        />
                      ) : (
                        <p className="mt-2 text-center text-xs text-slate-400">
                          Sin foto
                        </p>
                      )}
                      {up && kind === 'venta' ? (
                        <p className="mt-1 text-center text-xs font-semibold text-slate-700">
                          {moneyMx(up.total_cobrado)}
                        </p>
                      ) : null}
                      {up && kind === 'propina' ? (
                        <p className="mt-1 text-center text-xs font-semibold text-slate-700">
                          {moneyMx(up.propina)}
                        </p>
                      ) : null}
                      {up && !pending ? (
                        <button
                          type="button"
                          disabled={busy === `a${up.id}`}
                          onClick={() => void savePhotoAmount(up)}
                          className="mt-1 w-full rounded-lg bg-white py-1.5 text-[11px] font-bold disabled:opacity-60"
                          style={{ color: SUITE.navy }}
                        >
                          Corregir monto
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {ventaUpload && propinaUpload && !pending ? (
                <p className="mt-3 text-center text-sm text-slate-600">
                  Neto banco T{activeTerminal}:{' '}
                  <strong style={{ color: SUITE.navy }}>
                    {moneyMx(terminalNeto)}
                  </strong>{' '}
                  <span className="text-xs text-slate-400">
                    (cobrado + propinas)
                  </span>
                </p>
              ) : null}

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
              />

              {!unusedUpload && !pending ? (
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
                    {ventaUpload ? 'Retomar venta' : 'Foto venta'}
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
                    {propinaUpload ? 'Retomar propinas' : 'Foto propinas'}
                  </button>
                </div>
              ) : null}

              {pending ? (
                <div className="mt-4 space-y-3">
                  <p
                    className="rounded-xl px-3 py-2 text-sm font-semibold text-white"
                    style={{
                      backgroundColor:
                        activeKind === 'venta' ? SUITE.orange : '#0F9F9C',
                    }}
                  >
                    Capturando: {photoKindLabel(activeKind)} · T{activeTerminal}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pending.previewUrl}
                    alt="Vista previa"
                    className="max-h-56 w-full rounded-xl bg-slate-100 object-contain"
                  />
                  <p className="text-xs text-slate-500">
                    {pending.width}×{pending.height}px · nitidez{' '}
                    {pending.sharpness.toFixed(0)} (mín. {TPV_MIN_SHARPNESS} ·
                    lado ≥{TPV_MIN_LONG_SIDE})
                  </p>
                  <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950">
                    Al guardar se lee el ticket automáticamente. Si no se
                    entiende, vuelve a tomar la foto. Monto manual solo para
                    corregir.
                  </p>
                  {activeKind === 'venta' ? (
                    <MoneyInput
                      label="Cobrado (opcional / corrección)"
                      value={cobrado}
                      onChange={setCobrado}
                      hint="Auto desde TOTAL GENERAL; déjalo vacío si la foto está clara"
                    />
                  ) : (
                    <MoneyInput
                      label="Propina (opcional / corrección)"
                      value={propina}
                      onChange={setPropina}
                      hint="Auto desde el reporte; 0 si no hay propinas"
                    />
                  )}
                  {activeKind === 'venta' && netoPreview != null ? (
                    <p className="text-xs text-slate-500">
                      Vista previa: {moneyMx(netoPreview)}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy === `t${activeTerminal}-${activeKind}`}
                    onClick={() => void submitPhoto()}
                    className="min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-60"
                    style={{ backgroundColor: SUITE.navy }}
                  >
                    {busy === `t${activeTerminal}-${activeKind}`
                      ? 'Leyendo ticket…'
                      : `Guardar ${activeKind === 'venta' ? 'venta' : 'propinas'} · T${activeTerminal}`}
                  </button>
                  <button
                    type="button"
                    onClick={clearPending}
                    className="min-h-12 w-full rounded-2xl border border-slate-200 text-sm font-medium text-slate-600"
                  >
                    Descartar foto
                  </button>
                </div>
              ) : null}

              {!pending ? (
                <button
                  type="button"
                  disabled={busy === `u${activeTerminal}`}
                  onClick={() => void markUnused(activeTerminal)}
                  className="mt-3 min-h-12 w-full rounded-2xl border-2 text-sm font-bold disabled:opacity-60"
                  style={{ borderColor: SUITE.navy, color: SUITE.navy }}
                >
                  No se utilizó la terminal {activeTerminal}
                </button>
              ) : null}
            </div>
          );
        })()}
      </section>

      {/* Bancos resumen */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
          Bancos (desde fotos TPV)
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Solo lectura · suma de terminales del día · sin teclear líneas del RPT
          Excel
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-slate-500">Cobrado</p>
            <p className="font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(bancos?.cobrado)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Propinas</p>
            <p className="font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(bancos?.propina)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Neto banco</p>
            <p className="font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(bancos?.neto)}
            </p>
          </div>
        </div>
        {bancos?.blockers?.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {bancos.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm font-medium text-emerald-800">
            Terminales y montos listos para el cierre
          </p>
        )}
      </section>

      {/* 2. Cierre */}
      <section className="rounded-2xl bg-white p-4 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
          2 · Cierre del día
        </h3>
        <p className="text-xs text-slate-500">
          WI y Eventos · efectivo en tómbola vs Infocaja. Sin cortesías (vienen
          de Gmail). Propinas = suma de tickets TPV.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput
            label="WI (Carranza / Walk-in)"
            value={wi}
            onChange={setWi}
            required
            hint="Venta WI del día"
          />
          <MoneyInput
            label="Eventos"
            value={eventos}
            onChange={setEventos}
            required
            hint="0 si no hubo eventos ese día"
          />
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm">
          <p className="font-semibold text-slate-700">Propinas (tickets TPV)</p>
          <p className="mt-1 text-lg font-bold" style={{ color: SUITE.navy }}>
            {moneyMx(bancos?.propina)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Se guarda automáticamente al cerrar · no se vuelve a pedir
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 px-3 py-3">
          <p className="text-sm font-semibold text-slate-700">
            Efectivo Infocaja (referencia)
          </p>
          {payload?.infocajaError ? (
            <p className="mt-1 text-xs text-amber-800">{payload.infocajaError}</p>
          ) : infocaja?.hasEfectivo ? (
            <p className="mt-1 text-lg font-bold" style={{ color: SUITE.navy }}>
              {moneyMx(infocaja.efectivo)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              Aún no hay Infocaja Efectivo para esta fecha
            </p>
          )}
        </div>

        <MoneyInput
          label="Efectivo en Tómbola"
          value={efectivoContado}
          onChange={setEfectivoContado}
          required
          hint={
            infocaja?.hasEfectivo
              ? 'Obligatorio. Monto que depositas en tómbola. No puede ser menor que Infocaja.'
              : 'Obligatorio. Monto que depositas en tómbola.'
          }
        />
        {liveCashDelta != null && liveCashDelta < 0 ? (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-950"
          >
            Alerta: el efectivo en tómbola ({moneyMx(efectivoContadoNum ?? 0)}){' '}
            es menor que Infocaja ({moneyMx(infocaja?.efectivo ?? 0)}). Faltan{' '}
            {moneyMx(Math.abs(liveCashDelta))}. Corrige el monto para poder
            cerrar el corte.
          </p>
        ) : null}
        {efectivoContado.trim() !== '' && !efectivoContadoOk ? (
          <p role="alert" className="text-sm text-red-700">
            Indica un monto válido de efectivo en tómbola.
          </p>
        ) : null}

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">
            Notas (opcional)
          </span>
          <textarea
            className="mt-1.5 min-h-[72px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </label>

        <button
          type="button"
          disabled={busy === 'close' || !canCerrarCorte}
          onClick={() => void cerrarCorte()}
          className="min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: SUITE.navy }}
        >
          {busy === 'close'
            ? 'Guardando…'
            : status?.closeSaved
              ? 'Actualizar cierre del día'
              : 'Cerrar corte del día'}
        </button>
        {!bancos?.canSaveRpt ? (
          <p className="text-center text-xs text-slate-500">
            Completa las 3 terminales (2 fotos + montos, o no usada) antes de
            cerrar
          </p>
        ) : !efectivoContadoOk ? (
          <p className="text-center text-xs text-slate-500">
            Indica el efectivo en tómbola para poder cerrar
          </p>
        ) : efectivoBelowInfocaja ? (
          <p className="text-center text-xs text-red-700">
            El efectivo en tómbola es menor que Infocaja — no se puede cerrar
          </p>
        ) : null}
      </section>

      {payload?.recent?.length ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
            Cierres recientes
          </h3>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {payload.recent.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="font-medium text-slate-800">{r.rpt_date}</span>
                <span className="text-slate-500">
                  WI {moneyMx(r.wi_amount)} · Banco {moneyMx(r.bancos_neto_tpv)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
