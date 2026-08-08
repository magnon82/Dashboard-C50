'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  formatTimestampCdmx,
  formatTimestampCdmxShort,
} from '@/app/lib/admin-last-updates';
import {
  modeLabelEs,
  type ModuleSyncRow,
  type SyncScheduleMode,
  type SyncStatusKind,
  type SyncWorkflowKey,
} from '@/app/lib/admin-sync-schedules';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type SourceDetail = {
  sourceFile: string;
  rowCount: number;
  lastDate: string | null;
  lastIngestedAt: string | null;
};

type ScheduleRow = {
  id: string;
  label: string;
  feeds: string;
  mode: SyncScheduleMode;
  schedule: string;
  cronUtc?: string;
  areaId: string | null;
  workflow?: SyncWorkflowKey;
  canDispatch?: boolean;
  canDispatchNow?: boolean;
  actionsUrl?: string;
  note?: string;
  lastAt: string | null;
  lastDisplay: string | null;
  lastSource: string;
  sourceDetails?: SourceDetail[];
};

function formatAt(iso: string | null): string {
  if (!iso) return 'Sin sincronizar';
  return formatTimestampCdmx(iso) || formatTimestampCdmxShort(iso) || iso;
}

function statusStyle(status: SyncStatusKind): {
  bg: string;
  color: string;
  label: string;
} {
  switch (status) {
    case 'ok':
      return { bg: '#ECFDF5', color: '#065F46', label: 'Al día' };
    case 'stale':
      return { bg: '#FFF7ED', color: '#9A3412', label: '> 7 días' };
    case 'manual':
      return { bg: '#F1F5F9', color: '#334155', label: 'Manual / fijo' };
    default:
      return { bg: '#FEF2F2', color: '#991B1B', label: 'Sin sync' };
  }
}

