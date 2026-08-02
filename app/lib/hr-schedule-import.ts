/**
 * Parser de HORARIOS C50 *.xlsx → semanas / turnos.
 * Hojas «SEMANA N»: fila 7 días (Lun–Dom), col A nombres, pares Ent./Sal.
 * Conserva horas reales del sheet (no reescribe a esqueleto 48h/cena).
 */

import * as XLSX from 'xlsx';
import { addIsoDays, todayIsoCdmx } from '@/app/lib/hr';
import { mondayOfWeek, sundayOfWeek } from '@/app/lib/hr-schedule-propose';
import { normalizePersonName } from '@/app/lib/hr-payroll';
import { matchEmployeeId as matchEmployeeIdCore } from '@/app/lib/hr-person-match';

/** Lunes de SEMANA 1 2026 en el archivo C50. */
export const HR_HORARIOS_2026_WEEK1_MONDAY = '2026-01-05';

const SECTION_NAMES = new Set(
  [
    'gerencia',
    'hostess',
    'caja',
    'barra',
    'meseros',
    'runner',
    'cocina',
    'limpieza',
    'mantenimiento',
    'administracion',
    'administración',
    'captura',
    'capitan',
    'capitán',
    'etc',
    'ent.',
    'sal.',
    'ent',
    'sal',
  ].map((s) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  )
);

const AREA_HEADERS: { match: RegExp; area: string }[] = [
  { match: /^gerencia$/i, area: 'Gerencia' },
  { match: /^hostess$/i, area: 'Hostess' },
  { match: /^caja$/i, area: 'Caja' },
  { match: /^barra$/i, area: 'Barra' },
  { match: /^meseros$/i, area: 'Meseros' },
  { match: /^runner$/i, area: 'Runner' },
  { match: /^cocina$/i, area: 'Cocina' },
  { match: /^limpieza$/i, area: 'Limpieza' },
  { match: /^mantenimiento$/i, area: 'Mantenimiento' },
  { match: /^administraci[oó]n$/i, area: 'Administración' },
];

export type ParsedScheduleShift = {
  employee_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  area: string | null;
};

export type ParsedScheduleWeek = {
  sheetName: string;
  weekNumber: number;
  week_start: string;
  week_end: string;
  periodLabel: string | null;
  shifts: ParsedScheduleShift[];
  /** Nombres con al menos un turno */
  people: string[];
};

export type HorariosWorkbookSummary = {
  year: number;
  sheets: { name: string; weekNumber: number | null; isWeek: boolean }[];
  weekSheets: string[];
};

/**
 * SheetJS solo deja el valor en la celda superior-izquierda del merge.
 * En GERENCIA el nombre (col A) suele ir mergeado 2 filas y las horas
 * quedan en la fila inferior sin nombre → hay que rellenar antes de parsear.
 */
function fillMergedCellValues(ws: XLSX.WorkSheet): void {
  const merges = ws['!merges'];
  if (!merges?.length) return;
  for (const m of merges) {
    const topAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
    const top = ws[topAddr];
    if (!top || top.v == null || top.v === '') continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v != null && cell.v !== '') continue;
        ws[addr] = { t: top.t || 's', v: top.v, w: top.w };
      }
    }
  }
}

function sheetRows(ws: XLSX.WorkSheet): unknown[][] {
  fillMergedCellValues(ws);
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v instanceof Date) return '';
  return String(v).trim();
}

