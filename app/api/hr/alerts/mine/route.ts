import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
} from '@/app/lib/auth';
import { hasAlertPref } from '@/app/lib/alert-prefs';
import {
  buildNextWeekScheduleSummaryAlerts,
  evaluateNextWeekScheduleAlert,
} from '@/app/lib/hr-next-week-schedule-alert';
import { findUserByUsername, getServiceSupabase } from '@/app/lib/users';
import type { HrSummaryAlert } from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/alerts/mine
 * Alertas personales según preferencias Master (p. ej. horario próxima semana).
 * No exige módulo rrhh — basta sesión activa.
 */
export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }

  try {
    const row = await findUserByUsername(session.username);
    const prefs = row?.alert_prefs || [];
    const subscribed = hasAlertPref(prefs, 'hr.next_week_schedule', {
      role: session.role,
      modules: session.modules,
    });

    const alerts: HrSummaryAlert[] = [];
    let nextWeek = null as Awaited<
      ReturnType<typeof evaluateNextWeekScheduleAlert>
    > | null;

    if (subscribed) {
      const sb = getServiceSupabase();
      nextWeek = await evaluateNextWeekScheduleAlert(sb);
      alerts.push(...buildNextWeekScheduleSummaryAlerts(nextWeek));
    }

    return NextResponse.json({
      ready: true,
      username: session.username,
      subscribed: {
        'hr.next_week_schedule': subscribed,
      },
      alerts,
      nextWeek,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        error: e instanceof Error ? e.message : 'Error al cargar alertas',
        alerts: [] as HrSummaryAlert[],
      },
      { status: 200 }
    );
  }
}
