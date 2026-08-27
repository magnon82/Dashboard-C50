import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
} from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';
import { dispatchAlertPushes } from '@/app/lib/push-dispatch';
import { isWebPushConfigured } from '@/app/lib/web-push';
import { normalizeAlertPrefs } from '@/app/lib/alert-prefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorizeCronOrAdmin(request: Request): boolean | 'admin' {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const auth = request.headers.get('authorization') || '';
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

/**
 * POST /api/push/dispatch
 * Cron (Bearer CRON_SECRET) o admin de sesión.
 * Evalúa alert prefs activas y envía Web Push.
 */
export async function POST(request: Request) {
  const cronOk = authorizeCronOrAdmin(request);
  let isAdmin = false;

  if (!cronOk) {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const session = await verifySessionToken(token);
    if (!session || !canAccessAdmin(session)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    isAdmin = true;
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Faltan NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT',
      },
      { status: 503 }
    );
  }

  let prefsFilter: ReturnType<typeof normalizeAlertPrefs> | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      prefs?: string[];
    };
    if (Array.isArray(body.prefs) && body.prefs.length) {
      prefsFilter = normalizeAlertPrefs(body.prefs);
    }
  } catch {
    // empty body ok
  }

  try {
    const sb = getServiceSupabase();
    const results = await dispatchAlertPushes(sb, {
      prefs: prefsFilter?.length ? prefsFilter : undefined,
    });
    return NextResponse.json({
      ok: true,
      via: cronOk ? 'cron' : isAdmin ? 'admin' : 'unknown',
      results,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Error al despachar',
      },
      { status: 500 }
    );
  }
}

/** GET — estado / dry info (admin o cron). */
export async function GET(request: Request) {
  const cronOk = authorizeCronOrAdmin(request);
  if (!cronOk) {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session || !canAccessAdmin(session)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
  }
  return NextResponse.json({
    configured: isWebPushConfigured(),
    hint: 'POST para despachar alertas push activas',
  });
}
