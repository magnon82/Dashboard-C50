import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import { buildAreaLastUpdates } from '@/app/lib/admin-last-updates';
import {
  fetchDetectedSourceFiles,
  fetchHrLastUpdate,
} from '@/app/lib/storage-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      { error: 'Solo el administrador puede ver últimas actualizaciones' },
      { status: 403 },
    );
  }
  return session;
}

/**
 * GET /api/admin/last-updates — timestamps por área (FR created_at + RH).
 * Ligero: sin escaneo de Drive.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const [detected, hr] = await Promise.all([
    fetchDetectedSourceFiles(),
    fetchHrLastUpdate(),
  ]);

  const areas = buildAreaLastUpdates(detected.detectedSourceFiles, hr);

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    areas,
    bySourceFile: detected.detectedSourceFiles.map((d) => ({
      sourceFile: d.sourceFile,
      rowCount: d.rowCount,
      lastDate: d.lastDate,
      lastIngestedAt: d.lastIngestedAt,
    })),
    hr,
    detectedSourceFilesError: detected.detectedSourceFilesError,
  });
}
