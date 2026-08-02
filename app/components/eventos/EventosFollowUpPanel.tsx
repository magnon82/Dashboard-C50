'use client';

import { useEffect, useMemo, useState } from 'react';
import { SUITE } from '@/app/lib/themes';
import type { EventLead } from '@/app/lib/eventos';
import {
  FOLLOW_UP_ALERTS_SCOPE_HINT,
  FOLLOW_UP_SEVERITY_LABELS,
  FOLLOW_UP_STEPS,
  computeCrmFollowUpAlerts,
  computeLeadAlerts,
  leadAlertSeverity,
  normalizeFollowUpDone,
  type FollowUpAlert,
  type FollowUpSeverity,
  type FollowUpStepId,
} from '@/app/lib/eventos-follow-up';

const SEVERITY_STYLES: Record<
  FollowUpSeverity,
  { bg: string; border: string; text: string; badge: string }
> = {
  urgent: {
    bg: '#FEF2F2',
    border: '#FECACA',
    text: '#991B1B',
    badge: '#DC2626',
  },
  high: {
    bg: '#FFF7ED',
    border: '#FED7AA',
    text: '#9A3412',
    badge: '#EA580C',
  },
  medium: {
    bg: '#FFFBEB',
    border: '#FDE68A',
    text: '#92400E',
    badge: '#D97706',
  },
  info: {
    bg: '#F8FAFC',
    border: '#E2E8F0',
    text: '#334155',
    badge: '#64748B',
  },
};

function SeverityBadge({ severity }: { severity: FollowUpSeverity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      style={{ backgroundColor: s.badge }}
    >
      {FOLLOW_UP_SEVERITY_LABELS[severity]}
    </span>
  );
}

/** Franja superior del CRM: leads que requieren seguimiento ahora. */
export function EventosFollowUpAlertsStrip({
  leads,
  onFocusLead,
}: {
  leads: EventLead[];
  onFocusLead?: (leadId: string) => void;
}) {
  const alerts = useMemo(() => computeCrmFollowUpAlerts(leads), [leads]);
  const top = alerts.slice(0, 8);
  const urgent = alerts.filter((a) => a.severity === 'urgent').length;

  if (alerts.length === 0) {
    return (
      <div
        className="rounded-2xl border px-4 py-3"
        style={{
          backgroundColor: '#F0FDF4',
          borderColor: '#BBF7D0',
        }}
      >
        <p className="text-sm font-semibold text-emerald-800">
          Sin alertas de seguimiento
        </p>
        <p className="mt-0.5 text-xs text-emerald-700/80">
          {FOLLOW_UP_ALERTS_SCOPE_HINT}. Ningún lead en alcance requiere
          acción según la cadencia del manual.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border px-4 py-3.5"
      style={{
        backgroundColor: urgent > 0 ? '#FEF2F2' : '#FFF7ED',
        borderColor: urgent > 0 ? '#FECACA' : '#FED7AA',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p
            className="text-sm font-bold"
            style={{ color: urgent > 0 ? '#991B1B' : SUITE.orangeDeep }}
          >
            Alertas de seguimiento · {alerts.length}
            {urgent > 0 ? ` (${urgent} urgentes)` : ''}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: SUITE.muted }}>
            {FOLLOW_UP_ALERTS_SCOPE_HINT}. Cadencia del manual (captura &lt;1
            h, cotización 24 h, días 3 / 5 / 15) + holds que bloquean la fecha
            72 h.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {top.map((a) => (
          <AlertRow key={a.id} alert={a} onFocusLead={onFocusLead} />
        ))}
      </ul>
      {alerts.length > top.length ? (
        <p className="mt-2 text-[11px] text-slate-500">
          +{alerts.length - top.length} más en las tarjetas del pipeline
        </p>
      ) : null}
    </div>
  );
}

function AlertRow({
  alert,
  onFocusLead,
}: {
  alert: FollowUpAlert;
  onFocusLead?: (leadId: string) => void;
}) {
  const s = SEVERITY_STYLES[alert.severity];
  return (
    <li
      className="flex flex-wrap items-start gap-2 rounded-xl border bg-white/80 px-3 py-2"
      style={{ borderColor: s.border }}
    >
      <SeverityBadge severity={alert.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold" style={{ color: s.text }}>
          {alert.title}
        </p>
        <p className="text-xs text-slate-600">{alert.detail}</p>
      </div>
      {onFocusLead ? (
        <button
          type="button"
          onClick={() => onFocusLead(alert.leadId)}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: SUITE.navy, color: '#fff' }}
        >
          Ver
        </button>
      ) : null}
    </li>
  );
}