function modeBadgeStyle(mode: SyncScheduleMode): { background: string; color: string } {
  switch (mode) {
    case 'cloud':
      return { background: '#E7F6EE', color: '#1F6B45' };
    case 'manual':
      return { background: '#F1F5F9', color: '#64748B' };
    case 'mixed':
      return { background: '#FFF3E0', color: '#B45309' };
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0 transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path
        d="M4 6.2 8 10l4-3.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScheduleCard({
  row,
  onDispatch,
  busyWorkflow,
  dispatchMsg,
  msgWorkflow,
}: {
  row: ScheduleRow;
  onDispatch: (workflow: SyncWorkflowKey) => void;
  busyWorkflow: SyncWorkflowKey | null;
  dispatchMsg: string | null;
  msgWorkflow: SyncWorkflowKey | null;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const modeStyle = modeBadgeStyle(row.mode);
  const busy = row.workflow != null && busyWorkflow === row.workflow;
  const lastLabel = row.lastAt
    ? `${row.mode === 'manual' ? 'Última carga' : 'Última sync'}: ${formatTimestampCdmxShort(row.lastAt)}`
    : row.lastDisplay ||
      (row.mode === 'manual' || row.mode === 'mixed'
        ? 'Última carga: sin registro'
        : 'Última sync: Sin registro');

  return (
    <div
      className="overflow-hidden rounded-xl border bg-white"
      style={{ borderColor: SUITE.border }}
    >
      <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
              {row.label}
            </p>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={modeStyle}
            >
              {modeLabelEs(row.mode)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug" style={{ color: theme.muted }}>
            {row.feeds}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug">
            <span className="font-semibold" style={{ color: SUITE.navy }}>
              Programado:{' '}
            </span>
            <span style={{ color: SUITE.orangeDeep }}>{row.schedule}</span>
          </p>
          <p className="mt-0.5 text-[11px] font-semibold" style={{ color: SUITE.orangeDeep }}>
            {lastLabel}
          </p>
          {row.cronUtc ? (
            <p className="mt-0.5 font-mono text-[10px]" style={{ color: theme.muted }}>
              cron UTC: {row.cronUtc}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {row.actionsUrl ? (
            <a
              href={row.actionsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-slate-50"
              style={{ borderColor: SUITE.border, color: SUITE.navy }}
            >
              Ver Actions
            </a>
          ) : null}
          {row.workflow && row.canDispatch ? (
            <button
              type="button"
              disabled={busy || !row.canDispatchNow}
              title={
                row.canDispatchNow
                  ? 'Disparar workflow_dispatch ahora'
                  : 'Falta GH_WORKFLOW_DISPATCH_TOKEN · usa Ver Actions → Run workflow'
              }
              onClick={() => onDispatch(row.workflow!)}
              className="inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-bold text-white transition-opacity disabled:opacity-45"
              style={{ backgroundColor: SUITE.navy }}
            >
              {busy ? 'Encolando…' : 'Sincronizar ahora'}
            </button>
          ) : null}
          {(row.sourceDetails?.length || row.note) && (
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold"
              style={{ borderColor: SUITE.border, color: SUITE.navySoft }}
              aria-expanded={detailOpen}
            >
              Detalle
              <Chevron open={detailOpen} />
            </button>
          )}
        </div>
      </div>

      {dispatchMsg && msgWorkflow === row.workflow ? (
        <p className="border-t px-4 py-2 text-[11px]" style={{ borderColor: SUITE.border, color: theme.muted }}>
          {dispatchMsg}
        </p>
      ) : null}

      {detailOpen ? (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: SUITE.border, background: '#FCFDFE' }}>
          {row.note ? (
            <p className="text-[11px] leading-snug" style={{ color: theme.muted }}>
              {row.note}
            </p>
          ) : null}
          {row.sourceDetails && row.sourceDetails.length > 0 ? (
            <ul className="space-y-1.5">
              {row.sourceDetails.map((s) => (
                <li
                  key={s.sourceFile}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
                >
                  <code
                    className="rounded bg-[#F4F6F9] px-1.5 py-0.5 font-mono text-[10px]"
                    style={{ color: SUITE.navy }}
                  >
                    {s.sourceFile}
                  </code>
                  <span className="tabular-nums" style={{ color: theme.muted }}>
                    {s.rowCount.toLocaleString('es-MX')} fila{s.rowCount === 1 ? '' : 's'}
                  </span>
                  {s.lastIngestedAt ? (
                    <span className="font-semibold" style={{ color: SUITE.orangeDeep }}>
                      últ. {row.mode === 'manual' ? 'carga' : 'sync'}{' '}
                      {formatTimestampCdmxShort(s.lastIngestedAt)}
                    </span>
                  ) : s.lastDate ? (
                    <span style={{ color: theme.muted }}>dato {s.lastDate}</span>
                  ) : (
                    <span style={{ color: theme.muted }}>sin sync</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-[10px]" style={{ color: theme.muted }}>
            Horario solo lectura · editar cron = cambiar el workflow en el repo.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Controles de sincronización en /admin → Datos e inventario.
 * Vista principal: tablas por módulo (estilo Master BDMX).
 */
export function AdminSyncSchedules() {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [moduleRows, setModuleRows] = useState<ModuleSyncRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canDispatch, setCanDispatch] = useState(false);
  const [busyWorkflow, setBusyWorkflow] = useState<SyncWorkflowKey | null>(null);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  const [msgWorkflow, setMsgWorkflow] = useState<SyncWorkflowKey | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [pipelinesOpen, setPipelinesOpen] = useState(false);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/sync-schedules', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Error ${res.status}`);
      }
      setRows(Array.isArray(data.schedules) ? (data.schedules as ScheduleRow[]) : []);
      setModuleRows(
        Array.isArray(data.moduleRows) ? (data.moduleRows as ModuleSyncRow[]) : [],
      );
      setCanDispatch(Boolean(data.canDispatch));
      setFetchedAt(typeof data.fetchedAt === 'string' ? data.fetchedAt : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la programación');
      fetchedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    void load();
  }, [open, load]);

  async function dispatch(workflow: SyncWorkflowKey) {
    setBusyWorkflow(workflow);
    setMsgWorkflow(workflow);
    setDispatchMsg(null);
    try {
      const res = await fetch('/api/admin/sync-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDispatchMsg(String(json.error || 'No se pudo disparar el sync'));
        return;
      }
      setDispatchMsg(String(json.message || 'Sync encolado'));
      window.setTimeout(() => void load(), 90_000);
    } catch (e) {
      setDispatchMsg(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setBusyWorkflow(null);
    }
  }

  const byModule = useMemo(() => {
    const map = new Map<string, ModuleSyncRow[]>();
    for (const row of moduleRows) {
      const list = map.get(row.moduleLabel) || [];
      list.push(row);
      map.set(row.moduleLabel, list);
    }
    return [...map.entries()];
  }, [moduleRows]);

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold" style={{ color: SUITE.navy }}>
            Sincronizaciones
          </h2>
          <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
            Actualizaciones por módulo y fuente de datos (F1–F7 · V1–V2 · H1 · A1) · hora CDMX
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ background: '#059669' }}
            >
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-slate-50"
            style={{ borderColor: SUITE.border, color: SUITE.navy }}
          >
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="space-y-4">
          {error ? (
            <p className="text-sm" style={{ color: '#B45309' }}>
              {error}
            </p>
          ) : null}

          {fetchedAt ? (
            <p className="text-xs" style={{ color: SUITE.muted }}>
              Consulta: {formatAt(fetchedAt)}
              {!canDispatch && !loading ? (
                <span className="ml-2" style={{ color: '#B45309' }}>
                  · Sin GH_WORKFLOW_DISPATCH_TOKEN (usa Actions → Run workflow)
                </span>
              ) : null}
            </p>
          ) : loading && moduleRows.length === 0 ? (
            <p className="text-xs" style={{ color: SUITE.muted }}>
              Cargando sincronizaciones…
            </p>
          ) : null}

          {dispatchMsg ? (
            <p className="text-xs" style={{ color: theme.muted }}>
              {dispatchMsg}
              {msgWorkflow ? ` · ${msgWorkflow}` : ''}
            </p>
          ) : null}

          <div className="space-y-4">
            {byModule.map(([moduleLabel, moduleList]) => (
              <SuiteCard key={moduleLabel} className="!p-0 overflow-hidden">
                <div
                  className="border-b px-4 py-2.5 text-sm font-bold"
                  style={{ borderColor: SUITE.border, color: SUITE.navyDeep }}
                >
                  {moduleLabel}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr
                        className="border-b text-xs uppercase"
                        style={{ color: SUITE.muted, borderColor: SUITE.border }}
                      >
                        <th className="px-4 py-2 pr-2">Fuente</th>
                        <th className="py-2 pr-2">Canal / sync</th>
                        <th className="py-2 pr-2">Última actualización</th>
                        <th className="py-2 pr-2">Regs</th>
                        <th className="py-2 pr-2">Estado</th>
                        <th className="px-4 py-2">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {moduleList.map((row) => {
                        const st = statusStyle(row.status);
                        const busy =
                          row.workflow != null && busyWorkflow === row.workflow;
                        const showDispatch =
                          row.workflow &&
                          row.canDispatch &&
                          (row.actionLabel === 'Sincronizar' ||
                            row.moduleId === 'rrhh');
                        return (
                          <tr
                            key={row.id}
                            className="border-b align-top"
                            style={{ borderColor: 'rgba(15,23,42,0.06)' }}
                          >
                            <td className="px-4 py-3 pr-2">
                              <p className="font-semibold" style={{ color: SUITE.text }}>
                                <span
                                  className="mr-1.5 text-xs font-bold"
                                  style={{ color: SUITE.muted }}
                                >
                                  {row.sourceCode}
                                </span>
                                {row.label}
                              </p>
                              <p className="mt-0.5 text-xs" style={{ color: SUITE.muted }}>
                                {row.detail}
                              </p>
                            </td>
                            <td className="py-3 pr-2 text-xs" style={{ color: SUITE.muted }}>
                              {row.channel}
                            </td>
                            <td className="whitespace-nowrap py-3 pr-2 font-medium">
                              {formatAt(row.lastAt)}
                            </td>
                            <td className="py-3 pr-2 tabular-nums">
                              {row.records != null
                                ? row.records.toLocaleString('es-MX')
                                : '—'}
                            </td>
                            <td className="py-3 pr-2">
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                                style={{ background: st.bg, color: st.color }}
                              >
                                {st.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col items-start gap-1">
                                {showDispatch && row.workflow ? (
                                  <button
                                    type="button"
                                    disabled={busy || !canDispatch}
                                    onClick={() => dispatch(row.workflow!)}
                                    className="text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-45"
                                    style={{ color: SUITE.navy }}
                                  >
                                    {busy ? 'Encolando…' : 'Sincronizar →'}
                                  </button>
                                ) : null}
                                {row.actionHref && !showDispatch ? (
                                  <Link
                                    href={row.actionHref}
                                    className="text-xs font-semibold underline-offset-2 hover:underline"
                                    style={{ color: SUITE.navy }}
                                  >
                                    {row.actionLabel || 'Abrir'} →
                                  </Link>
                                ) : null}
                                {row.actionHref && showDispatch ? (
                                  <Link
                                    href={row.actionHref}
                                    className="text-[11px] font-medium underline-offset-2 hover:underline"
                                    style={{ color: SUITE.muted }}
                                  >
                                    Abrir módulo
                                  </Link>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SuiteCard>
            ))}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPipelinesOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide"
              style={{ color: SUITE.navySoft }}
              aria-expanded={pipelinesOpen}
            >
              Pipelines · disparo manual
              <Chevron open={pipelinesOpen} />
            </button>

            {pipelinesOpen ? (
              <div className="mt-2.5 space-y-2.5">
                {rows.map((row) => (
                  <ScheduleCard
                    key={row.id}
                    row={row}
                    onDispatch={dispatch}
                    busyWorkflow={busyWorkflow}
                    dispatchMsg={dispatchMsg}
                    msgWorkflow={msgWorkflow}
                  />
                ))}
                <p className="text-xs leading-relaxed" style={{ color: theme.muted }}>
                  Timestamps: max{' '}
                  <code className="text-[11px]">financial_records.created_at</code> por{' '}
                  <code className="text-[11px]">source_file</code>
                  {' · '}
                  RR.HH. vía soft-sync / hr_*
                  {' · '}
                  catálogo en{' '}
                  <code className="text-[11px]">app/lib/admin-sync-schedules.ts</code>.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
