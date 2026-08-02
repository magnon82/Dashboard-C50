/**
 * Nóminas C50 desde archivos locales (Downloads / HR_NOMINA_LOCAL_DIR).
 * Soft-load del historial en /rrhh → Nómina (ensure_year). No expone rutas crudas al cliente.
 */

import { access, readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import type { HrNominaSheetInfo, HrPayrollLineInput } from '@/app/lib/hr-payroll';
import {
  importNominaSheet,
  listNominaSheets,
  pickLatestNominaSheet,
} from '@/app/lib/hr-payroll-import';

/** Años conocidos, más reciente primero (default UI = 2026). */
export const HR_NOMINA_LOCAL_YEARS = [2026, 2025, 2024, 2023, 2022] as const;

/**
 * Nombres exactos observados en Downloads (espacios / acentos).
 * Se resuelven también por escaneo NFD si el nombre varía un poco.
 */
const KNOWN_FILENAMES: Record<number, string[]> = {
  2026: ['NOMINA C50 2026 .xlsx', 'NOMINA C50 2026.xlsx'],
  2025: ['NOMINA C50 2025.xlsx'],
  2024: ['NOMINAS C50 2024.xlsx', 'NOMINA C50 2024.xlsx'],
  2023: ['Nómina C50 2023.xlsx', 'Nomina C50 2023.xlsx'],
  2022: ['Nómina C50  2022.xlsx', 'Nómina C50 2022.xlsx', 'Nomina C50  2022.xlsx'],
};

export type HrLocalNominaFile = {
  /** Id estable para API/UI: local:2026 */
  id: string;
  year: number;
  /** Etiqueta amigable sin ruta (p. ej. NOMINA C50 2026). */
  label: string;
  fileName: string;
  modifiedTime: string | null;
};

export type HrLocalPayrollProbe = {
  localConfigured: boolean;
  localDirOk: boolean;
  localFiles: HrLocalNominaFile[];
  selectedFileId: string | null;
  selectedFileName: string | null;
  selectedYear: number | null;
  sheets: HrNominaSheetInfo[];
  suggestedSheet: string | null;
  sourceLabel: string;
};

function normalizeFileKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function getHrNominaLocalDir(): string {
  return (
    process.env.HR_NOMINA_LOCAL_DIR?.trim() ||
    path.join(
      process.env.USERPROFILE || process.env.HOME || '',
      'Downloads'
    )
  );
}

export function localNominaFileId(year: number): string {
  return `local:${year}`;
}

export function parseLocalNominaFileId(
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
  return `NOMINA C50 ${year}`;
}

/** Busca el xlsx del año en el directorio (candidatos fijos + escaneo). */
export async function resolveLocalNominaPath(
  year: number,
  dir = getHrNominaLocalDir()
): Promise<{ absolutePath: string; fileName: string } | null> {
  if (!(await pathExists(dir))) return null;

  const known = KNOWN_FILENAMES[year] || [`NOMINA C50 ${year}.xlsx`];
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
    if (!key.includes('nomin') || !key.includes('c50')) return false;
    // Año en el nombre (evita confundir "1 2025" sheet names — esto es filename)
    return (
      key.includes(yearStr) ||
      new RegExp(`\\b${yearStr}\\b`).test(key) ||
      key.includes(` ${yearStr}`) ||
      key.endsWith(`${yearStr}.xlsx`)
    );
  });

  if (!hit) return null;
  return { absolutePath: path.join(dir, hit), fileName: hit };
}

export async function listLocalNominaFiles(
  dir = getHrNominaLocalDir()
): Promise<HrLocalNominaFile[]> {
  const out: HrLocalNominaFile[] = [];
  for (const year of HR_NOMINA_LOCAL_YEARS) {
    const resolved = await resolveLocalNominaPath(year, dir);
    if (!resolved) continue;
    let modifiedTime: string | null = null;
    try {
      const st = await stat(resolved.absolutePath);
      modifiedTime = st.mtime.toISOString();
    } catch {
      /* ignore */
    }
    out.push({
      id: localNominaFileId(year),
      year,
      label: friendlyLabel(resolved.fileName, year),
      fileName: resolved.fileName,
      modifiedTime,
    });
  }
  return out;
}

