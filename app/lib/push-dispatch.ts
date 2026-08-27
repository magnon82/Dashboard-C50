/**
 * Despacho de pushes según alert_prefs activas (Master).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type AlertPrefId, hasAlertPref } from '@/app/lib/alert-prefs';
import {
  buildNextWeekScheduleSummaryAlerts,
  evaluateNextWeekScheduleAlert,
} from '@/app/lib/hr-next-week-schedule-alert';
import {
  buildLeaveUpcomingSummaryAlerts,
  listLeaveUpcomingAlerts,
} from '@/app/lib/hr-leave-upcoming-alerts';
import { listUsers } from '@/app/lib/users';
import { notifyUsernames, type PushPayload } from '@/app/lib/web-push';

export type PushDispatchResult = {
  pref: AlertPrefId;
  active: boolean;
  recipients: number;
  sent: number;
  failed: number;
  pruned: number;
  message: string | null;
};

async function recipientUsernames(pref: AlertPrefId): Promise<string[]> {
  const users = await listUsers();
  return users
    .filter(
      (u) =>
        u.active !== false &&
        hasAlertPref(u.alert_prefs, pref, {
          role: u.role,
          modules: u.modules,
        })
    )
    .map((u) => u.username.trim().toLowerCase());
}

async function payloadForPref(
  sb: SupabaseClient,
  pref: AlertPrefId
): Promise<{
  active: boolean;
  payload: PushPayload | null;
  message: string | null;
}> {
  if (pref === 'hr.next_week_schedule') {
    const info = await evaluateNextWeekScheduleAlert(sb);
    const alerts = buildNextWeekScheduleSummaryAlerts(info);
    if (!info.active || !alerts[0]) {
      return { active: false, payload: null, message: null };
    }
    return {
      active: true,
      message: alerts[0].message,
      payload: {
        title: 'C50 · Horarios',
        body: alerts[0].message,
        url: '/staff/horario',
        tag: 'hr-next-week-schedule',
      },
    };
  }

  if (pref === 'hr.leave_upcoming') {
    const upcoming = await listLeaveUpcomingAlerts(sb, { limit: 40 });
    if (upcoming.schemaMissing || upcoming.rows.length === 0) {
      return { active: false, payload: null, message: null };
    }
    const alerts = buildLeaveUpcomingSummaryAlerts(upcoming.rows);
    const msg = alerts[0]?.message || null;
    if (!msg) return { active: false, payload: null, message: null };
    return {
      active: true,
      message: msg,
      payload: {
        title: 'C50 · Vacaciones',
        body: msg,
        url: '/rrhh',
        tag: 'hr-leave-upcoming',
      },
    };
  }

  return { active: false, payload: null, message: null };
}

/** Evalúa prefs conocidas y envía push a suscriptores con esa palomita. */
export async function dispatchAlertPushes(
  sb: SupabaseClient,
  opts?: { prefs?: AlertPrefId[] }
): Promise<PushDispatchResult[]> {
  const prefs: AlertPrefId[] = opts?.prefs?.length
    ? opts.prefs
    : ['hr.next_week_schedule', 'hr.leave_upcoming'];

  const out: PushDispatchResult[] = [];
  for (const pref of prefs) {
    const { active, payload, message } = await payloadForPref(sb, pref);
    if (!active || !payload) {
      out.push({
        pref,
        active: false,
        recipients: 0,
        sent: 0,
        failed: 0,
        pruned: 0,
        message: null,
      });
      continue;
    }
    const recipients = await recipientUsernames(pref);
    if (!recipients.length) {
      out.push({
        pref,
        active: true,
        recipients: 0,
        sent: 0,
        failed: 0,
        pruned: 0,
        message,
      });
      continue;
    }
    const r = await notifyUsernames(sb, recipients, payload);
    out.push({
      pref,
      active: true,
      recipients: recipients.length,
      sent: r.sent,
      failed: r.failed,
      pruned: r.pruned,
      message,
    });
  }
  return out;
}
