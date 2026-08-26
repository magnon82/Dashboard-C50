import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import {
  ADMIN_SYNC_SCHEDULES,
  SYNC_WORKFLOW_FILES,
  actionsUrlFor,
  buildModuleSyncRows,
  buildSourceSyncReport,
  type SyncWorkflowKey,
} from '@/app/lib/admin-sync-schedules';
import { buildAreaLastUpdates } from '@/app/lib/admin-last-updates';
import {
  GITHUB_ACTIONS_HUB_URL,
  getGithubDispatchToken,
} from '@/app/lib/github-dispatch';
import {
  fetchDetectedSourceFiles,
  fetchFinanzasSyncState,
  fetchHrLastUpdate,
} from '@/app/lib/storage-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPO = 'magnon82/Dashboard-C50';

const ALL_WORKFLOWS: SyncWorkflowKey[] = ['gmail', 'saldos', 'hr', 'finanzas'];

async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!canAccessAdmin(session)) {
    return NextResponse.json(
      { error: 'Solo el administrador puede gestionar sync' },
      { status: 403 },
    );
  }
  return session;
}

function resolveWorkflow(raw: unknown): SyncWorkflowKey | 'all' | null {
  if (raw === 'all') return 'all';
  if (
    raw === 'gmail' ||
    raw === 'saldos' ||
    raw === 'hr' ||
    raw === 'finanzas'
  ) {
    return raw;
  }
  return null;
}

async function dispatchOne(
  token: string,
  workflow: SyncWorkflowKey,
): Promise<{
  workflow: SyncWorkflowKey;
  ok: boolean;
  status: number;
  detail?: string;
  actionsUrl: string;
}> {
  const file = SYNC_WORKFLOW_FILES[workflow];
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    return {
      workflow,
      ok: false,
      status: res.status,
      detail,
      actionsUrl: actionsUrlFor(workflow),
    };
  }
  return {
    workflow,
    ok: true,
    status: res.status,
    actionsUrl: actionsUrlFor(workflow),
  };
}

/**
 * GET /api/admin/sync-schedules — catálogo de horarios + última sync por área.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const [detected, hr, finanzas] = await Promise.all([
    fetchDetectedSourceFiles(),
    fetchHrLastUpdate(),
    fetchFinanzasSyncState(),
  ]);
  const areas = buildAreaLastUpdates(detected.detectedSourceFiles, hr);
  const byArea = new Map(areas.map((a) => [a.id, a]));

  const canDispatch = Boolean(getGithubDispatchToken());

  const schedules = ADMIN_SYNC_SCHEDULES.map((s) => {
    let last = s.areaId ? byArea.get(s.areaId) ?? null : null;
    // Saldos: max(flujo, cxp_vivo)
    if (s.id === 'sync-saldos') {
      const flujo = byArea.get('flujo');
      const cxp = byArea.get('cxp_vivo');
      if (flujo?.lastAt && cxp?.lastAt) {
        last = flujo.lastAt >= cxp.lastAt ? flujo : cxp;
      } else {
        last = flujo?.lastAt ? flujo : cxp ?? flujo ?? null;
      }
    }
    // Gmail: max(ventas, facturas)
    if (s.id === 'sync-gmail') {
      const ventas = byArea.get('ventas');
      const facturas = byArea.get('facturas');
      if (ventas?.lastAt && facturas?.lastAt) {
        last = ventas.lastAt >= facturas.lastAt ? ventas : facturas;
      } else {
        last = ventas?.lastAt ? ventas : facturas ?? ventas ?? null;
      }
    }

    const sourceDetails = (s.sourceFiles ?? [])
      .map((sf) => {
        const hit = detected.detectedSourceFiles.find((d) => d.sourceFile === sf);
        return {
          sourceFile: sf,
          rowCount: hit?.rowCount ?? 0,
          lastDate: hit?.lastDate ?? null,
          lastIngestedAt: hit?.lastIngestedAt ?? null,
        };
      })
      .filter(Boolean);

    return {
      ...s,
      lastAt: last?.lastAt ?? null,
      lastDisplay: last?.display ?? null,
      lastSource: last?.source ?? 'none',
      canDispatchNow: Boolean(s.canDispatch && canDispatch),
      sourceDetails,
    };
  });

  const sourceReport = buildSourceSyncReport(detected.detectedSourceFiles, hr);
  const moduleRows = buildModuleSyncRows(detected.detectedSourceFiles, hr, {
    canDispatch,
    finanzas,
  });

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    timezone: 'America/Mexico_City',
    canDispatch,
    actionsHubUrl: GITHUB_ACTIONS_HUB_URL,
    schedules,
    moduleRows,
    sourceReport,
    note:
      'Los cron de GitHub Actions son solo lectura aquí. Editar horarios = cambiar el .yml en el repo.',
  });
}

/**
 * POST /api/admin/sync-schedules — { workflow: 'gmail'|'saldos'|'hr'|'finanzas'|'all' }
 * Dispara workflow_dispatch (mismo token que ventas-sync-status).
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const workflow = resolveWorkflow(
    body && typeof body === 'object' && 'workflow' in body
      ? (body as { workflow: unknown }).workflow
      : null,
  );
  if (!workflow) {
    return NextResponse.json(
      { error: 'workflow debe ser gmail | saldos | hr | finanzas | all' },
      { status: 400 },
    );
  }

  const token = getGithubDispatchToken();
  if (!token) {
    return NextResponse.json(
      {
        error:
          'Falta GH_WORKFLOW_DISPATCH_TOKEN en Vercel (PAT con actions:write). Mientras tanto: Actions → Run workflow.',
        actionsUrl:
          workflow === 'all'
            ? GITHUB_ACTIONS_HUB_URL
            : actionsUrlFor(workflow),
        actionsHubUrl: GITHUB_ACTIONS_HUB_URL,
      },
      { status: 503 },
    );
  }

  const targets = workflow === 'all' ? ALL_WORKFLOWS : [workflow];
  const results = await Promise.all(
    targets.map((w) => dispatchOne(token, w)),
  );
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (ok.length === 0) {
    return NextResponse.json(
      {
        error: `GitHub no aceptó el disparo (${failed[0]?.status ?? '?'})`,
        detail: failed[0]?.detail,
        results,
        actionsUrl: failed[0]?.actionsUrl ?? GITHUB_ACTIONS_HUB_URL,
        actionsHubUrl: GITHUB_ACTIONS_HUB_URL,
      },
      { status: 502 },
    );
  }

  const names = ok.map((r) => r.workflow).join(', ');
  return NextResponse.json({
    ok: true,
    message:
      failed.length === 0
        ? `Sync encolado (${names}). En 1–3 min debería aparecer en Actions.`
        : `Encolados: ${names}. Fallaron: ${failed.map((r) => r.workflow).join(', ')}.`,
    results,
    actionsHubUrl: GITHUB_ACTIONS_HUB_URL,
    actionsUrl:
      workflow === 'all'
        ? GITHUB_ACTIONS_HUB_URL
        : actionsUrlFor(workflow),
  });
}
