'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  formatAntiguedad,
  formatHrDate,
  formatHrPuesto,
  plantillaPositionFamily,
  plantillaTeamGroup,
  PLANTILLA_TEAM_GROUP_LABELS,
  PLANTILLA_TEAM_GROUP_ORDER,
  type HrPayrollStatus,
  type PlantillaTeamGroup,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import {
  HR_PAYROLL_CADENCE_LABELS,
  HR_PAYROLL_DAY_LETTERS,
  HR_PAYROLL_STATUS_LABELS,
  emptyDiasSemana,
  normalizeDiasSemana,
  setDiasSemanaDay,
  sumDiasSemana,
  type HrPayrollCadence,
  type HrPayrollDiasSemana,
  type HrPayrollLine,
  type HrPayrollLineInput,
  type HrPayrollPeriod,
  pickDefaultQuincena,
} from '@/app/lib/hr-payroll';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

const TEAL = {
  bg: '#E6F4F3',
  border: '#0F9F9C',
  label: '#0A7A78',
  deep: '#08706E',
} as const;

type ListPayload = {
  ready: boolean;
  periods: HrPayrollPeriod[];
  message?: string;
};

type DetailPayload = {
  ready: boolean;
  period: HrPayrollPeriod | null;
  lines: HrPayrollLine[];
  message?: string;
};

type LocalFileLabel = {
  id: string;
  year?: number;
  name: string;
  label: string;
};

type ProbePayload = {
  ready: boolean;
  note?: string;
  localFileLabels?: LocalFileLabel[];
  localFiles?: LocalFileLabel[];
  selectedYear?: number | null;
};

type DraftLine = {
  key: string;
  employee_id?: string;
  full_name: string;
  puesto: string;
  area: string;
  sueldo_diario: string;
  dias_trabajados: string;
  /** Marcas Lun–Dom; la suma alimenta dias_trabajados. */
  dias_semana: HrPayrollDiasSemana;
  /** True si hay matriz de días (import/toggle); false = solo número histórico. */
  dias_marks_active: boolean;
  horas_extra: string;
  bonos: string;
  retenciones: string;
  importe_pagado: string;
  vacaciones_tomadas: string;
  vacaciones_restantes: string;
  fecha_ingreso: string | null;
};

function statusStyle(status: HrPayrollStatus): { bg: string; color: string } {
  switch (status) {
    case 'pagado':
      return { bg: TEAL.bg, color: TEAL.deep };
    case 'cerrado':
      return { bg: '#E8EEF8', color: SUITE.navy };
    default:
      return { bg: SUITE.orangeSoft, color: SUITE.navy };
  }
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  });
}

function moneyCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function numOrEmpty(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '';
  return String(v);
}

function parseNum(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function linesToDraft(lines: HrPayrollLine[]): DraftLine[] {
  return lines.map((l, i) => {
    const dias =
      normalizeDiasSemana(l.dias_semana) ?? emptyDiasSemana();
    const fromMarks = sumDiasSemana(dias);
    const marksActive = fromMarks > 0 || dias.some((d) => d > 0);
    const diasTrab = marksActive ? fromMarks : l.dias_trabajados;
    return {
      key: l.id || `e-${l.employee_id || i}`,
      employee_id: l.employee_id,
      full_name: l.employee_name || '',
      puesto: l.puesto_snapshot || '',
      area: l.employee_area || '',
      sueldo_diario: numOrEmpty(l.sueldo_diario),
      dias_trabajados: numOrEmpty(diasTrab),
      dias_semana: dias,
      dias_marks_active: marksActive,
      horas_extra: numOrEmpty(l.horas_extra),
      bonos: numOrEmpty(l.bonos),
      retenciones: numOrEmpty(l.retenciones),
      importe_pagado: numOrEmpty(l.importe_pagado),
      vacaciones_tomadas: numOrEmpty(l.vacaciones_tomadas),
      vacaciones_restantes: numOrEmpty(l.vacaciones_restantes),
      fecha_ingreso: l.fecha_ingreso ?? null,
    };
  });
}

function draftToInputs(rows: DraftLine[]): HrPayrollLineInput[] {
  return rows
    .filter((r) => r.full_name.trim())
    .map((r) => {
      const dias = normalizeDiasSemana(r.dias_semana) ?? emptyDiasSemana();
      const fromMarks = sumDiasSemana(dias);
      const useMarks = r.dias_marks_active;
      return {
        full_name: r.full_name.trim(),
        puesto: r.puesto.trim() || null,
        area: r.area.trim() || null,
        sueldo_diario: parseNum(r.sueldo_diario),
        dias_semana: useMarks ? dias : null,
        dias_trabajados: useMarks
          ? fromMarks
          : parseNum(r.dias_trabajados) ?? 0,
        horas_extra: parseNum(r.horas_extra) ?? 0,
        bonos: parseNum(r.bonos) ?? 0,
        retenciones: parseNum(r.retenciones) ?? 0,
        importe_pagado: parseNum(r.importe_pagado) ?? 0,
        vacaciones_tomadas: parseNum(r.vacaciones_tomadas),
        vacaciones_restantes: parseNum(r.vacaciones_restantes),
        fecha_ingreso: r.fecha_ingreso,
      };
    });
}

function emptyDraftLine(): DraftLine {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    full_name: '',
    puesto: '',
    area: '',
    sueldo_diario: '',
    dias_trabajados: '',
    dias_semana: emptyDiasSemana(),
    dias_marks_active: true,
    horas_extra: '',
    bonos: '',
    retenciones: '',
    importe_pagado: '',
    vacaciones_tomadas: '',
    vacaciones_restantes: '',
    fecha_ingreso: null,
  };
}

