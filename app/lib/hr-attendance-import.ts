/**
 * Parser flexible de xlsx del reloj checador → checadas.
 * Soporta hojas con columnas Nombre/Fecha/Entrada/Salida (o equivalentes)
 * y filas largas Nombre|Fecha|Hora|Tipo.
 */

import * as XLSXNS from 'xlsx';
import { addIsoDays } from '@/app/lib/hr';
import { mondayOfWeek, sundayOfWeek } from '@/app/lib/hr-schedule-propose';
import { parseHm, formatHmFromMinutes } from '@/app/lib/hr-attendance-policy';

const XLSX =
  (XLSXNS as unknown as { default?: typeof XLSXNS }).default ?? XLSXNS;

export type ParsedAttendancePunch = {
  employee_name_raw: string;
  punch_date: string; // YYYY-MM-DD
  punch_time: string; // HH:mm
  punch_kind: 'in' | 'out' | 'unknown';
};

export type ParsedAttendanceWorkbook = {
  punches: ParsedAttendancePunch[];
  week_start: string | null;
  week_end: string | null;
  week_number: number | null;
  sheetNames: string[];
  warnings: string[];
};

type ColMap = {
  name?: number;
  date?: number;
  time?: number;
  in?: number;
  out?: number;
  kind?: number;
};

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString();
  }
  return String(v).trim();
}

function normHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCols(headerRow: unknown[]): ColMap | null {
  const map: ColMap = {};
  for (let i = 0; i < headerRow.length; i += 1) {
    const h = normHeader(cellStr(headerRow[i]));
    if (!h) continue;
    if (
      map.name == null &&
      (/nombre|empleado|trabajador|name|colaborador/.test(h) ||
        h === 'persona')
    ) {
      map.name = i;
    } else if (
      map.date == null &&
      (/^fecha$|fecha checada|punch date|date/.test(h) || h.includes('fecha'))
    ) {
      map.date = i;
    } else if (
      map.time == null &&
      (/^hora$|hora checada|time|datetime|fecha.?hora/.test(h) ||
        h === 'checada')
    ) {
      map.time = i;
    } else if (
      map.in == null &&
      (/entrada|check.?in|clock.?in|hora entrada|in\b/.test(h) ||
        h === 'ent')
    ) {
      map.in = i;
    } else if (
      map.out == null &&
      (/salida|check.?out|clock.?out|hora salida|out\b/.test(h) ||
        h === 'sal')
    ) {
      map.out = i;
    } else if (
      map.kind == null &&
      (/tipo|estado|io|sentido|verif/.test(h) || h === 'e/s')
    ) {
      map.kind = i;
    }
  }
  if (map.name == null) return null;
  if (map.in == null && map.out == null && map.time == null && map.date == null) {
    return null;
  }
  return map;
}

function parseIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    let y = m[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo}-${d}`;
  }
  // Excel serial as string number
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
      return epoch.toISOString().slice(0, 10);
    }
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function parseTimeLoose(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^[-—–]$/.test(s)) return null;
  const hm = parseHm(s);
  if (hm != null) return formatHmFromMinutes(hm);
  // 8.30 excel-ish or 830
  const m = s.match(/^(\d{1,2})[.:]?(\d{2})\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  // datetime string → time
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const space = s.match(/\s(\d{1,2}):(\d{2})/);
  if (space) {
    return `${space[1].padStart(2, '0')}:${space[2]}`;
  }
  return null;
}

function kindFromLabel(raw: string): 'in' | 'out' | 'unknown' {
  const h = normHeader(raw);
  if (/entrada|check.?in|in\b|entry|llegada/.test(h)) return 'in';
  if (/salida|check.?out|out\b|exit|retiro/.test(h)) return 'out';
  return 'unknown';
}

function inferWeekNumber(filename: string, punches: ParsedAttendancePunch[]): number | null {
  const m = filename.match(/sem(?:ana)?\s*[_-]?\s*(\d{1,2})/i);
  if (m) return Number(m[1]);
  if (punches.length === 0) return null;
  const dates = punches.map((p) => p.punch_date).sort();
  const mid = dates[Math.floor(dates.length / 2)];
  const d = new Date(mid + 'T12:00:00');
  // ISO week
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function sheetMatrix(wb: XLSXNS.WorkBook, sheetName: string): unknown[][] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  }) as unknown[][];
}

function parseSheet(
  rows: unknown[][],
  warnings: string[],
  sheetName: string
): ParsedAttendancePunch[] {
  if (rows.length < 2) return [];

  let headerIdx = -1;
  let cols: ColMap | null = null;
  for (let i = 0; i < Math.min(15, rows.length); i += 1) {
    const c = detectCols(rows[i] || []);
    if (c) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (!cols || headerIdx < 0) {
    warnings.push(`Hoja «${sheetName}»: no se detectaron columnas de asistencia`);
    return [];
  }

  const out: ParsedAttendancePunch[] = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const name = cellStr(row[cols.name!]);
    if (!name || /^total/i.test(name)) continue;

    // Wide: Entrada + Salida (+ Fecha)
    if (cols.in != null || cols.out != null) {
      const dateRaw =
        cols.date != null ? cellStr(row[cols.date]) : cellStr(row[0]);
      const date = parseIsoDate(dateRaw);
      if (!date) continue;
      if (cols.in != null) {
        const t = parseTimeLoose(cellStr(row[cols.in]));
        if (t) {
          out.push({
            employee_name_raw: name,
            punch_date: date,
            punch_time: t,
            punch_kind: 'in',
          });
        }
      }
      if (cols.out != null) {
        const t = parseTimeLoose(cellStr(row[cols.out]));
        if (t) {
          out.push({
            employee_name_raw: name,
            punch_date: date,
            punch_time: t,
            punch_kind: 'out',
          });
        }
      }
      continue;
    }

    // Long: Fecha + Hora (+ Tipo)
    if (cols.date != null && cols.time != null) {
      const date = parseIsoDate(cellStr(row[cols.date]));
      let time = parseTimeLoose(cellStr(row[cols.time]));
      // Sometimes date cell is datetime and time empty
      if (!time) {
        const combined = cellStr(row[cols.date]);
        time = parseTimeLoose(combined);
      }
      if (!date || !time) continue;
      const kind =
        cols.kind != null
          ? kindFromLabel(cellStr(row[cols.kind]))
          : 'unknown';
      out.push({
        employee_name_raw: name,
        punch_date: date,
        punch_time: time,
        punch_kind: kind,
      });
    }
  }
  return out;
}

export function parseAttendanceWorkbook(
  buffer: Buffer,
  opts?: { filename?: string }
): ParsedAttendanceWorkbook {
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetNames = wb.SheetNames || [];
  const punches: ParsedAttendancePunch[] = [];

  for (const name of sheetNames) {
    const rows = sheetMatrix(wb, name);
    punches.push(...parseSheet(rows, warnings, name));
  }

  // Deduplicate exact punches
  const seen = new Set<string>();
  const unique: ParsedAttendancePunch[] = [];
  for (const p of punches) {
    const key = `${p.employee_name_raw}|${p.punch_date}|${p.punch_time}|${p.punch_kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  let week_start: string | null = null;
  let week_end: string | null = null;
  if (unique.length) {
    const dates = unique.map((p) => p.punch_date).sort();
    week_start = mondayOfWeek(dates[0]);
    week_end = sundayOfWeek(week_start);
    // If punches span beyond one week, expand to cover min..max Monday range
    const lastMon = mondayOfWeek(dates[dates.length - 1]);
    if (lastMon > week_start) {
      week_end = sundayOfWeek(lastMon);
    }
  }

  const week_number = inferWeekNumber(opts?.filename || '', unique);

  if (unique.length === 0) {
    warnings.push(
      'No se extrajeron checadas. Revisa que el xlsx tenga columnas Nombre, Fecha, Entrada/Salida (o Hora).'
    );
  }

  return {
    punches: unique,
    week_start,
    week_end: week_end || (week_start ? addIsoDays(week_start, 6) : null),
    week_number,
    sheetNames,
    warnings,
  };
}