export async function readLocalNominaBuffer(
  year: number,
  dir = getHrNominaLocalDir()
): Promise<{ buffer: Buffer; fileName: string; year: number; label: string }> {
  const resolved = await resolveLocalNominaPath(year, dir);
  if (!resolved) {
    throw new Error(
      `No se encontró el archivo de nómina ${year}. Colócalo en la carpeta de nóminas locales o súbelo.`
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

function applyYearHint(
  sheets: HrNominaSheetInfo[],
  year: number
): HrNominaSheetInfo[] {
  return sheets.map((s) => {
    const patchIso = (iso: string | null): string | null => {
      if (!iso || !/^\d{4}-/.test(iso)) return iso;
      return `${year}${iso.slice(4)}`;
    };
    let weekLabel = s.weekLabel;
    if (weekLabel && /Semana\s+\d+/i.test(weekLabel)) {
      weekLabel = weekLabel.replace(/\s*·\s*\d{4}\s*$/, '').trim();
      weekLabel = `${weekLabel} · ${year}`;
    }
    return {
      ...s,
      weekLabel,
      periodStart: patchIso(s.periodStart),
      periodEnd: patchIso(s.periodEnd),
    };
  });
}

export async function listSheetsFromLocalFile(
  year: number
): Promise<{
  file: HrLocalNominaFile;
  sheets: HrNominaSheetInfo[];
  buffer: Buffer;
}> {
  const { buffer, fileName, label } = await readLocalNominaBuffer(year);
  const sheets = applyYearHint(listNominaSheets(buffer), year);
  let modifiedTime: string | null = null;
  try {
    const st = await stat(
      (await resolveLocalNominaPath(year))!.absolutePath
    );
    modifiedTime = st.mtime.toISOString();
  } catch {
    /* ignore */
  }
  return {
    file: {
      id: localNominaFileId(year),
      year,
      label,
      fileName,
      modifiedTime,
    },
    sheets,
    buffer,
  };
}

export async function importNominaFromLocal(
  year: number,
  sheetName: string
): Promise<{
  meta: HrNominaSheetInfo;
  lines: HrPayrollLineInput[];
  sourceLabel: string;
  fileName: string;
  label: string;
}> {
  const { buffer, fileName, label } = await readLocalNominaBuffer(year);
  let resolved = sheetName.trim();
  if (!resolved) {
    const sheets = applyYearHint(listNominaSheets(buffer), year);
    resolved = pickLatestNominaSheet(sheets)?.name || '';
  }
  if (!resolved) {
    throw new Error(
      'No hay hoja SEM con líneas legibles en el archivo local'
    );
  }
  const parsed = importNominaSheet(buffer, resolved);
  const [meta] = applyYearHint([parsed.meta], year);
  return {
    meta,
    lines: parsed.lines,
    sourceLabel: `Local:${label}#${resolved}`,
    fileName,
    label,
  };
}

export async function probeLocalPayrollSources(
  preferredId?: string | null
): Promise<HrLocalPayrollProbe> {
  const dir = getHrNominaLocalDir();
  const localDirOk = await pathExists(dir);
  const localFiles = localDirOk ? await listLocalNominaFiles(dir) : [];
  const preferredYear = parseLocalNominaFileId(preferredId);

  let selected =
    localFiles.find((f) => f.year === preferredYear) ||
    localFiles.find((f) => f.year === 2026) ||
    localFiles[0] ||
    null;

  let sheets: HrNominaSheetInfo[] = [];
  if (selected) {
    try {
      const listed = await listSheetsFromLocalFile(selected.year);
      sheets = listed.sheets;
      selected = listed.file;
    } catch {
      sheets = [];
    }
  }

  const suggested = pickLatestNominaSheet(sheets);

  return {
    localConfigured: true,
    localDirOk,
    localFiles,
    selectedFileId: selected?.id ?? null,
    selectedFileName: selected?.label ?? null,
    selectedYear: selected?.year ?? null,
    sheets,
    suggestedSheet: suggested?.name ?? null,
    sourceLabel: 'Nóminas C50 (archivos)',
  };
}

export function formatLocalFileLabel(f: HrLocalNominaFile): string {
  return `${f.label} · ${f.year}`;
}
