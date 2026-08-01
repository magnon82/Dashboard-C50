/**
 * Checklist y alertas de seguimiento del CRM Eventos.
 * Flujo alineado al Cotizador (alta cliente → cotización en sistema → enviar PDF)
 * + cadencia 15 días + holds + cierre.
 */

import type { EventLead, LeadStage } from '@/app/lib/eventos';

export const FOLLOW_UP_STEP_IDS = [
  'captura',
  'bienvenida',
  'alta_cliente',
  'cotizacion',
  'seg_d3',
  'seg_d5',
  'hold',
  'cierre',
] as const;

export type FollowUpStepId = (typeof FOLLOW_UP_STEP_IDS)[number];

export type FollowUpStep = {
  id: FollowUpStepId;
  /** Etiqueta breve en UI */
  label: string;
  /** Día del ciclo (manual) a partir de created_at */
  dayOffset: number | null;
  /** Hold es opcional según política */
  optional?: boolean;
};

/**
 * Ids legacy que pueden existir en follow_up_done guardados.
 * Se normalizan al id canónico al leer/guardar.
 */
const FOLLOW_UP_LEGACY_IDS: Record<string, FollowUpStepId> = {
  // Cotización manual → mismo paso (ahora = generar en Cotizador + enviar PDF)
  envio_cotizacion: 'cotizacion',
  enviar_cotizacion: 'cotizacion',
};

/** Checklist breve del vendedor — orden del manual. */
export const FOLLOW_UP_STEPS: readonly FollowUpStep[] = [
  {
    id: 'captura',
    label: 'Captura: llamada (<1 h) o WA ≤5 min si no contesta',
    dayOffset: 0,
  },
  {
    id: 'bienvenida',
    label: 'Bienvenida: WA + confirmar fecha y necesidades',
    dayOffset: 0,
  },
  {
    id: 'alta_cliente',
    label: 'Alta cliente en CRM (obligatorio antes de cotizar)',
    dayOffset: 0,
  },
  {
    id: 'cotizacion',
    label: 'Cotización: generar en Cotizador + enviar/compartir PDF (≤24 h)',
    dayOffset: 1,
  },
  {
    id: 'seg_d3',
    label: 'Seguimiento día 3 (WA post-cotización)',
    dayOffset: 3,
  },
  {
    id: 'seg_d5',
    label: 'Seguimiento día 5 (llamada / ajuste)',
    dayOffset: 5,
  },
  {
    id: 'hold',
    label: 'Hold 72 h (si aplica)',
    dayOffset: null,
    optional: true,
  },
  {
    id: 'cierre',
    label: 'Cierre: reserva/congelar + OS + depósito',
    dayOffset: 15,
  },
] as const;

export type FollowUpSeverity = 'urgent' | 'high' | 'medium' | 'info';

export type FollowUpAlert = {
  id: string;
  leadId: string;
  severity: FollowUpSeverity;
  title: string;
  detail: string;
  /** Paso del checklist relacionado (para limpiar al marcar) */
  stepId?: FollowUpStepId;
};

const CLOSED: LeadStage[] = ['ganado', 'perdido'];

const SEVERITY_RANK: Record<FollowUpSeverity, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  info: 3,
};

function resolveFollowUpStepId(v: unknown): FollowUpStepId | null {
  if (typeof v !== 'string') return null;
  if ((FOLLOW_UP_STEP_IDS as readonly string[]).includes(v)) {
    return v as FollowUpStepId;
  }
  return FOLLOW_UP_LEGACY_IDS[v] ?? null;
}

export function isFollowUpStepId(v: unknown): v is FollowUpStepId {
  return resolveFollowUpStepId(v) != null;
}