/** Excel time serial / Date / "HH:MM" → "HH:MM:SS". */
export function cellToTime(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    // SheetJS cellDates: use local wall-clock (UTC skews midnight → 06:00 in MX).
    const lh = v.getHours();
    const lm = v.getMinutes();
    const ls = v.getSeconds();
    return `${String(lh).padStart(2, '0')}:${String(lm).padStart(2, '0')}:${String(ls).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Fraction of day (Excel) — also tolerate full datetime serials
    let frac = v;
    if (v >= 1) frac = v % 1;
    const totalSec = Math.round(frac * 24 * 60 * 60);
    const hh = Math.floor(totalSec / 3600) % 24;
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (isOffMarker(s)) return null;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) {
      return `${m[1].padStart(2, '0')}:${m[2]}:${(m[3] || '00').padStart(2, '0')}`;
    }
  }
  return null;
}

function isOffMarker(v: unknown): boolean {
  const s = cellStr(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!s) return false;
  return (
    s === 'x' ||
    s === 'descanso' ||
    s === 'off' ||
    s.startsWith('descanso') ||
    s === '-'
  );
}

function cleanPersonName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // "RobertoRamirez" → "Roberto Ramirez"
  s = s.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2');
  return s;
}

function isSectionOrPlaceholder(name: string): boolean {
  const key = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
  if (!key || key.length < 2) return true;
  if (SECTION_NAMES.has(key)) return true;
  // Role placeholders without surname
  if (/^(mesero|bartender|hostess|cajera?|gerente)\s*\d*$/i.test(name)) {
    return true;
  }
  return false;
}

function detectAreaHeader(name: string): string | null {
  const t = name.trim();
  for (const h of AREA_HEADERS) {
    if (h.match.test(t)) return h.area;
  }
  return null;
}

function parseWeekNumber(sheetName: string, cellB3: unknown): number | null {
  const fromName = /semana\s*(\d+)/i.exec(sheetName);
  if (fromName) return Number(fromName[1]);
  if (typeof cellB3 === 'number' && Number.isFinite(cellB3)) {
    return Math.round(cellB3);
  }
  const n = Number(cellStr(cellB3));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Ancla: SEMANA 1 = lunes 2026-01-05 (y homologables por año).
 * Para otros años: primer lunes del año civil si no hay ancla conocida.
 */
export function weekStartForHorariosSheet(
  year: number,
  weekNumber: number
): string {
  if (year === 2026) {
    return addIsoDays(HR_HORARIOS_2026_WEEK1_MONDAY, (weekNumber - 1) * 7);
  }
  // Primer lunes del año
  let d = `${year}-01-01`;
  d = mondayOfWeek(d);
  if (d.slice(0, 4) !== String(year)) {
    d = addIsoDays(d, 7);
  }
  return addIsoDays(d, (weekNumber - 1) * 7);
}

/** Nº SEMANA C50 a partir del lunes de semana (homologable por año). */
export function weekNumberForHorariosMonday(weekStart: string): number | null {
  const monday = weekStart.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) return null;
  const year = Number(monday.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const week1 = weekStartForHorariosSheet(year, 1);
  const a = new Date(week1 + 'T12:00:00').getTime();
  const b = new Date(monday + 'T12:00:00').getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days < 0 || days % 7 !== 0) return null;
  return Math.floor(days / 7) + 1;
}

/** Columnas Ent/Sal: Lun=B/C … Dom=N/O (0-based: 1/2 … 13/14). */
const DAY_COL_PAIRS: { ent: number; sal: number; offset: number }[] = [
  { ent: 1, sal: 2, offset: 0 }, // Lun
  { ent: 3, sal: 4, offset: 1 },
  { ent: 5, sal: 6, offset: 2 },
  { ent: 7, sal: 8, offset: 3 },
  { ent: 9, sal: 10, offset: 4 },
  { ent: 11, sal: 12, offset: 5 }, // Sáb
  { ent: 13, sal: 14, offset: 6 }, // Dom
];

function headerHasDomingo(row7: unknown[]): boolean {
  for (let c = 0; c < Math.min(row7.length, 16); c++) {
    const s = cellStr(row7[c])
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (s.startsWith('domingo')) return true;
  }
  return false;
}

export function summarizeHorariosWorkbook(
  buffer: Buffer,
  yearHint?: number
): HorariosWorkbookSummary {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheets = wb.SheetNames.map((name) => {
    const weekNumber = /semana\s*(\d+)/i.test(name)
      ? Number(/semana\s*(\d+)/i.exec(name)![1])
      : null;
    return {
      name,
      weekNumber,
      isWeek: weekNumber != null,
    };
  });
  const year =
    yearHint ||
    (() => {
      for (const n of wb.SheetNames) {
        const m = /20\d{2}/.exec(n);
        if (m) return Number(m[0]);
      }
      return 2026;
    })();
  return {
    year,
    sheets,
    weekSheets: sheets.filter((s) => s.isWeek).map((s) => s.name),
  };
}

export function parseHorariosWeekSheet(
  ws: XLSX.WorkSheet,
  sheetName: string,
  year: number
): ParsedScheduleWeek | null {
  const rows = sheetRows(ws);
  if (rows.length < 9) return null;

  const weekNumber = parseWeekNumber(sheetName, rows[2]?.[1]);
  if (weekNumber == null || weekNumber < 1) return null;

  const week_start = weekStartForHorariosSheet(year, weekNumber);
  const week_end = sundayOfWeek(week_start);
  const periodLabel = cellStr(rows[4]?.[1]) || null;
  const row7 = rows[6] || [];
  const includeSunday = headerHasDomingo(row7);

  const pairs = includeSunday
    ? DAY_COL_PAIRS
    : DAY_COL_PAIRS.filter((p) => p.offset < 6);

  const shifts: ParsedScheduleShift[] = [];
  const peopleSet = new Set<string>();
  let currentArea: string | null = null;

  for (let r = 7; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawName = cellStr(row[0]);
    if (!rawName) continue;

    const areaHeader = detectAreaHeader(rawName);
    if (areaHeader) {
      currentArea = areaHeader;
      continue;
    }

    const name = cleanPersonName(rawName);
    if (isSectionOrPlaceholder(name)) continue;

    // ¿Algún Ent./Sal. con hora o off?
    let anyShift = false;
    for (const pair of pairs) {
      const entCell = row[pair.ent];
      const salCell = row[pair.sal];
      if (isOffMarker(entCell) || isOffMarker(salCell)) continue;
      const start = cellToTime(entCell);
      const end = cellToTime(salCell);
      if (!start || !end) continue;
      const shift_date = addIsoDays(week_start, pair.offset);
      shifts.push({
        employee_name: name,
        shift_date,
        start_time: start,
        end_time: end,
        area: currentArea,
      });
      anyShift = true;
    }
    if (anyShift) peopleSet.add(name);
  }

  return {
    sheetName,
    weekNumber,
    week_start,
    week_end,
    periodLabel,
    shifts,
    people: [...peopleSet],
  };
}

export function parseAllHorariosWeeks(
  buffer: Buffer,
  year: number
): ParsedScheduleWeek[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const out: ParsedScheduleWeek[] = [];
  for (const name of wb.SheetNames) {
    if (!/^semana\s*\d+/i.test(name)) continue;
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const parsed = parseHorariosWeekSheet(ws, name, year);
    if (parsed && parsed.shifts.length > 0) out.push(parsed);
  }
  out.sort((a, b) => a.weekNumber - b.weekNumber);
  return out;
}

/**
 * Semanas pasadas y en curso (lunes ISO CDMX) → publicado;
 * solo futuras → borrador (permanecen hasta Publicar explícito; Guardar no publica).
 * No fuerza borrador en la semana en curso.
 */
export function statusForImportedWeek(
  weekStart: string,
  today = todayIsoCdmx()
): 'publicado' | 'borrador' {
  const currentMon = mondayOfWeek(today);
  return weekStart <= currentMon ? 'publicado' : 'borrador';
}

/** Matching de nombre vía `hr-person-match` (exacto / nicknames / fuzzy único). */
export function matchEmployeeId(
  name: string,
  byKey: Map<string, { id: string; full_name: string }>,
  all: { id: string; full_name: string }[]
): string | null {
  return matchEmployeeIdCore(name, byKey, all);
}
