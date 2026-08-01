import {
  acumuladoWeekForDate,
  mondayOf,
  parseIsoDate,
  sundayOfWeek,
  toIsoLocal,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

export const TPV_STORAGE_BUCKET = 'tpv-cortes';
export const TPV_TERMINALS = [1, 2, 3] as const;
export type TpvTerminalNumber = (typeof TPV_TERMINALS)[number];

export const TPV_MAX_BYTES = 8 * 1024 * 1024;
export const TPV_MIN_BYTES = 40 * 1024;
export const TPV_MIN_LONG_SIDE = 1200;
/** Varianza de luminancia mínima — por debajo se pide retomar la foto */
export const TPV_MIN_SHARPNESS = 40;

export type TpvEntryKind = 'photo' | 'unused';
export type TpvCorteStatus =
  | 'pending'
  | 'parsed'
  | 'verified'
  | 'rejected'
  | 'unused';
export type TpvOcrStatus = 'skipped' | 'pending' | 'done' | 'failed';

export interface TpvCorteUpload {
  id: string;
  corte_date: string;
  terminal_number: TpvTerminalNumber;
  entry_kind: TpvEntryKind;
  terminal_label: string | null;
  uploader_username: string;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width_px: number | null;
  height_px: number | null;
  sharpness_score: number | null;
  total_cobrado: number | null;
  propina: number | null;
  neto_banco: number | null;
  ocr_text: string | null;
  ocr_status: TpvOcrStatus;
  status: TpvCorteStatus;
  notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  image_url?: string | null;
}

export interface ImageQualityResult {
  ok: boolean;
  errors: string[];
  width: number;
  height: number;
  byteSize: number;
  sharpness?: number;
}

export interface TpvDayTerminalSlot {
  terminal: TpvTerminalNumber;
  state: 'missing' | 'photo' | 'unused';
  upload: TpvCorteUpload | null;
}

export interface TpvDayCompleteness {
  corteDate: string;
  slots: TpvDayTerminalSlot[];
  accounted: number;
  complete: boolean;
  missing: TpvTerminalNumber[];
}

/** Hoy en zona America/Mexico_City (YYYY-MM-DD). */
export function todayCdmxIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function moneyMx(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `$${Number(v).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function terminalLabel(n: TpvTerminalNumber): string {
  return `Terminal ${n}`;
}

/** Neto esperado: cobrado − propina (si ambos existen). */
export function computeNetoBanco(
  cobrado: number | null | undefined,
  propina: number | null | undefined
): number | null {
  if (cobrado == null || Number.isNaN(Number(cobrado))) return null;
  const tip =
    propina == null || Number.isNaN(Number(propina)) ? 0 : Number(propina);
  return Math.round((Number(cobrado) - tip) * 100) / 100;
}

/**
 * Validación de calidad (cliente + servidor).
 * Borrosa / baja resolución → pedir retomar (no aceptar).
 */
export function validateTpvImageQuality(opts: {
  width: number;
  height: number;
  byteSize: number;
  sharpness?: number;
}): ImageQualityResult {
  const errors: string[] = [];
  const { width, height, byteSize, sharpness } = opts;
  const longSide = Math.max(width, height);

  if (byteSize > TPV_MAX_BYTES) {
    errors.push(
      'La foto pesa más de 8 MB. Vuelve a tomar la foto un poco más lejos o con menos zoom.'
    );
  }
  if (byteSize < TPV_MIN_BYTES) {
    errors.push(
      'La foto es demasiado pequeña o está muy comprimida. Vuelve a tomar la foto con mejor luz.'
    );
  }
  if (longSide < TPV_MIN_LONG_SIDE) {
    errors.push(
      `La foto es muy chica (${longSide}px). Usa la cámara trasera, encuadra el ticket completo y vuelve a tomar la foto (≥${TPV_MIN_LONG_SIDE}px).`
    );
  }
  if (sharpness != null && sharpness < TPV_MIN_SHARPNESS) {
    errors.push(
      'La foto se ve borrosa o fuera de foco. Enfoca el ticket del TPV, sujeta firme el celular y vuelve a tomar la foto.'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    width,
    height,
    byteSize,
    sharpness,
  };
}

/** Varianza de luminancia en ImageData reducido (heurística de nitidez). */
export function estimateSharpnessFromImageData(data: ImageData): number {
  const { data: px, width, height } = data;
  if (width < 8 || height < 8) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const yLum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      sum += yLum;
      sumSq += yLum * yLum;
      n += 1;
    }
  }
  if (n < 10) return 0;
  const mean = sum / n;
  return Math.round((sumSq / n - mean * mean) * 100) / 100;
}

/** Completitud del día: las 3 terminales con foto o unused. */
export function buildDayCompleteness(
  uploads: TpvCorteUpload[],
  corteDate: string
): TpvDayCompleteness {
  const byTerm = new Map<number, TpvCorteUpload>();
  for (const u of uploads) {
    if (String(u.corte_date).slice(0, 10) !== corteDate) continue;
    if (u.status === 'rejected') continue;
    const n = Number(u.terminal_number);
    if (n < 1 || n > 3) continue;
    const prev = byTerm.get(n);
    if (!prev || String(u.updated_at) > String(prev.updated_at)) {
      byTerm.set(n, u);
    }
  }

  const slots: TpvDayTerminalSlot[] = TPV_TERMINALS.map((terminal) => {
    const upload = byTerm.get(terminal) || null;
    if (!upload) return { terminal, state: 'missing' as const, upload: null };
    if (upload.entry_kind === 'unused' || upload.status === 'unused') {
      return { terminal, state: 'unused' as const, upload };
    }
    return { terminal, state: 'photo' as const, upload };
  });

  const missing = slots
    .filter((s) => s.state === 'missing')
    .map((s) => s.terminal);
  const accounted = 3 - missing.length;

  return {
    corteDate,
    slots,
    accounted,
    complete: missing.length === 0,
    missing,
  };
}

export interface TpvWeekVerify {
  mondayKey: string;
  sundayKey: string;
  weekNumber: number;
  year: number;
  tpv: {
    count: number;
    photoCount: number;
    unusedCount: number;
    verifiedCount: number;
    cobrado: number;
    propina: number;
    neto: number;
  };
  infocaja: {
    bancarias: number;
    propina: number;
    cobrado: number;
    hasData: boolean;
  };
  presupuesto: {
    ventasBancarias: number;
    mifel: number;
    bbva: number;
    hasData: boolean;
    semLabel: string | null;
  };
  deltaNetoVsPresupuesto: number | null;
}

function parsePresupuestoDesc(
  desc: string | null | undefined
): Record<string, unknown> {
  if (!desc) return {};
  try {
    const p = JSON.parse(desc);
    return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function monthSemForMonday(mondayIso: string): {
  year: number;
  month: number;
  week: number;
} | null {
  const p = parseIsoDate(mondayIso);
  if (!p) return null;
  const first = new Date(p.y, p.m - 1, 1, 12, 0, 0);
  while (first.getDay() !== 1) first.setDate(first.getDate() + 1);
  const mon = mondayOf(mondayIso);
  const diff = Math.round((mon.getTime() - first.getTime()) / 86400000);
  if (diff < 0) {
    const prev = new Date(p.y, p.m - 2, 1, 12, 0, 0);
    while (prev.getDay() !== 1) prev.setDate(prev.getDate() + 1);
    let w = 1;
    const cur = new Date(prev);
    while (toIsoLocal(cur) < mondayIso && w < 8) {
      cur.setDate(cur.getDate() + 7);
      w += 1;
    }
    return { year: prev.getFullYear(), month: prev.getMonth() + 1, week: w };
  }
  const week = Math.floor(diff / 7) + 1;
  return { year: p.y, month: p.m, week };
}

export function buildTpvWeekVerify(
  uploads: TpvCorteUpload[],
  financialRecords: FinancialRecord[],
  todayIso?: string
): TpvWeekVerify {
  const today = todayIso || todayCdmxIso();
  const mon = mondayOf(today);
  const mondayKey = toIsoLocal(mon);
  const sundayKey = sundayOfWeek(mondayKey);
  const weekNumber = acumuladoWeekForDate(today);
  const year = parseIsoDate(today)?.y ?? new Date().getFullYear();

  let cobrado = 0;
  let propina = 0;
  let neto = 0;
  let count = 0;
  let photoCount = 0;
  let unusedCount = 0;
  let verifiedCount = 0;

  for (const u of uploads) {
    const d = String(u.corte_date || '').slice(0, 10);
    if (d < mondayKey || d > sundayKey) continue;
    if (u.status === 'rejected') continue;
    count += 1;
    if (u.entry_kind === 'unused' || u.status === 'unused') {
      unusedCount += 1;
      continue;
    }
    photoCount += 1;
    if (u.status === 'verified') verifiedCount += 1;
    const c = u.total_cobrado != null ? Number(u.total_cobrado) : 0;
    const tip = u.propina != null ? Number(u.propina) : 0;
    const n =
      u.neto_banco != null
        ? Number(u.neto_banco)
        : computeNetoBanco(u.total_cobrado, u.propina) ?? 0;
    cobrado += c;
    propina += tip;
    neto += n;
  }

  let bancarias = 0;
  let infoPropina = 0;
  for (const r of financialRecords) {
    if (r.source_file !== 'infocaja') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.key < mondayKey || p.key > sundayKey) continue;
    const amt = Number(r.amount) || 0;
    if (r.category === 'Infocaja Bancarias') bancarias += amt;
    else if (r.category === 'Infocaja Propina') infoPropina += amt;
  }

  const sem = monthSemForMonday(mondayKey);
  let mifel = 0;
  let bbva = 0;
  let semLabel: string | null = null;
  if (sem) {
    semLabel = `SEM ${sem.week} · ${sem.month}/${sem.year}`;
    for (const r of financialRecords) {
      if (r.source_file !== 'presupuesto_ingreso') continue;
      const d = parsePresupuestoDesc(r.description);
      if (String(d.tipo || '').toLowerCase() !== 'ventas') continue;
      const w = d.week != null ? Number(d.week) : null;
      const y = d.year != null ? Number(d.year) : null;
      const m = d.month != null ? Number(d.month) : null;
      const fecha = String(d.fecha || '').slice(0, 10);
      const byFecha = fecha === mondayKey;
      const bySem =
        w === sem.week &&
        (y == null || y === sem.year) &&
        (m == null || m === sem.month);
      if (!byFecha && !bySem) continue;
      const bank = String(d.bank || '').toUpperCase();
      const amt = Number(r.amount) || 0;
      if (bank === 'BBVA') bbva += amt;
      else mifel += amt;
    }
  }

  const presupuestoTotal = mifel + bbva;
  const refNeto = photoCount > 0 ? neto : bancarias > 0 ? bancarias : null;
  const deltaNetoVsPresupuesto =
    refNeto != null && presupuestoTotal > 0
      ? Math.round((refNeto - presupuestoTotal) * 100) / 100
      : null;

  return {
    mondayKey,
    sundayKey,
    weekNumber,
    year,
    tpv: {
      count,
      photoCount,
      unusedCount,
      verifiedCount,
      cobrado,
      propina,
      neto,
    },
    infocaja: {
      bancarias,
      propina: infoPropina,
      cobrado: bancarias + infoPropina,
      hasData: bancarias > 0 || infoPropina > 0,
    },
    presupuesto: {
      ventasBancarias: presupuestoTotal,
      mifel,
      bbva,
      hasData: presupuestoTotal > 0,
      semLabel,
    },
    deltaNetoVsPresupuesto,
  };
}

export function parseTerminalNumber(raw: unknown): TpvTerminalNumber | null {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

/** Normaliza fila DB → TpvCorteUpload */
export function asTpvRow(r: Record<string, unknown>): TpvCorteUpload {
  const tn = Number(r.terminal_number);
  const terminal_number = (
    tn === 1 || tn === 2 || tn === 3 ? tn : 1
  ) as TpvTerminalNumber;
  const entry_kind: TpvEntryKind =
    r.entry_kind === 'unused' ? 'unused' : 'photo';
  return {
    id: String(r.id),
    corte_date: String(r.corte_date).slice(0, 10),
    terminal_number,
    entry_kind,
    terminal_label: r.terminal_label != null ? String(r.terminal_label) : null,
    uploader_username: String(r.uploader_username || ''),
    storage_path: r.storage_path != null ? String(r.storage_path) : null,
    mime_type: r.mime_type != null ? String(r.mime_type) : null,
    byte_size: r.byte_size != null ? Number(r.byte_size) : null,
    width_px: r.width_px != null ? Number(r.width_px) : null,
    height_px: r.height_px != null ? Number(r.height_px) : null,
    sharpness_score:
      r.sharpness_score != null ? Number(r.sharpness_score) : null,
    total_cobrado: r.total_cobrado != null ? Number(r.total_cobrado) : null,
    propina: r.propina != null ? Number(r.propina) : null,
    neto_banco: r.neto_banco != null ? Number(r.neto_banco) : null,
    ocr_text: r.ocr_text != null ? String(r.ocr_text) : null,
    ocr_status: (r.ocr_status as TpvOcrStatus) || 'skipped',
    status: (r.status as TpvCorteStatus) || 'pending',
    notes: r.notes != null ? String(r.notes) : null,
    verified_by: r.verified_by != null ? String(r.verified_by) : null,
    verified_at: r.verified_at != null ? String(r.verified_at) : null,
    created_at: String(r.created_at || ''),
    updated_at: String(r.updated_at || ''),
  };
}
