/**
 * Escaneo de rutas Drive para Inventario de datos (solo servidor / Node).
 */

import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { DrivePathStat } from '@/app/lib/storage-format';

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
