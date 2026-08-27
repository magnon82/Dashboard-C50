'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  HR_ATTENDANCE_TOLERANCE_MINUTES,
  HR_ATTENDANCE_RETARDOS_PER_FALTA,
} from '@/app/lib/hr-attendance-policy';
import { HR_ATTENDANCE_DAY_STATUS_LABELS } from '@/app/lib/hr-attendance-reconcile';
import { formatHrDate } from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type ReportRow = {
  id: string;
  week_start: string;
  week_end: string;
  week_number: number | null;
  source_filename: string | null;
  uploaded_by: string | null;
  punch_count: number;
  created_at: string;
};

type ReconcilePayload = {
  week_start: string;
  week_end: string;
  people: Array<{
    employee_name: string;
    area: string | null;
    retardos: number;
    tolerancias: number;
    sin_entrada: number;
    sin_salida: number;
    faltas: number;
    line: string;
    days: Array<{
      work_date: string;
      scheduled_start: string | null;
      scheduled_end: string | null;
      actual_in: string | null;
      actual_out: string | null;
      status: keyof typeof HR_ATTENDANCE_DAY_STATUS_LABELS;
      late_minutes: number | null;
    }>;
  }>;
  totals: {
    retardos: number;
    tolerancias: number;
    sin_entrada: number;
    sin_salida: number;
    faltas: number;
  };
  narrative: string[];
};

export function RrhhAsistencia() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [ready, setReady] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<ReconcilePayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/attendance', { cache: 'no-store' });
      const json = await res.json();
      setReady(json.ready !== false);
      setMessage(json.message || json.error || null);
      setReports(Array.isArray(json.reports) ? json.reports : []);
    } catch {
      setReady(false);
      setMessage('Error de red al cargar reportes');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function openReport(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    setReconcile(null);
    try {
      const res = await fetch(`/api/hr/attendance/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo cargar el reporte');
        return;
      }
      setReconcile(json.reconcile || null);
    } catch {
      setToast('Error de red');
    } finally {
      setDetailLoading(false);
    }
  }

  async function onUpload(file: File) {
    setBusy(true);
    setToast(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/hr/attendance', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo importar');
        return;
      }
      setToast(
        `Importado · ${json.report?.punch_count ?? 0} checadas` +
          (json.warnings?.length ? ` · ${json.warnings[0]}` : '')
      );
      await loadList();
      if (json.report?.id) {
        setSelectedId(json.report.id);
        setReconcile(json.reconcile || null);
      }
    } catch {
      setToast('Error de red al subir');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function copyNarrative() {
    if (!reconcile?.narrative?.length) return;
    const text = reconcile.narrative.join('\n');
    void navigator.clipboard.writeText(text).then(
      () => setToast('Incidencias copiadas al portapapeles'),
      () => setToast('No se pudo copiar')
    );
  }

  return (
    <div className="space-y-4">
      <SuiteCard className="max-w-3xl">
        <p className="text-sm font-bold" style={{ color: theme.title }}>
          Asistencia biométrica
        </p>
        <p className="mt-1 text-sm" style={{ color: theme.muted }}>
          Sube el .xlsx del reloj checador. Se coteja Entrada/Salida vs horario
          publicado (tolerancia {HR_ATTENDANCE_TOLERANCE_MINUTES} min ·{' '}
          {HR_ATTENDANCE_RETARDOS_PER_FALTA} retardos = 1 falta · omisión = ½ día).
          Fase 1: import manual; luego conexión por IP.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: SUITE.navy }}
          >
            {busy ? 'Importando…' : 'Subir reporte xlsx'}
          </button>
          <button
            type="button"
            onClick={() => void loadList()}
            className="rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ backgroundColor: '#fff', color: SUITE.navy, boxShadow: SUITE.shadow }}
          >
            Actualizar lista
          </button>
        </div>
        {toast && (
          <p className="mt-2 text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
            {toast}
          </p>
        )}
        {!ready && message && (
          <p className="mt-2 text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
      </SuiteCard>

      <div className="grid gap-4 lg:grid-cols-5">
        <SuiteCard className="lg:col-span-2">
          <p className="text-sm font-bold" style={{ color: theme.title }}>
            Reportes importados
          </p>
          <ul className="mt-3 max-h-[28rem] space-y-1 overflow-y-auto">
            {reports.length === 0 ? (
              <li className="text-sm" style={{ color: theme.muted }}>
                Aún no hay reportes.
              </li>
            ) : (
              reports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void openReport(r.id)}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm transition-colors"
                    style={{
                      backgroundColor:
                        selectedId === r.id ? '#e8eef8' : '#f8fafc',
                      color: theme.title,
                    }}
                  >
                    <span className="font-semibold">
                      {r.week_number != null ? `Sem ${r.week_number} · ` : ''}
                      {formatHrDate(r.week_start)} – {formatHrDate(r.week_end)}
                    </span>
                    <span
                      className="mt-0.5 block text-xs"
                      style={{ color: theme.muted }}
                    >
                      {r.punch_count} checadas
                      {r.source_filename ? ` · ${r.source_filename}` : ''}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </SuiteCard>

        <SuiteCard className="lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold" style={{ color: theme.title }}>
              Cotejo e incidencias
            </p>
            {reconcile && (
              <button
                type="button"
                onClick={copyNarrative}
                className="text-xs font-semibold underline"
                style={{ color: SUITE.orangeDeep }}
              >
                Copiar resumen (correo)
              </button>
            )}
          </div>

          {detailLoading && (
            <p className="mt-3 text-sm" style={{ color: theme.muted }}>
              Cargando…
            </p>
          )}

          {!detailLoading && !reconcile && (
            <p className="mt-3 text-sm" style={{ color: theme.muted }}>
              Sube un xlsx o elige un reporte de la lista.
            </p>
          )}

          {reconcile && (
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-900">
                  {reconcile.totals.retardos} retardos
                </span>
                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-orange-900">
                  {reconcile.totals.tolerancias} tolerancia
                </span>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900">
                  {reconcile.totals.sin_entrada} sin entrada
                </span>
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-900">
                  {reconcile.totals.sin_salida} sin salida
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-800">
                  {reconcile.totals.faltas} faltas
                </span>
              </div>

              <div
                className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap"
                style={{ backgroundColor: '#fffbeb', color: '#92400e' }}
              >
                {reconcile.narrative.join('\n')}
              </div>

              <ul className="space-y-2 max-h-[22rem] overflow-y-auto">
                {reconcile.people.map((p) => (
                  <li
                    key={p.employee_name}
                    className="rounded-xl border border-slate-100 px-3 py-2"
                  >
                    <p className="text-sm font-semibold" style={{ color: theme.title }}>
                      {p.employee_name}
                      {p.area ? (
                        <span
                          className="ml-2 text-xs font-normal"
                          style={{ color: theme.muted }}
                        >
                          {p.area}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
                      {p.line}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                        Detalle por día
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[11px] tabular-nums text-slate-700">
                        {p.days.map((d) => (
                          <li key={d.work_date}>
                            {d.work_date.slice(5)} · prog{' '}
                            {d.scheduled_start || '—'}–{d.scheduled_end || '—'} ·
                            real {d.actual_in || '—'}–{d.actual_out || '—'} ·{' '}
                            {HR_ATTENDANCE_DAY_STATUS_LABELS[d.status] || d.status}
                            {d.late_minutes != null && d.late_minutes > 0
                              ? ` (+${d.late_minutes} min)`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SuiteCard>
      </div>
    </div>
  );
}
