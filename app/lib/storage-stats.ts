/**
 * Escaneo de rutas Drive + agregación source_file (solo servidor / Node).
 */

import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { DetectedSourceFile, DrivePathStat } from '@/app/lib/storage-format';
import type { HrLastUpdateProbe } from '@/app/lib/admin-last-updates';
import { ALL_SOURCE_FILES } from '@/app/lib/admin-resources';
import { getServiceSupabase } from '@/app/lib/users';
import { listHrDriveSyncState } from '@/app/lib/hr-drive-sync';

export type DriveInventoryEntry = {
  /** Coincide con ResourceBranch.id en admin-resources. */
  id: string;
  label: string;
  /** Rutas a escanear (puede haber varias, p.ej. Presupuestos por año). */
  paths: string[];
};

const MI_UNIDAD = process.env.DRIVE_MI_UNIDAD_PATH?.trim() || 'I:\\Mi unidad';

/** Carpetas shortcut de Presupuestos (mismas que ingest_presupuesto.py). */
const DEFAULT_PRESUPUESTO_FOLDERS = [
  'I:\\.shortcut-targets-by-id\\1dDDnlR8VfbCeaI1Hn0cPg7HBHqfyUJFA\\PRESUPUESTOS 2022',
  'I:\\.shortcut-targets-by-id\\1c6J44HPdUaoGKQI8RcRdBtxg-c0HZMAT\\PRESUPUESTOS 2023',
  'I:\\.shortcut-targets-by-id\\1-2gKQvuVI_3O2N5-uZ2NG51FbQftMqSG\\PRESUPUESTOS MENSUALES  2024',
  'I:\\.shortcut-targets-by-id\\10X4rPJGf3mGqVWGybos3O11nHD_4e7Cx\\PRESUPUESTOS MENSUALES 2025',
  'I:\\.shortcut-targets-by-id\\1-6eRRMYs_V7qHEjD8GHjQgwFC63ucMPk\\PRESUPUESTOS 2026',
  path.join(MI_UNIDAD, 'Presupuestos'),
];

function presupuestoPaths(): string[] {
  const fromEnv = process.env.PRESUPUESTOS_PATHS?.trim();
  if (fromEnv) {
    return fromEnv.split(';').map((p) => p.trim()).filter(Boolean);
  }
  return DEFAULT_PRESUPUESTO_FOLDERS;
}

/** Rutas scaneables del inventario Drive (excluye Google Sheets en la nube). */
export function getDriveInventoryEntries(): DriveInventoryEntry[] {
  return [
    {
      id: 'drive-presupuestos',
      label: 'Presupuestos (por año)',
      paths: presupuestoPaths(),
    },
    {
      id: 'drive-admin',
      label: 'Administración',
      paths: [path.join(MI_UNIDAD, 'Administración')],
    },
    {
      id: 'drive-comprobantes',
      label: 'Comprobantes bancarios',
      paths: [
        process.env.COMPROBANTES_PATH?.trim() || path.join(MI_UNIDAD, 'COMPROBANTES BANCARIOS'),
      ],
    },
    {
      id: 'drive-facturas',
      label: 'Facturas CFDI',
      paths: [
        process.env.FACTURAS_PATH?.trim() || path.join(MI_UNIDAD, 'FACTURAS CFDI'),
      ],
    },
    {
      id: 'drive-eventos',
      label: 'Eventos',
      paths: [
        process.env.EVENTOS_PATH?.trim() || path.join(MI_UNIDAD, 'Eventos'),
      ],
    },
    {
      id: 'drive-rh',
      label: 'Recursos Humanos (RH)',
      paths: [path.join(MI_UNIDAD, 'RH')],
    },
    {
      id: 'local-hr-downloads',
      label: 'Descargas · import RR.HH.',
      /** Solo archivos conocidos (no escanea toda la carpeta Descargas). */
      paths: (() => {
        const dir =
          process.env.HR_NOMINA_LOCAL_DIR?.trim() ||
          process.env.HR_HORARIOS_LOCAL_DIR?.trim() ||
          path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
        return [
          path.join(dir, 'NOMINA C50 2026 .xlsx'),
          path.join(dir, 'NOMINA C50 2026.xlsx'),
          path.join(dir, 'NOMINA C50 2025.xlsx'),
          path.join(dir, 'NOMINAS C50 2024.xlsx'),
          path.join(dir, 'NOMINA C50 2024.xlsx'),
          path.join(dir, 'HORARIOS C50 2026.xlsx'),
          path.join(dir, 'Horarios C50 2026.xlsx'),
        ];
      })(),
    },
  ];
}

