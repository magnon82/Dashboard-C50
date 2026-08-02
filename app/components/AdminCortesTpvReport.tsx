'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TPV_TERMINALS,
  buildDayCompleteness,
  computeNetoBanco,
  defaultCorteDateCdmx,
  moneyMx,
  photoKindLabel,
  todayCdmxIso,
  type TpvAdminReportDay,
  type TpvCorteUpload,
  type TpvPhotoKind,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';
import {
  prepareTpvPhotoForUpload,
  readTpvApiJson,
} from '@/app/lib/tpv-upload-client';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');
const TEAL = '#0F9F9C';

function apiErrorText(json: Record<string, unknown>, fallback: string): string {
  return (
    [json.error, json.hint].filter(Boolean).map(String).join(' — ') || fallback
  );
}

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

function StatusBadge({
  complete,
  corteCompleto,
  accounted,
}: {
  complete: boolean;
  corteCompleto: boolean;
  accounted: number;
}) {
  if (corteCompleto) {
    return (
      <span
        className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
        style={{ backgroundColor: TEAL }}
      >
        Corte completo
      </span>
    );
  }
  if (complete) {
    return (
      <span
        className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
        style={{ backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep }}
      >
        TPV 3/3 · sin cierre
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
      Incompleto · {accounted}/3
    </span>
  );
}

function SlotStateChip({ state }: { state: string }) {
  if (state === 'photo') {
    return (
      <span className="text-[10px] font-bold uppercase" style={{ color: TEAL }}>
        Venta + propina
      </span>
    );
  }
  if (state === 'unused') {
    return (
      <span className="text-[10px] font-bold uppercase text-slate-500">
        No usada
      </span>
    );
  }
  if (state === 'partial') {
    return (
      <span
        className="text-[10px] font-bold uppercase"
        style={{ color: SUITE.orangeDeep }}
      >
        Parcial
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold uppercase text-slate-400">
      Sin registro
    </span>
  );
}

function PhotoCard({
  label,
  kind,
  upload,
  busy,
  onEditAmount,
  onReplace,
  onDelete,
}: {
  label: string;
  kind: TpvPhotoKind;
  upload: TpvCorteUpload | null;
  busy: boolean;
  onEditAmount: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {kind === 'venta' ? 'Venta (Totalización)' : 'Propinas'}
        </p>
        {upload?.image_url ? (
          <a
            href={upload.image_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold underline"
            style={{ color: SUITE.orangeDeep }}
          >
            Ampliar
          </a>
        ) : null}
      </div>

      {upload?.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <a
          href={upload.image_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block overflow-hidden rounded-lg bg-slate-50"
        >
          <img
            src={upload.image_url}
            alt={label}
            className="max-h-36 w-full object-contain"
          />
        </a>
      ) : (
        <div className="mt-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80">
          <p className="text-xs text-slate-400">Sin foto</p>
        </div>
      )}

      <p className="mt-2 text-center text-sm font-semibold text-slate-800">
        {kind === 'propina'
          ? moneyMx(upload?.propina)
          : moneyMx(upload?.total_cobrado)}
      </p>
      {upload?.uploader_username ? (
        <p className="mt-0.5 text-center text-[11px] text-slate-400">
          Subió: {upload.uploader_username}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy || !upload}
          onClick={onEditAmount}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Editar monto
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: SUITE.navy }}
        >
          {upload ? 'Reemplazar' : 'Subir foto'}
        </button>
        {upload ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Eliminar
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onReplace(f);
          }}
        />
      </div>
    </div>
  );
}

type Props = {
  /** Compact embed on /admin Financieros */
  compact?: boolean;
};

/**
 * Reporte admin Cortes TPV: listado por fecha, detalle expandible y edición.
 */
export function AdminCortesTpvReport({ compact = false }: Props) {
  const [days, setDays] = useState<TpvAdminReportDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [rptHint, setRptHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploads, setUploads] = useState<TpvCorteUpload[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  /** Fecha elegida para subir/revisar (admin puede cualquier día). */
  const [jumpDate, setJumpDate] = useState(() => defaultCorteDateCdmx());

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tpv-cortes?report=1&limit=60', {
        cache: 'no-store',
      });
      const json = (await res.json()) as {
        error?: string;
        hint?: string;
        days?: TpvAdminReportDay[];
        rptError?: string | null;
      };
      if (!res.ok) {
        setError(apiErrorText(json, 'No se pudo cargar el reporte'));
        setDays([]);
        return;
      }
      setDays((json.days || []) as TpvAdminReportDay[]);
      setRptHint(json.rptError || null);
    } catch {
      setError('Error de red al cargar el reporte de cortes');
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (date: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(
        `/api/tpv-cortes?date=${encodeURIComponent(date)}&urls=1&day=1`,
        { cache: 'no-store' }
      );
      const json = (await res.json()) as {
        error?: string;
        uploads?: TpvCorteUpload[];
      };
      if (!res.ok) {
        setError(
          apiErrorText(
            json as Record<string, unknown>,
            'No se pudieron cargar las fotos del día'
          )
        );
        setUploads([]);
        return;
      }
      setUploads(json.uploads || []);
    } catch {
      setError('Error de red al cargar el detalle');
      setUploads([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function toggleDay(date: string) {
    if (expanded === date) {
      setExpanded(null);
      setUploads([]);
      return;
    }
    setExpanded(date);
    setMsg('');
    await loadDetail(date);
  }

  async function refreshExpanded() {
    await loadList();
    if (expanded) await loadDetail(expanded);
  }

  const visibleDays = useMemo(() => {
    let list = days;
    if (onlyIncomplete) {
      list = list.filter((d) => !d.corteCompleto);
    }
    if (jumpDate && /^\d{4}-\d{2}-\d{2}$/.test(jumpDate)) {
      const found = list.filter((d) => d.date === jumpDate);
      if (found.length) return found;
      // Día sin registros aún: permite expandir y cargar/subir
      return [
        {
          date: jumpDate,
          complete: false,
          accounted: 0,
          missing: [...TPV_TERMINALS],
          slots: TPV_TERMINALS.map((terminal) => ({
            terminal,
            state: 'missing' as const,
            cobrado: null,
            propina: null,
            neto: null,
            ventaUploader: null,
            propinaUploader: null,
            unusedUploader: null,
          })),
          totals: { cobrado: 0, propina: 0, neto: 0 },
          rpt: null,
          hasRpt: false,
          corteCompleto: false,
        },
      ];
    }
    return compact ? list.slice(0, 8) : list;
  }, [days, onlyIncomplete, jumpDate, compact]);

  useEffect(() => {
    if (!jumpDate || !/^\d{4}-\d{2}-\d{2}$/.test(jumpDate)) return;
    setExpanded(jumpDate);
    void loadDetail(jumpDate);
  }, [jumpDate, loadDetail]);

  function bundleFor(
    terminal: TpvTerminalNumber
  ): {
    unused: TpvCorteUpload | null;
    venta: TpvCorteUpload | null;
    propina: TpvCorteUpload | null;
  } {
    const day = buildDayCompleteness(uploads, expanded || '');
    const slot = day.slots.find((s) => s.terminal === terminal);
    if (!slot) return { unused: null, venta: null, propina: null };
    if (slot.state === 'unused') {
      return { unused: slot.upload, venta: null, propina: null };
    }
    return {
      unused: null,
      venta: slot.venta,
      propina: slot.propinaUpload,
    };
  }

  async function replacePhoto(
    date: string,
    terminal: TpvTerminalNumber,
    kind: TpvPhotoKind,
    file: File
  ) {
    const key = `${date}-t${terminal}-${kind}`;
    setBusyKey(key);
    setError('');
    setMsg('');
    try {
      const prepared = await prepareTpvPhotoForUpload(file);
      try {
        const fd = new FormData();
        fd.set('file', prepared.file);
        fd.set('terminal_number', String(terminal));
        fd.set('photo_kind', kind);
        fd.set('corte_date', date);
        fd.set('width_px', String(prepared.width));
        fd.set('height_px', String(prepared.height));
        fd.set('sharpness', String(prepared.sharpness));
        const res = await fetch('/api/tpv-cortes', { method: 'POST', body: fd });
        const json = await readTpvApiJson(res);
        if (!res.ok) {
          setError(apiErrorText(json, 'No se pudo subir la foto'));
          return;
        }
        setMsg(
          `T${terminal} · ${photoKindLabel(kind)} guardada con OCR (${date}).`
        );
        await refreshExpanded();
      } finally {
        URL.revokeObjectURL(prepared.previewUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir');
    } finally {
      setBusyKey(null);
    }
  }

  async function editAmount(upload: TpvCorteUpload) {
    const kind = upload.photo_kind === 'propina' ? 'propina' : 'venta';
    const label =
      kind === 'propina' ? 'Propina (REPORTE)' : 'Total cobrado (TOTALIZACIÓN)';
    const current =
      kind === 'propina'
        ? String(upload.propina ?? '')
        : String(upload.total_cobrado ?? '');
    const raw = window.prompt(label, current);
    if (raw === null) return;
    setBusyKey(upload.id);
    setError('');
    try {
      const body =
        kind === 'propina'
          ? { propina: raw.trim() === '' ? null : Number(raw), status: 'parsed' }
          : {
              total_cobrado: raw.trim() === '' ? null : Number(raw),
              status: 'parsed',
            };
      const res = await fetch(`/api/tpv-cortes/${upload.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await readTpvApiJson(res);
      if (!res.ok) {
        setError(apiErrorText(json, 'No se guardó el monto'));
        return;
      }
      setMsg(`Monto actualizado · T${upload.terminal_number}.`);
      await refreshExpanded();
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteUpload(upload: TpvCorteUpload) {
    const kind =
      upload.entry_kind === 'unused'
        ? 'marca «no usada»'
        : upload.photo_kind === 'propina'
          ? 'foto de propinas'
          : 'foto de venta';
    if (
      !confirm(
        `¿Eliminar ${kind} de T${upload.terminal_number} (${upload.corte_date})?`
      )
    ) {
      return;
    }
    setBusyKey(upload.id);
    setError('');
    try {
      const res = await fetch(`/api/tpv-cortes/${upload.id}`, {
        method: 'DELETE',
      });
      const json = await readTpvApiJson(res);
      if (!res.ok) {
        setError(apiErrorText(json, 'No se pudo eliminar'));
        return;
      }
      setMsg(`Eliminado · T${upload.terminal_number}.`);
      await refreshExpanded();
    } finally {
      setBusyKey(null);
    }
  }

  async function markUnused(date: string, terminal: TpvTerminalNumber) {
    if (
      !confirm(
        `¿Marcar terminal ${terminal} como no utilizada el ${date}? Se borrarán fotos de esa terminal.`
      )
    ) {
      return;
    }
    setBusyKey(`${date}-t${terminal}-unused`);
    setError('');
    try {
      const res = await fetch('/api/tpv-cortes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_kind: 'unused',
          terminal_number: terminal,
          corte_date: date,
        }),
      });
      const json = await readTpvApiJson(res);
      if (!res.ok) {
        setError(apiErrorText(json, 'No se pudo marcar como no utilizada'));
        return;
      }
      setMsg(`T${terminal} marcada como no utilizada.`);
      await refreshExpanded();
    } finally {
      setBusyKey(null);
    }
  }

  const stats = useMemo(() => {
    const total = days.length;
    const complete = days.filter((d) => d.corteCompleto).length;
    const tpvOk = days.filter((d) => d.complete && !d.corteCompleto).length;
    const incomplete = days.filter((d) => !d.complete).length;
    return { total, complete, tpvOk, incomplete };
  }, [days]);

  return (
    <div className="space-y-4">
      <div
        className="rounded-[24px] border border-slate-100 bg-white p-5"
        style={{
          boxShadow: SUITE.shadow,
          borderTop: `4px solid ${SUITE.navy}`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: SUITE.navy }}
            >
              Operación · Caja
            </p>
            <h3
              className="mt-1 text-lg font-bold"
              style={{ color: theme.title }}
            >
              Cortes TPV · reporte y carga
            </h3>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              Elige cualquier fecha y sube Venta (Totalización) + Propinas por
              terminal (misma compresión/OCR que Staff). Útil para días pasados
              o para probar el fix de subida.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadList()}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? 'Cargando…' : 'Actualizar'}
            </button>
            {compact ? (
              <Link
                href="/admin/cortes-tpv"
                className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-white"
                style={{ backgroundColor: SUITE.navy }}
              >
                Abrir reporte completo
              </Link>
            ) : (
              <Link
                href="/ventas/corte-tpv"
                className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-white"
                style={{ backgroundColor: TEAL }}
              >
                Ir a captura
              </Link>
            )}
            <Link
              href="/ventas/corte-tpv/guia"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Guía de fotos
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: SUITE.navy }}
          >
            Cargar / revisar por fecha
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Admin puede cualquier día. Staff solo usa la ventana del día
            (madrugada → día anterior). Hoy CDMX: {todayCdmxIso()}.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block text-xs font-semibold text-slate-600">
              Fecha del corte
              <input
                type="date"
                value={jumpDate}
                onChange={(e) => setJumpDate(e.target.value)}
                className="mt-1 block min-h-11 w-full min-w-[11rem] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => setJumpDate(defaultCorteDateCdmx())}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Ventana staff
            </button>
            <button
              type="button"
              onClick={() => setJumpDate(todayCdmxIso())}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Hoy
            </button>
            {jumpDate ? (
              <button
                type="button"
                onClick={() => setJumpDate('')}
                className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600"
              >
                Ver todos los días
              </button>
            ) : null}
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={onlyIncomplete}
                onChange={(e) => setOnlyIncomplete(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Solo incompletos
            </label>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Días listados', value: String(stats.total), color: SUITE.navy },
            {
              label: 'Corte completo',
              value: String(stats.complete),
              color: TEAL,
            },
            {
              label: 'TPV listo sin cierre',
              value: String(stats.tpvOk),
              color: SUITE.orangeDeep,
            },
            {
              label: 'Incompletos',
              value: String(stats.incomplete),
              color: '#64748b',
            },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {k.label}
              </p>
              <p
                className="mt-0.5 text-xl font-bold tabular-nums"
                style={{ color: k.color }}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {msg ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {msg}
          </div>
        ) : null}
        {rptHint ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {rptHint}
          </div>
        ) : null}

        {loading && days.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            Cargando cortes…
          </p>
        ) : null}

        {!loading && !error && visibleDays.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            {jumpDate
              ? `No hay registros para ${jumpDate}.`
              : 'Aún no hay cortes TPV ni cierres RPT.'}
          </p>
        ) : null}

        <div className="mt-5 space-y-3">
          {visibleDays.map((day) => {
            const open = expanded === day.date;
            return (
              <div
                key={day.date}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/50"
              >
                <button
                  type="button"
                  onClick={() => void toggleDay(day.date)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-white/70"
                >
                  <div className="min-w-0">
                    <p
                      className="text-sm font-bold capitalize"
                      style={{ color: theme.title }}
                    >
                      {formatCorteDateDisplay(day.date)}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {day.date}
                      {day.hasRpt ? ' · con cierre RPT' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="hidden items-center gap-1.5 sm:flex">
                      {day.slots.map((s) => (
                        <span
                          key={s.terminal}
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                          style={{
                            backgroundColor:
                              s.state === 'photo' || s.state === 'unused'
                                ? `${TEAL}18`
                                : s.state === 'partial'
                                  ? SUITE.orangeSoft
                                  : '#f1f5f9',
                            color:
                              s.state === 'photo' || s.state === 'unused'
                                ? TEAL
                                : s.state === 'partial'
                                  ? SUITE.orangeDeep
                                  : '#94a3b8',
                          }}
                          title={`T${s.terminal}: ${s.state}`}
                        >
                          T{s.terminal}
                          {s.state === 'unused'
                            ? '·—'
                            : s.state === 'photo'
                              ? '·✓'
                              : s.state === 'partial'
                                ? '·½'
                                : '··'}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs font-semibold tabular-nums text-slate-600">
                      Neto {moneyMx(day.totals.neto)}
                    </p>
                    <StatusBadge
                      complete={day.complete}
                      corteCompleto={day.corteCompleto}
                      accounted={day.accounted}
                    />
                    <span className="text-slate-400" aria-hidden>
                      {open ? '▾' : '▸'}
                    </span>
                  </div>
                </button>

                {open ? (
                  <div className="border-t border-slate-100 bg-white px-4 py-4">
                    {detailLoading ? (
                      <p className="text-center text-sm text-slate-500">
                        Cargando fotos…
                      </p>
                    ) : (
                      <>
                        {day.rpt ? (
                          <div
                            className="mb-4 rounded-xl border px-3 py-3"
                            style={{
                              borderColor: `${TEAL}44`,
                              backgroundColor: `${TEAL}0d`,
                            }}
                          >
                            <p
                              className="text-[10px] font-bold uppercase tracking-wide"
                              style={{ color: TEAL }}
                            >
                              Cierre del día (staff_rpt)
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                              {(
                                [
                                  ['WI', day.rpt.wi_amount],
                                  ['Eventos', day.rpt.eventos_amount],
                                  [
                                    'Efectivo en tómbola',
                                    day.rpt.efectivo_tombola ??
                                      day.rpt.efectivo_contado,
                                  ],
                                  ['Infocaja', day.rpt.efectivo_infocaja],
                                  ['Bancos neto TPV', day.rpt.bancos_neto_tpv],
                                ] as const
                              ).map(([lab, val]) => (
                                <div key={lab}>
                                  <p className="text-[10px] text-slate-500">
                                    {lab}
                                  </p>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {moneyMx(val)}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] text-slate-400">
                              Cerrado por {day.rpt.created_by}
                              {day.rpt.updated_by
                                ? ` · actualizó ${day.rpt.updated_by}`
                                : ''}
                            </p>
                          </div>
                        ) : (
                          <p className="mb-4 text-xs text-slate-400">
                            Sin cierre RPT guardado para este día.
                          </p>
                        )}

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                          {TPV_TERMINALS.map((terminal) => {
                            const bundle = bundleFor(terminal);
                            const slotMeta = day.slots.find(
                              (s) => s.terminal === terminal
                            );
                            const neto = computeNetoBanco(
                              bundle.venta?.total_cobrado ?? null,
                              bundle.propina?.propina ?? null
                            );
                            const busy =
                              busyKey?.startsWith(`${day.date}-t${terminal}`) ||
                              busyKey === bundle.venta?.id ||
                              busyKey === bundle.propina?.id ||
                              busyKey === bundle.unused?.id;

                            return (
                              <div
                                key={terminal}
                                className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3"
                              >
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div>
                                    <p
                                      className="text-sm font-bold"
                                      style={{ color: SUITE.navy }}
                                    >
                                      Terminal {terminal}
                                    </p>
                                    <SlotStateChip
                                      state={slotMeta?.state || 'missing'}
                                    />
                                  </div>
                                  {!bundle.unused ? (
                                    <button
                                      type="button"
                                      disabled={Boolean(busy)}
                                      onClick={() =>
                                        void markUnused(day.date, terminal)
                                      }
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      Marcar no usada
                                    </button>
                                  ) : null}
                                </div>

                                {bundle.unused ? (
                                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
                                    <p className="text-sm font-semibold text-slate-600">
                                      No se utilizó
                                    </p>
                                    <p className="mt-1 text-[11px] text-slate-400">
                                      {bundle.unused.uploader_username}
                                    </p>
                                    <button
                                      type="button"
                                      disabled={Boolean(busy)}
                                      onClick={() =>
                                        void deleteUpload(bundle.unused!)
                                      }
                                      className="mt-3 rounded-lg border border-red-200 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      Quitar marca (habilitar fotos)
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                      <PhotoCard
                                        label="Venta (Totalización)"
                                        kind="venta"
                                        upload={bundle.venta}
                                        busy={Boolean(busy)}
                                        onEditAmount={() => {
                                          if (bundle.venta)
                                            void editAmount(bundle.venta);
                                          else
                                            setError(
                                              'Sube la foto de venta antes de editar el monto'
                                            );
                                        }}
                                        onReplace={(f) =>
                                          void replacePhoto(
                                            day.date,
                                            terminal,
                                            'venta',
                                            f
                                          )
                                        }
                                        onDelete={() => {
                                          if (bundle.venta)
                                            void deleteUpload(bundle.venta);
                                        }}
                                      />
                                      <PhotoCard
                                        label="Propinas"
                                        kind="propina"
                                        upload={bundle.propina}
                                        busy={Boolean(busy)}
                                        onEditAmount={() => {
                                          if (bundle.propina)
                                            void editAmount(bundle.propina);
                                          else
                                            setError(
                                              'Sube la foto de propinas antes de editar el monto'
                                            );
                                        }}
                                        onReplace={(f) =>
                                          void replacePhoto(
                                            day.date,
                                            terminal,
                                            'propina',
                                            f
                                          )
                                        }
                                        onDelete={() => {
                                          if (bundle.propina)
                                            void deleteUpload(bundle.propina);
                                        }}
                                      />
                                    </div>
                                    <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                                      <div>
                                        <p className="text-slate-400">Cobrado</p>
                                        <p className="font-semibold text-slate-700">
                                          {moneyMx(bundle.venta?.total_cobrado)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-slate-400">Propina</p>
                                        <p className="font-semibold text-slate-700">
                                          {moneyMx(bundle.propina?.propina)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-slate-400">Neto</p>
                                        <p className="font-semibold text-slate-700">
                                          {moneyMx(neto)}
                                        </p>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {compact && days.length > 8 ? (
          <p className="mt-4 text-center text-sm text-slate-500">
            Mostrando los 8 más recientes.{' '}
            <Link
              href="/admin/cortes-tpv"
              className="font-semibold underline"
              style={{ color: SUITE.navy }}
            >
              Ver reporte completo
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
