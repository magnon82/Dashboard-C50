/**
 * Días de descanso obligatorio (LFT art. 74) + excepciones C50.
 * Usado para «días hábiles» (Lun–Vie sin asueto) en alertas RH.
 */

import { addIsoDays } from '@/app/lib/hr';

export type MxHolidayKind = 'oficial' | 'c50';

export type MxHoliday = {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  kind: MxHolidayKind;
  /**
   * Si true, no cuenta como día hábil administrativo
   * (asuetos oficiales). Eventos C50 (p. ej. 15 sep) pueden
   * listarse sin bloquear el conteo hábil.
   */
  blocksBusinessDay: boolean;
  note?: string;
};

/** Primer lunes del mes (month 1–12). */
function firstMondayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const wd = d.getUTCDay(); // 0=dom
  const add = wd === 1 ? 0 : wd === 0 ? 1 : 8 - wd;
  d.setUTCDate(1 + add);
  return d.toISOString().slice(0, 10);
}

/** Tercer lunes del mes (month 1–12). */
function thirdMondayOfMonth(year: number, month: number): string {
  const first = firstMondayOfMonth(year, month);
  return addIsoDays(first, 14);
}

function iso(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Asuetos oficiales del año + notas C50.
 * 15 sep (Noche Mexicana): en calendario C50 pero no bloquea hábil
 * (el asueto oficial es 16 sep). 25 dic / 1 ene: oficiales; apertura TBD.
 */
export function mxHolidaysForYear(year: number): MxHoliday[] {
  const list: MxHoliday[] = [
    {
      date: iso(year, 1, 1),
      name: 'Año Nuevo',
      kind: 'oficial',
      blocksBusinessDay: true,
      note: 'Apertura C50 por definir',
    },
    {
      date: firstMondayOfMonth(year, 2),
      name: 'Día de la Constitución',
      kind: 'oficial',
      blocksBusinessDay: true,
    },
    {
      date: thirdMondayOfMonth(year, 3),
      name: 'Natalicio de Benito Juárez',
      kind: 'oficial',
      blocksBusinessDay: true,
    },
    {
      date: iso(year, 5, 1),
      name: 'Día del Trabajo',
      kind: 'oficial',
      blocksBusinessDay: true,
    },
    {
      date: iso(year, 9, 15),
      name: 'Noche Mexicana (C50)',
      kind: 'c50',
      blocksBusinessDay: false,
      note: 'Evento C50 · asueto oficial al día siguiente (16 sep)',
    },
    {
      date: iso(year, 9, 16),
      name: 'Día de la Independencia',
      kind: 'oficial',
      blocksBusinessDay: true,
    },
    {
      date: thirdMondayOfMonth(year, 11),
      name: 'Día de la Revolución',
      kind: 'oficial',
      blocksBusinessDay: true,
    },
    {
      date: iso(year, 12, 25),
      name: 'Navidad',
      kind: 'oficial',
      blocksBusinessDay: true,
      note: 'Apertura C50 por definir',
    },
  ];

  // Transmisión del Poder Ejecutivo: 1 dic cada 6 años (años …2018, 2024, 2030…)
  if ((year - 2018) % 6 === 0) {
    list.push({
      date: iso(year, 12, 1),
      name: 'Transmisión del Poder Ejecutivo Federal',
      kind: 'oficial',
      blocksBusinessDay: true,
    });
  }

  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const holidayCache = new Map<number, MxHoliday[]>();

function holidaysCached(year: number): MxHoliday[] {
  let h = holidayCache.get(year);
  if (!h) {
    h = mxHolidaysForYear(year);
    holidayCache.set(year, h);
  }
  return h;
}

/** Asueto oficial que bloquea día hábil. */
export function isMxOfficialHoliday(isoDate: string): boolean {
  const d = isoDate.slice(0, 10);
  const year = Number(d.slice(0, 4));
  if (!year) return false;
  return holidaysCached(year).some(
    (h) => h.date === d && h.blocksBusinessDay
  );
}

/**
 * Día hábil administrativo: Lun–Vie y no asueto oficial LFT.
 * (Sáb/dom y asuetos no cuentan para «2 días hábiles antes».)
 */
export function isMxBusinessDay(isoDate: string): boolean {
  const d = isoDate.slice(0, 10);
  const dt = new Date(d + 'T12:00:00');
  if (Number.isNaN(dt.getTime())) return false;
  const wd = dt.getDay(); // 0=dom … 6=sáb
  if (wd === 0 || wd === 6) return false;
  return !isMxOfficialHoliday(d);
}

/** Suma (o resta si delta&lt;0) N días hábiles MX. */
export function addMxBusinessDays(isoDate: string, delta: number): string {
  if (delta === 0) return isoDate.slice(0, 10);
  const step = delta > 0 ? 1 : -1;
  let left = Math.abs(delta);
  let cur = isoDate.slice(0, 10);
  // Tope de seguridad (~1 año calendario)
  for (let i = 0; i < 400 && left > 0; i += 1) {
    cur = addIsoDays(cur, step);
    if (isMxBusinessDay(cur)) left -= 1;
  }
  return cur;
}

/** Fecha que está `n` días hábiles antes de `isoDate` (n≥1). */
export function mxBusinessDaysBefore(isoDate: string, n: number): string {
  return addMxBusinessDays(isoDate.slice(0, 10), -Math.max(0, n));
}