/** Suma recursiva de tamaños de archivo bajo un directorio (o tamaño de un archivo). */
export async function sumPathBytes(
  root: string,
): Promise<{ bytes: number; fileCount: number } | null> {
  if (!existsSync(root)) return null;
  try {
    const st = await stat(root);
    if (st.isFile()) return { bytes: st.size, fileCount: 1 };
    if (!st.isDirectory()) return { bytes: 0, fileCount: 0 };
  } catch {
    return null;
  }

  let bytes = 0;
  let fileCount = 0;
  const stack: string[] = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const s = await stat(full);
          bytes += s.size;
          fileCount += 1;
        } else if (entry.isSymbolicLink()) {
          const s = await stat(full);
          if (s.isFile()) {
            bytes += s.size;
            fileCount += 1;
          } else if (s.isDirectory()) {
            stack.push(full);
          }
        }
      } catch {
        // permiso / enlace roto
      }
    }
  }

  return { bytes, fileCount };
}

export async function scanDriveInventory(): Promise<{
  driveBytes: number | null;
  driveAvailable: boolean;
  driveMessage: string | null;
  driveByPath: DrivePathStat[];
}> {
  const entries = getDriveInventoryEntries();
  const driveByPath: DrivePathStat[] = [];
  let total = 0;
  let anyAvailable = false;

  for (const entry of entries) {
    let bytes = 0;
    let fileCount = 0;
    let found = 0;
    for (const p of entry.paths) {
      const result = await sumPathBytes(p);
      if (result) {
        found += 1;
        bytes += result.bytes;
        fileCount += result.fileCount;
      }
    }
    if (found === 0) {
      driveByPath.push({
        id: entry.id,
        label: entry.label,
        paths: entry.paths,
        bytes: null,
        available: false,
        fileCount: 0,
        message: 'no disponible en este servidor',
      });
    } else {
      anyAvailable = true;
      total += bytes;
      driveByPath.push({
        id: entry.id,
        label: entry.label,
        paths: entry.paths,
        bytes,
        available: true,
        fileCount,
      });
    }
  }

  return {
    driveBytes: anyAvailable ? total : null,
    driveAvailable: anyAvailable,
    driveMessage: anyAvailable ? null : 'no disponible en este servidor',
    driveByPath,
  };
}

function normalizeDetectedRows(
  rows: Array<{
    source_file?: unknown;
    row_count?: unknown;
    last_date?: unknown;
    last_created_at?: unknown;
  }>,
): DetectedSourceFile[] {
  const out: DetectedSourceFile[] = [];
  for (const row of rows) {
    const sourceFile = String(row.source_file ?? '').trim();
    if (!sourceFile) continue;
    const rowCount = Number(row.row_count);
    if (!Number.isFinite(rowCount) || rowCount < 0) continue;
    let lastDate: string | null = null;
    if (row.last_date != null) {
      const raw = String(row.last_date);
      lastDate = raw.slice(0, 10) || null;
    }
    let lastIngestedAt: string | null = null;
    if (row.last_created_at != null) {
      const raw = String(row.last_created_at).trim();
      lastIngestedAt = raw || null;
    }
    out.push({ sourceFile, rowCount, lastDate, lastIngestedAt });
  }
  out.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile, 'es'));
  return out;
}

/**
 * Una sola agregación DISTINCT source_file (RPC).
 * Fallback: una query por source_file (max created_at) — barato y admin-only.
 */
export async function fetchDetectedSourceFiles(): Promise<{
  detectedSourceFiles: DetectedSourceFile[];
  detectedSourceFilesError: string | null;
}> {
  try {
    const sb = getServiceSupabase();
    const rpc = await sb.rpc('admin_source_file_stats');
    if (!rpc.error && Array.isArray(rpc.data)) {
      const normalized = normalizeDetectedRows(
        rpc.data as Array<{
          source_file?: unknown;
          row_count?: unknown;
          last_date?: unknown;
          last_created_at?: unknown;
        }>,
      );
      // RPC antiguo sin last_created_at: completar con sondeos puntuales.
      const needsIngest = normalized.some(
        (r) => r.rowCount > 0 && !r.lastIngestedAt,
      );
      if (!needsIngest) {
        return {
          detectedSourceFiles: normalized,
          detectedSourceFilesError: null,
        };
      }
      const enriched = await enrichLastIngested(normalized);
      return {
        detectedSourceFiles: enriched,
        detectedSourceFilesError: null,
      };
    }

    // Fallback sin RPC: por source_file conocido + descubiertos vía count head.
    const perSource = await fetchPerSourceStats();
    return {
      detectedSourceFiles: perSource.rows,
      detectedSourceFilesError: rpc.error
        ? `RPC no disponible; agregación por source_file (${rpc.error.message}). Ejecuta supabase/admin_source_file_stats.sql.`
        : null,
    };
  } catch (e) {
    return {
      detectedSourceFiles: [],
      detectedSourceFilesError:
        e instanceof Error ? e.message : 'Error detectando source_file',
    };
  }
}