/** Badge compacto en la tarjeta del lead. */
export function EventosLeadAlertBadge({ lead }: { lead: EventLead }) {
  const severity = leadAlertSeverity(lead);
  if (!severity) return null;
  const count = computeLeadAlerts(lead).length;
  const s = SEVERITY_STYLES[severity];
  return (
    <span
      className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      style={{ backgroundColor: s.badge }}
      title={FOLLOW_UP_SEVERITY_LABELS[severity]}
    >
      Seguimiento
      {count > 1 ? ` · ${count}` : ''}
    </span>
  );
}

/** Checklist expandible + diferir próxima acción. */
export function EventosLeadFollowUpChecklist({
  lead,
  canEdit,
  busy,
  open,
  onToggleOpen,
  onPatch,
}: {
  lead: EventLead;
  canEdit: boolean;
  busy: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onPatch: (body: {
    id: string;
    follow_up_done?: string[];
    next_follow_up_at?: string | null;
  }) => Promise<void>;
}) {
  const done = normalizeFollowUpDone(lead.follow_up_done);
  const doneCount = FOLLOW_UP_STEPS.filter((s) => done.includes(s.id)).length;
  const alerts = computeLeadAlerts(lead);
  const [deferDate, setDeferDate] = useState(
    lead.next_follow_up_at
      ? lead.next_follow_up_at.slice(0, 10)
      : ''
  );

  useEffect(() => {
    setDeferDate(
      lead.next_follow_up_at ? lead.next_follow_up_at.slice(0, 10) : ''
    );
  }, [lead.id, lead.next_follow_up_at]);

  async function toggleStep(stepId: FollowUpStepId, checked: boolean) {
    if (!canEdit || busy) return;
    const next = checked
      ? [...done, stepId]
      : done.filter((id) => id !== stepId);
    await onPatch({ id: lead.id, follow_up_done: next });
  }

  async function saveDefer() {
    if (!canEdit || busy) return;
    if (!deferDate) {
      await onPatch({ id: lead.id, next_follow_up_at: null });
      return;
    }
    // Mediodía CDMX aproximado vía ISO local del input date
    await onPatch({
      id: lead.id,
      next_follow_up_at: `${deferDate}T15:00:00.000Z`,
    });
  }

  return (
    <div className="mt-2 border-t border-slate-200/80 pt-2">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-bold" style={{ color: SUITE.navy }}>
          Checklist seguimiento · {doneCount}/{FOLLOW_UP_STEPS.length}
        </span>
        <span className="text-[11px] text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {alerts.length > 0 && !open ? (
        <p className="mt-1 text-[11px] font-medium" style={{ color: '#9A3412' }}>
          {alerts[0].title}
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-2">
          <ul className="space-y-1.5">
            {FOLLOW_UP_STEPS.map((step) => {
              const checked = done.includes(step.id);
              return (
                <li key={step.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={!canEdit || busy}
                      onChange={(e) => toggleStep(step.id, e.target.checked)}
                    />
                    <span>
                      {step.label}
                      {step.optional ? (
                        <span className="text-slate-400"> · opcional</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {canEdit ? (
            <div className="rounded-lg bg-white px-2 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Diferir / próxima acción
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  value={deferDate}
                  onChange={(e) => setDeferDate(e.target.value)}
                  disabled={busy}
                  className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveDefer()}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  Guardar
                </button>
              </div>
              {lead.next_follow_up_at ? (
                <p className="mt-1 text-[10px] text-slate-500">
                  Programado:{' '}
                  {new Date(lead.next_follow_up_at).toLocaleString('es-MX')}
                </p>
              ) : null}
            </div>
          ) : null}

          {alerts.length > 0 ? (
            <ul className="space-y-1">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="text-[10px] font-medium"
                  style={{ color: SEVERITY_STYLES[a.severity].text }}
                >
                  · {a.title}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-emerald-700">Al día con la cadencia</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
