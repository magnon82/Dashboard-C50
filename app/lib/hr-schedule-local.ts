/**
 * Horarios C50 desde archivos locales (Downloads / HR_HORARIOS_LOCAL_DIR).
 * No expone rutas crudas al cliente.
 */

import { access, readdir, readFile, stat } from 'fs/promises';
import path from 'path';

export const HR_HORARIOS_LOCAL_YEARS = [2026, 2025, 2024] as const;

const KNOWN_FILENAMES: Record<number, string[]> = {
  2026: ['HORARIOS C50 2026.xlsx', 'Horarios C50 2026.xlsx'],
  2025: ['HORARIOS C50 2025.xlsx', 'Horarios C50 2025.xlsx'],
  2024: ['HORARIOS C50 2024.xlsx', 'Horarios C50 2024.xlsx'],
};

export type HrLocalHorariosFile = {
  /** Id estable: local:2026 */
  id: string;
  year: number;
  label: string;
  fileName: string;
  modifiedTime: string | null;
  sheetCount: number | null;
};

function normalizeFileKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function getHrHorariosLocalDir(): string {
  return (
    process.env.HR_HORARIOS_LOCAL_DIR?.trim() ||
    process.env.HR_NOMINA_LOCAL_DIR?.trim() ||
    path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads')
  );
}

export function localHorariosFileId(year: number): string {
  return `local:${year}`;
}

export function parseLocalHorariosFileId(
  raw: string | null | undefined
): number | null {
  const s = String(raw || '').trim();
  const m = /^local:(\d{4})$/i.exec(s);
  if (m) return Number(m[1]);
  if (/^\d{4}$/.test(s)) return Number(s);
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function friendlyLabel(fileName: string, year: number): string {
  const base = fileName.replace(/\.xlsx$/i, '').replace(/\s+/g, ' ').trim();
  if (base) return base;
  return `HORARIOS C50 ${year}`;
}

export async function resolveLocalHorariosPath(
  year: number,
  dir = getHrHorariosLocalDir()
): Promise<{ absolutePath: string; fileName: string } | null> {
  if (!(await pathExists(dir))) return null;

  const known = KNOWN_FILENAMES[year] || [`HORARIOS C50 ${year}.xlsx`];
  for (const name of known) {
    const full = path.join(dir, name);
    if (await pathExists(full)) {
      return { absolutePath: full, fileName: name };
    }
  }

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  const yearStr = String(year);
  const hit = entries.find((name) => {
    if (!/\.xlsx$/i.test(name)) return false;
    const key = normalizeFileKey(name);
    if (!key.includes('horario') || !key.includes('c50')) return false;
    return key.includes(yearStr);
  });

  if (!hit) return null;
  return { absolutePath: path.join(dir, hit), fileName: hit };
}

export async function listLocalHorariosFiles(
  dir = getHrHorariosLocalDir()
): Promise<HrLocalHorariosFile[]> {
  const out: HrLocalHorariosFile[] = [];
  for (const year of HR_HORARIOS_LOCAL_YEARS) {
    const resolved = await resolveLocalHorariosPath(year, dir);
    if (!resolved) continue;
    let modifiedTime: string | null = null;
    try {
      const st = await stat(resolved.absolutePath);
      modifiedTime = st.mtime.toISOString();
    } catch {
      /* ignore */
    }
    out.push({
      id: localHorariosFileId(year),
      year,
      label: friendlyLabel(resolved.fileName, year),
      fileName: resolved.fileName,
      modifiedTime,
      sheetCount: null,
    });
  }
  return out;
}

export async function readLocalHorariosBuffer(
  year: number,
  dir = getHrHorariosLocalDir()
): Promise<{ buffer: Buffer; fileName: string; year: number; label: string }> {
  const resolved = await resolveLocalHorariosPath(year, dir);
  if (!resolved) {
    throw new Error(
      `No se encontró el archivo de horarios ${year}. Colócalo en Descargas (p. ej. HORARIOS C50 ${year}.xlsx).`
    );
  }
  const buffer = await readFile(resolved.absolutePath);
  return {
    buffer,
    fileName: resolved.fileName,
    year,
    label: friendlyLabel(resolved.fileName, year),
  };
}

export function formatLocalHorariosLabel(f: HrLocalHorariosFile): string {
  return `${f.label} · ${f.year}`;
}