async function enrichLastIngested(
  rows: DetectedSourceFile[],
): Promise<DetectedSourceFile[]> {
  const sb = getServiceSupabase();
  const out = await Promise.all(
    rows.map(async (row) => {
      if (row.lastIngestedAt || row.rowCount <= 0) return row;
      try {
        const { data } = await sb
          .from('financial_records')
          .select('created_at')
          .eq('source_file', row.sourceFile)
          .order('created_at', { ascending: false })
          .limit(1);
        const created = data?.[0]
          ? String((data[0] as { created_at?: unknown }).created_at || '')
          : '';
        return {
          ...row,
          lastIngestedAt: created || null,
        };
      } catch {
        return row;
      }
    }),
  );
  return out;
}

async function fetchPerSourceStats(): Promise<{ rows: DetectedSourceFile[] }> {
  const sb = getServiceSupabase();
  const sources = new Set(ALL_SOURCE_FILES);

  // Descubrir source_file extra con una muestra acotada.
  try {
    const { data } = await sb
      .from('financial_records')
      .select('source_file')
      .order('id', { ascending: false })
      .limit(2000);
    for (const row of data || []) {
      const sf = String((row as { source_file?: unknown }).source_file || '').trim();
      if (sf) sources.add(sf);
    }
  } catch {
    /* ignore */
  }

  const rows: DetectedSourceFile[] = [];
  await Promise.all(
    [...sources].map(async (sourceFile) => {
      try {
        const [countRes, lastRes] = await Promise.all([
          sb
            .from('financial_records')
            .select('id', { count: 'exact', head: true })
            .eq('source_file', sourceFile),
          sb
            .from('financial_records')
            .select('created_at, date')
            .eq('source_file', sourceFile)
            .order('created_at', { ascending: false })
            .limit(1),
        ]);
        const rowCount = countRes.count ?? 0;
        if (rowCount <= 0) {
          rows.push({
            sourceFile,
            rowCount: 0,
            lastDate: null,
            lastIngestedAt: null,
          });
          return;
        }
        const head = lastRes.data?.[0] as
          | { created_at?: unknown; date?: unknown }
          | undefined;
        const lastIngestedAt = head?.created_at
          ? String(head.created_at)
          : null;
        const lastDate = head?.date ? String(head.date).slice(0, 10) : null;
        rows.push({ sourceFile, rowCount, lastDate, lastIngestedAt });
      } catch {
        /* skip broken source */
      }
    }),
  );

  rows.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile, 'es'));
  return { rows };
}

export type FinanzasSyncProbe = { lastAt: string | null; source: string };

/** Heartbeat de sync-saldos (GitHub Actions / local). */
export async function fetchFinanzasSyncState(): Promise<FinanzasSyncProbe> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('finanzas_sync_state')
      .select('last_synced_at')
      .eq('content_type', 'saldos')
      .maybeSingle();
    if (error || !data?.last_synced_at) {
      return { lastAt: null, source: 'none' };
    }
    return {
      lastAt: String(data.last_synced_at),
      source: 'finanzas_sync_state',
    };
  } catch {
    return { lastAt: null, source: 'none' };
  }
}

/** Última sync / mutación RR.HH. para el mapa e inventario. */
export async function fetchHrLastUpdate(): Promise<HrLastUpdateProbe> {
  try {
    const state = await listHrDriveSyncState();
    if (!state.tableMissing) {
      let best: string | null = null;
      for (const r of state.rows) {
        const ts = r.last_synced_at || r.updated_at;
        if (ts && (!best || ts > best)) best = ts;
      }
      if (best) {
        return { lastAt: best, source: 'hr_drive_sync_state' };
      }
    }
  } catch {
    /* fall through to table probes */
  }

  const sb = getServiceSupabase();
  const tables = [
    'hr_payroll_periods',
    'hr_schedule_weeks',
    'hr_employees',
    'hr_leave_requests',
    'hr_resguardo_requests',
  ] as const;
  const stamps = await Promise.all(
    tables.map(async (table) => {
      try {
        const { data, error } = await sb
          .from(table)
          .select('updated_at')
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error || !data?.[0]) return null;
        const ts = String(
          (data[0] as { updated_at?: unknown }).updated_at || '',
        );
        return ts || null;
      } catch {
        return null;
      }
    }),
  );
  let best: string | null = null;
  for (const ts of stamps) {
    if (ts && (!best || ts > best)) best = ts;
  }
  return best
    ? { lastAt: best, source: 'hr_tables' }
    : { lastAt: null, source: 'none' };
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
 * 1) RPC `admin_relation_size` → pg_total_relation_size
 * 2) Si falta el RPC: count × promedio de muestra de filas
 */
export async function measureSupabase(): Promise<{
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
