/**
 * Escaneo de rutas Drive + agregación source_file (solo servidor / Node).
 */

import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { DetectedSourceFile, DrivePathStat } from '@/app/lib/storage-format';
import { getServiceSupabase } from '@/app/lib/users';

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
  rows: Array<{ source_file?: unknown; row_count?: unknown; last_date?: unknown }>,
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
    out.push({ sourceFile, rowCount, lastDate });
  }
  out.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile, 'es'));
  return out;
}

/**
 * Una sola agregación DISTINCT source_file (RPC).
 * Fallback: lectura paginada solo de source_file + date (sin N+1).
 */
export async function fetchDetectedSourceFiles(): Promise<{
  detectedSourceFiles: DetectedSourceFile[];
  detectedSourceFilesError: string | null;
}> {
  try {
    const sb = getServiceSupabase();
    const rpc = await sb.rpc('admin_source_file_stats');
    if (!rpc.error && Array.isArray(rpc.data)) {
      return {
        detectedSourceFiles: normalizeDetectedRows(
          rpc.data as Array<{
            source_file?: unknown;
            row_count?: unknown;
            last_date?: unknown;
          }>,
        ),
        detectedSourceFilesError: null,
      };
    }

    // Fallback sin RPC: agregar en memoria (columnas mínimas, una pasada).
    const tallies = new Map<string, { rowCount: number; lastDate: string | null }>();
    let from = 0;
    const pageSize = 1000;
    const maxRows = 80_000;
    let truncated = false;

    while (from < maxRows) {
      const { data, error } = await sb
        .from('financial_records')
        .select('source_file, date')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        return {
          detectedSourceFiles: [],
          detectedSourceFilesError: rpc.error
            ? `RPC no disponible (${rpc.error.message}); fallback falló: ${error.message}`
            : error.message,
        };
      }
      if (!data?.length) break;

      for (const row of data) {
        const sourceFile = String(
          (row as { source_file?: unknown }).source_file ?? '',
        ).trim() || '(vacío)';
        const dateRaw = (row as { date?: unknown }).date;
        const dateStr =
          dateRaw != null ? String(dateRaw).slice(0, 10) || null : null;
        const prev = tallies.get(sourceFile);
        if (!prev) {
          tallies.set(sourceFile, { rowCount: 1, lastDate: dateStr });
        } else {
          prev.rowCount += 1;
          if (dateStr && (!prev.lastDate || dateStr > prev.lastDate)) {
            prev.lastDate = dateStr;
          }
        }
      }

      if (data.length < pageSize) break;
      from += pageSize;
      if (from >= maxRows) truncated = true;
    }

    const detectedSourceFiles = [...tallies.entries()]
      .map(([sourceFile, v]) => ({
        sourceFile,
        rowCount: v.rowCount,
        lastDate: v.lastDate,
      }))
      .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile, 'es'));

    return {
      detectedSourceFiles,
      detectedSourceFilesError: truncated
        ? `Agregación parcial (límite ${maxRows.toLocaleString('es-MX')} filas). Ejecuta supabase/admin_source_file_stats.sql para el RPC exacto.`
        : rpc.error
          ? `RPC no disponible; agregación por lectura (${rpc.error.message}). Ejecuta supabase/admin_source_file_stats.sql.`
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
