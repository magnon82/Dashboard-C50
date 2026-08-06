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
  type SyncWorkflowKey,
} from '@/app/lib/admin-sync-schedules';
import { buildAreaLastUpdates } from '@/app/lib/admin-last-updates';
import {
  fetchDetectedSourceFiles,
  fetchHrLastUpdate,
} from '@/app/lib/storage-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPO = 'magnon82/Dashboard-C50';

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

function hasDispatchToken(): boolean {
  return Boolean(
    process.env.GH_WORKFLOW_DISPATCH_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim(),
  );
}

function resolveWorkflow(raw: unknown): SyncWorkflowKey | null {
  if (raw === 'gmail' || raw === 'saldos' || raw === 'hr') return raw;
  return null;
}

/**
 * GET /api/admin/sync-schedules — catálogo de horarios + última sync por área.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const [detected, hr] = await Promise.all([
    fetchDetectedSourceFiles(),
    fetchHrLastUpdate(),
  ]);
  const areas = buildAreaLastUpdates(detected.detectedSourceFiles, hr);
  const byArea = new Map(areas.map((a) => [a.id, a]));

  const canDispatch = hasDispatchToken();

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

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    canDispatch,
    schedules,
    note:
      'Los cron de GitHub Actions son solo lectura aquí. Editar horarios = cambiar el .yml en el repo.',
  });
}

/**
 * POST /api/admin/sync-schedules — { workflow: 'gmail'|'saldos'|'hr' }
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
      { error: 'workflow debe ser gmail | saldos | hr' },
      { status: 400 },
    );
  }

  const token =
    process.env.GH_WORKFLOW_DISPATCH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error:
          'Falta GH_WORKFLOW_DISPATCH_TOKEN en Vercel. Mientras tanto: Actions → Run workflow.',
        actionsUrl: actionsUrlFor(workflow),
      },
      { status: 503 },
    );
  }

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
    return NextResponse.json(
      {
        error: `GitHub no aceptó el disparo (${res.status})`,
        detail,
        actionsUrl: actionsUrlFor(workflow),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: `Sync ${workflow} encolado. En 1–3 min debería aparecer en Actions.`,
    actionsUrl: actionsUrlFor(workflow),
  });
}
