'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_TERMINALS,
  TPV_CORTE_DATE_HELP,
  computeNetoBanco,
  defaultCorteDateCdmx,
  isAdminWritableCorteDate,
  moneyMx,
  photoKindLabel,
  staffCorteDateWindow,
  type TpvCorteUpload,
  type TpvPhotoKind,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';
import {
  prepareTpvPhotoForUpload,
  readTpvApiJson,
} from '@/app/lib/tpv-upload-client';
import type {
  StaffRptBancosFromTpv,
  StaffRptInfocajaDay,
  StaffRptRow,
  StaffCorteStatus,
  EfectivoInfocajaReconcile,
} from '@/app/lib/staff-rpt';
import {
  cortePropinasBreakdown,
  expectedTombolaDeposit,
  parseMoneyInput,
  reconcileEfectivoRecibidoVsInfocaja,
  resolveInfocajaEfectivo,
} from '@/app/lib/staff-rpt';
import { SUITE } from '@/app/lib/themes';
import { useSession } from '@/app/lib/useSession';

type PendingFile = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  sharpness: number;
};

function parseManualAmount(raw: string): number | null {
  const n = Number(String(raw).trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function confirmTerminalAmount(
  kind: TpvPhotoKind,
  terminal: TpvTerminalNumber,
  amount: number
): boolean {
  const formatted = moneyMx(amount);
  if (kind === 'venta') {
    return confirm(
      `¿Este es el monto cobrado en la terminal ${terminal}?\n\n${formatted}`
    );
  }
  return confirm(
    `¿Este es el monto de propinas cobrado con la terminal ${terminal}?\n\n${formatted}`
  );
}

type DayWindowSummary = {
  date: string;
  closeSaved: boolean;
  corteCompleto: boolean;
  terminalsReady: boolean;
  unknown: boolean;
};

type DateWindowPayload = {
  opDay: string;
  prevDay: string;
  op: DayWindowSummary;
  prev: DayWindowSummary;
};

type AdminLookbackPayload = {
  minDate: string;
  maxDate: string;
  days: DayWindowSummary[];
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
  cashCheck: EfectivoInfocajaReconcile;
  recent: StaffRptRow[];
  dateWindow?: DateWindowPayload;
  adminLookback?: AdminLookbackPayload | null;
  isMasterAdmin?: boolean;
  canClosePendingCortes?: boolean;
  staffPrevDate?: string;
  defaultDate?: string;
  eventosDelDia?: {
    hasEvent: boolean;
    hasDigitalOs?: boolean;
    /** OS subtotals sum, or 0 when there is no digital OS / no event. */
    suggestedOsAmount?: number | null;
    suggestedOsLabel?: string | null;
    items: Array<{
      id: string;
      label: string;
      os_number: string | null;
      total: number | null;
      /** Venta sin servicio (OS subtotal). */
      venta?: number | null;
      source: 'os_digital' | 'financial';
    }>;
  };
};

const OS_SUGGEST_TOLERANCE_MXN = 0.01;

function formatOsSuggestInput(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Propone tómbola = efectivo recibido − propinas TPV. */
function proposeTombolaInput(
  recibidoRaw: string,
  propinasTpv: number | null | undefined
): string {
  const rec = parseMoneyInput(recibidoRaw);
  const expected = expectedTombolaDeposit(rec, propinasTpv ?? 0);
  if (expected == null) return '';
  return formatOsSuggestInput(expected);
}

function corteStatusLabel(summary: DayWindowSummary | null | undefined): string {
  if (!summary || summary.unknown) return '—';
  if (summary.corteCompleto) return 'Cerrado';
  if (summary.closeSaved) return 'Cierre guardado';
  if (summary.terminalsReady) return 'Sin cerrar';
  return 'Pendiente';
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

function MoneyInput({
  label,
  value,
  onChange,
  hint,
  required,
  warn,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
  warn?: boolean;
}) {
  return (
    <label className="flex h-full flex-col gap-1.5">
      <div>
        <span className="text-sm font-semibold text-slate-700">
          {label}
          {required ? ' *' : ''}
        </span>
        {hint ? (
          <p
            className={`mt-0.5 text-xs leading-snug ${
              warn ? 'font-medium text-amber-800' : 'text-slate-500'
            }`}
          >
            {hint}
          </p>
        ) : null}
      </div>
      <input
        inputMode="decimal"
        className={`mt-auto min-h-12 w-full rounded-xl border bg-white px-3 text-lg ${
          warn
            ? 'border-amber-400 ring-2 ring-amber-200'
            : 'border-slate-200'
        }`}
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function StaffCorteClient() {
  const { user } = useSession();
  const localWindow = staffCorteDateWindow();
  const [corteDate, setCorteDate] = useState(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('date')?.slice(0, 10);
      if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    }
    return defaultCorteDateCdmx();
  });
  const [dateWindow, setDateWindow] = useState<DateWindowPayload>(() => ({
    opDay: localWindow.opDay,
    prevDay: localWindow.prevDay,
    op: {
      date: localWindow.opDay,
      closeSaved: false,
      corteCompleto: false,
      terminalsReady: false,
      unknown: true,
    },
    prev: {
      date: localWindow.prevDay,
      closeSaved: false,
      corteCompleto: false,
      terminalsReady: false,
      unknown: true,
    },
  }));
  const [adminLookback, setAdminLookback] = useState<AdminLookbackPayload | null>(
    null
  );
  const [payload, setPayload] = useState<DayPayload | null>(null);
  /** Master o palomita «Cortes pendientes»: ventana 7 días + cierre offline. */
  const canPendingCortes = Boolean(
    user?.canClosePendingCortes ||
      user?.canAccessAdmin ||
      payload?.canClosePendingCortes ||
      payload?.isMasterAdmin ||
      adminLookback
  );
  const isMasterAdmin = Boolean(
    user?.canAccessAdmin || payload?.isMasterAdmin
  );
  const opDay = dateWindow.opDay;
  const prevDay = dateWindow.prevDay;
  const isPrevDay = corteDate === prevDay;
  const isOutsideStaffWindow =
    corteDate !== opDay && corteDate !== prevDay;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [activeTerminal, setActiveTerminal] = useState<TpvTerminalNumber>(1);
  const [activeKind, setActiveKind] = useState<TpvPhotoKind>('venta');
  /** Tras «Foto venta/propinas»: elegir cámara o galería. */
  const [sourcePicker, setSourcePicker] = useState<TpvPhotoKind | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [pendingAmount, setPendingAmount] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [wi, setWi] = useState('');
  const [eventosOs, setEventosOs] = useState('');
  const [eventosExtra, setEventosExtra] = useState('');
  /** Efectivo recibido del día (manual). */
  const [efectivoRecibido, setEfectivoRecibido] = useState('');
  /** Efectivo en tómbola después de propinas (manual). */
  const [efectivoTombola, setEfectivoTombola] = useState('');
  const [notes, setNotes] = useState('');

  const pendingAdminDays = useMemo(() => {
    if (!adminLookback?.days?.length) return [];
    return adminLookback.days.filter((d) => !d.corteCompleto && !d.unknown);
  }, [adminLookback]);

  const pendingSelectValue = pendingAdminDays.some((d) => d.date === corteDate)
    ? corteDate
    : '';

  // Mantener selección dentro de la ventana writable (staff: hoy/ayer; pendientes: 7 días).
  useEffect(() => {
    function syncWritableDate() {
      const { opDay: nextOp, prevDay: nextPrev } = staffCorteDateWindow();
      setDateWindow((prev) =>
        prev.opDay === nextOp && prev.prevDay === nextPrev
          ? prev
          : {
              opDay: nextOp,
              prevDay: nextPrev,
              op: {
                date: nextOp,
                closeSaved: false,
                corteCompleto: false,
                terminalsReady: false,
                unknown: true,
              },
              prev: {
                date: nextPrev,
                closeSaved: false,
                corteCompleto: false,
                terminalsReady: false,
                unknown: true,
              },
            }
      );
      setCorteDate((prev) => {
        if (prev === nextOp || prev === nextPrev) return prev;
        if (isAdminWritableCorteDate(prev)) {
          // Permiso pendientes (o ?date= en ventana 7 días): no forzar hoy antes de resolver sesión.
          if (canPendingCortes) return prev;
          const q = new URLSearchParams(window.location.search)
            .get('date')
            ?.slice(0, 10);
          if (q === prev) return prev;
        }
        return nextOp;
      });
    }
    syncWritableDate();
    window.addEventListener('focus', syncWritableDate);
    return () => window.removeEventListener('focus', syncWritableDate);
  }, [canPendingCortes]);

  // Si llega ?date= y hay permiso de pendientes, respetarlo dentro de la ventana.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('date')?.slice(0, 10);
    if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q)) return;
    if (!isAdminWritableCorteDate(q)) return;
    if (!canPendingCortes && q !== opDay && q !== prevDay) return;
    setCorteDate((prev) => (prev === q ? prev : q));
  }, [canPendingCortes, opDay, prevDay]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/staff-corte?date=${encodeURIComponent(corteDate)}&recent=1`,
        { cache: 'no-store' }
      );
      const data = await readTpvApiJson(res);
      const dw = data.dateWindow as DateWindowPayload | undefined;
      if (dw?.opDay && dw?.prevDay) {
        setDateWindow(dw);
      } else {
        const fallbackOp =
          typeof data.defaultDate === 'string'
            ? data.defaultDate
            : staffCorteDateWindow().opDay;
        const fallbackPrev =
          typeof data.staffPrevDate === 'string'
            ? data.staffPrevDate
            : staffCorteDateWindow().prevDay;
        setDateWindow((prev) => ({
          ...prev,
          opDay: fallbackOp,
          prevDay: fallbackPrev,
        }));
      }
      if (data.adminLookback && typeof data.adminLookback === 'object') {
        setAdminLookback(data.adminLookback as AdminLookbackPayload);
      } else if (
        data.isMasterAdmin !== true &&
        data.canClosePendingCortes !== true
      ) {
        setAdminLookback(null);
      }
      if (!res.ok) {
        setError(
          String(data.error || data.hint || 'No se pudo cargar el corte')
        );
        setPayload(null);
        return;
      }
      setPayload(data as unknown as DayPayload);
      const rpt = data.rpt as StaffRptRow | null;
      const eventosHint = (data as DayPayload).eventosDelDia;
      const suggestedOs =
        eventosHint?.suggestedOsAmount != null &&
        Number.isFinite(Number(eventosHint.suggestedOsAmount))
          ? Number(eventosHint.suggestedOsAmount)
          : 0;
      if (rpt) {
        setWi(String(rpt.wi_amount ?? ''));
        setEventosOs(String(rpt.eventos_os_amount ?? rpt.eventos_amount ?? ''));
        setEventosExtra(String(rpt.eventos_extra_amount ?? '0'));
        // Legacy: filas viejas guardaban contado = tómbola (mismo monto).
        const recibido =
          rpt.efectivo_contado != null ? String(rpt.efectivo_contado) : '';
        setEfectivoRecibido(recibido);
        const tips =
          (data as DayPayload).bancos?.propina ??
          rpt.bancos_propina_tpv ??
          rpt.propinas ??
          0;
        const proposed = proposeTombolaInput(recibido, tips);
        setEfectivoTombola(
          proposed ||
            (rpt.efectivo_tombola != null ? String(rpt.efectivo_tombola) : '')
        );
        setNotes(rpt.notes || '');
      } else {
        setWi('');
        // Prefill: OS digital → subtotal(s); sin evento / sin OS → $0.
        setEventosOs(formatOsSuggestInput(suggestedOs));
        setEventosExtra('0');
        setEfectivoRecibido('');
        setEfectivoTombola('');
        setNotes('');
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

  // Tómbola = recibido − propinas TPV (nuevo, atrasado o edición).
  useEffect(() => {
    if (efectivoRecibido.trim() === '') {
      setEfectivoTombola('');
      return;
    }
    const proposed = proposeTombolaInput(
      efectivoRecibido,
      payload?.bancos?.propina ?? 0
    );
    if (proposed !== '') setEfectivoTombola(proposed);
  }, [efectivoRecibido, payload?.bancos?.propina]);

  function clearPending() {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setPendingAmount('');
    setSourcePicker(null);
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  }

  function openPhotoSource(kind: TpvPhotoKind) {
    setActiveKind(kind);
    setSourcePicker(kind);
    setError(null);
    setMsg(null);
  }

  function pickFromCamera() {
    cameraRef.current?.click();
  }

  function pickFromGallery() {
    galleryRef.current?.click();
  }

  function selectCorteDate(nextRaw: string) {
    const next = nextRaw.slice(0, 10);
    if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    if (next === corteDate) return;
    const inAdminWindow = isAdminWritableCorteDate(next);
    if (!canPendingCortes && next !== opDay && next !== prevDay) return;
    if (canPendingCortes && !inAdminWindow && next !== opDay && next !== prevDay)
      return;
    clearPending();
    setMsg(null);
    setError(null);
    setPayload(null);
    setWi('');
    setEventosOs('');
    setEventosExtra('');
    setEfectivoRecibido('');
    setEfectivoTombola('');
    setNotes('');
    setActiveTerminal(1);
    setActiveKind('venta');
    setSourcePicker(null);
    setCorteDate(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      // Persistir día pendiente (incl. ayer) en ?date=; hoy usa default sin query.
      if (canPendingCortes && next !== opDay && inAdminWindow) {
        url.searchParams.set('date', next);
      } else {
        url.searchParams.delete('date');
      }
      window.history.replaceState({}, '', url.toString());
    }
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    setError(null);
    setMsg(null);
    setSourcePicker(null);
    try {
      const prepared = await prepareTpvPhotoForUpload(file);
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      setPending({
        file: prepared.file,
        previewUrl: prepared.previewUrl,
        width: prepared.width,
        height: prepared.height,
        sharpness: prepared.sharpness,
      });
      setPendingAmount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo validar la foto');
    } finally {
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  }

  async function submitPhoto() {
    if (!pending) return;

    const amount = parseManualAmount(pendingAmount);
    if (amount == null) {
      setError(
        activeKind === 'venta'
          ? 'Indica el monto cobrado (número ≥ 0).'
          : 'Indica el monto de propinas (número ≥ 0; 0 si no hubo).'
      );
      return;
    }
    if (!confirmTerminalAmount(activeKind, activeTerminal, amount)) return;

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
      if (activeKind === 'venta') fd.set('total_cobrado', String(amount));
      else fd.set('propina', String(amount));

      const res = await fetch('/api/tpv-cortes', { method: 'POST', body: fd });
      const data = await readTpvApiJson(res);
      if (!res.ok) {
        setError(
          String(
            data.error ||
              data.hint ||
              'No se pudo guardar. Revisa la foto y el monto.'
          )
        );
        return;
      }
      clearPending();
      const upload = data.upload as TpvCorteUpload | undefined;
      const amountBit =
        activeKind === 'venta'
          ? ` · ${moneyMx(upload?.total_cobrado ?? amount)}`
          : ` · propina ${moneyMx(upload?.propina ?? amount)}`;
      setMsg(
        `T${activeTerminal} · ${photoKindLabel(activeKind)} guardada${amountBit}`
      );
      await refresh();
      const day = data.day as
        | {
            missing?: number[];
            slots?: { terminal: number; state?: string }[];
          }
        | undefined;
      const nextMissing = (day?.missing || []) as number[];
      // Si falta la otra foto de esta terminal, cambiar a esa
      const slotAfter = (day?.slots || []).find(
        (s) => s.terminal === activeTerminal
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
      const data = await readTpvApiJson(res);
      if (!res.ok) {
        setError(String(data.error || 'No se pudo marcar'));
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
        `Monto cobrado en la terminal ${u.terminal_number} — léelo de la foto`,
        String(u.total_cobrado ?? '')
      );
      if (cobStr == null) return;
      const cob = parseManualAmount(cobStr);
      if (cob == null) {
        setError('Total inválido');
        return;
      }
      if (!confirmTerminalAmount('venta', u.terminal_number, cob)) return;
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
        const data = await readTpvApiJson(res);
        if (!res.ok) {
          setError(String(data.error || 'No se pudo guardar el monto'));
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
      `Monto de propinas cobrado con la terminal ${u.terminal_number} — léelo de la foto; 0 si no hubo`,
      String(u.propina ?? '0')
    );
    if (tipStr == null) return;
    const tip = parseManualAmount(tipStr);
    if (tip == null) {
      setError('Propina inválida');
      return;
    }
    if (!confirmTerminalAmount('propina', u.terminal_number, tip)) return;
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
      const data = await readTpvApiJson(res);
      if (!res.ok) {
        setError(String(data.error || 'No se pudo guardar el monto'));
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
      const recibidoNum = parseMoneyInput(efectivoRecibido);
      if (recibidoNum == null || recibidoNum < 0) {
        setError('Indica el efectivo recibido (obligatorio)');
        return;
      }
      const tombolaNum = parseMoneyInput(efectivoTombola);
      if (tombolaNum == null || tombolaNum < 0) {
        setError('Indica el efectivo en tómbola después de propinas (obligatorio)');
        return;
      }
      const osNum = parseMoneyInput(eventosOs === '' ? '0' : eventosOs);
      const extraNum = parseMoneyInput(eventosExtra === '' ? '0' : eventosExtra);
      if (osNum == null || osNum < 0) {
        setError('Indica el monto de la orden de servicio (puede ser 0)');
        return;
      }
      if (extraNum == null || extraNum < 0) {
        setError('Indica la venta extra del evento (0 si no hubo)');
        return;
      }
      const osDiffers =
        Math.abs(osNum - suggestedOsAmount) > OS_SUGGEST_TOLERANCE_MXN;
      if (hasEventosHoy || osNum !== 0 || extraNum !== 0 || osDiffers) {
        const osConfirmLines = [
          `¿Confirmas el monto de la orden de servicio (VENTA)?`,
          '',
          moneyMx(osNum),
          '',
          `Sugerido: ${moneyMx(suggestedOsAmount)}`,
        ];
        if (hasDigitalOs && osDiffers) {
          osConfirmLines.push(
            '(No coincide con la venta de la orden de servicio)'
          );
        } else if (!hasDigitalOs && osDiffers) {
          osConfirmLines.push(
            hasEventosHoy
              ? '(No hay orden de servicio digital para esta fecha)'
              : '(Sin evento / OS registrada — el sugerido es $0)'
          );
        }
        if (!confirm(osConfirmLines.join('\n'))) {
          return;
        }
        if (
          !confirm(
            `¿Confirmas la venta extra del evento?\n\n${moneyMx(extraNum)}`
          )
        ) {
          return;
        }
      }
      const res = await fetch('/api/staff-corte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: corteDate,
          wi_amount: wi,
          eventos_os_amount: String(osNum),
          eventos_extra_amount: String(extraNum),
          efectivo_contado: String(recibidoNum),
          efectivo_tombola: String(tombolaNum),
          notes: notes || null,
          ...(canPendingCortes && !payload?.bancos?.canSaveRpt
            ? { admin_offline: true }
            : {}),
        }),
      });
      const data = await readTpvApiJson(res);
      if (!res.ok) {
        const blockers = Array.isArray(data.blockers)
          ? (data.blockers as unknown[]).map(String).join(' ')
          : '';
        setError(
          [data.error, blockers].filter(Boolean).map(String).join(' — ')
        );
        return;
      }
      if (typeof data.warning === 'string' && data.warning) {
        setMsg(`Corte cerrado · ${data.warning}`);
      } else {
        setMsg('Corte del día cerrado correctamente');
      }
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

  // «Failed to fetch» es un TypeError de fetch (red / respuesta cortada), no un
  // error de Supabase: el hint de staff_rpt_diario ahí solo despista.
  const isNetworkError =
    Boolean(error) &&
    /failed to fetch|load failed|networkerror|error de red|network request failed/i.test(
      error as string
    );
  const mentionsRptTable = /staff_rpt_diario|staff_corte_prod_fix/i.test(
    error || ''
  );
  const errorHint = isNetworkError
    ? 'Se cortó la conexión con el servidor. Revisa la señal y toca Reintentar; los datos ya guardados no se pierden.'
    : mentionsRptTable
      ? 'Ejecuta en Supabase → SQL Editor: supabase/staff_corte_prod_fix.sql (o staff_rpt_diario.sql).'
      : 'Puedes cambiar entre Hoy y Ayer arriba aunque falle la carga de este día.';

  const eventosDelDia = payload?.eventosDelDia;
  const hasEventosHoy = Boolean(eventosDelDia?.hasEvent);
  const hasDigitalOs = Boolean(eventosDelDia?.hasDigitalOs);
  const suggestedOsAmount =
    eventosDelDia?.suggestedOsAmount != null &&
    Number.isFinite(Number(eventosDelDia.suggestedOsAmount))
      ? Number(eventosDelDia.suggestedOsAmount)
      : 0;
  const eventosOsNum = parseMoneyInput(eventosOs === '' ? '0' : eventosOs) ?? 0;
  const eventosExtraNum =
    parseMoneyInput(eventosExtra === '' ? '0' : eventosExtra) ?? 0;
  const eventosTotalNum = Math.round((eventosOsNum + eventosExtraNum) * 100) / 100;
  const eventosOsMismatch =
    Math.abs(eventosOsNum - suggestedOsAmount) > OS_SUGGEST_TOLERANCE_MXN;
  const eventosExtraMismatch =
    Math.abs(eventosExtraNum - 0) > OS_SUGGEST_TOLERANCE_MXN && !hasEventosHoy;
  const eventosOsWarnMessage = !eventosOsMismatch
    ? null
    : hasDigitalOs
      ? `No coincide con la venta de la orden de servicio (${moneyMx(suggestedOsAmount)}).`
      : hasEventosHoy
        ? 'No hay orden de servicio digital para esta fecha (sugerido $0). Genera o vincula la OS en Eventos para prellenar.'
        : 'Sin evento / OS registrada — el sugerido es $0.';
  const eventosOsHint = eventosOsWarnMessage
    ? eventosOsWarnMessage
    : hasDigitalOs
      ? `Sugerido: ${moneyMx(suggestedOsAmount)} — confirma el monto`
      : 'Sugerido: $0 — confirma o edita si hace falta';

  const efectivoRecibidoNum = parseMoneyInput(efectivoRecibido);
  const efectivoTombolaNum = parseMoneyInput(efectivoTombola);
  const efectivoRecibidoOk =
    efectivoRecibidoNum != null && efectivoRecibidoNum >= 0;
  const efectivoTombolaOk =
    efectivoTombolaNum != null && efectivoTombolaNum >= 0;

  /** Referencia interna: recibido − propinas TPV WI (no bloquea; no usa Infocaja). */
  const esperadoTombolaFromRecibido = expectedTombolaDeposit(
    efectivoRecibidoOk ? efectivoRecibidoNum : null,
    bancos?.propina ?? 0
  );
  const tipBreakdown = cortePropinasBreakdown(
    bancos?.propina ?? 0,
    eventosOsNum
  );

  const liveReconcile = reconcileEfectivoRecibidoVsInfocaja(
    efectivoRecibidoOk ? efectivoRecibidoNum : null,
    resolveInfocajaEfectivo(infocaja)
  );
  const savedReconcile = payload?.cashCheck ?? null;
  const reconcile =
    liveReconcile.hasRecibido || liveReconcile.hasInfocaja
      ? liveReconcile
      : savedReconcile;

  const canCerrarCorte =
    (Boolean(bancos?.canSaveRpt) || canPendingCortes) &&
    efectivoRecibidoOk &&
    efectivoTombolaOk;

  const prevIncomplete =
    !dateWindow.prev.unknown && !dateWindow.prev.corteCompleto;
  // Banner de ayer solo en Hoy (no pelear con un día pendiente más atrás).
  const showPrevCatchUpBanner =
    !isPrevDay && prevIncomplete && !isOutsideStaffWindow;
  const opStatusLabel = corteStatusLabel(dateWindow.op);
  const prevStatusLabel = corteStatusLabel(dateWindow.prev);

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
            {/* Hoy | Ayer — first viewport control (visible even with schema errors) */}
      <section className="rounded-2xl border-2 border-slate-900 bg-white p-3 shadow-sm">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
          Día del corte
        </p>
        <div
          className="grid grid-cols-2 gap-2"
          role="tablist"
          aria-label="Fecha del corte"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isPrevDay && !isOutsideStaffWindow}
            onClick={() => selectCorteDate(opDay)}
            className={`rounded-xl px-3 py-2.5 text-left text-sm transition ${
              !isPrevDay && !isOutsideStaffWindow
                ? 'bg-slate-900 font-semibold text-white'
                : 'bg-slate-50 font-medium text-slate-700 ring-1 ring-slate-200'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              Hoy
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  !isPrevDay && !isOutsideStaffWindow
                    ? 'bg-white/15 text-slate-100'
                    : dateWindow.op.corteCompleto
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-900'
                }`}
              >
                {opStatusLabel}
              </span>
            </span>
            <span
              className={`mt-0.5 block text-xs capitalize ${
                !isPrevDay && !isOutsideStaffWindow
                  ? 'text-slate-300'
                  : 'text-slate-500'
              }`}
            >
              {formatCorteDateDisplay(opDay)}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isPrevDay}
            onClick={() => selectCorteDate(prevDay)}
            className={`rounded-xl px-3 py-2.5 text-left text-sm transition ${
              isPrevDay
                ? 'bg-slate-900 font-semibold text-white'
                : prevIncomplete
                  ? 'bg-amber-50 font-semibold text-amber-950 ring-2 ring-amber-400'
                  : 'bg-slate-50 font-medium text-slate-700 ring-1 ring-slate-200'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              Ayer
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  isPrevDay
                    ? 'bg-white/15 text-slate-100'
                    : dateWindow.prev.corteCompleto
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-900'
                }`}
              >
                {prevStatusLabel}
              </span>
            </span>
            <span
              className={`mt-0.5 block text-xs capitalize ${
                isPrevDay ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {formatCorteDateDisplay(prevDay)}
            </span>
          </button>
        </div>

        {canPendingCortes ? (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {isMasterAdmin ? 'Master · días pendientes' : 'Días pendientes'}
            </p>
            {pendingAdminDays.length > 0 ? (
              <select
                value={pendingSelectValue}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 10);
                  if (v) selectCorteDate(v);
                }}
                aria-label="Elegir día pendiente"
                className="block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm capitalize"
              >
                <option value="">
                  {pendingSelectValue
                    ? '— Elegir otro día —'
                    : 'Elegir día pendiente'}
                </option>
                {pendingAdminDays.map((d) => (
                  <option key={d.date} value={d.date}>
                    {formatCorteDateDisplay(d.date)} ·{' '}
                    {corteStatusLabel(d)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-slate-500">
                No hay días pendientes en la ventana de 7 días.
              </p>
            )}
            {isOutsideStaffWindow ? (
              <p className="text-xs font-medium text-amber-900">
                Editando · {formatCorteDateDisplay(corteDate)}
              </p>
            ) : null}
            {isMasterAdmin ? (
              <Link
                href="/admin/cortes-tpv"
                className="inline-flex text-xs font-semibold underline"
                style={{ color: SUITE.navy }}
              >
                Volver a Cortes TPV (Master)
              </Link>
            ) : null}
          </div>
        ) : null}

        {showPrevCatchUpBanner ? (
          <button
            type="button"
            onClick={() => selectCorteDate(prevDay)}
            className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-left transition hover:bg-amber-100"
          >
            <span>
              <span className="block text-sm font-bold text-amber-950">
                El corte de ayer no se concluyó
              </span>
              <span className="mt-0.5 block text-xs text-amber-900">
                {formatCorteDateDisplay(prevDay)} ·{' '}
                {prevStatusLabel.toLowerCase()}
              </span>
            </span>
            <span
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-bold text-white"
              style={{ backgroundColor: SUITE.orange }}
            >
              Continuar
            </span>
          </button>
        ) : null}

        {!isPrevDay && dateWindow.prev.unknown ? (
          <button
            type="button"
            onClick={() => selectCorteDate(prevDay)}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100"
          >
            ¿Falta el corte de ayer?{' '}
            <span className="font-semibold" style={{ color: SUITE.orange }}>
              Ir al día anterior
            </span>
          </button>
        ) : null}

      </section>

{/* Fecha + progreso — siempre visible aunque falle staff_rpt_diario */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orange }}
        >
          {isOutsideStaffWindow
            ? 'Corte día pendiente'
            : isPrevDay
              ? 'Corte del día anterior'
              : 'Corte del día'}
        </p>
        <h2
          className="mt-1 text-xl font-bold capitalize"
          style={{ color: SUITE.navy }}
        >
          {formatCorteDateDisplay(corteDate)}
        </h2>
        {!isOutsideStaffWindow ? (
          <p className="mt-1 text-xs text-slate-500">
            {isPrevDay
              ? 'Estás cargando el corte del día anterior respecto al día operativo (CDMX). El flujo de madrugada (00:00–05:59) sigue usando el día de operación nocturno.'
              : TPV_CORTE_DATE_HELP}
          </p>
        ) : null}

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
            1) Por terminal: foto nítida + monto manual (venta y propinas), o «no
            se usó» → 2) Cierre
          </p>
        )}
      </section>

      {error ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>{error}</p>
          <p className="mt-1 text-xs text-amber-900/80">{errorHint}</p>
          {isNetworkError ? (
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-950"
            >
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {msg}
        </div>
      ) : null}
      {payload?.rptError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p>{payload.rptError}</p>
          <p className="mt-1 text-xs text-rose-800/90">
            Sin esa tabla no se puede cerrar el corte. En Supabase → SQL Editor
            ejecuta <code className="font-mono">supabase/staff_rpt_diario.sql</code>{' '}
            o el fix completo{' '}
            <code className="font-mono">supabase/staff_corte_prod_fix.sql</code>.
            La selección Hoy / Ayer sigue disponible.
          </p>
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
            // Las 2 fotos están, pero a alguna le falta el monto.
            const needsAmount = slot?.state === 'photo' && !slot.hasAmounts;
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
                        : needsAmount
                          ? '#FDE68A'
                          : partial
                            ? '#FEF3C7'
                            : '#fff',
                  color: activeTerminal === n ? '#fff' : SUITE.navy,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
              >
                T{n}
                {done ? ' ✓' : needsAmount ? ' $?' : partial ? ' …' : ''}
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
                <strong>Reporte de propinas</strong>, con el monto escrito a mano.
                O marca «No se utilizó».
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
                      {(() => {
                        if (!up) return null;
                        const amount =
                          kind === 'venta' ? up.total_cobrado : up.propina;
                        return amount == null ? (
                          <p className="mt-1 text-center text-xs font-bold text-amber-700">
                            Falta el monto
                          </p>
                        ) : (
                          <p className="mt-1 text-center text-xs font-semibold text-slate-700">
                            {moneyMx(amount)}
                          </p>
                        );
                      })()}
                      {up && !pending ? (
                        <button
                          type="button"
                          disabled={busy === `a${up.id}`}
                          onClick={() => void savePhotoAmount(up)}
                          className={`mt-1 w-full rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-60 ${
                            (kind === 'venta' ? up.total_cobrado : up.propina) ==
                            null
                              ? 'bg-amber-400 text-amber-950'
                              : 'bg-white'
                          }`}
                          style={
                            (kind === 'venta' ? up.total_cobrado : up.propina) ==
                            null
                              ? undefined
                              : { color: SUITE.navy }
                          }
                        >
                          {(kind === 'venta' ? up.total_cobrado : up.propina) ==
                          null
                            ? 'Escribir monto'
                            : 'Corregir monto'}
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
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
              />

              {!unusedUpload && !pending ? (
                sourcePicker ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-center text-sm font-semibold text-slate-700">
                      {sourcePicker === 'venta'
                        ? ventaUpload
                          ? 'Retomar venta'
                          : 'Foto venta'
                        : propinaUpload
                          ? 'Retomar propinas'
                          : 'Foto propinas'}{' '}
                      · T{activeTerminal}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={pickFromCamera}
                        className="flex min-h-14 items-center justify-center rounded-2xl px-2 text-sm font-bold text-white"
                        style={{
                          backgroundColor:
                            sourcePicker === 'venta' ? SUITE.orange : '#0F9F9C',
                        }}
                      >
                        Tomar foto
                      </button>
                      <button
                        type="button"
                        onClick={pickFromGallery}
                        className="flex min-h-14 items-center justify-center rounded-2xl border-2 px-2 text-sm font-bold"
                        style={{
                          borderColor:
                            sourcePicker === 'venta' ? SUITE.orange : '#0F9F9C',
                          color:
                            sourcePicker === 'venta' ? SUITE.orange : '#0F9F9C',
                        }}
                      >
                        Elegir de galería
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSourcePicker(null)}
                      className="min-h-10 w-full rounded-2xl text-sm font-medium text-slate-500"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openPhotoSource('venta')}
                      className="flex min-h-14 items-center justify-center rounded-2xl px-2 text-sm font-bold text-white"
                      style={{ backgroundColor: SUITE.orange }}
                    >
                      {ventaUpload ? 'Retomar venta' : 'Foto venta'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openPhotoSource('propina')}
                      className="flex min-h-14 items-center justify-center rounded-2xl px-2 text-sm font-bold text-white"
                      style={{ backgroundColor: '#0F9F9C' }}
                    >
                      {propinaUpload ? 'Retomar propinas' : 'Foto propinas'}
                    </button>
                  </div>
                )
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
                    Foto: {photoKindLabel(activeKind)} · T{activeTerminal}
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
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold text-slate-700">
                      {activeKind === 'venta'
                        ? `Monto cobrado · Terminal ${activeTerminal}`
                        : `Monto de propinas · Terminal ${activeTerminal}`}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={pendingAmount}
                      onChange={(e) => setPendingAmount(e.target.value)}
                      placeholder={
                        activeKind === 'venta'
                          ? 'Ej. 6215.00'
                          : 'Ej. 624.75 (0 si no hubo)'
                      }
                      className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-semibold text-slate-900"
                    />
                  </label>
                  <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950">
                    La foto debe verse nítida (candado de nitidez). El monto se
                    escribe a mano mirando el ticket; al guardar te pediremos
                    confirmarlo.
                  </p>
                  <button
                    type="button"
                    disabled={busy === `t${activeTerminal}-${activeKind}`}
                    onClick={() => void submitPhoto()}
                    className="min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-60"
                    style={{ backgroundColor: SUITE.navy }}
                  >
                    {busy === `t${activeTerminal}-${activeKind}`
                      ? 'Guardando…'
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
            <p className="text-xs text-slate-500">Propina TPV (WI)</p>
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
          WI y Eventos · captura manual de efectivo recibido y tómbola (después
          de propinas TPV WI). Infocaja se concilia cuando llegue el reporte por
          correo. Sin cortesías (vienen de Gmail). Propina TPV = tickets WI;
          el 12.5% / 2.5% del evento se calcula sobre la VENTA OS.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput
            label="WI (Carranza / Walk-in)"
            value={wi}
            onChange={setWi}
            required
            hint="Venta WI del día"
          />
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm sm:bg-transparent sm:px-0 sm:py-0">
            <p className="font-semibold text-slate-700 sm:hidden">Eventos</p>
            <p className="mt-1 text-xs text-slate-500 sm:mt-0">
              {hasEventosHoy
                ? hasDigitalOs
                  ? `Evento con OS digital · sugerido ${moneyMx(suggestedOsAmount)}`
                  : 'Evento sin OS digital · sugerido $0'
                : 'Sin evento registrado · sugerido $0 (editable)'}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 px-3 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {hasEventosHoy
                ? 'Evento del día · como Global'
                : 'Eventos (VENTA)'}
            </p>
            {hasEventosHoy ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
                {(eventosDelDia?.items || []).slice(0, 4).map((it) => {
                  const displayVenta =
                    it.source === 'os_digital'
                      ? (it.venta ?? null)
                      : it.total;
                  return (
                    <li key={it.id}>
                      {it.label}
                      {it.os_number ? ` · OS ${it.os_number}` : ''}
                      {displayVenta != null
                        ? ` · VENTA ${moneyMx(displayVenta)}`
                        : ''}
                      {it.source === 'os_digital' &&
                      it.total != null &&
                      it.venta != null &&
                      Math.abs(it.total - it.venta) > OS_SUGGEST_TOLERANCE_MXN
                        ? ` (total c/servicio ${moneyMx(it.total)})`
                        : ''}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                No hay OS / Global para esta fecha. Se sugiere $0; puedes
                capturar un monto si aplica.
              </p>
            )}
            {hasDigitalOs ? (
              <p className="mt-2 text-xs text-slate-500">
                Sugerido OS (VENTA)
                {eventosDelDia?.suggestedOsLabel
                  ? ` · ${eventosDelDia.suggestedOsLabel}`
                  : ''}
                :{' '}
                <span className="font-semibold text-slate-700">
                  {moneyMx(suggestedOsAmount)}
                </span>
                . Confirma o edita si hace falta.
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyInput
              label="Orden de servicio (VENTA)"
              value={eventosOs}
              onChange={setEventosOs}
              required
              warn={eventosOsMismatch}
              hint={eventosOsHint}
            />
            <MoneyInput
              label="Venta extra del evento"
              value={eventosExtra}
              onChange={setEventosExtra}
              required
              warn={eventosExtraMismatch}
              hint={
                eventosExtraMismatch
                  ? 'Sin evento registrado — el sugerido es $0'
                  : '0 si no hubo venta extra'
              }
            />
          </div>
          {eventosOsWarnMessage ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
              {eventosOsWarnMessage} Puedes guardar el monto editado; solo es
              una alerta.
            </p>
          ) : null}
          {eventosExtraMismatch ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
              Venta extra distinta de $0 sin evento registrado. Puedes guardar;
              solo es una alerta.
            </p>
          ) : null}
          <p className="text-sm text-slate-600">
            Total eventos:{' '}
            <strong style={{ color: SUITE.navy }}>
              {moneyMx(eventosTotalNum)}
            </strong>{' '}
            <span className="text-xs text-slate-400">(OS + extra)</span>
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm space-y-2">
          <p className="font-semibold text-slate-700">Propinas · desglose</p>
          <div
            className={`grid grid-cols-1 gap-2 ${
              tipBreakdown.osVenta > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
            }`}
          >
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Propinas TPV</p>
              <p className="font-bold" style={{ color: SUITE.navy }}>
                {moneyMx(tipBreakdown.propinaTpvWi)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Solo WI de terminal
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Propina eventos</p>
              <p className="font-bold" style={{ color: SUITE.navy }}>
                {moneyMx(tipBreakdown.staffTipEventos)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                12.5% sobre OS
              </p>
            </div>
            {tipBreakdown.osVenta > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs text-slate-500">Admin 2.5%</p>
                <p className="font-bold" style={{ color: SUITE.navy }}>
                  {moneyMx(tipBreakdown.adminTombola)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Cargo a tómbola
                </p>
              </div>
            ) : null}
            <div
              className="rounded-lg border-2 px-3 py-2"
              style={{
                borderColor: SUITE.orange,
                background: SUITE.orangeSoft,
              }}
            >
              <p className="text-xs font-semibold" style={{ color: SUITE.orangeDeep }}>
                Total propinas
              </p>
              <p className="font-bold" style={{ color: SUITE.navy }}>
                {moneyMx(tipBreakdown.propinasTotal)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Propinas TPV + Propina eventos
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 px-3 py-3 space-y-3">
          <p className="text-sm font-semibold text-slate-700">Efectivo</p>
          <p className="text-xs text-slate-500">
            Captura ambos montos al cerrar. La comparación con Infocaja es
            posterior (el reporte suele llegar por correo después del cierre).
          </p>

          <MoneyInput
            label="Efectivo recibido"
            value={efectivoRecibido}
            onChange={setEfectivoRecibido}
            required
            hint="Obligatorio. Efectivo de venta del día (antes de propinas)."
          />
          <MoneyInput
            label="Efectivo en tómbola (después de propinas)"
            value={efectivoTombola}
            onChange={setEfectivoTombola}
            required
            hint={
              esperadoTombolaFromRecibido != null
                ? `Propuesto: recibido − propinas TPV WI = ${moneyMx(esperadoTombolaFromRecibido)}. Se actualiza al capturar el recibido.`
                : 'Se propone solo: efectivo recibido − propinas TPV (WI).'
            }
          />

          {payload?.infocajaError ? (
            <p className="text-xs text-amber-800">{payload.infocajaError}</p>
          ) : null}

          {reconcile?.hasInfocaja ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                reconcile.match
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  : reconcile.mismatch
                    ? 'border-amber-300 bg-amber-50 text-amber-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex justify-between gap-2">
                <span>Infocaja Efectivo</span>
                <span className="font-semibold">
                  {moneyMx(reconcile.infocaja)}
                </span>
              </div>
              {reconcile.hasRecibido ? (
                <div className="mt-1 flex justify-between gap-2">
                  <span>Recibido en corte</span>
                  <span className="font-semibold">
                    {moneyMx(reconcile.recibido)}
                  </span>
                </div>
              ) : null}
              <p className="mt-2 text-xs font-medium">
                {reconcile.match
                  ? 'Coincide con Infocaja.'
                  : reconcile.mismatch
                    ? reconcile.message
                    : null}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Infocaja aún no está para esta fecha — no bloquea el cierre. Cuando
              llegue el reporte, se revisará que el efectivo recibido coincida.
            </p>
          )}

          {efectivoRecibido.trim() !== '' && !efectivoRecibidoOk ? (
            <p role="alert" className="text-sm text-red-700">
              Indica un monto válido de efectivo recibido.
            </p>
          ) : null}
          {efectivoTombola.trim() !== '' && !efectivoTombolaOk ? (
            <p role="alert" className="text-sm text-red-700">
              Indica un monto válido de efectivo en tómbola.
            </p>
          ) : null}
        </div>

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
              ? isPrevDay
                ? 'Actualizar cierre del día anterior'
                : 'Actualizar cierre del día'
              : isPrevDay
                ? 'Cerrar corte del día anterior'
                : 'Cerrar corte del día'}
        </button>
        {!bancos?.canSaveRpt ? (
          <p className="text-center text-xs text-slate-500">
            {canPendingCortes
              ? 'TPV incompleto: puedes cerrar offline con el permiso de cortes pendientes (bancos = snapshot TPV o $0).'
              : 'Completa las 3 terminales (2 fotos + montos, o no usada) antes de cerrar'}
          </p>
        ) : !efectivoRecibidoOk || !efectivoTombolaOk ? (
          <p className="text-center text-xs text-slate-500">
            Indica efectivo recibido y efectivo en tómbola para poder cerrar
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
