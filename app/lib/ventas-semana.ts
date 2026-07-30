const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export interface FinancialRecord {
  id: string;
  date: string;
  type: 'income' | 'expense' | 'commission';
  category: string;
  amount: number;
  description: string;
  source_file?: string | null;
}

export interface WeekSale {
  year: number;
  week: number;
  total: number;
  eventos: number;
  ventaWi: number;
  mes?: string;
  label?: string;
  mondayKey?: string;
}

export function parseIsoDate(iso: string): { y: number; m: number; d: number; key: string } | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), key: `${m[1]}-${m[2]}-${m[3]}` };
}

export function mondayOf(iso: string): Date {
  const p = parseIsoDate(iso)!;
  const d = new Date(p.y, p.m - 1, p.d);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Primer lunes en o después del 1 de enero — igual que Acumulado ventas x semana */
export function firstMondayOnOrAfterJan1(year: number): Date {
  const d = new Date(year, 0, 1, 12, 0, 0);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

/** # de semana alineado al Excel Acumulado ventas x semana */
export function acumuladoWeekForDate(iso: string): number {
  const p = parseIsoDate(iso);
  if (!p) return 0;
  const week1Mon = firstMondayOnOrAfterJan1(p.y);
  const dayMon = mondayOf(iso);
  const diffDays = Math.round((dayMon.getTime() - week1Mon.getTime()) / 86400000);
  if (diffDays < 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

export function weekMondayIso(year: number, week: number): string {
  const mon = firstMondayOnOrAfterJan1(year);
  mon.setDate(mon.getDate() + (week - 1) * 7);
  return toIsoLocal(mon);
}

export function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatShort(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

export function formatLongDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const d = new Date(p.y, p.m - 1, p.d);
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function sundayOfWeek(mondayKey: string): string {
  const mon = mondayOf(mondayKey);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return toIsoLocal(sun);
}

function parseVentasSemanaDesc(desc: string): { year: number; week: number; mes?: string } | null {
  const m = desc.match(/^(\d{4})\s+Semana\s+(\d+)\s*(?:[·\u00b7]\s*(.+))?/);
  if (!m) return null;
  return { year: Number(m[1]), week: Number(m[2]), mes: m[3]?.trim() };
}

function emptyWeek(year: number, week: number, mes?: string): WeekSale {
  const monKey = weekMondayIso(year, week);
  const sun = sundayOfWeek(monKey);
  return {
    year,
    week,
    total: 0,
    eventos: 0,
    ventaWi: 0,
    mes,
    mondayKey: monKey,
    label: `${formatShort(monKey)} – ${formatShort(sun)}`,
  };
}

function finalizeWeek(w: WeekSale): WeekSale {
  if (w.total > 0) {
    w.ventaWi = Math.max(0, w.total - w.eventos);
  } else if (w.ventaWi > 0 || w.eventos > 0) {
    w.total = w.ventaWi + w.eventos;
  }
  return w;
}

/** Histórico semanal desde Acumulado (ventas_semana) */
export function weeklyFromVentasSemana(records: FinancialRecord[]): Map<string, WeekSale> {
  const map = new Map<string, WeekSale>();

  for (const r of records) {
    if (r.source_file !== 'ventas_semana') continue;
    const meta = parseVentasSemanaDesc(r.description || '');
    if (!meta) continue;

    const key = `${meta.year}-${meta.week}`;
    const cur = map.get(key) || emptyWeek(meta.year, meta.week, meta.mes);
    const amt = Number(r.amount);

    if (r.category === 'TOTAL') {
      cur.total = amt;
    } else if (r.category === 'Eventos') {
      cur.eventos += amt;
    } else if (r.category === 'Venta WI') {
      cur.ventaWi += amt;
    } else {
      cur.total += amt;
    }

    if (meta.mes) cur.mes = meta.mes;
    map.set(key, cur);
  }

  map.forEach((w, k) => map.set(k, finalizeWeek(w)));
  return map;
}

/** Eventos diarios → semana acumulado */
export function weeklyEventosFromRecords(records: FinancialRecord[], year: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of records) {
    if (r.source_file !== 'eventos' || r.category !== 'Eventos') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year) continue;
    const week = acumuladoWeekForDate(r.date);
    if (week <= 0) continue;
    map.set(week, (map.get(week) || 0) + Number(r.amount));
  }
  return map;
}

/** Infocaja diaria → semanas (total = Venta Total; WI = total − eventos) */
export function weeklyFromInfocaja(
  records: FinancialRecord[],
  year: number,
  eventosByWeek?: Map<number, number>
): Map<number, WeekSale> {
  const daily = records.filter(
    (r) =>
      r.source_file === 'infocaja' &&
      r.category === 'Venta Total' &&
      parseIsoDate(r.date)?.y === year
  );

  const map = new Map<number, WeekSale>();

  for (const r of daily) {
    const p = parseIsoDate(r.date);
    if (!p) continue;
    const week = acumuladoWeekForDate(r.date);
    if (week <= 0) continue;

    const cur = map.get(week) || emptyWeek(year, week, MESES[p.m - 1]);
    cur.total += Number(r.amount);
    cur.mes = MESES[p.m - 1];
    map.set(week, cur);
  }

  map.forEach((w, week) => {
    const ev = eventosByWeek?.get(week) ?? w.eventos;
    w.eventos = ev;
    w.ventaWi = Math.max(0, w.total - ev);
    map.set(week, finalizeWeek(w));
  });

  return map;
}

export function buildWeeklySalesByYear(
  records: FinancialRecord[],
  years: number[]
): Map<number, Map<number, WeekSale>> {
  const ventasSemana = weeklyFromVentasSemana(records);
  const byYear = new Map<number, Map<number, WeekSale>>();

  for (const y of years) {
    const yearMap = new Map<number, WeekSale>();
    const eventosByWeek = weeklyEventosFromRecords(records, y);

    ventasSemana.forEach((row) => {
      if (row.year !== y) return;
      const ev = eventosByWeek.get(row.week) ?? row.eventos;
      yearMap.set(row.week, finalizeWeek({ ...row, eventos: ev, ventaWi: Math.max(0, row.total - ev) }));
    });

    const infocaja = weeklyFromInfocaja(records, y, eventosByWeek);
    infocaja.forEach((row) => {
      if (row.total > 0) yearMap.set(row.week, row);
    });

    if (yearMap.size > 0) byYear.set(y, yearMap);
  }

  return byYear;
}

export function weeklyAverage(weeks: WeekSale[]): number {
  const withData = weeks.filter((w) => w.total > 0);
  if (!withData.length) return 0;
  return withData.reduce((a, w) => a + w.total, 0) / withData.length;
}

export function buildWeeklyComparisonChart(
  byYear: Map<number, Map<number, WeekSale>>,
  compareYears: number[],
  primaryYear: number
): { rows: Record<string, string | number>[]; categories: string[]; maxWeek: number } {
  const categories = compareYears.map(String);

  let maxWeek = 0;
  compareYears.forEach((y) => {
    byYear.get(y)?.forEach((_, w) => {
      if (w > maxWeek) maxWeek = w;
    });
  });

  const rows: Record<string, string | number>[] = [];

  for (let w = 1; w <= maxWeek; w++) {
    const label = `S${w}`;

    const row: Record<string, string | number> = { semana: label, n: w };
    let hasValue = false;

    for (const y of compareYears) {
      const val = byYear.get(y)?.get(w)?.total ?? 0;
      row[String(y)] = val > 0 ? Number(val.toFixed(2)) : 0;
      if (val > 0) hasValue = true;
    }

    if (hasValue) rows.push(row);
  }

  return { rows, categories, maxWeek };
}

export function lastCompleteWeekSunday(records: FinancialRecord[], year: number): string | null {
  const daily = records
    .filter(
      (r) =>
        r.source_file === 'infocaja' &&
        r.category === 'Venta Total' &&
        parseIsoDate(r.date)?.y === year
    )
    .map((r) => parseIsoDate(r.date)!.key)
    .sort();

  if (!daily.length) return null;

  const maxKey = daily[daily.length - 1];
  const monKey = toIsoLocal(mondayOf(maxKey));
  const sunKey = sundayOfWeek(monKey);

  if (maxKey >= sunKey) return sunKey;

  const prevMon = mondayOf(monKey);
  prevMon.setDate(prevMon.getDate() - 7);
  return sundayOfWeek(toIsoLocal(prevMon));
}

export interface MonthSale {
  year: number;
  month: number;
  mes: string;
  total: number;
  eventos: number;
  ventaWi: number;
}

export function mesToIndex(mes?: string): number {
  if (!mes) return 0;
  const i = MESES.indexOf(mes);
  return i >= 0 ? i + 1 : 0;
}

export interface MonthWeeklyAvg {
  year: number;
  month: number;
  mes: string;
  /** Promedio de venta semanal dentro del mes (Acumulado) */
  promSemanal: number;
  semanas: number;
  totalMes: number;
}

/** Promedio venta semanal por mes — igual que pestaña Acumulado ventas x semana */
export function buildMonthlyWeeklyAverageByYear(
  weeklyByYear: Map<number, Map<number, WeekSale>>,
  years: number[]
): Map<number, Map<number, MonthWeeklyAvg>> {
  const result = new Map<number, Map<number, MonthWeeklyAvg>>();

  for (const y of years) {
    const buckets = new Map<number, number[]>();

    weeklyByYear.get(y)?.forEach((week) => {
      if (week.total <= 0) return;
      const monthIdx = mesToIndex(week.mes);
      if (monthIdx <= 0) return;
      const arr = buckets.get(monthIdx) || [];
      arr.push(week.total);
      buckets.set(monthIdx, arr);
    });

    const monthMap = new Map<number, MonthWeeklyAvg>();
    buckets.forEach((totals, monthIdx) => {
      if (!totals.length) return;
      const totalMes = totals.reduce((a, t) => a + t, 0);
      monthMap.set(monthIdx, {
        year: y,
        month: monthIdx,
        mes: MESES[monthIdx - 1],
        promSemanal: totalMes / totals.length,
        semanas: totals.length,
        totalMes,
      });
    });

    if (monthMap.size > 0) result.set(y, monthMap);
  }

  return result;
}

export function buildMonthlyAvgChartRows(
  monthlyAvgByYear: Map<number, Map<number, MonthWeeklyAvg>>,
  compareYears: number[]
): Record<string, string | number | null>[] {
  return MESES.map((mes, i) => {
    const monthIdx = i + 1;
    const row: Record<string, string | number | null> = { mes, monthIdx };
    for (const y of compareYears) {
      const val = monthlyAvgByYear.get(y)?.get(monthIdx)?.promSemanal ?? 0;
      row[String(y)] = val > 0 ? Number(val.toFixed(2)) : null;
    }
    return row;
  });
}

/** Promedio anual del promedio semanal mensual (meses con datos) */
export function yearWeeklyAverageFromMonthly(
  monthlyAvgByYear: Map<number, Map<number, MonthWeeklyAvg>>,
  year: number
): number {
  const months = monthlyAvgByYear.get(year);
  if (!months) return 0;
  const vals = Array.from(months.values()).filter((m) => m.promSemanal > 0);
  if (!vals.length) return 0;
  return vals.reduce((a, m) => a + m.promSemanal, 0) / vals.length;
}

/** Ventas mensuales por año — semanas Acumulado + Infocaja diario */
export function buildMonthlySalesByYear(
  records: FinancialRecord[],
  weeklyByYear: Map<number, Map<number, WeekSale>>,
  years: number[]
): Map<number, Map<number, MonthSale>> {
  const result = new Map<number, Map<number, MonthSale>>();

  for (const y of years) {
    const monthMap = new Map<number, MonthSale>();

    const weekMap = weeklyByYear.get(y);
    weekMap?.forEach((week) => {
      if (week.total <= 0) return;
      const monthIdx = mesToIndex(week.mes);
      if (monthIdx <= 0) return;
      const cur =
        monthMap.get(monthIdx) ||
        ({
          year: y,
          month: monthIdx,
          mes: MESES[monthIdx - 1],
          total: 0,
          eventos: 0,
          ventaWi: 0,
        } satisfies MonthSale);
      cur.total += week.total;
      cur.eventos += week.eventos;
      cur.ventaWi += week.ventaWi;
      monthMap.set(monthIdx, cur);
    });

    // Infocaja diario sobrescribe meses con días registrados (año en curso)
    const eventosMes = new Map<number, number>();
    records.forEach((r) => {
      if (r.source_file !== 'eventos' || r.category !== 'Eventos') return;
      const p = parseIsoDate(r.date);
      if (!p || p.y !== y) return;
      eventosMes.set(p.m, (eventosMes.get(p.m) || 0) + Number(r.amount));
    });

    const infocajaMes = new Map<number, number>();
    records.forEach((r) => {
      if (r.source_file !== 'infocaja' || r.category !== 'Venta Total') return;
      const p = parseIsoDate(r.date);
      if (!p || p.y !== y) return;
      infocajaMes.set(p.m, (infocajaMes.get(p.m) || 0) + Number(r.amount));
    });

    infocajaMes.forEach((total, monthIdx) => {
      if (total <= 0) return;
      const existing = monthMap.get(monthIdx);
      const currentYear = new Date().getFullYear();
      // Histórico: conservar suma semanal del Acumulado si ya existe
      if (existing && existing.total > 0 && y !== currentYear) return;

      const ev = eventosMes.get(monthIdx) || 0;
      monthMap.set(monthIdx, {
        year: y,
        month: monthIdx,
        mes: MESES[monthIdx - 1],
        total,
        eventos: ev,
        ventaWi: Math.max(0, total - ev),
      });
    });

    if (monthMap.size > 0) result.set(y, monthMap);
  }

  return result;
}

export function buildMonthlyComparisonRows(
  monthlyByYear: Map<number, Map<number, MonthSale>>,
  compareYears: number[]
): Record<string, string | number | null>[] {
  return MESES.map((mes, i) => {
    const monthIdx = i + 1;
    const row: Record<string, string | number | null> = { mes, monthIdx };
    for (const y of compareYears) {
      const val = monthlyByYear.get(y)?.get(monthIdx)?.total ?? 0;
      row[String(y)] = val > 0 ? Number(val.toFixed(2)) : null;
    }
    return row;
  });
}

/** Filas para gráfica comparativa de ventas totales por mes */
export function buildMonthlyTotalChartRows(
  monthlyByYear: Map<number, Map<number, MonthSale>>,
  compareYears: number[],
  monthFilter: number | null = null
): Record<string, string | number>[] {
  const monthIndexes =
    monthFilter !== null ? [monthFilter] : MESES.map((_, i) => i + 1);

  return monthIndexes.map((monthIdx) => {
    const mes = MESES[monthIdx - 1];
    const row: Record<string, string | number> = {
      mes,
      mesCorto: mes.slice(0, 3),
      monthIdx,
    };
    for (const y of compareYears) {
      const val = monthlyByYear.get(y)?.get(monthIdx)?.total ?? 0;
      row[String(y)] = val > 0 ? Number(val.toFixed(2)) : 0;
    }
    return row;
  });
}

export function monthlyTotalForYear(
  monthlyByYear: Map<number, Map<number, MonthSale>>,
  year: number
): number {
  const months = monthlyByYear.get(year);
  if (!months) return 0;
  return Array.from(months.values()).reduce((a, m) => a + m.total, 0);
}

export function monthlyAverageForYear(
  monthlyByYear: Map<number, Map<number, MonthSale>>,
  year: number
): number {
  const months = monthlyByYear.get(year);
  if (!months) return 0;
  const withData = Array.from(months.values()).filter((m) => m.total > 0);
  if (!withData.length) return 0;
  return withData.reduce((a, m) => a + m.total, 0) / withData.length;
}

export { MESES };
