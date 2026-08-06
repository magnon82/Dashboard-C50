'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTimestampCdmxShort } from '@/app/lib/admin-last-updates';
import { modeLabelEs, type SyncScheduleMode, type SyncWorkflowKey } from '@/app/lib/admin-sync-schedules';
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
}: {
  row: ScheduleRow;
  onDispatch: (workflow: SyncWorkflowKey) => void;
  busyWorkflow: SyncWorkflowKey | null;
  dispatchMsg: string | null;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const modeStyle = modeBadgeStyle(row.mode);
  const busy = row.workflow != null && busyWorkflow === row.workflow;
  const lastLabel = row.lastAt
    ? `Última sync: ${formatTimestampCdmxShort(row.lastAt)}`
    : row.lastDisplay ||
      (row.mode === 'manual' || row.mode === 'mixed'
        ? 'Última sync: Manual / sin sync cloud'
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

      {dispatchMsg && busyWorkflow === row.workflow ? (
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
                      últ. sync {formatTimestampCdmxShort(s.lastIngestedAt)}
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
 * Controles de programación de sync en /admin → Datos e inventario.
 */
export function AdminSyncSchedules() {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canDispatch, setCanDispatch] = useState(false);
  const [busyWorkflow, setBusyWorkflow] = useState<SyncWorkflowKey | null>(null);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
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

  const cloudCount = rows.filter((r) => r.mode === 'cloud').length;
  const manualCount = rows.filter((r) => r.mode === 'manual' || r.mode === 'mixed').length;

  return (
    <section
      className="mb-8 overflow-hidden rounded-[20px] bg-white"
      style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${SUITE.orange}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold" style={{ color: theme.title }}>
            Programación de sincronizaciones
          </h2>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: theme.muted }}>
            Horarios programados (CDMX) y última sync por fuente. Los cron de GitHub Actions son
            solo lectura; desde aquí puedes disparar un sync manual si hay token configurado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border px-3 py-2 text-sm font-semibold transition-colors hover:bg-slate-50 disabled:opacity-50"
              style={{ borderColor: SUITE.border, color: SUITE.navy }}
            >
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: SUITE.navy }}
          >
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[11px]"
            style={{ background: '#F8FAFC', color: theme.muted }}
          >
            <span className="font-semibold" style={{ color: SUITE.navy }}>
              Resumen:
            </span>
            {loading && rows.length === 0 ? (
              <span>Cargando horarios…</span>
            ) : (
              <>
                <span className="tabular-nums font-semibold" style={{ color: SUITE.navySoft }}>
                  {cloudCount} cloud · {manualCount} manual
                </span>
                {fetchedAt ? (
                  <span className="ml-auto tabular-nums">
                    Consultado {formatTimestampCdmxShort(fetchedAt)}
                  </span>
                ) : null}
              </>
            )}
            {!canDispatch && !loading ? (
              <span className="w-full text-[10px]" style={{ color: '#B45309' }}>
                Sin GH_WORKFLOW_DISPATCH_TOKEN: usa «Ver Actions → Run workflow» para sync
                manual.
              </span>
            ) : null}
          </div>

          {error ? (
            <p className="text-sm" style={{ color: '#B45309' }}>
              {error}
            </p>
          ) : null}

          <div className="space-y-2.5">
            {rows.map((row) => (
              <ScheduleCard
                key={row.id}
                row={row}
                onDispatch={dispatch}
                busyWorkflow={busyWorkflow}
                dispatchMsg={dispatchMsg}
              />
            ))}
          </div>

          <p className="text-xs leading-relaxed" style={{ color: theme.muted }}>
            Catálogo en{' '}
            <code className="text-[11px]">app/lib/admin-sync-schedules.ts</code>
            {' · '}
            última sync desde{' '}
            <code className="text-[11px]">financial_records.created_at</code>
            {' / '}
            <code className="text-[11px]">hr_drive_sync_state</code>
            {' vía '}
            <code className="text-[11px]">/api/admin/sync-schedules</code>.
          </p>
        </div>
      ) : null}
    </section>
  );
}