/** Fechas Lun–Dom del periodo (para subtítulos de columna). */
function weekDayLabels(period: HrPayrollPeriod | null): string[] {
  if (!period?.period_start) return [...HR_PAYROLL_DAY_LETTERS];
  const start = period.period_start.slice(0, 10);
  const base = new Date(`${start}T12:00:00`);
  if (Number.isNaN(base.getTime())) return [...HR_PAYROLL_DAY_LETTERS];
  return HR_PAYROLL_DAY_LETTERS.map((letter, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return `${letter}${d.getDate()}`;
  });
}

function DiasSemanaChecks({
  days,
  dayLabels,
  editable,
  fallbackTotal,
  onToggle,
}: {
  days: HrPayrollDiasSemana;
  dayLabels: string[];
  editable: boolean;
  /** Si no hay marcas (histórico previo), mostrar el número guardado. */
  fallbackTotal?: number | null;
  onToggle?: (dayIndex: number, on: boolean) => void;
}) {
  const fromMarks = sumDiasSemana(days);
  const total = fromMarks > 0 ? fromMarks : fallbackTotal && fallbackTotal > 0 ? fallbackTotal : 0;
  return (
    <div className="flex items-center justify-end gap-1.5">
      <div
        className="flex items-center gap-0.5"
        role="group"
        aria-label="Días trabajados"
      >
        {HR_PAYROLL_DAY_LETTERS.map((letter, i) => {
          const on = (days[i] || 0) > 0;
          const isDom = letter === 'D';
          const title = isDom
            ? `${dayLabels[i] || letter} · prima 25% (1.25)`
            : `${dayLabels[i] || letter}${
                days[i] && days[i] !== 1 ? ` · ${days[i]}` : ''
              }`;
          if (!editable) {
            return (
              <span
                key={letter}
                title={title}
                className="inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-semibold"
                style={{
                  borderColor: on ? TEAL.border : '#E2E8F0',
                  backgroundColor: on ? TEAL.bg : '#F8FAFC',
                  color: on ? TEAL.deep : '#94A3B8',
                }}
                aria-hidden
              >
                {on ? '✓' : letter}
              </span>
            );
          }
          return (
            <label
              key={letter}
              title={title}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border"
              style={{
                borderColor: on ? TEAL.border : '#E2E8F0',
                backgroundColor: on ? TEAL.bg : '#fff',
              }}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={(e) => onToggle?.(i, e.target.checked)}
                aria-label={
                  isDom
                    ? `${dayLabels[i] || letter} (prima 25%)`
                    : dayLabels[i] || letter
                }
              />
              <span
                className="text-[10px] font-semibold"
                style={{ color: on ? TEAL.deep : '#94A3B8' }}
              >
                {on ? '✓' : letter}
              </span>
            </label>
          );
        })}
      </div>
      <span
        className="min-w-[1.75rem] text-right text-sm font-semibold tabular-nums"
        style={{ color: SUITE.navy }}
        title="Días trabajados (Dom = 1.25 si trabaja domingo)"
      >
        {total > 0 ? total : '—'}
      </span>
    </div>
  );
}

function weekSortKey(p: HrPayrollPeriod): number {
  const m = p.label.match(/Semana\s+(\d+)/i);
  if (m) return Number(m[1]);
  return Date.parse(p.period_end) || 0;
}

function weekNumber(p: HrPayrollPeriod): number | null {
  const m = p.label.match(/Semana\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Preferencia: última pagada → última cerrada → más reciente por fin de periodo. */
function pickDefaultPeriod(
  list: HrPayrollPeriod[],
  preferredId?: string | null
): HrPayrollPeriod | null {
  if (!list.length) return null;
  if (preferredId) {
    const hit = list.find((p) => p.id === preferredId);
    if (hit) return hit;
  }
  const byEnd = [...list].sort(
    (a, b) =>
      b.period_end.localeCompare(a.period_end) ||
      weekSortKey(b) - weekSortKey(a)
  );
  return (
    byEnd.find((p) => p.status === 'pagado') ||
    byEnd.find((p) => p.status === 'cerrado') ||
    byEnd[0] ||
    null
  );
}

function friendlyUserMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // No volcar rutas, IDs de Drive ni mensajes de montaje
  if (
    /[A-Za-z]:\\|\\\\|Mi unidad|drive\.google|folder.?id|HR_NOMINA|Downloads\\/i.test(
      s
    )
  ) {
    return 'No se pudo sincronizar el historial. Revisa el archivo de nómina o súbelo desde Más…';
  }
  return s;
}

type NominaTeamBucket = {
  group: PlantillaTeamGroup;
  label: string;
  rows: DraftLine[];
  total: number;
};

function groupDraftByTeam(rows: DraftLine[]): NominaTeamBucket[] {
  const buckets: Record<PlantillaTeamGroup, DraftLine[]> = {
    piso: [],
    cocina: [],
    admin: [],
    otros: [],
  };
  for (const r of rows) {
    buckets[plantillaTeamGroup(r.puesto || r.area)].push(r);
  }
  const collator = new Intl.Collator('es', { sensitivity: 'base' });
  for (const g of PLANTILLA_TEAM_GROUP_ORDER) {
    buckets[g].sort((a, b) => {
      const famA = plantillaPositionFamily(a.puesto || a.area);
      const famB = plantillaPositionFamily(b.puesto || b.area);
      if (famA.order !== famB.order) return famA.order - famB.order;
      return collator.compare(a.full_name || '', b.full_name || '');
    });
  }
  return PLANTILLA_TEAM_GROUP_ORDER.filter((g) => buckets[g].length > 0).map(
    (g) => ({
      group: g,
      label: PLANTILLA_TEAM_GROUP_LABELS[g],
      rows: buckets[g],
      total: buckets[g].reduce(
        (sum, r) => sum + (parseNum(r.importe_pagado) ?? 0),
        0
      ),
    })
  );
}

function StatusPill({ status }: { status: HrPayrollStatus }) {
  const st = statusStyle(status);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide"
      style={{ backgroundColor: st.bg, color: st.color }}
    >
      {HR_PAYROLL_STATUS_LABELS[status]}
    </span>
  );
}

