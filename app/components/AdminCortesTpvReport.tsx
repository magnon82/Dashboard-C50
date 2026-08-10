'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TPV_TERMINALS,
  adminCorteDateWindow,
  buildDayCompleteness,
  computeNetoBanco,
  moneyMx,
  photoKindLabel,
  type TpvAdminReportDay,
  type TpvCorteUpload,
  type TpvPhotoKind,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';
import {
  prepareTpvPhotoForUpload,
  readTpvApiJson,
} from '@/app/lib/tpv-upload-client';
import { expectedTombolaDeposit } from '@/app/lib/staff-rpt';
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

function moneyField(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '';
  return String(v);
}

type MasterRptFormState = {
  wi_amount: string;
  eventos_os_amount: string;
  eventos_extra_amount: string;
  efectivo_contado: string;
  efectivo_tombola: string;
  bancos_cobrado_tpv: string;
  bancos_propina_tpv: string;
  notes: string;
};

function formFromDayRpt(
  day: TpvAdminReportDay
): MasterRptFormState {
  const rpt = day.rpt;
  const tip =
    rpt?.bancos_propina_tpv ?? day.totals.propina ?? 0;
  const rec = rpt?.efectivo_contado ?? null;
  const proposedTombola = expectedTombolaDeposit(rec, tip);
  return {
    wi_amount: moneyField(rpt?.wi_amount ?? 0),
    eventos_os_amount: moneyField(
      rpt?.eventos_os_amount ?? rpt?.eventos_amount ?? 0
    ),
    eventos_extra_amount: moneyField(rpt?.eventos_extra_amount ?? 0),
    efectivo_contado: moneyField(rec ?? 0),
    efectivo_tombola: moneyField(
      proposedTombola ?? rpt?.efectivo_tombola ?? 0
    ),
    bancos_cobrado_tpv: moneyField(
      rpt?.bancos_cobrado_tpv ?? day.totals.cobrado ?? 0
    ),
    bancos_propina_tpv: moneyField(tip),
    notes: rpt?.notes ?? '',
  };
}

