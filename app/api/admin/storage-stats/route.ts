import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';
import { scanDriveInventory } from '@/app/lib/storage-stats';
import type { StorageStatsResult } from '@/app/lib/storage-format';

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
      { error: 'Solo el administrador puede ver estadísticas de almacenamiento' },
      { status: 403 },
    );
  }
  return session;
}

/** Bytes estimados de payload JSON de una fila (aprox. tamaño útil). */
function rowPayloadBytes(row: Record<string, unknown>): number {
  try {
    return Buffer.byteLength(JSON.stringify(row), 'utf8');
  } catch {
    return 512;
  }
}

/**
 * Tamaño de financial_records:
 * 1) RPC `admin_relation_size` → pg_total_relation_size (incluye índices/TOAST)
 * 2) Si falta el RPC: count × promedio de muestra de filas
 */
async function measureSupabase(): Promise<{
  supabaseBytes: number | null;
  supabaseMethod: 'rpc' | 'estimate' | null;
  supabaseRowCount: number | null;
  supabaseError: string | null;
}> {
  try {
    const sb = getServiceSupabase();

    const rpc = await sb.rpc('admin_relation_size', { rel: 'financial_records' });
    if (!rpc.error && rpc.data != null) {
      const n = typeof rpc.data === 'number' ? rpc.data : Number(rpc.data);
      if (Number.isFinite(n) && n >= 0) {
        const countRes = await sb
          .from('financial_records')
          .select('id', { count: 'exact', head: true });
        return {
          supabaseBytes: n,
          supabaseMethod: 'rpc',
          supabaseRowCount: countRes.count ?? null,
          supabaseError: null,
        };
      }
    }

    const countRes = await sb
      .from('financial_records')
      .select('id', { count: 'exact', head: true });
    if (countRes.error) {
      return {
        supabaseBytes: null,
        supabaseMethod: null,
        supabaseRowCount: null,
        supabaseError: countRes.error.message,
      };
    }
    const rowCount = countRes.count ?? 0;
    if (rowCount === 0) {
      return {
        supabaseBytes: 0,
        supabaseMethod: 'estimate',
        supabaseRowCount: 0,
        supabaseError: null,
      };
    }

    const sampleSize = Math.min(80, rowCount);
    const { data: sample, error: sampleError } = await sb
      .from('financial_records')
      .select('*')
      .limit(sampleSize);

    if (sampleError || !sample?.length) {
      // Fallback grueso ~1.2 KB/fila si no se puede muestrear
      const avg = 1200;
      return {
        supabaseBytes: Math.round(rowCount * avg),
        supabaseMethod: 'estimate',
        supabaseRowCount: rowCount,
        supabaseError: sampleError
          ? `Estimación gruesa (${sampleError.message})`
          : null,
      };
    }

    const avg =
      sample.reduce((sum, row) => sum + rowPayloadBytes(row as Record<string, unknown>), 0) /
      sample.length;
    // Factor ~1.35: índices + overhead heap aproximado vs solo payload JSON
    const estimated = Math.round(rowCount * avg * 1.35);

    return {
      supabaseBytes: estimated,
      supabaseMethod: 'estimate',
      supabaseRowCount: rowCount,
      supabaseError: rpc.error
        ? `RPC no disponible; estimación por filas (${rpc.error.message})`
        : null,
    };
  } catch (e) {
    return {
      supabaseBytes: null,
      supabaseMethod: null,
      supabaseRowCount: null,
      supabaseError: e instanceof Error ? e.message : 'Error midiendo Supabase',
    };
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const [supabase, drive] = await Promise.all([measureSupabase(), scanDriveInventory()]);

  const body: StorageStatsResult = {
    ...supabase,
    ...drive,
  };

  return NextResponse.json(body);
}
