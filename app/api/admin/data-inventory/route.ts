import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import {
  ALL_SOURCE_FILES,
  HR_TABLES,
  SOURCE_FILE_GROUPS,
} from '@/app/lib/admin-resources';
import {
  fetchDetectedSourceFiles,
  fetchHrLastUpdate,
  measureSupabase,
  scanDriveInventory,
} from '@/app/lib/storage-stats';
import { buildAreaLastUpdates } from '@/app/lib/admin-last-updates';
import type { DataInventoryResult } from '@/app/lib/storage-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Escaneo de Drive puede tardar en carpetas grandes. */
export const maxDuration = 120;

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
      { error: 'Solo el administrador puede ver el inventario de datos' },
      { status: 403 },
    );
  }
  return session;
}

/**
 * Inventario híbrido: metadatos documentados (código) + detección en vivo
 * (Supabase source_file + carpetas Drive). El mapa de orígenes sigue siendo
 * curado a mano en admin-resources.ts.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const [supabase, drive, detected, hr] = await Promise.all([
    measureSupabase(),
    scanDriveInventory(),
    fetchDetectedSourceFiles(),
    fetchHrLastUpdate(),
  ]);

  const body: DataInventoryResult = {
    documented: {
      sourceFiles: ALL_SOURCE_FILES,
      groups: [
        ...SOURCE_FILE_GROUPS.map((g) => ({
          id: g.id,
          label: g.label,
          sources: g.sources,
        })),
        {
          id: 'rrhh',
          label: 'Recursos Humanos (hr_*)',
          sources: HR_TABLES,
        },
      ],
      hrTables: HR_TABLES,
    },
    detectedSourceFiles: detected.detectedSourceFiles,
    detectedSourceFilesError: detected.detectedSourceFilesError,
    driveFolders: drive.driveByPath,
    sizes: {
      supabaseBytes: supabase.supabaseBytes,
      supabaseMethod: supabase.supabaseMethod,
      supabaseRowCount: supabase.supabaseRowCount,
      supabaseError: supabase.supabaseError,
      driveBytes: drive.driveBytes,
      driveAvailable: drive.driveAvailable,
      driveMessage: drive.driveMessage,
    },
    areaLastUpdates: buildAreaLastUpdates(detected.detectedSourceFiles, hr),
  };

  return NextResponse.json(body);
}
