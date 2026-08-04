import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { requireRrhhSession, requireRrhhWrite } from '@/app/lib/hr-api';
import {
  HR_DRIVE_SYNC_CONTENT_TYPES,
  listHrDriveSyncState,
  upsertHrDriveSyncState,
  type HrDriveSyncContentType,
} from '@/app/lib/hr-drive-sync';
import { HR_EXPEDIENTES_DIR } from '@/app/lib/hr';
import { hrRootExists } from '@/app/lib/hr-biblioteca';
import { localDriveFsEnabled } from '@/app/lib/local-fs';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID = new Set(HR_DRIVE_SYNC_CONTENT_TYPES.map((d) => d.id));

/**
 * GET /api/hr/sync — estado de sync + catálogo de tipos.
 * POST /api/hr/sync — { contentType } Actualizar desde Drive (solo si File Stream / fuente local).
 * Soft-sync cloud (inventario + hr_drive_sync_state): Actions diario 12:00 PM CDMX
 *   (.github/workflows/sync-hr-drive.yml → sync_hr_drive_cloud.py).
 */
export async function GET() {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const state = await listHrDriveSyncState();
  let expedienteLinked = 0;
  let payrollPeriods = 0;
  let scheduleWeeks = 0;
  let docLinks = 0;
  try {
    const sb = getServiceSupabase();
    const [emp, pay, sch, docs] = await Promise.all([
      sb
        .from('hr_employees')
        .select('id', { count: 'exact', head: true })
        .not('drive_folder_path', 'is', null),
      sb
        .from('hr_payroll_periods')
        .select('id', { count: 'exact', head: true }),
      sb
        .from('hr_schedule_weeks')
        .select('id', { count: 'exact', head: true }),
      sb
        .from('hr_doc_links')
        .select('id', { count: 'exact', head: true })
        .eq('active', true),
    ]);
    expedienteLinked = emp.count ?? 0;
    payrollPeriods = pay.count ?? 0;
    scheduleWeeks = sch.count ?? 0;
    docLinks = docs.count ?? 0;
  } catch {
    /* ignore */
  }

  const localFs = localDriveFsEnabled();
  return NextResponse.json({
    ready: true,
    driveMounted: state.driveMounted,
    localFsEnabled: localFs,
    expedientesDirExists: localFs && existsSync(HR_EXPEDIENTES_DIR),
    tableMissing: state.tableMissing,
    inventory: {
      expedienteLinked,
      payrollPeriods,
      scheduleWeeks,
      docLinks,
    },
    contentTypes: HR_DRIVE_SYNC_CONTENT_TYPES.map((d) => ({
      ...d,
      /** Soft-sync cloud documentado; POST local sigue siendo refresh opcional. */
      syncFrequency: 'Diario 12:00 PM CDMX (Actions soft-sync)' as string | null,
    })),
    state: state.rows,
    note:
      'Operación diaria en Supabase (Vercel). Soft-sync Actions 12:00 PM CDMX actualiza hr_drive_sync_state. Refresh Drive/xlsx opcional desde PC admin o POST aquí; no requiere File Stream en producción.',
  });
}