function MasterRptForm({
  day,
  saving,
  onSave,
}: {
  day: TpvAdminReportDay;
  saving: boolean;
  onSave: (form: MasterRptFormState) => void;
}) {
  const [form, setForm] = useState<MasterRptFormState>(() =>
    formFromDayRpt(day)
  );

  useEffect(() => {
    setForm(formFromDayRpt(day));
  }, [day.date, day.hasRpt, day.rpt?.updated_by, day.totals.cobrado, day.totals.propina]);

  const offline = !day.complete;

  function patchForm(key: keyof MasterRptFormState, value: string) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'efectivo_contado' || key === 'bancos_propina_tpv') {
        const recRaw =
          key === 'efectivo_contado' ? value : next.efectivo_contado;
        const tipRaw =
          key === 'bancos_propina_tpv' ? value : next.bancos_propina_tpv;
        const rec = Number(String(recRaw).replace(/,/g, ''));
        const tip = Number(String(tipRaw).replace(/,/g, ''));
        const proposed = expectedTombolaDeposit(
          Number.isFinite(rec) ? rec : null,
          Number.isFinite(tip) ? tip : 0
        );
        if (proposed != null) next.efectivo_tombola = moneyField(proposed);
      }
      return next;
    });
  }

  return (
    <div
      className="mb-4 rounded-xl border px-3 py-3"
      style={{
        borderColor: offline ? `${SUITE.orange}66` : `${TEAL}44`,
        backgroundColor: offline ? SUITE.orangeSoft : `${TEAL}0d`,
      }}
    >
      <p
        className="text-[10px] font-bold uppercase tracking-wide"
        style={{ color: offline ? SUITE.orangeDeep : TEAL }}
      >
        {day.hasRpt ? 'Editar cierre RPT' : 'Generar cierre RPT'}
        {offline ? ' · offline (sin TPV completo)' : ''}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        {offline
          ? 'Puedes cerrar el día sin fotos TPV. Captura WI, eventos, efectivo y bancos manualmente.'
          : 'Actualiza montos del cierre. Bancos se rellenan desde TPV si ya están listos.'}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {(
          [
            ['wi_amount', 'WI'],
            ['eventos_os_amount', 'Eventos OS'],
            ['eventos_extra_amount', 'Eventos extra'],
            ['efectivo_contado', 'Efectivo recibido'],
            ['efectivo_tombola', 'Efectivo en tómbola (recibido − propinas)'],
            ['bancos_cobrado_tpv', 'Bancos cobrado'],
            ['bancos_propina_tpv', 'Propina TPV (WI)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-semibold tabular-nums text-slate-900"
              value={form[key]}
              onChange={(e) => patchForm(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <label className="mt-2 block">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Nota
        </span>
        <textarea
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900"
          value={form.notes}
          onChange={(e) =>
            setForm((f) => ({ ...f, notes: e.target.value }))
          }
          maxLength={2000}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(form)}
          className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60"
          style={{ backgroundColor: SUITE.navy }}
        >
          {saving
            ? 'Guardando…'
            : day.hasRpt
              ? 'Guardar cambios'
              : 'Generar cierre'}
        </button>
        <Link
          href={`/staff/corte?date=${encodeURIComponent(day.date)}`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Abrir flujo Staff
        </Link>
      </div>
    </div>
  );
}

/**
 * Reporte admin Cortes TPV: listado por fecha, detalle expandible y edición.
 */
export function AdminCortesTpvReport({ compact = false }: Props) {
  const [panelOpen, setPanelOpen] = useState(!compact);
  const [days, setDays] = useState<TpvAdminReportDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [rptHint, setRptHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploads, setUploads] = useState<TpvCorteUpload[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savingRpt, setSavingRpt] = useState(false);
  /** Día pendiente seleccionado (ventana Master, solo incompletos). */
  const [jumpDate, setJumpDate] = useState('');
  const dateWindow = useMemo(() => adminCorteDateWindow(), []);

  function selectPendingDate(next: string) {
    if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
      setJumpDate('');
      return;
    }
    const { minDate, maxDate } = adminCorteDateWindow();
    if (next < minDate || next > maxDate) return;
    setJumpDate(next);
  }

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
    if (compact && !panelOpen) return;
    void loadList();
  }, [loadList, compact, panelOpen]);

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

  async function saveMasterRpt(day: TpvAdminReportDay, form: MasterRptFormState) {
    setSavingRpt(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/staff-corte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: day.date,
          wi_amount: form.wi_amount,
          eventos_os_amount: form.eventos_os_amount,
          eventos_extra_amount: form.eventos_extra_amount,
          efectivo_contado: form.efectivo_contado,
          efectivo_tombola: form.efectivo_tombola,
          bancos_cobrado_tpv: form.bancos_cobrado_tpv,
          bancos_propina_tpv: form.bancos_propina_tpv,
          notes: form.notes.trim() || null,
          admin_offline: !day.complete,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        hint?: string;
        blockers?: string[];
      };
      if (!res.ok) {
        setError(
          [json.error, json.hint, ...(json.blockers || [])]
            .filter(Boolean)
            .join(' — ') || 'No se pudo guardar el cierre'
        );
        return;
      }
      setMsg(
        day.hasRpt
          ? `Cierre de ${day.date} actualizado`
          : `Cierre de ${day.date} generado`
      );
      await refreshExpanded();
    } catch {
      setError('Error de red al guardar el cierre');
    } finally {
      setSavingRpt(false);
    }
  }

  const pendingInWindow = useMemo(() => {
    const { minDate, maxDate, opDay } = dateWindow;
    const incomplete = days.filter(
      (d) =>
        !d.corteCompleto &&
        d.date >= minDate &&
        d.date <= maxDate
    );
    const hasOp = incomplete.some((d) => d.date === opDay);
    const withOp =
      !hasOp &&
      (!days.find((d) => d.date === opDay) ||
        !days.find((d) => d.date === opDay)?.corteCompleto)
        ? [
            ...incomplete,
            {
              date: opDay,
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
            } satisfies TpvAdminReportDay,
          ]
        : incomplete;
    return [...withOp].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
  }, [days, dateWindow]);

  const visibleDays = useMemo(() => {
    return compact ? pendingInWindow.slice(0, 8) : pendingInWindow;
  }, [pendingInWindow, compact]);

  // Si el seleccionado ya no es pendiente, caer al primero de la lista.
  useEffect(() => {
    if (!pendingInWindow.length) {
      if (jumpDate) setJumpDate('');
      return;
    }
    if (jumpDate && pendingInWindow.some((d) => d.date === jumpDate)) return;
    setJumpDate(pendingInWindow[0].date);
  }, [pendingInWindow, jumpDate]);

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
      const amountPrompt =
        kind === 'venta'
          ? `Monto cobrado en la terminal ${terminal} — léelo de la foto`
          : `Monto de propinas cobrado con la terminal ${terminal} — léelo de la foto; 0 si no hubo`;
      const amountRaw = window.prompt(amountPrompt, kind === 'propina' ? '0' : '');
      if (amountRaw === null) return;
      const amount = Number(String(amountRaw).trim().replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount < 0) {
        setError('Monto inválido');
        return;
      }
      const formatted = moneyMx(amount);
      const ok =
        kind === 'venta'
          ? confirm(
              `¿Este es el monto cobrado en la terminal ${terminal}?\n\n${formatted}`
            )
          : confirm(
              `¿Este es el monto de propinas cobrado con la terminal ${terminal}?\n\n${formatted}`
            );
      if (!ok) return;

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
        if (kind === 'venta') fd.set('total_cobrado', String(amount));
        else fd.set('propina', String(amount));
        const res = await fetch('/api/tpv-cortes', { method: 'POST', body: fd });
        const json = await readTpvApiJson(res);
        if (!res.ok) {
          setError(apiErrorText(json, 'No se pudo subir la foto'));
          return;
        }
        setMsg(
          `T${terminal} · ${photoKindLabel(kind)} guardada (${formatted}) · ${date}.`
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
      kind === 'propina'
        ? `Monto de propinas cobrado con la terminal ${upload.terminal_number}`
        : `Monto cobrado en la terminal ${upload.terminal_number}`;
    const current =
      kind === 'propina'
        ? String(upload.propina ?? '')
        : String(upload.total_cobrado ?? '');
    const raw = window.prompt(label, current);
    if (raw === null) return;
    const amount = Number(String(raw).trim().replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Monto inválido');
      return;
    }
    const formatted = moneyMx(amount);
    const ok =
      kind === 'venta'
        ? confirm(
            `¿Este es el monto cobrado en la terminal ${upload.terminal_number}?\n\n${formatted}`
          )
        : confirm(
            `¿Este es el monto de propinas cobrado con la terminal ${upload.terminal_number}?\n\n${formatted}`
          );
    if (!ok) return;
    setBusyKey(upload.id);
    setError('');
    try {
      const body =
        kind === 'propina'
          ? { propina: amount, status: 'parsed' }
          : {
              total_cobrado: amount,
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
              Día operativo del corte (madrugada 00:00–05:59 → día anterior) y
              hasta 7 días atrás. Misma compresión/OCR que Staff.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {compact ? (
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-white"
                style={{ backgroundColor: SUITE.navy }}
                aria-expanded={panelOpen}
              >
                {panelOpen ? 'Ocultar' : 'Mostrar'}
              </button>
            ) : null}
            {panelOpen || !compact ? (
              <button
                type="button"
                onClick={() => void loadList()}
                disabled={loading}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {loading ? 'Cargando…' : 'Actualizar'}
              </button>
            ) : null}
            {compact ? (
              <Link
                href="/admin/cortes-tpv"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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

        {panelOpen || !compact ? (
        <>
        <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: SUITE.navy }}
          >
            Cargar / revisar por fecha
          </p>
          <label className="mt-3 block text-xs font-semibold text-slate-600">
            Días pendientes
            <select
              value={jumpDate}
              onChange={(e) => selectPendingDate(e.target.value)}
              disabled={pendingInWindow.length === 0}
              className="mt-1 block min-h-11 w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 text-sm capitalize disabled:opacity-60"
            >
              {pendingInWindow.length === 0 ? (
                <option value="">Sin días pendientes</option>
              ) : (
                pendingInWindow.map((d) => (
                  <option key={d.date} value={d.date}>
                    {formatCorteDateDisplay(d.date)}
                    {d.date === dateWindow.opDay ? ' · operativo' : ''}
                    {d.complete && !d.corteCompleto
                      ? ' · TPV listo'
                      : d.accounted
                        ? ` · ${d.accounted}/3`
                        : ' · sin TPV'}
                    {d.hasRpt ? ' · con RPT' : ''}
                  </option>
                ))
              )}
            </select>
          </label>
          <p className="mt-2 text-[11px] text-slate-500">
            En días sin TPV puedes generar el cierre RPT offline y editarlo aquí
            (Master).
          </p>
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
            No hay días pendientes en los últimos 7 días.
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
                        <MasterRptForm
                          day={day}
                          saving={savingRpt}
                          onSave={(form) => void saveMasterRpt(day, form)}
                        />

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
                              Cierre guardado
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                              {(
                                [
                                  ['WI', day.rpt.wi_amount],
                                  ['Eventos', day.rpt.eventos_amount],
                                  [
                                    'Efectivo recibido',
                                    day.rpt.efectivo_contado,
                                  ],
                                  [
                                    'Efectivo en tómbola',
                                    day.rpt.efectivo_tombola,
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
                            {(() => {
                              const recibido = day.rpt.efectivo_contado;
                              const info = day.rpt.efectivo_infocaja;
                              if (
                                recibido == null ||
                                info == null ||
                                !Number.isFinite(Number(recibido)) ||
                                !Number.isFinite(Number(info))
                              ) {
                                return info == null ? (
                                  <p className="mt-2 text-[11px] text-slate-400">
                                    Infocaja pendiente — conciliar efectivo
                                    recibido cuando llegue el reporte.
                                  </p>
                                ) : null;
                              }
                              const delta =
                                Math.round(
                                  (Number(recibido) - Number(info)) * 100
                                ) / 100;
                              const ok = Math.abs(delta) <= 1;
                              return (
                                <p
                                  className={`mt-2 text-[11px] font-medium ${
                                    ok ? 'text-emerald-700' : 'text-amber-800'
                                  }`}
                                >
                                  {ok
                                    ? 'Efectivo recibido coincide con Infocaja.'
                                    : `Descuadre efectivo recibido vs Infocaja: ${moneyMx(delta)}.`}
                                </p>
                              );
                            })()}
                            <p className="mt-2 text-[11px] text-slate-400">
                              Cerrado por {day.rpt.created_by}
                              {day.rpt.updated_by
                                ? ` · actualizó ${day.rpt.updated_by}`
                                : ''}
                            </p>
                          </div>
                        ) : null}

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
        </>
        ) : null}
      </div>
    </div>
  );
}