function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      className="min-w-[8.5rem] flex-1 rounded-2xl bg-white px-4 py-3"
      style={{
        boxShadow: SUITE.shadow,
        borderTop: `3px solid ${accent}`,
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: theme.muted }}
      >
        {label}
      </p>
      <p
        className="mt-1.5 text-xl font-bold tabular-nums tracking-tight"
        style={{ color: SUITE.navy }}
      >
        {value}
      </p>
    </div>
  );
}

export function RrhhNomina({ onChanged }: { onChanged?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [yearOptions, setYearOptions] = useState<number[]>([2026]);
  const [year, setYear] = useState(2026);
  const [cadence, setCadence] = useState<HrPayrollCadence>('semanal');
  const [periods, setPeriods] = useState<HrPayrollPeriod[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<HrPayrollPeriod | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isQuincena = cadence === 'quincenal';

  const sortedPeriods = useMemo(() => {
    // Defensa UI: una entrada por period_start aunque la API/DB traiga extras.
    const byStart = new Map<string, HrPayrollPeriod>();
    const rank: Record<string, number> = {
      pagado: 3,
      cerrado: 2,
      borrador: 1,
    };
    for (const p of periods) {
      const key = p.period_start.slice(0, 10);
      const prev = byStart.get(key);
      if (!prev) {
        byStart.set(key, p);
        continue;
      }
      const better =
        (rank[p.status] || 0) > (rank[prev.status] || 0) ||
        ((rank[p.status] || 0) === (rank[prev.status] || 0) &&
          (p.line_count ?? 0) > (prev.line_count ?? 0));
      if (better) byStart.set(key, p);
    }
    return [...byStart.values()].sort(
      (a, b) =>
        b.period_end.localeCompare(a.period_end) ||
        weekSortKey(b) - weekSortKey(a) ||
        b.period_start.localeCompare(a.period_start)
    );
  }, [periods]);

  const totalImporte = useMemo(
    () => draft.reduce((sum, r) => sum + (parseNum(r.importe_pagado) ?? 0), 0),
    [draft]
  );

  const teamBuckets = useMemo(() => groupDraftByTeam(draft), [draft]);

  const dayLabels = useMemo(() => weekDayLabels(period), [period]);

  const loadPeriods = useCallback(async (y: number, cad: HrPayrollCadence) => {
    const res = await fetch(
      `/api/hr/payroll?year=${y}&cadence=${cad}`,
      { cache: 'no-store' }
    );
    const json = (await res.json()) as ListPayload;
    const list = json.periods || [];
    setPeriods(list);
    setMessage(
      json.ready
        ? null
        : friendlyUserMessage(json.message) || 'Sin datos de nómina'
    );
    return list;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    const res = await fetch(`/api/hr/payroll?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    const json = (await res.json()) as DetailPayload;
    if (!json.period) {
      setPeriod(null);
      setDraft([]);
      setDirty(false);
      setEditing(false);
      setToast(
        friendlyUserMessage(json.message) || 'No se pudo cargar el periodo'
      );
      return;
    }
    setPeriod(json.period);
    setDraft(linesToDraft(json.lines || []));
    setDirty(false);
    setEditing(false);
  }, []);

  const ensureYear = useCallback(
    async (y: number, refreshExisting = false) => {
      setSyncing(true);
      try {
        const res = await fetch('/api/hr/payroll/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ensure_year',
            year: y,
            refreshExisting,
            enrichBase: true,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setToast(
            friendlyUserMessage(json.error) ||
              'No se pudo sincronizar el historial'
          );
          return false;
        }
        if (json.created > 0 || json.refreshed > 0) {
          setToast(
            friendlyUserMessage(json.message) || 'Historial actualizado'
          );
        }
        return true;
      } catch {
        setToast('No se pudo sincronizar el historial de nómina');
        return false;
      } finally {
        setSyncing(false);
      }
    },
    []
  );

  const openYear = useCallback(
    async (
      y: number,
      cad: HrPayrollCadence = 'semanal',
      opts?: { forceRefresh?: boolean; pickId?: string | null }
    ) => {
      setLoading(true);
      setYear(y);
      setCadence(cad);
      try {
        let list = await loadPeriods(y, cad);
        if (cad === 'semanal') {
          if (list.length === 0 || opts?.forceRefresh) {
            await ensureYear(y, Boolean(opts?.forceRefresh));
            list = await loadPeriods(y, cad);
          } else {
            void ensureYear(y, false).then(async (ok) => {
              if (!ok) return;
              const next = await loadPeriods(y, cad);
              setPeriods(next);
            });
          }
        }

        const pick =
          cad === 'quincenal'
            ? opts?.pickId
              ? list.find((p) => p.id === opts.pickId) ||
                pickDefaultQuincena(list)
              : pickDefaultQuincena(list)
            : pickDefaultPeriod(list, opts?.pickId);
        if (pick) {
          await loadDetail(pick.id);
        } else {
          setSelectedId(null);
          setPeriod(null);
          setDraft([]);
        }
        onChanged?.();
      } catch {
        setMessage('Error de red al cargar nómina');
        setPeriods([]);
      } finally {
        setLoading(false);
      }
    },
    [ensureYear, loadDetail, loadPeriods, onChanged]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probeRes = await fetch('/api/hr/payroll/import', {
          cache: 'no-store',
        });
        const probe = (await probeRes.json()) as ProbePayload;
        if (cancelled) return;
        const files = probe.localFileLabels?.length
          ? probe.localFileLabels
          : probe.localFiles || [];
        const years = files
          .map((f) => f.year)
          .filter((n): n is number => typeof n === 'number');
        const unique = [...new Set(years.length ? years : [2026])].sort(
          (a, b) => b - a
        );
        if (!unique.includes(2026)) unique.push(2026);
        unique.sort((a, b) => b - a);
        setYearOptions(unique);
        const startYear = unique.includes(2026) ? 2026 : unique[0] || 2026;
        await openYear(startYear, 'semanal');
      } catch {
        if (!cancelled) await openYear(2026, 'semanal');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(status: HrPayrollStatus) {
    if (!selectedId) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch('/api/hr/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(friendlyUserMessage(json.error) || 'No se pudo actualizar');
        return;
      }
      setToast(friendlyUserMessage(json.message) || 'Estatus actualizado');
      await loadPeriods(year, cadence);
      await loadDetail(selectedId);
      onChanged?.();
    } catch {
      setToast('Error de red');
    } finally {
      setBusy(false);
    }
  }

  async function saveLines() {
    if (!selectedId) return;
    const lines = draftToInputs(draft);
    if (!lines.length) {
      setToast('Agrega al menos una línea con nombre');
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch('/api/hr/payroll', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, lines }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(
          friendlyUserMessage(json.error) || 'No se pudieron guardar las líneas'
        );
        return;
      }
      setToast(friendlyUserMessage(json.message) || 'Cambios guardados');
      await loadPeriods(year, cadence);
      await loadDetail(selectedId);
      onChanged?.();
    } catch {
      setToast('Error de red al guardar');
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setBusy(true);
    setToast(null);
    setMenuOpen(false);
    try {
      const fd = new FormData();
      fd.set(
        'action',
        /\.xlsx$/i.test(file.name) ? 'upload_xlsx' : 'upload_csv'
      );
      fd.set('file', file);
      fd.set('markPaid', 'false');
      const res = await fetch('/api/hr/payroll/import', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(
          friendlyUserMessage(json.error) || 'No se pudo cargar el archivo'
        );
        return;
      }
      setToast(friendlyUserMessage(json.message) || 'Archivo cargado');
      const periodId = json.period?.id as string | undefined;
      const periodStart = String(json.period?.period_start || '').slice(0, 4);
      const y = Number(periodStart) || year;
      await openYear(y, 'semanal', { pickId: periodId || null });
      onChanged?.();
    } catch {
      setToast('Error de red al subir archivo');
    } finally {
      setBusy(false);
    }
  }

  async function enrichBase() {
    setBusy(true);
    setToast(null);
    setMenuOpen(false);
    try {
      const res = await fetch('/api/hr/payroll/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enrich_base_datos',
          createMissing: false,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(
          friendlyUserMessage(json.error) ||
            'No se pudo enriquecer la plantilla'
        );
        return;
      }
      setToast(
        friendlyUserMessage(json.message) || 'Datos de personal aplicados'
      );
      if (selectedId) await loadDetail(selectedId);
      onChanged?.();
    } catch {
      setToast('No se pudo enriquecer los datos de personal');
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(idx: number, patch: Partial<DraftLine>) {
    setDraft((rows) => {
      const next = [...rows];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    setDirty(true);
  }

  function toggleDraftDay(idx: number, dayIndex: number, on: boolean) {
    setDraft((rows) => {
      const next = [...rows];
      const row = next[idx];
      if (!row) return rows;
      const dias = setDiasSemanaDay(row.dias_semana, dayIndex, on);
      next[idx] = {
        ...row,
        dias_semana: dias,
        dias_marks_active: true,
        dias_trabajados: numOrEmpty(sumDiasSemana(dias)),
      };
      return next;
    });
    setDirty(true);
  }

  function findDraftIndex(key: string): number {
    return draft.findIndex((r) => r.key === key);
  }

  async function selectPeriod(id: string) {
    if (id === selectedId && period) return;
    if (
      dirty &&
      !confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de periodo?')
    ) {
      return;
    }
    await loadDetail(id);
  }

  async function changeYear(y: number) {
    if (
      dirty &&
      !confirm('Hay cambios sin guardar. ¿Continuar?')
    ) {
      return;
    }
    await openYear(y, cadence);
  }

  async function changeCadence(next: HrPayrollCadence) {
    if (next === cadence) return;
    if (
      dirty &&
      !confirm('Hay cambios sin guardar. ¿Continuar?')
    ) {
      return;
    }
    await openYear(year, next);
  }

  function periodListLabel(p: HrPayrollPeriod): string {
    if (p.cadence === 'quincenal' || isQuincena) return p.label;
    const wn = weekNumber(p);
    return wn != null ? `Semana ${wn}` : p.label;
  }

  const asOf = period?.period_end || period?.paid_at || null;
  const statusMsg = friendlyUserMessage(toast) || friendlyUserMessage(message);
  const weekLabelShort =
    isQuincena || period?.cadence === 'quincenal'
      ? period?.label || ''
      : period && weekNumber(period) != null
        ? `Semana ${weekNumber(period)}`
        : period?.label || '';
  const personCount =
    draft.length || period?.line_count || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold" style={{ color: theme.title }}>
            Nómina
          </h3>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            {isQuincena
              ? 'Control de pago quincenal · administrativos y socios'
              : 'Histórico de periodos · detalle por semana'}
          </p>
          <div
            className="mt-3 inline-flex rounded-full border border-slate-200 bg-white p-0.5"
            role="tablist"
            aria-label="Cadencia de nómina"
          >
            {(['semanal', 'quincenal'] as const).map((c) => {
              const active = cadence === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={busy || loading || syncing}
                  onClick={() => void changeCadence(c)}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  style={{
                    backgroundColor: active ? SUITE.navy : 'transparent',
                    color: active ? '#fff' : theme.title,
                  }}
                >
                  {HR_PAYROLL_CADENCE_LABELS[c]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative flex flex-wrap items-end gap-2">
          <label
            className="text-xs font-semibold"
            style={{ color: theme.muted }}
          >
            Año
            <select
              className="mt-1 block min-w-[5.5rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              value={year}
              disabled={busy || loading || syncing}
              onChange={(e) => void changeYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
            style={{ color: theme.title }}
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
          >
            Más…
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              style={{ boxShadow: SUITE.shadow }}
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={busy || syncing}
                onClick={() => {
                  setMenuOpen(false);
                  void openYear(year, cadence, {
                    forceRefresh: true,
                    pickId: selectedId,
                  });
                }}
              >
                {syncing ? 'Actualizando…' : 'Actualizar historial'}
              </button>
              <label className="block cursor-pointer px-3 py-2 text-sm hover:bg-slate-50">
                Subir archivo
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  disabled={busy || isQuincena}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {!isQuincena && (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={busy}
                onClick={() => void enrichBase()}
              >
                Enriquecer personal
              </button>
              )}
              {isQuincena && (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={busy || !selectedId}
                onClick={() => {
                  setMenuOpen(false);
                  if (!selectedId) return;
                  void (async () => {
                    setBusy(true);
                    try {
                      const res = await fetch(
                        `/api/hr/payroll?id=${encodeURIComponent(selectedId)}&reseed=1`,
                        { cache: 'no-store' }
                      );
                      const json = (await res.json()) as DetailPayload;
                      if (!json.period) {
                        setToast(
                          friendlyUserMessage(json.message) ||
                            'No se pudo recargar'
                        );
                        return;
                      }
                      setPeriod(json.period);
                      setDraft(linesToDraft(json.lines || []));
                      setDirty(false);
                      setEditing(false);
                      setToast('Personal quincenal actualizado desde plantilla');
                      await loadPeriods(year, cadence);
                    } catch {
                      setToast('Error de red');
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Recargar personal quincenal
              </button>
              )}
            </div>
          )}
        </div>
      </div>

      {statusMsg && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
          {syncing ? 'Actualizando historial…' : statusMsg}
        </p>
      )}
      {!statusMsg && syncing && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
          Actualizando historial…
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        {/* Histórico */}
        <aside className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-bold" style={{ color: theme.title }}>
              Histórico
            </h4>
            <span className="text-xs" style={{ color: theme.muted }}>
              {sortedPeriods.length} periodo
              {sortedPeriods.length === 1 ? '' : 's'}
            </span>
          </div>
          {loading || (syncing && sortedPeriods.length === 0) ? (
            <p className="text-sm" style={{ color: theme.muted }}>
              {syncing
                ? `Cargando nómina ${year}…`
                : 'Cargando…'}
            </p>
          ) : sortedPeriods.length === 0 ? (
            <SuiteCard>
              <p
                className="text-sm font-semibold"
                style={{ color: theme.title }}
              >
                Sin periodos en {year}
              </p>
              <p className="mt-2 text-sm" style={{ color: theme.muted }}>
                {isQuincena
                  ? 'Cuando haya quincenas del año, aquí verás Q1/Q2 de cada mes. Puedes actualizar desde Más…'
                  : 'Cuando haya historial sincronizado, aquí verás todas las semanas. Puedes actualizar desde Más… o subir un archivo.'}
              </p>
              <button
                type="button"
                disabled={busy || syncing}
                onClick={() =>
                  void openYear(year, cadence, { forceRefresh: true })
                }
                className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: SUITE.navy }}
              >
                Buscar historial
              </button>
            </SuiteCard>
          ) : (
            <ul
              className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1"
              role="listbox"
              aria-label="Periodos de nómina"
            >
              {sortedPeriods.map((p) => {
                const st = statusStyle(p.status);
                const active = p.id === selectedId;
                const count = p.line_count ?? 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={busy}
                      onClick={() => void selectPeriod(p.id)}
                      className="w-full rounded-xl bg-white px-3 py-2.5 text-left transition-shadow disabled:opacity-50"
                      style={{
                        boxShadow: SUITE.shadow,
                        outline: active
                          ? `2px solid ${SUITE.navy}`
                          : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-sm font-semibold"
                          style={{ color: theme.title }}
                        >
                          {periodListLabel(p)}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style={{
                            backgroundColor: st.bg,
                            color: st.color,
                          }}
                        >
                          {HR_PAYROLL_STATUS_LABELS[p.status]}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 text-xs"
                        style={{ color: theme.muted }}
                      >
                        {formatHrDate(p.period_start)} –{' '}
                        {formatHrDate(p.period_end)}
                      </p>
                      <p
                        className="mt-0.5 text-xs tabular-nums"
                        style={{ color: theme.muted }}
                      >
                        {count} pers.
                        {p.total_pagado != null
                          ? ` · ${moneyCompact(p.total_pagado)}`
                          : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Detalle */}
        <main className="min-w-0 space-y-3">
          {loading && !period ? (
            <p className="text-sm" style={{ color: theme.muted }}>
              Cargando nómina…
            </p>
          ) : !period ? (
            <SuiteCard className="max-w-2xl">
              <p
                className="text-sm font-bold"
                style={{ color: theme.title }}
              >
                Elige un periodo del histórico
              </p>
              <p className="mt-2 text-sm" style={{ color: theme.muted }}>
                {isQuincena
                  ? 'Se selecciona la quincena en curso. Marcar pagada registra el pago a administrativos/socios (no cambia la plantilla semanal).'
                  : 'Se selecciona por defecto la última nómina pagada o conciliada. Cerrar o marcar pagado actualiza la plantilla vigente.'}
              </p>
            </SuiteCard>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4
                  className="text-base font-bold"
                  style={{ color: theme.title }}
                >
                  {weekLabelShort}
                </h4>
                <StatusPill status={period.status} />
                <span className="text-sm" style={{ color: theme.muted }}>
                  {formatHrDate(period.period_start)} –{' '}
                  {formatHrDate(period.period_end)}
                  {' · '}
                  {personCount} pers. · {money(totalImporte)}
                  {period.status === 'pagado' && period.paid_at
                    ? ` · pagado ${formatHrDate(period.paid_at)}`
                    : ''}
                </span>
                {dirty && (
                  <span className="text-xs font-semibold text-amber-800">
                    Sin guardar
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <KpiTile
                  label="Personas"
                  value={String(personCount)}
                  accent={SUITE.navy}
                />
                <KpiTile
                  label="Total periodo"
                  value={money(totalImporte)}
                  accent={TEAL.border}
                />
              </div>

              {/* Acciones secundarias de estatus */}
              <div className="flex flex-wrap items-center gap-2">
                {period.status === 'borrador' && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{ color: theme.title }}
                    onClick={() => void setStatus('cerrado')}
                  >
                    Cerrar
                  </button>
                )}
                {period.status !== 'pagado' && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{ color: TEAL.deep }}
                    onClick={() => void setStatus('pagado')}
                    title={
                      isQuincena
                        ? 'Registrar pago de esta quincena'
                        : 'Conciliar: alimenta la plantilla vigente'
                    }
                  >
                    {isQuincena ? 'Marcar pagada' : 'Marcar pagado'}
                  </button>
                )}
                {period.status === 'pagado' && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{ color: theme.muted }}
                    onClick={() => void setStatus('borrador')}
                  >
                    Reabrir borrador
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
                  style={{
                    color: editing ? SUITE.orangeDeep : theme.title,
                    backgroundColor: editing ? SUITE.orangeSoft : '#fff',
                  }}
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? 'Salir de edición' : 'Editar líneas'}
                </button>
                {editing && (
                  <>
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold"
                      style={{ color: theme.title }}
                      onClick={() => {
                        setDraft((rows) => [...rows, emptyDraftLine()]);
                        setDirty(true);
                      }}
                    >
                      + Línea
                    </button>
                    <button
                      type="button"
                      disabled={busy || !dirty}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: SUITE.navy }}
                      onClick={() => void saveLines()}
                    >
                      Guardar cambios
                    </button>
                  </>
                )}
              </div>

              {/* Tabla quincenal o semanal */}
              {isQuincena ? (
              <div
                className="overflow-x-auto rounded-2xl bg-white"
                style={{ boxShadow: SUITE.shadow }}
              >
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr
                      className="border-b text-[11px] uppercase tracking-[0.12em]"
                      style={{ color: theme.muted }}
                    >
                      <th className="px-4 py-3 font-semibold">Nombre</th>
                      <th className="px-4 py-3 font-semibold">Puesto</th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Importe quincenal
                      </th>
                      <th className="px-4 py-3 font-semibold">Antigüedad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((row) => {
                      const idx = findDraftIndex(row.key);
                      return editing && idx >= 0 ? (
                        <tr key={row.key} className="border-b border-slate-100">
                          <td className="px-2 py-1.5">
                            <input
                              className="w-full min-w-[9rem] rounded border border-slate-200 px-2 py-1 text-sm font-medium"
                              style={{ color: theme.title }}
                              value={row.full_name}
                              onChange={(e) =>
                                updateDraft(idx, { full_name: e.target.value })
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              className="w-full min-w-[7rem] rounded border border-slate-200 px-2 py-1 text-sm"
                              value={row.puesto}
                              onChange={(e) =>
                                updateDraft(idx, { puesto: e.target.value })
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              className="w-28 rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums"
                              value={row.importe_pagado}
                              onChange={(e) =>
                                updateDraft(idx, {
                                  importe_pagado: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td
                            className="whitespace-nowrap px-4 py-2 text-xs"
                            style={{ color: theme.muted }}
                          >
                            {formatAntiguedad(row.fecha_ingreso, asOf)}
                          </td>
                        </tr>
                      ) : (
                        <tr key={row.key} className="border-b border-slate-100">
                          <td
                            className="px-4 py-3 font-medium"
                            style={{ color: theme.title }}
                          >
                            {formatHrListName(row.full_name) || row.full_name}
                          </td>
                          <td className="px-4 py-3" style={{ color: theme.muted }}>
                            {formatHrPuesto(row.puesto) || row.puesto || '—'}
                          </td>
                          <td
                            className="px-4 py-3 text-right font-semibold tabular-nums"
                            style={{ color: SUITE.navy }}
                          >
                            {money(parseNum(row.importe_pagado))}
                          </td>
                          <td
                            className="whitespace-nowrap px-4 py-3 text-xs"
                            style={{ color: theme.muted }}
                          >
                            {formatAntiguedad(row.fecha_ingreso, asOf)}
                          </td>
                        </tr>
                      );
                    })}
                    {!draft.length && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-8 text-sm"
                          style={{ color: theme.muted }}
                        >
                          Sin personal quincenal en esta quincena. Abre el
                          periodo (se arma desde plantilla admin/socios) o usa
                          «Editar líneas».
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {draft.length > 0 && (
                    <tfoot>
                      <tr
                        className="border-t"
                        style={{ backgroundColor: '#F7F9FC' }}
                      >
                        <td
                          colSpan={2}
                          className="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                          style={{ color: theme.muted }}
                        >
                          Total · {draft.length} colaborador
                          {draft.length === 1 ? '' : 'es'}
                        </td>
                        <td
                          className="px-4 py-3 text-right text-sm font-bold tabular-nums"
                          style={{ color: SUITE.navy }}
                        >
                          {money(totalImporte)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              ) : (

              <div
                className="overflow-x-auto rounded-2xl bg-white"
                style={{ boxShadow: SUITE.shadow }}
              >
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr
                      className="border-b text-[11px] uppercase tracking-[0.12em]"
                      style={{ color: theme.muted }}
                    >
                      <th className="px-4 py-3 font-semibold">Nombre</th>
                      <th className="px-4 py-3 font-semibold">Puesto</th>
                      <th className="px-4 py-3 font-semibold text-right">
                        <span className="block">Días</span>
                        <span className="mt-0.5 flex justify-end gap-0.5 font-semibold normal-case tracking-normal">
                          {dayLabels.map((lab, i) => {
                            const isDom = HR_PAYROLL_DAY_LETTERS[i] === 'D';
                            return (
                              <span
                                key={HR_PAYROLL_DAY_LETTERS[i]}
                                className="inline-flex w-5 justify-center text-[9px] opacity-80"
                                title={
                                  isDom
                                    ? `${lab} · prima 25% (1.25)`
                                    : lab
                                }
                              >
                                {HR_PAYROLL_DAY_LETTERS[i]}
                              </span>
                            );
                          })}
                          <span
                            className="inline-flex min-w-[1.75rem] justify-end text-[9px] opacity-70"
                            title="Dom marcado = 1.25 (prima 25%)"
                          >
                            Σ
                          </span>
                        </span>
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Sueldo diario
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Extras
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Bonos
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Ret.
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Importe
                      </th>
                      <th className="px-4 py-3 font-semibold">Antigüedad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamBuckets.map((bucket) => {
                      const familyIds = new Set(
                        bucket.rows.map(
                          (r) =>
                            plantillaPositionFamily(r.puesto || r.area).id
                        )
                      );
                      const showFamilyHeaders = familyIds.size > 1;
                      return (
                        <Fragment key={bucket.group}>
                          <tr
                            className="border-b border-slate-200"
                            style={{ backgroundColor: SUITE.orangeSoft }}
                          >
                            <td
                              colSpan={9}
                              className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide"
                              style={{ color: SUITE.navy }}
                            >
                              {bucket.label}
                              <span className="ml-2 font-semibold normal-case tracking-normal opacity-80">
                                {bucket.rows.length}
                              </span>
                              <span
                                className="ml-3 font-semibold normal-case tracking-normal tabular-nums"
                                style={{ color: TEAL.deep }}
                              >
                                {money(bucket.total)}
                              </span>
                            </td>
                          </tr>
                          {bucket.rows.map((row, i) => {
                            const fam = plantillaPositionFamily(
                              row.puesto || row.area
                            );
                            const prev =
                              i > 0
                                ? plantillaPositionFamily(
                                    bucket.rows[i - 1].puesto ||
                                      bucket.rows[i - 1].area
                                  )
                                : null;
                            const showSub =
                              showFamilyHeaders &&
                              fam.id !== 'otros' &&
                              (!prev || prev.id !== fam.id);
                            const idx = findDraftIndex(row.key);
                            const he = parseNum(row.horas_extra) ?? 0;

                            return (
                              <Fragment key={row.key}>
                                {showSub ? (
                                  <tr className="border-b border-slate-100">
                                    <td
                                      colSpan={9}
                                      className="px-4 pt-2.5 pb-1 text-[11px] font-medium tracking-wide"
                                      style={{ color: theme.muted }}
                                    >
                                      {fam.label}
                                    </td>
                                  </tr>
                                ) : null}
                                {editing && idx >= 0 ? (
                                  <tr className="border-b border-slate-100">
                                    <td className="px-2 py-1.5">
                                      <input
                                        className="w-full min-w-[9rem] rounded border border-slate-200 px-2 py-1 text-sm font-medium"
                                        style={{ color: theme.title }}
                                        value={row.full_name}
                                        onChange={(e) =>
                                          updateDraft(idx, {
                                            full_name: e.target.value,
                                          })
                                        }
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        className="w-full min-w-[6rem] rounded border border-slate-200 px-2 py-1 text-sm"
                                        value={row.puesto}
                                        onChange={(e) =>
                                          updateDraft(idx, {
                                            puesto: e.target.value,
                                          })
                                        }
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <DiasSemanaChecks
                                        days={row.dias_semana}
                                        dayLabels={dayLabels}
                                        editable
                                        fallbackTotal={parseNum(
                                          row.dias_trabajados
                                        )}
                                        onToggle={(dayIndex, on) =>
                                          toggleDraftDay(idx, dayIndex, on)
                                        }
                                      />
                                    </td>
                                    {(
                                      [
                                        'sueldo_diario',
                                        'horas_extra',
                                        'bonos',
                                        'retenciones',
                                        'importe_pagado',
                                      ] as const
                                    ).map((field) => (
                                      <td key={field} className="px-2 py-1.5">
                                        <input
                                          type="number"
                                          step="any"
                                          className="w-full min-w-[4.5rem] rounded border border-slate-200 px-2 py-1 text-right text-sm tabular-nums"
                                          value={row[field]}
                                          onChange={(e) =>
                                            updateDraft(idx, {
                                              [field]: e.target.value,
                                            })
                                          }
                                        />
                                      </td>
                                    ))}
                                    <td
                                      className="whitespace-nowrap px-4 py-2 text-xs"
                                      style={{ color: theme.muted }}
                                    >
                                      {formatAntiguedad(
                                        row.fecha_ingreso,
                                        asOf
                                      )}
                                    </td>
                                  </tr>
                                ) : (
                                  <tr className="border-b border-slate-100 last:border-0">
                                    <td
                                      className="px-4 py-3 font-medium"
                                      style={{ color: theme.title }}
                                    >
                                      {row.full_name
                                        ? formatHrListName(row.full_name)
                                        : '—'}
                                    </td>
                                    <td
                                      className="px-4 py-3"
                                      style={{ color: theme.muted }}
                                    >
                                      {formatHrPuesto(row.puesto) || '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                      <DiasSemanaChecks
                                        days={row.dias_semana}
                                        dayLabels={dayLabels}
                                        editable={false}
                                        fallbackTotal={parseNum(
                                          row.dias_trabajados
                                        )}
                                      />
                                    </td>
                                    <td
                                      className="px-4 py-3 text-right tabular-nums"
                                      style={{ color: theme.muted }}
                                    >
                                      {money(parseNum(row.sueldo_diario))}
                                    </td>
                                    <td
                                      className="px-4 py-3 text-right tabular-nums"
                                      style={{ color: theme.muted }}
                                    >
                                      {he
                                        ? he.toLocaleString('es-MX')
                                        : '—'}
                                    </td>
                                    <td
                                      className="px-4 py-3 text-right tabular-nums"
                                      style={{ color: theme.muted }}
                                    >
                                      {money(parseNum(row.bonos))}
                                    </td>
                                    <td
                                      className="px-4 py-3 text-right tabular-nums"
                                      style={{ color: theme.muted }}
                                    >
                                      {money(parseNum(row.retenciones))}
                                    </td>
                                    <td
                                      className="px-4 py-3 text-right font-semibold tabular-nums"
                                      style={{ color: SUITE.navy }}
                                    >
                                      {money(parseNum(row.importe_pagado))}
                                    </td>
                                    <td
                                      className="whitespace-nowrap px-4 py-3 text-xs"
                                      style={{ color: theme.muted }}
                                      title={
                                        row.fecha_ingreso
                                          ? formatHrDate(row.fecha_ingreso)
                                          : undefined
                                      }
                                    >
                                      {formatAntiguedad(
                                        row.fecha_ingreso,
                                        asOf
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                    {!draft.length && (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-4 py-8 text-sm"
                          style={{ color: theme.muted }}
                        >
                          Sin líneas en este periodo. Usa «Editar líneas» o
                          actualiza el historial desde Más…
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {draft.length > 0 && (
                    <tfoot>
                      <tr
                        className="border-t"
                        style={{ backgroundColor: '#F7F9FC' }}
                      >
                        <td
                          colSpan={7}
                          className="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                          style={{ color: theme.muted }}
                        >
                          Total · {draft.length} colaborador
                          {draft.length === 1 ? '' : 'es'}
                        </td>
                        <td
                          className="px-4 py-3 text-right text-sm font-bold tabular-nums"
                          style={{ color: SUITE.navy }}
                        >
                          {money(totalImporte)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              )}

              {teamBuckets.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {teamBuckets.map((b) => (
                    <span
                      key={b.group}
                      className="rounded-full px-3 py-1 text-xs font-semibold"
                      style={{ backgroundColor: TEAL.bg, color: TEAL.deep }}
                    >
                      {b.label}: {b.rows.length} · {moneyCompact(b.total)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