export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  let body: { contentType?: string; content_type?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const raw = (body.contentType || body.content_type || '').trim();
  if (!VALID.has(raw as HrDriveSyncContentType)) {
    return NextResponse.json(
      {
        error:
          'contentType inválido. Usa: ' +
          HR_DRIVE_SYNC_CONTENT_TYPES.map((d) => d.id).join(', '),
      },
      { status: 400 }
    );
  }
  const contentType = raw as HrDriveSyncContentType;
  const def = HR_DRIVE_SYNC_CONTENT_TYPES.find((d) => d.id === contentType)!;
  const driveMounted = hrRootExists();

  if (contentType === 'cultura') {
    await upsertHrDriveSyncState({
      contentType,
      status: 'ok',
      source: 'code',
      message: 'Cultura vive en app/lib/hr-cultura.ts (sin File Stream).',
      rowCount: null,
    });
    return NextResponse.json({
      ready: true,
      contentType,
      status: 'ok',
      source: 'code',
      message: def.refreshHow,
    });
  }

  if (contentType === 'expedientes') {
    if (
      !localDriveFsEnabled() ||
      !driveMounted ||
      !existsSync(HR_EXPEDIENTES_DIR)
    ) {
      const sb = getServiceSupabase();
      const { count } = await sb
        .from('hr_employees')
        .select('id', { count: 'exact', head: true })
        .not('drive_folder_path', 'is', null);
      await upsertHrDriveSyncState({
        contentType,
        status: 'ok',
        source: 'supabase',
        message: `Índice en Supabase (${count ?? 0} vinculados). Sync de carpetas nuevas es opcional (PC de admin).`,
        rowCount: count ?? 0,
      });
      return NextResponse.json({
        ready: true,
        contentType,
        status: 'ok',
        source: 'supabase',
        linkedCount: count ?? 0,
        message:
          'Índice de expedientes operativo en Supabase. Detectar carpetas nuevas es opcional desde el PC de admin.',
        hint: 'Opcional: HR_EXPEDIENTES_DRIVE_FOLDER_ID + credenciales Google para soft-pull Drive→Storage en Vercel.',
      });
    }

    // Disparar el mismo listado que la UI (vincula paths al vuelo).
    const base = new URL(request.url);
    const indexUrl = new URL('/api/hr/expedientes', base.origin);
    const cookie = request.headers.get('cookie') || '';
    const idxRes = await fetch(indexUrl, {
      headers: { cookie },
      cache: 'no-store',
    });
    const idx = await idxRes.json();
    const altas = (idx.buckets || []).find(
      (b: { kind: string }) => b.kind === 'altas'
    );
    let linkedPass = 0;
    if (altas?.path) {
      const q = new URLSearchParams({ bucket: 'altas', path: altas.path });
      const listRes = await fetch(
        new URL(`/api/hr/expedientes?${q}`, base.origin),
        { headers: { cookie }, cache: 'no-store' }
      );
      const list = await listRes.json();
      linkedPass = list.pathsWritten ?? 0;
    }
    await upsertHrDriveSyncState({
      contentType,
      status: 'ok',
      source: 'file_stream',
      message: `Sync expedientes File Stream (paths nuevos: ${linkedPass})`,
      rowCount: idx.linkedCount ?? null,
    });
    return NextResponse.json({
      ready: true,
      contentType,
      status: 'ok',
      source: 'file_stream',
      pathsWritten: linkedPass,
      message: 'Índice de expedientes actualizado desde File Stream.',
    });
  }

  if (contentType === 'biblioteca') {
    const sb = getServiceSupabase();
    const { count, error } = await sb
      .from('hr_doc_links')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);
    if (error) {
      await upsertHrDriveSyncState({
        contentType,
        status: 'error',
        source: 'supabase',
        message: error.message,
      });
      return NextResponse.json(
        { error: error.message, hint: 'Ejecuta supabase/hr_module.sql / hr_doc_links_seed.sql' },
        { status: 500 }
      );
    }
    await upsertHrDriveSyncState({
      contentType,
      status: 'ok',
      source: driveMounted ? 'file_stream' : 'supabase',
      message: driveMounted
        ? `Catálogo hr_doc_links (${count ?? 0}) · disco local disponible`
        : `Catálogo hr_doc_links (${count ?? 0}) en servidor · Abrir vía drive_url / Cultura in-app`,
      rowCount: count ?? 0,
    });
    return NextResponse.json({
      ready: true,
      contentType,
      status: 'ok',
      docLinks: count ?? 0,
      driveMounted,
      localFsEnabled: localDriveFsEnabled(),
      message:
        'Metadatos de biblioteca en Supabase. Binarios: Abrir en Drive o Cultura in-app.',
    });
  }

  if (contentType === 'nomina' || contentType === 'horarios') {
    const path =
      contentType === 'nomina'
        ? '/api/hr/payroll/import'
        : '/api/hr/schedules/import';
    const base = new URL(request.url);
    const cookie = request.headers.get('cookie') || '';
    try {
      const res = await fetch(new URL(path, base.origin), {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'ensure_year' }),
        cache: 'no-store',
      });
      const json = await res.json();
      const ok = res.ok && json.ready !== false;
      await upsertHrDriveSyncState({
        contentType,
        status: ok ? 'ok' : 'error',
        source: driveMounted ? 'file_stream' : 'downloads',
        message: json.message || json.error || def.refreshHow,
        rowCount: json.imported ?? json.created ?? json.count ?? null,
      });
      return NextResponse.json({
        ready: ok,
        contentType,
        status: ok ? 'ok' : 'error',
        result: json,
        message: ok
          ? `${def.label}: soft-load ensure_year ejecutado.`
          : json.error || 'No se pudo actualizar (¿xlsx local / Drive?)',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      await upsertHrDriveSyncState({
        contentType,
        status: 'error',
        source: 'manual',
        message: msg,
      });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  await upsertHrDriveSyncState({
    contentType,
    status: 'skipped',
    source: 'manual',
    message: `Sync automático diferido: ${def.refreshHow}`,
  });
  return NextResponse.json({
    ready: true,
    contentType,
    status: 'skipped',
    message: def.refreshHow,
    stillNeedsDrive: def.stillNeedsDrive,
    cadenceHint: def.cadenceHint,
  });
}
