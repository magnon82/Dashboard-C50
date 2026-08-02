/**
 * Lectura de nómina / base de datos personal (xlsx buffer o path opcional).
 * Fuente preferida: archivos locales (ver hr-payroll-local.ts).
 */

import { readFileSync } from 'fs';
import path from 'path';
import * as XLSXNS from 'xlsx';
import {
  HR_BASE_DATOS_XLSX,
  emptyDiasSemana,
  excelSerialToIso,
  isoFromUnknownDate,
  mergeDiasSemana,
  normalizePersonName,
  parseLooseNumber,
  sanitizePayrollDayMark,
  sumDiasSemana,
  type HrNominaSheetInfo,
  type HrPayrollDiasSemana,
  type HrPayrollLineInput,
} from '@/app/lib/hr-payroll';

/** xlsx CJS/ESM: en Node a veces las exports viven en `.default`. */
const XLSX =
  (XLSXNS as unknown as { default?: typeof XLSXNS }).default ?? XLSXNS;

const SECTION_NAMES = new Set(
  [
    'capitan',
    'caja',
    'cajas',
    'barra',
    'piso',
    'cocina',
    'hosstes',
    'hostess',
    'administracion',
    'administración',
    'gerentes',
    'totales generales',
    'mantenimiento',
    'comision',
    'comisiones',
    'propina',
    'propinas',
    'total',
    'totales',
    'efectivo',
    'transferencia',
    'nomina',
    'por sacar',
    'a transferir',
  ].map((s) => normalizePersonName(s))
);

function cellStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Normaliza encabezados sin reordenar tokens.
 * `normalizePersonName` ordena palabras (útil para nombres) y rompe aliases
 * como «nombre»⊃«no» (columna No.).
 */
function normalizeHeaderLabel(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function headerIndex(row: unknown[], ...aliases: string[]): number {
  const norms = aliases.map((a) => normalizeHeaderLabel(a)).filter(Boolean);
  if (!norms.length) return -1;

  // 1) Exacto
  for (let i = 0; i < row.length; i++) {
    const h = normalizeHeaderLabel(cellStr(row[i]));
    if (h && norms.includes(h)) return i;
  }

  // 2) Tokens: alias de una palabra = token exacto; multi-palabra = todos presentes
  for (let i = 0; i < row.length; i++) {
    const h = normalizeHeaderLabel(cellStr(row[i]));
    if (!h) continue;
    const hTokens = new Set(h.split(' ').filter(Boolean));
    for (const a of norms) {
      const aTokens = a.split(' ').filter(Boolean);
      if (!aTokens.length) continue;
      if (aTokens.length === 1) {
        if (hTokens.has(aTokens[0]!)) return i;
      } else if (aTokens.every((t) => hTokens.has(t))) {
        return i;
      }
    }
  }
  return -1;
}

function isSectionRow(name: string, puesto: string): boolean {
  if (!name) return true;
  if (puesto) return false;
  return SECTION_NAMES.has(normalizePersonName(name));
}

/** Columnas I–O (índices 8–14): marcas numéricas Lun–Dom del Excel. */
function readDiasSemanaFromRow(row: unknown[]): HrPayrollDiasSemana {
  const out = emptyDiasSemana();
  for (let i = 0; i < 7; i++) {
    out[i] = sanitizePayrollDayMark(parseLooseNumber(row[8 + i]));
  }
  return out;
}

function readWorkbook(filePathOrBuffer: string | Buffer): XLSXNS.WorkBook {
  if (typeof filePathOrBuffer === 'string') {
    if (typeof XLSX.readFile === 'function') {
      return XLSX.readFile(filePathOrBuffer, { cellDates: false });
    }
    return XLSX.read(readFileSync(filePathOrBuffer), {
      type: 'buffer',
      cellDates: false,
    });
  }
  return XLSX.read(filePathOrBuffer, { type: 'buffer', cellDates: false });
}

function sheetMatrix(wb: XLSXNS.WorkBook, sheetName: string): unknown[][] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
}