export function normalizeFollowUpDone(raw: unknown): FollowUpStepId[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowUpStepId[] = [];
  for (const x of raw) {
    const id = resolveFollowUpStepId(x);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

function daysBetween(a: Date, b: Date): number {
  return hoursBetween(a, b) / 24;
}

function addCalendarDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function isDeferred(lead: EventLead, now: Date): boolean {
  if (!lead.next_follow_up_at) return false;
  const next = new Date(lead.next_follow_up_at);
  return Number.isFinite(next.getTime()) && next.getTime() > now.getTime();
}

function leadLabel(lead: EventLead): string {
  return (
    lead.celebration ||
    lead.title ||
    lead.contact_name ||
    lead.company ||
    'Lead'
  );
}

/** Cliente ya ligado al lead (alta hecha o cotización creó/reusó el vínculo). */
function hasClientRegistered(lead: EventLead): boolean {
  return Boolean(lead.client_id);
}

/**
 * Calcula la próxima fecha sugerida de seguimiento según pasos pendientes
 * y la cadencia del manual (anclado a created_at).
 * Si el lead ya tiene client_id, se trata alta_cliente como cumplido.
 */
export function suggestNextFollowUpAt(
  lead: Pick<EventLead, 'created_at' | 'stage' | 'client_id'>,
  done: FollowUpStepId[],
  now = new Date()
): string | null {
  if (CLOSED.includes(lead.stage)) return null;
  const created = new Date(lead.created_at);
  if (!Number.isFinite(created.getTime())) return null;

  const effectiveDone = [...done];
  if (lead.client_id && !effectiveDone.includes('alta_cliente')) {
    effectiveDone.push('alta_cliente');
  }
  // Lead ya en etapa cotizada/negociación ⇒ PDF emitido en la práctica
  if (
    (lead.stage === 'cotizado' || lead.stage === 'negociacion') &&
    !effectiveDone.includes('cotizacion')
  ) {
    effectiveDone.push('cotizacion');
  }

  for (const step of FOLLOW_UP_STEPS) {
    if (step.optional) continue;
    if (effectiveDone.includes(step.id)) continue;
    if (step.dayOffset == null) continue;
    const due = addCalendarDays(created, step.dayOffset);
    if (due.getTime() > now.getTime()) return due.toISOString();
    // Vencido → acción inmediata
    return now.toISOString();
  }
  return null;
}

/** Alertas activas de un lead (vacío si ganado/perdido). */
export function computeLeadAlerts(
  lead: EventLead,
  now = new Date()
): FollowUpAlert[] {
  if (CLOSED.includes(lead.stage)) return [];

  const done = normalizeFollowUpDone(lead.follow_up_done);
  const created = new Date(lead.created_at);
  if (!Number.isFinite(created.getTime())) return [];

  const alerts: FollowUpAlert[] = [];
  const ageH = hoursBetween(created, now);
  const ageD = daysBetween(created, now);
  const name = leadLabel(lead);
  const deferred = isDeferred(lead, now);
  const clientOk = hasClientRegistered(lead) || done.includes('alta_cliente');

  // Holds: siempre visibles (plazo duro), aunque haya defer
  if (lead.hold_until) {
    const holdUntil = new Date(lead.hold_until);
    if (Number.isFinite(holdUntil.getTime())) {
      const hoursLeft = hoursBetween(now, holdUntil);
      if (hoursLeft < 0) {
        alerts.push({
          id: `${lead.id}:hold_vencido`,
          leadId: lead.id,
          severity: 'urgent',
          title: 'Hold vencido',
          detail: `${name} · el hold expiró; renueva, cierra o libera la fecha.`,
          stepId: 'hold',
        });
      } else if (hoursLeft <= 12) {
        alerts.push({
          id: `${lead.id}:hold_por_vencer`,
          leadId: lead.id,
          severity: 'high',
          title: 'Hold por vencer',
          detail: `${name} · quedan ~${Math.max(1, Math.round(hoursLeft))} h del hold 72 h.`,
          stepId: 'hold',
        });
      }
    }
  }

  // Seguimiento programado vencido (acción diferida por el vendedor)
  if (lead.next_follow_up_at) {
    const next = new Date(lead.next_follow_up_at);
    if (Number.isFinite(next.getTime()) && next.getTime() <= now.getTime()) {
      alerts.push({
        id: `${lead.id}:programado`,
        leadId: lead.id,
        severity: 'high',
        title: 'Seguimiento programado',
        detail: `${name} · toca contactar (fecha programada vencida).`,
      });
    }
  }

  if (deferred) {
    // Solo holds + programado; la cadencia espera a next_follow_up_at
    return sortAlerts(alerts);
  }

  // Captura < 1 h (manual: regla de oro)
  if (!done.includes('captura') && ageH >= 1) {
    alerts.push({
      id: `${lead.id}:captura`,
      leadId: lead.id,
      severity: ageH >= 4 ? 'urgent' : 'high',
      title: 'Captura atrasada',
      detail: `${name} · sin llamada/WA inicial (>${Math.floor(ageH)} h). Meta: <1 h.`,
      stepId: 'captura',
    });
  }

  // Bienvenida día 0
  if (
    done.includes('captura') &&
    !done.includes('bienvenida') &&
    ageD >= 0.5
  ) {
    alerts.push({
      id: `${lead.id}:bienvenida`,
      leadId: lead.id,
      severity: 'medium',
      title: 'Bienvenida pendiente',
      detail: `${name} · falta WA de bienvenida y confirmar fecha.`,
      stepId: 'bienvenida',
    });
  }

  // Alta cliente (obligatoria antes de cotizar en Cotizador)
  const readyForAlta =
    done.includes('captura') ||
    done.includes('bienvenida') ||
    lead.stage === 'contactado' ||
    lead.stage === 'cotizado' ||
    lead.stage === 'negociacion';
  if (
    readyForAlta &&
    !clientOk &&
    lead.stage !== 'cotizado' &&
    lead.stage !== 'negociacion' &&
    ageH >= 4
  ) {
    alerts.push({
      id: `${lead.id}:alta_cliente`,
      leadId: lead.id,
      severity: ageH >= 24 ? 'high' : 'medium',
      title: 'Alta de cliente pendiente',
      detail: `${name} · registrar en CRM/Cotizador («+ Alta cliente») antes de cotizar.`,
      stepId: 'alta_cliente',
    });
  }

  // Cotización = generar en Cotizador + enviar/compartir PDF (≤24 h tras brief/alta)
  const readyForQuote =
    clientOk &&
    (done.includes('captura') ||
      done.includes('bienvenida') ||
      done.includes('alta_cliente') ||
      lead.stage === 'contactado' ||
      lead.stage === 'cotizado' ||
      lead.stage === 'negociacion');
  if (
    readyForQuote &&
    !done.includes('cotizacion') &&
    lead.stage !== 'cotizado' &&
    lead.stage !== 'negociacion' &&
    ageH >= 24
  ) {
    alerts.push({
      id: `${lead.id}:cotizacion`,
      leadId: lead.id,
      severity: 'high',
      title: 'Cotización / PDF pendiente',
      detail: `${name} · cliente listo: generar en Cotizador y enviar/compartir el PDF (máx. 24 h).`,
      stepId: 'cotizacion',
    });
  }

  const quoted =
    done.includes('cotizacion') ||
    lead.stage === 'cotizado' ||
    lead.stage === 'negociacion';

  // Día 3
  if (quoted && !done.includes('seg_d3') && ageD >= 3) {
    alerts.push({
      id: `${lead.id}:seg_d3`,
      leadId: lead.id,
      severity: ageD >= 4 ? 'high' : 'medium',
      title: 'Seguimiento día 3',
      detail: `${name} · WA post-cotización pendiente (cadencia manual).`,
      stepId: 'seg_d3',
    });
  }

  // Día 5
  if (quoted && !done.includes('seg_d5') && ageD >= 5) {
    alerts.push({
      id: `${lead.id}:seg_d5`,
      leadId: lead.id,
      severity: ageD >= 7 ? 'high' : 'medium',
      title: 'Seguimiento día 5',
      detail: `${name} · llamada/ajuste pendiente («¿qué le pareció?»).`,
      stepId: 'seg_d5',
    });
  }

  // Día 15 cierre
  if (!done.includes('cierre') && ageD >= 15) {
    alerts.push({
      id: `${lead.id}:cierre`,
      leadId: lead.id,
      severity: 'urgent',
      title: 'Cierre día 15',
      detail: `${name} · última llamada: reservar o congelar (nunca descartar por silencio).`,
      stepId: 'cierre',
    });
  }

  return sortAlerts(alerts);
}

function sortAlerts(alerts: FollowUpAlert[]): FollowUpAlert[] {
  return [...alerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
}

export function computeCrmFollowUpAlerts(
  leads: EventLead[],
  now = new Date()
): FollowUpAlert[] {
  const all: FollowUpAlert[] = [];
  for (const lead of leads) {
    all.push(...computeLeadAlerts(lead, now));
  }
  return sortAlerts(all);
}

export function leadAlertSeverity(
  lead: EventLead,
  now = new Date()
): FollowUpSeverity | null {
  const alerts = computeLeadAlerts(lead, now);
  if (alerts.length === 0) return null;
  return alerts[0].severity;
}

export const FOLLOW_UP_SEVERITY_LABELS: Record<FollowUpSeverity, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Media',
  info: 'Info',
};

/** Días hasta next_follow_up_at (negativo = vencido). */
export function daysUntilNextFollowUp(
  nextFollowUpAt: string | null | undefined,
  now = new Date()
): number | null {
  if (!nextFollowUpAt) return null;
  const next = new Date(nextFollowUpAt);
  if (!Number.isFinite(next.getTime())) return null;
  return Math.round(daysBetween(now, next));
}
