import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  canAccessModule,
  type SessionUser,
} from '@/app/lib/auth';
import {
  formatVentasHubAlert,
  type VentasLastDayHubStats,
} from '@/app/lib/hub-alerts';
import { getServiceSupabase } from '@/app/lib/users';
import {
  evaluateInfocajaSyncHealth,
  formatInfocajaSyncHubAlert,
} from '@/app/lib/infocaja-sync-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW_FILE = 'sync-gmail.yml';
const REPO = 'magnon82/Dashboard-C50';

async function requireViewer(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  const ok =
    canAccessAdmin(session) ||
    canAccessModule(session, 'ventas') ||
    canAccessModule(session, 'reportes-socios');
  if (!ok) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  return session;
}

async function loadMaxInfocajaDate(): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('financial_records')
    .select('date')
    .eq('source_file', 'infocaja')
    .eq('category', 'Venta Total')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.date) return null;
  return String(data.date).slice(0, 10);
}

/** Venta Total + conteo de cancelaciones del último día Infocaja. */
async function loadLastVentasDayStats(
  date: string
): Promise<VentasLastDayHubStats> {
  const sb = getServiceSupabase();

  const [ventaRes, cancRes] = await Promise.all([
    sb
      .from('financial_records')
      .select('amount')
      .eq('source_file', 'infocaja')
      .eq('category', 'Venta Total')
      .eq('date', date)
      .limit(1)
      .maybeSingle(),
    sb
      .from('financial_records')
      .select('id', { count: 'exact', head: true })
      .eq('source_file', 'corte_caja')
      .eq('category', 'Corte Cancelacion')
      .eq('date', date),
  ]);

  return {
    date,
    ventaTotal: Number(ventaRes.data?.amount) || 0,
    cancelacionesCount: cancRes.count ?? 0,
  };
}

/**
 * GET /api/ventas-sync-status — ¿Infocaja al día según hora CDMX?
 * Incluye KPIs del último día (venta total + # cancelaciones) para el hub Ventas.
 */
export async function GET() {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;

  try {
    const maxInfocajaDate = await loadMaxInfocajaDate();
    const health = evaluateInfocajaSyncHealth({ maxInfocajaDate });
    const lastDay = maxInfocajaDate
      ? await loadLastVentasDayStats(maxInfocajaDate)
      : null;
    const hubAlert = formatVentasHubAlert({
      stale: health.stale,
      maxInfocajaDate: health.maxInfocajaDate,
      lastDay,
    });
    /** Reportes Socios / banner: solo frescura del sync. */
    const hubAlertSync = formatInfocajaSyncHubAlert(health);

    return NextResponse.json({
      ready: true,
      health,
      lastDay,
      hubAlert,
      hubAlertSync,
      canDispatch:
        canAccessAdmin(auth) &&
        Boolean(
          process.env.GH_WORKFLOW_DISPATCH_TOKEN?.trim() ||
            process.env.GITHUB_TOKEN?.trim()
        ),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ready: false,
        error: msg,
        hubAlert: { text: 'Sin alertas', severity: 'ok' },
        hubAlertSync: { text: 'Sin alertas', severity: 'ok' },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ventas-sync-status — dispara workflow Sync Gmail (workflow_dispatch).
 * Requiere secret GH_WORKFLOW_DISPATCH_TOKEN (PAT con actions:write) en Vercel.
 */
export async function POST() {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  if (!canAccessAdmin(auth)) {
    return NextResponse.json(
      { error: 'Solo admin puede disparar el sync' },
      { status: 403 }
    );
  }

  const token =
    process.env.GH_WORKFLOW_DISPATCH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error:
          'Falta GH_WORKFLOW_DISPATCH_TOKEN en Vercel. Mientras tanto usa Actions → Sync Gmail diario → Run workflow.',
        actionsUrl: `https://github.com/${REPO}/actions/workflows/${WORKFLOW_FILE}`,
      },
      { status: 503 }
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    return NextResponse.json(
      {
        error: `GitHub no aceptó el disparo (${res.status})`,
        detail,
        actionsUrl: `https://github.com/${REPO}/actions/workflows/${WORKFLOW_FILE}`,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: 'Sync Gmail encolado. En 1–3 min debería aparecer en Actions.',
    actionsUrl: `https://github.com/${REPO}/actions/workflows/${WORKFLOW_FILE}`,
  });
}