/** Meses en encabezado C50 (fila 2 col H): ENE, JUNIO-JULIO, JULIO-AGO, MAR- ABRIL… */
const SPANISH_MONTH_TOKEN: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  mzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

function normalizeMonthToken(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function parseSpanishMonthToken(raw: string): number | null {
  const t = normalizeMonthToken(raw);
  return t ? SPANISH_MONTH_TOKEN[t] ?? null : null;
}

/** Parsea «JUNIO», «ENE-FEB», «JULIO-AGO», «MAR- ABRIL». */
export function parseNominaMonthHeader(
  cell: string
): { startMonth: number; endMonth: number } | null {
  const s = cellStr(cell);
  if (!s) return null;
  const parts = s
    .split(/[-–/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const months = parts
    .map(parseSpanishMonthToken)
    .filter((m): m is number => m != null);
  if (!months.length) return null;
  return {
    startMonth: months[0]!,
    endMonth: months[months.length - 1]!,
  };
}

/** Nº de semana C50 = nombre de hoja («30», «SEM 30»). */
export function weekNumFromNominaSheetName(sheetName: string): number | null {
  const n = String(sheetName || '').trim();
  const m = n.match(/^(?:SEM\s*)?(\d{1,2})$/i);
  if (!m) return null;
  const num = Number(m[1]);
  return num >= 1 && num <= 60 ? num : null;
}

function isoDate(y: number, month: number, day: number): string {
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferWeekMeta(rows: unknown[][], sheetName: string): {
  weekLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
} {
  const r0 = rows[0] || [];
  const r1 = rows[1] || [];
  const r2 = rows[2] || [];

  // Prioridad: nombre de hoja C50 (1…N). No usar días del mes como nº de semana.
  let weekNum = weekNumFromNominaSheetName(sheetName);
  const titleBits: string[] = [];
  for (const c of r0) {
    const s = cellStr(c);
    if (s && /nomina|sem/i.test(s)) titleBits.push(s);
    if (weekNum == null) {
      const n = parseLooseNumber(c);
      if (n != null && n >= 1 && n <= 60 && Number.isInteger(n)) {
        weekNum = n;
      }
    }
  }

  const daySerials: number[] = [];
  // Días Lun–Dom en columnas I–O de la fila de encabezados (índice 2)
  for (let i = 8; i <= 14; i++) {
    const n = parseLooseNumber(r2[i]);
    if (n != null && n >= 1 && n <= 31) daySerials.push(n);
  }

  let year = 2026;
  const ym = sheetName.match(/\((\d{2})\)/);
  if (ym) year = 2000 + Number(ym[1]);
  else if (/20(2[0-9]|1[0-9])/.test(sheetName)) {
    const yHit = sheetName.match(/20\d{2}/);
    if (yHit) year = Number(yHit[0]);
  }

  for (const row of rows.slice(0, 4)) {
    for (const c of row || []) {
      const n = parseLooseNumber(c);
      if (n != null && n > 40000 && n < 60000) {
        const iso = excelSerialToIso(n);
        if (iso) year = Number(iso.slice(0, 4));
      }
    }
  }

  // Mes real del Excel (col H fila 2), no heurística por nº de semana.
  const monthHeader =
    parseNominaMonthHeader(cellStr(r1[7])) ||
    parseNominaMonthHeader(cellStr(r1[6])) ||
    parseNominaMonthHeader(cellStr(r1[8]));

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (daySerials.length > 0) {
    const startDay = daySerials[0]!;
    const endDay = daySerials[daySerials.length - 1]!;
    const wraps = endDay < startDay;

    let startMonth: number;
    let endMonth: number;
    if (monthHeader) {
      startMonth = monthHeader.startMonth;
      endMonth = wraps
        ? monthHeader.endMonth !== monthHeader.startMonth
          ? monthHeader.endMonth
          : monthHeader.startMonth === 12
            ? 1
            : monthHeader.startMonth + 1
        : monthHeader.startMonth;
    } else if (weekNum != null) {
      // Fallback legacy si falta el mes en el libro
      startMonth =
        weekNum <= 5
          ? 1
          : weekNum >= 48
            ? 12
            : Math.min(12, Math.max(1, Math.round((weekNum * 7) / 30.4)));
      endMonth = wraps
        ? startMonth === 12
          ? 1
          : startMonth + 1
        : startMonth;
    } else {
      startMonth = 1;
      endMonth = wraps ? 2 : 1;
    }

    const startY = year;
    const endY =
      wraps && endMonth < startMonth ? year + 1 : year;
    periodStart = isoDate(startY, startMonth, startDay);
    periodEnd = isoDate(endY, endMonth, endDay);
  }

  const weekLabel =
    weekNum != null
      ? `Semana ${weekNum} · ${year}`
      : /^SEM/i.test(sheetName)
        ? sheetName
        : titleBits[0] || sheetName;

  return { weekLabel, periodStart, periodEnd };
}

export function parseNominaSheetRows(
  rows: unknown[][],
  sheetName: string
): { meta: HrNominaSheetInfo; lines: HrPayrollLineInput[] } {
  const metaBase = inferWeekMeta(rows, sheetName);
  const headerRowIdx = rows.findIndex((r) => {
    const b = normalizeHeaderLabel(cellStr(r?.[1]));
    const a = normalizeHeaderLabel(cellStr(r?.[0]));
    return b === 'nombre' || (a === 'no' && b === 'nombre');
  });
  const header = headerRowIdx >= 0 ? rows[headerRowIdx] : [];
  const idx = {
    nombre: headerIndex(header, 'nombre') >= 0 ? headerIndex(header, 'nombre') : 1,
    puesto: headerIndex(header, 'puesto') >= 0 ? headerIndex(header, 'puesto') : 2,
    antiguedad: headerIndex(header, 'antiguedad', 'antigüedad'),
    vac: headerIndex(header, 'vacaciones'),
    tomadas: headerIndex(
      header,
      'dias tomados/pagados',
      'dias tomados',
      'días tomados'
    ),
    restantes: headerIndex(
      header,
      'dias retantes',
      'dias restantes',
      'días restantes'
    ),
    dias: headerIndex(header, 'dias trabajados', 'días trabajados'),
    // Solo «SUELDO DIARIO» (col ~17). Nunca «SUELDO SEMANAL» (col ~7):
    // ese alias hacía que la ficha guardara 2205 / 1300 en vez de 315.04.
    sd: headerIndex(header, 'sueldo diario'),
    he: headerIndex(header, 'horas extras', 'hora extra'),
    ret: headerIndex(header, 'retenciones'),
    bonos: headerIndex(header, 'bonos'),
    // Evitar match suelto «pagado» dentro de «dias tomados/pagados»
    pagado: headerIndex(header, 'importe pagado', 'total pagado', 'neto', 'pagado'),
  };

  const byName = new Map<string, HrPayrollLineInput>();

  for (let r = (headerRowIdx >= 0 ? headerRowIdx : 2) + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const full_name = cellStr(row[idx.nombre]);
    const puesto = cellStr(row[idx.puesto]);
    if (isSectionRow(full_name, puesto)) continue;
    if (!full_name || full_name.length < 3) continue;
    // Puesto numérico = fila de totales / comisión mal alineada
    if (puesto && /^-?\d+(\.\d+)?$/.test(puesto.replace(/,/g, ''))) continue;
    if (SECTION_NAMES.has(normalizePersonName(full_name))) continue;

    const importe = parseLooseNumber(row[idx.pagado >= 0 ? idx.pagado : 23]);
    const dias = parseLooseNumber(row[idx.dias >= 0 ? idx.dias : 16]);
    const sd = parseLooseNumber(row[idx.sd >= 0 ? idx.sd : 17]);
    const diasSemana = readDiasSemanaFromRow(row);
    const diasFromMarks = sumDiasSemana(diasSemana);
    const hasDayMarks = diasFromMarks > 0;
    // Filas vacías de plantilla
    if (
      (importe == null || importe === 0) &&
      (dias == null || dias === 0) &&
      !hasDayMarks &&
      !puesto
    ) {
      continue;
    }
    if (!puesto && (importe == null || importe === 0) && !hasDayMarks) continue;

    const key = normalizePersonName(full_name);
    const prev = byName.get(key);
    const mergedDays = mergeDiasSemana(prev?.dias_semana, diasSemana);
    const diasSum =
      (dias != null ? dias : hasDayMarks ? diasFromMarks : 0) +
      (prev?.dias_trabajados ?? 0);
    // Dual rol (p. ej. Mesero + Limpieza): conservar el SD más alto
    // (Mesero 315.04 > Limpieza 185.71), no el de la última fila.
    const prevSd =
      prev?.sueldo_diario != null ? Number(prev.sueldo_diario) : NaN;
    const curSd = sd != null ? Number(sd) : NaN;
    const sdCandidates = [prevSd, curSd].filter(
      (n) => Number.isFinite(n) && n > 0
    );
    const mergedSd =
      sdCandidates.length > 0
        ? Math.round(Math.max(...sdCandidates) * 100) / 100
        : (sd ?? prev?.sueldo_diario ?? null);
    const line: HrPayrollLineInput = {
      full_name: full_name.replace(/\s+/g, ' '),
      // Primer puesto del sheet (piso/barra antes que limpieza)
      puesto: prev?.puesto || puesto || null,
      sueldo_diario: mergedSd,
      dias_trabajados: diasSum,
      dias_semana: mergedDays,
      horas_extra:
        (parseLooseNumber(row[idx.he]) ?? 0) + (prev?.horas_extra ?? 0),
      bonos: (parseLooseNumber(row[idx.bonos]) ?? 0) + (prev?.bonos ?? 0),
      retenciones:
        (parseLooseNumber(row[idx.ret]) ?? 0) + (prev?.retenciones ?? 0),
      importe_pagado: (importe ?? 0) + (prev?.importe_pagado ?? 0),
      vacaciones_entitled:
        parseLooseNumber(row[idx.vac]) ?? prev?.vacaciones_entitled ?? null,
      vacaciones_tomadas:
        parseLooseNumber(row[idx.tomadas]) ?? prev?.vacaciones_tomadas ?? null,
      vacaciones_restantes:
        parseLooseNumber(row[idx.restantes]) ??
        prev?.vacaciones_restantes ??
        null,
      antiguedad:
        isoFromUnknownDate(row[idx.antiguedad]) || prev?.antiguedad || null,
      fecha_ingreso:
        isoFromUnknownDate(row[idx.antiguedad]) || prev?.fecha_ingreso || null,
      notes: prev?.notes || null,
    };
    byName.set(key, line);
  }

  const lines = [...byName.values()].filter(
    (l) =>
      (l.importe_pagado ?? 0) > 0 ||
      (l.dias_trabajados ?? 0) > 0 ||
      Boolean(l.puesto)
  );

  return {
    meta: {
      name: sheetName,
      weekLabel: metaBase.weekLabel,
      periodStart: metaBase.periodStart,
      periodEnd: metaBase.periodEnd,
      rowCount: lines.length,
    },
    lines,
  };
}

function isNominaWeekSheetName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (/^mant/i.test(n) || /aguinaldo/i.test(n)) return false;
  if (/ejercicio|base\s*datos|totales?/i.test(n)) return false;
  return /^SEM/i.test(n) || /^\d+$/.test(n);
}

export function listNominaSheets(filePathOrBuffer: string | Buffer): HrNominaSheetInfo[] {
  const wb = readWorkbook(filePathOrBuffer);
  const out: HrNominaSheetInfo[] = [];
  for (const name of wb.SheetNames) {
    if (!isNominaWeekSheetName(name)) continue;
    const rows = sheetMatrix(wb, name);
    const { meta } = parseNominaSheetRows(rows, name);
    if (meta.rowCount > 0 || /^SEM/i.test(name) || /^\d+$/.test(name)) {
      out.push(meta);
    }
  }
  return out;
}

export function importNominaSheet(
  filePathOrBuffer: string | Buffer,
  sheetName: string
): { meta: HrNominaSheetInfo; lines: HrPayrollLineInput[]; sourceLabel: string } {
  const wb = readWorkbook(filePathOrBuffer);
  if (!wb.SheetNames.includes(sheetName)) {
    throw new Error(`Hoja «${sheetName}» no encontrada en el archivo`);
  }
  const rows = sheetMatrix(wb, sheetName);
  const parsed = parseNominaSheetRows(rows, sheetName);
  const sourceLabel =
    typeof filePathOrBuffer === 'string'
      ? `${path.basename(filePathOrBuffer)}#${sheetName}`
      : `upload:${sheetName}`;
  return { ...parsed, sourceLabel };
}

export type BaseDatosRow = {
  full_name: string;
  status: 'activo' | 'baja';
  puesto: string | null;
  area: string | null;
  fecha_ingreso: string | null;
  fecha_nacimiento: string | null;
  sueldo_diario: number | null;
  phone: string | null;
  email: string | null;
};

export function parseBaseDatosPersonal(
  filePathOrBuffer: string | Buffer = HR_BASE_DATOS_XLSX
): BaseDatosRow[] {
  const wb = readWorkbook(filePathOrBuffer);
  const sheetName =
    wb.SheetNames.find((n) => /activo/i.test(n)) || wb.SheetNames[0];
  const rows = sheetMatrix(wb, sheetName);
  const headerIdx = rows.findIndex((r) =>
    normalizePersonName(cellStr(r?.[5] ?? r?.[4])).includes('nombre completo')
  );
  if (headerIdx < 0) return [];
  const header = rows[headerIdx];
  const iName = headerIndex(header, 'nombre completo');
  const iStatus = headerIndex(header, 'estatus');
  const iPuesto = headerIndex(header, 'puesto');
  const iDepto = headerIndex(header, 'departamento');
  const iIngreso = headerIndex(header, 'fecha de ingreso');
  const iNacimiento = headerIndex(
    header,
    'fecha de nacimiento',
    'fecha nacimiento'
  );
  const iSd = headerIndex(header, 's.d.', 'sd', 'sueldo diario');
  // Teléfono suele estar en columnas variables; buscar header
  const iPhone = headerIndex(header, 'telefono', 'teléfono', 'celular');

  const out: BaseDatosRow[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const full_name = cellStr(row[iName >= 0 ? iName : 5]);
    if (!full_name || full_name.length < 3) continue;
    const st = cellStr(row[iStatus >= 0 ? iStatus : 1]).toUpperCase();
    out.push({
      full_name: full_name.replace(/\s+/g, ' '),
      status: st.includes('BAJA') ? 'baja' : 'activo',
      puesto: cellStr(row[iPuesto]) || null,
      area: cellStr(row[iDepto]) || null,
      fecha_ingreso: isoFromUnknownDate(row[iIngreso]),
      fecha_nacimiento:
        iNacimiento >= 0 ? isoFromUnknownDate(row[iNacimiento]) : null,
      sueldo_diario: parseLooseNumber(row[iSd]),
      phone: iPhone >= 0 ? cellStr(row[iPhone]) || null : guessPhone(row),
      email: null,
    });
  }
  return out;
}

function guessPhone(row: unknown[]): string | null {
  for (const c of row) {
    const s = cellStr(c);
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 12 && /\d/.test(s)) {
      return s;
    }
  }
  return null;
}

/** CSV simple: cabeceras flexibles (nombre, puesto, sd, dias, importe, …). */
export function parsePayrollCsv(text: string): HrPayrollLineInput[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];

  const delim = lines[0].includes(';') ? ';' : ',';
  const split = (line: string) => {
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === delim && !q) {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };

  const header = split(lines[0]).map((h) => normalizePersonName(h));
  const col = (...aliases: string[]) => {
    const a = aliases.map((x) => normalizePersonName(x));
    return header.findIndex((h) => a.some((x) => h === x || h.includes(x)));
  };

  const iName = col('nombre', 'full_name', 'empleado', 'nombre completo');
  const iPuesto = col('puesto');
  const iArea = col('area', 'área', 'departamento');
  const iSd = col('sueldo_diario', 'sd', 'sueldo diario');
  const iDias = col('dias', 'dias_trabajados', 'días trabajados');
  const iImp = col('importe', 'importe_pagado', 'pagado');
  const iVacT = col('vacaciones_tomadas', 'dias tomados');
  const iVacR = col('vacaciones_restantes', 'dias restantes');
  const iVacE = col('vacaciones', 'vacaciones_entitled');

  if (iName < 0) {
    throw new Error(
      'CSV sin columna de nombre (nombre / full_name / empleado)'
    );
  }

  const out: HrPayrollLineInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    const full_name = cells[iName] || '';
    if (!full_name) continue;
    out.push({
      full_name,
      puesto: iPuesto >= 0 ? cells[iPuesto] || null : null,
      area: iArea >= 0 ? cells[iArea] || null : null,
      sueldo_diario: iSd >= 0 ? parseLooseNumber(cells[iSd]) : null,
      dias_trabajados: iDias >= 0 ? parseLooseNumber(cells[iDias]) ?? 0 : 0,
      importe_pagado: iImp >= 0 ? parseLooseNumber(cells[iImp]) ?? 0 : 0,
      vacaciones_tomadas: iVacT >= 0 ? parseLooseNumber(cells[iVacT]) : null,
      vacaciones_restantes: iVacR >= 0 ? parseLooseNumber(cells[iVacR]) : null,
      vacaciones_entitled: iVacE >= 0 ? parseLooseNumber(cells[iVacE]) : null,
      horas_extra: 0,
      bonos: 0,
      retenciones: 0,
    });
  }
  return out;
}

export function pickLatestNominaSheet(
  sheets: HrNominaSheetInfo[]
): HrNominaSheetInfo | null {
  if (!sheets.length) return null;
  const weekSheets = sheets.filter((s) => isNominaWeekSheetName(s.name));
  const pool = weekSheets.length ? weekSheets : sheets;
  // Última SEM *con líneas legibles* — una hoja vacía al final del libro no gana.
  const withLines = pool.filter((s) => (s.rowCount ?? 0) > 0);
  if (!withLines.length) return null;
  // Prefer SEM / hoja numérica con mayor número; "SEM 1 (22)" al final del libro
  const scored = withLines.map((s, i) => {
    const m22 = s.name.match(/SEM\s*(\d+)\s*\(22\)/i);
    if (m22) return { s, score: 1000 + Number(m22[1]), i };
    const m = s.name.match(/SEM\s*(\d+)/i);
    if (m) return { s, score: Number(m[1]), i };
    if (/^\d+$/.test(s.name.trim())) return { s, score: Number(s.name.trim()), i };
    // No semana: ranking bajo para no ganar a «30» / SEM N
    return { s, score: -1000 + i, i };
  });
  scored.sort((a, b) => b.score - a.score || b.i - a.i);
  return scored[0]?.s ?? null;
}
