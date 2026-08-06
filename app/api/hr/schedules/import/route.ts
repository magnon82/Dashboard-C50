/**
 * GET/POST /api/hr/schedules/import
 * Importa HORARIOS C50 2026.xlsx (Downloads) → hr_schedule_weeks + shifts.
 *
 * POST:
 * - { action: 'ensure_year', year?, refreshExisting?, createMissing? } — soft-load
 * - { year?, replace?, createMissing? } — import completo (replace default true)
 */

import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireSchedulesSession,
  requireSchedulesWrite,
} from '@/app/lib/hr-api';
import {
  summarizeHorariosWorkbook,
} from '@/app/lib/hr-schedule-import';
import {
  formatLocalHorariosLabel,
  listLocalHorariosFiles,
  parseLocalHorariosFileId,
  readLocalHorariosBuffer,
  getHrHorariosLocalDir,
} from '@/app/lib/hr-schedule-local';
import { ensureYearSchedulesFromLocal } from '@/app/lib/hr-schedule-sync';
import { access } from 'fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicError(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message;
    if (hrSchemaMissing(m)) {
      return 'Ejecuta supabase/hr_module.sql en Supabase.';
    }
    if (/[A-Za-z]:\\|\/Mi unidad|File Stream|ENOENT|EPERM|Downloads/i.test(m)) {
      return 'No se pudo leer el archivo de horarios. Coloca «HORARIOS C50 2026.xlsx» en Descargas.';
    }
    return m;
  }
  return 'Error';
}

async function dirOk(): Promise<boolean> {
  try {
    await access(getHrHorariosLocalDir());
    return true;
  } catch {
    return false;
  }
}

/**
 * GET — lista archivos locales de horarios (sin rutas).
 */
export async function GET() {
  const auth = await requireSchedulesSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const localDirOk = await dirOk();
    const localFiles = localDirOk ? await listLocalHorariosFiles() : [];
    const preferred =
      localFiles.find((f) => f.year === 2026) || localFiles[0] || null;

    let weekSheetCount = 0;
    let label: string | null = preferred?.label ?? null;
    if (preferred) {
      try {
        const { buffer } = await readLocalHorariosBuffer(preferred.year);
        const summary = summarizeHorariosWorkbook(buffer, preferred.year);
        weekSheetCount = summary.weekSheets.length;
        label = preferred.label;
      } catch {
        weekSheetCount = 0;
      }
    }

    return NextResponse.json({
      ready: Boolean(preferred && weekSheetCount > 0),
      localDirOk,
      localFiles: localFiles.map((f) => ({
        id: f.id,
        year: f.year,
        label: formatLocalHorariosLabel(f),
        fileName: f.fileName,
        modifiedTime: f.modifiedTime,
      })),
      selectedYear: preferred?.year ?? null,
      selectedLabel: label,
      weekSheetCount,
      note:
        preferred && weekSheetCount > 0
          ? `${label}: ${weekSheetCount} semanas listas para importar`
          : localDirOk
            ? 'No hay archivo de horarios en Descargas (p. ej. HORARIOS C50 2026.xlsx).'
            : 'No se pudo acceder a la carpeta Descargas. Revisa HR_HORARIOS_LOCAL_DIR.',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        localDirOk: false,
        localFiles: [],
        note: publicError(e),
      },
      { status: 200 }
    );
  }
}

/**
 * POST JSON:
 * { action?: 'ensure_year', year?: 2026, localFileId?: "local:2026",
 *   replace?: true, refreshExisting?: true, createMissing?: true }
 */
export async function POST(request: Request) {
  const auth = await requireSchedulesSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireSchedulesWrite(auth);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const year =
    parseLocalHorariosFileId(
      String(body.localFileId || body.year || 'local:2026')
    ) || 2026;
  const action = String(body.action || '').trim() || 'import';
  const createMissing = body.createMissing !== false;
  // ensure_year: soft (no replace) salvo refreshExisting
  // import legacy: replace por default
  const refreshExisting =
    action === 'ensure_year'
      ? body.refreshExisting === true
      : body.replace !== false || body.refreshExisting === true;

  try {
    const sb = getServiceSupabase();
    const result = await ensureYearSchedulesFromLocal(
      sb,
      auth.username,
      year,
      { refreshExisting, createMissing }
    );

    if (result.fileMissing) {
      return NextResponse.json(
        {
          ...result,
          error: 'archivo_no_encontrado',
          message: result.message,
        },
        { status: 404 }
      );
    }

    if (!result.ready && result.weeksImported === 0 && result.weeksAlready === 0) {
      return NextResponse.json(
        {
          ...result,
          error: 'sin_semanas',
          message: result.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = publicError(e);
    const missing = hrSchemaMissing(
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      {
        error: msg,
        message: msg,
      },
      { status: missing ? 503 : 500 }
    );
  }
}
