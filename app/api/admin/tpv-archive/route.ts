import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
} from '@/app/lib/auth';
import { archiveOldTpvPhotos } from '@/app/lib/tpv-archive';
import {
  getGoogleDriveWriteStatus,
  tpvArchiveFolderId,
} from '@/app/lib/google-drive-write';
import { TPV_ARCHIVE_AFTER_DAYS } from '@/app/lib/tpv-cortes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function requireMaster() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session || !canAccessAdmin(session)) {
    return NextResponse.json(
      { error: 'Solo Master puede archivar cortes TPV' },
      { status: 403 }
    );
  }
  return session;
}

/** GET: estado de config + dry-run de candidatos >60 días. */
export async function GET() {
  const auth = await requireMaster();
  if (auth instanceof NextResponse) return auth;

  const drive = getGoogleDriveWriteStatus();
  const preview = await archiveOldTpvPhotos({ dryRun: true, limit: 200 });

  return NextResponse.json({
    archiveAfterDays: TPV_ARCHIVE_AFTER_DAYS,
    folderConfigured: Boolean(tpvArchiveFolderId()),
    drive,
    preview,
  });
}

/** POST: archiva lote (default 80) a Drive y libera Storage. */
export async function POST(request: Request) {
  const auth = await requireMaster();
  if (auth instanceof NextResponse) return auth;

  let body: { dryRun?: boolean; limit?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await archiveOldTpvPhotos({
    dryRun: Boolean(body.dryRun),
    limit: body.limit,
  });

  return NextResponse.json(result, { status: result.ok || result.archived > 0 ? 200 : 500 });
}
