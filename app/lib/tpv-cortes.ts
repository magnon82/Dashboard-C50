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

/** Dos tickets por terminal: Totalización (venta) + Reporte de propinas. */
export const TPV_PHOTO_KINDS = ['venta', 'propina'] as const;
export type TpvPhotoKind = (typeof TPV_PHOTO_KINDS)[number];

/** Límite storage / defensa servidor (Supabase bucket). */
export const TPV_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Techo tras compresión en cliente. Vercel serverless rechaza bodies ≳4.5 MB
 * con HTML "Request Entity Too Large" (antes de llegar a la ruta).
 */
export const TPV_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
/** Objetivo de compresión JPEG en el celular (~margen OCR). */
export const TPV_UPLOAD_TARGET_BYTES = 2 * 1024 * 1024;
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
  /** venta | propina para fotos; null si unused */
  photo_kind: TpvPhotoKind | null;
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
  /** missing | partial (1 de 2 fotos) | photo (ambas) | unused */
  state: 'missing' | 'partial' | 'photo' | 'unused';
  /** @deprecated Prefer venta/propina; apunta a venta o la única foto legacy */
  upload: TpvCorteUpload | null;
  venta: TpvCorteUpload | null;
  propinaUpload: TpvCorteUpload | null;
}

export interface TpvDayCompleteness {
  corteDate: string;
  slots: TpvDayTerminalSlot[];
  accounted: number;
  complete: boolean;
  missing: TpvTerminalNumber[];
}

export function photoKindLabel(kind: TpvPhotoKind): string {
  return kind === 'venta' ? 'Venta (Totalización)' : 'Propinas (Reporte)';
}

export function parsePhotoKind(raw: unknown): TpvPhotoKind | null {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'venta' || s === 'totalizacion' || s === 'totalización') {
    return 'venta';
  }
  if (s === 'propina' || s === 'propinas') return 'propina';
  return null;
}

const CDMX_TZ = 'America/Mexico_City';

/** Texto de ayuda junto al campo Fecha (captura de cortes). */
export const TPV_CORTE_DATE_HELP =
  'Fecha del día de corte. Hasta las 23:59 se registra el día en curso. De 00:00 a 05:59 se asigna el día anterior (cierre nocturno).';

/** Hoy en zona America/Mexico_City (YYYY-MM-DD). */
export function todayCdmxIso(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CDMX_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Hora local CDMX (0–23). */
export function cdmxHour(at: Date = new Date()): number {
  const hourPart = new Intl.DateTimeFormat('en-GB', {
    timeZone: CDMX_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(at)
    .find((p) => p.type === 'hour')?.value;
  const h = Number(hourPart);
  return Number.isFinite(h) ? h : 0;
}

/**
 * Fecha de corte por defecto (CDMX):
 * - 00:00–05:59 → día anterior (cierre nocturno)
 * - 06:00–23:59 → día en curso
 */
export function defaultCorteDateCdmx(at: Date = new Date()): string {
  const today = todayCdmxIso(at);
  if (cdmxHour(at) <= 5) {
    const [y, m, d] = today.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 1, d));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  }
  return today;
}

/** Días hacia atrás que Master puede cargar/editar respecto al día operativo. */
export const TPV_ADMIN_LOOKBACK_DAYS = 7;

/**
 * Primer día operativo del flujo de cortes TPV en producción.
 * Fechas anteriores (p. ej. julio 2026) no aparecen como pendientes ni son editables.
 */
export const TPV_CORTE_EPOCH = '2026-08-01';

/** Resta N días a una fecha ISO `YYYY-MM-DD` (calendario UTC noon-safe). */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Ventana Master: día operativo ± lookback, no antes de `TPV_CORTE_EPOCH`
 * (sin fechas futuras).
 * `opDay` = defaultCorteDateCdmx (madrugada → día anterior).
 */
export function adminCorteDateWindow(at: Date = new Date()): {
  opDay: string;
  minDate: string;
  maxDate: string;
} {
  const opDay = defaultCorteDateCdmx(at);
  const lookbackMin = shiftIsoDate(opDay, -TPV_ADMIN_LOOKBACK_DAYS);
  const minDate =
    lookbackMin < TPV_CORTE_EPOCH ? TPV_CORTE_EPOCH : lookbackMin;
  const maxDate = opDay < TPV_CORTE_EPOCH ? TPV_CORTE_EPOCH : opDay;
  return {
    opDay,
    minDate: minDate > maxDate ? maxDate : minDate,
    maxDate,
  };
}

/** Fechas ISO de la ventana Master (opDay … minDate), más reciente primero. */
export function listAdminLookbackDates(at: Date = new Date()): string[] {
  const { opDay, minDate } = adminCorteDateWindow(at);
  const out: string[] = [];
  let cur = opDay;
  while (cur >= minDate) {
    out.push(cur);
    cur = shiftIsoDate(cur, -1);
  }
  return out;
}

export function isAdminWritableCorteDate(
  corteDate: string,
  at: Date = new Date()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) return false;
  if (corteDate < TPV_CORTE_EPOCH) return false;
  const { minDate, maxDate } = adminCorteDateWindow(at);
  return corteDate >= minDate && corteDate <= maxDate;
}

/**
 * Ventana Staff: día operativo CDMX y el día anterior (catch-up del corte).
 * Madrugada 00:00–05:59: opDay ya es el día de operación nocturno.
 */
export function staffCorteDateWindow(at: Date = new Date()): {
  opDay: string;
  prevDay: string;
} {
  const opDay = defaultCorteDateCdmx(at);
  return { opDay, prevDay: shiftIsoDate(opDay, -1) };
}

export function isStaffWritableCorteDate(
  corteDate: string,
  at: Date = new Date()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) return false;
  if (corteDate < TPV_CORTE_EPOCH) return false;
  const { opDay, prevDay } = staffCorteDateWindow(at);
  return corteDate === opDay || corteDate === prevDay;
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

/**
 * Depósito diario bancario (neto banco): cobrado + propinas.
 * Las propinas se muestran aparte; no se descuentan del depósito.
 */
export function computeNetoBanco(
  cobrado: number | null | undefined,
  propina: number | null | undefined
): number | null {
  if (cobrado == null || Number.isNaN(Number(cobrado))) return null;
  const tip =
    propina == null || Number.isNaN(Number(propina)) ? 0 : Number(propina);
  return Math.round((Number(cobrado) + tip) * 100) / 100;
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

  if (byteSize > TPV_UPLOAD_MAX_BYTES) {
    errors.push(
      'Foto demasiado grande. Aléjate un poco del ticket y vuelve a tomar la foto (se comprime sola al subir).'
    );
  } else if (byteSize > TPV_MAX_BYTES) {
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

/** Completitud del día: las 3 terminales con (venta+propina) o unused. */
export function buildDayCompleteness(
  uploads: TpvCorteUpload[],
  corteDate: string
): TpvDayCompleteness {
  type Bundle = {
    unused: TpvCorteUpload | null;
    venta: TpvCorteUpload | null;
    propina: TpvCorteUpload | null;
  };
  const byTerm = new Map<number, Bundle>();

  function ensure(n: number): Bundle {
    let b = byTerm.get(n);
    if (!b) {
      b = { unused: null, venta: null, propina: null };
      byTerm.set(n, b);
    }
    return b;
  }

  function newer(a: TpvCorteUpload | null, b: TpvCorteUpload): TpvCorteUpload {
    if (!a) return b;
    return String(b.updated_at) > String(a.updated_at) ? b : a;
  }

  for (const u of uploads) {
    if (String(u.corte_date).slice(0, 10) !== corteDate) continue;
    if (u.status === 'rejected') continue;
    const n = Number(u.terminal_number);
    if (n < 1 || n > 3) continue;
    const b = ensure(n);
    if (u.entry_kind === 'unused' || u.status === 'unused') {
      b.unused = newer(b.unused, u);
      continue;
    }
    const kind = u.photo_kind === 'propina' ? 'propina' : 'venta';
    if (kind === 'propina') b.propina = newer(b.propina, u);
    else b.venta = newer(b.venta, u);
  }

  const slots: TpvDayTerminalSlot[] = TPV_TERMINALS.map((terminal) => {
    const b = byTerm.get(terminal);
    if (!b) {
      return {
        terminal,
        state: 'missing' as const,
        upload: null,
        venta: null,
        propinaUpload: null,
      };
    }
    if (b.unused) {
      return {
        terminal,
        state: 'unused' as const,
        upload: b.unused,
        venta: null,
        propinaUpload: null,
      };
    }
    const venta = b.venta;
    const propinaUpload = b.propina;
    if (venta && propinaUpload) {
      return {
        terminal,
        state: 'photo' as const,
        upload: venta,
        venta,
        propinaUpload,
      };
    }
    if (venta || propinaUpload) {
      return {
        terminal,
        state: 'partial' as const,
        upload: venta || propinaUpload,
        venta,
        propinaUpload,
      };
    }
    return {
      terminal,
      state: 'missing' as const,
      upload: null,
      venta: null,
      propinaUpload: null,
    };
  });

  const missing = slots
    .filter((s) => s.state === 'missing' || s.state === 'partial')
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

  /** Agrupa por fecha+terminal para no contar 2 fotos como 2 terminales. */
  const terminalDays = new Map<
    string,
    { unused: boolean; venta: TpvCorteUpload | null; propina: TpvCorteUpload | null }
  >();

  for (const u of uploads) {
    const d = String(u.corte_date || '').slice(0, 10);
    if (d < mondayKey || d > sundayKey) continue;
    if (u.status === 'rejected') continue;
    const key = `${d}|${u.terminal_number}`;
    let g = terminalDays.get(key);
    if (!g) {
      g = { unused: false, venta: null, propina: null };
      terminalDays.set(key, g);
    }
    if (u.entry_kind === 'unused' || u.status === 'unused') {
      g.unused = true;
      continue;
    }
    if (u.photo_kind === 'propina') g.propina = u;
    else g.venta = u;
  }

  for (const g of terminalDays.values()) {
    count += 1;
    if (g.unused) {
      unusedCount += 1;
      continue;
    }
    photoCount += 1;
    const c = g.venta?.total_cobrado != null ? Number(g.venta.total_cobrado) : 0;
    const tip =
      g.propina?.propina != null
        ? Number(g.propina.propina)
        : g.venta?.propina != null
          ? Number(g.venta.propina)
          : 0;
    const n = computeNetoBanco(
      g.venta?.total_cobrado ?? null,
      g.propina?.propina ?? g.venta?.propina ?? null
    ) ?? 0;
    cobrado += c;
    propina += tip;
    neto += n;
    if (
      g.venta?.status === 'verified' ||
      g.propina?.status === 'verified'
    ) {
      verifiedCount += 1;
    }
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

/** Resumen de cierre RPT embebido en el reporte admin de cortes. */
export interface TpvAdminReportRptSummary {
  wi_amount: number;
  eventos_amount: number;
  propinas: number;
  efectivo_tombola: number;
  efectivo_contado: number | null;
  efectivo_infocaja: number | null;
  bancos_neto_tpv: number | null;
  bancos_cobrado_tpv: number | null;
  bancos_propina_tpv: number | null;
  tpv_complete: boolean;
  created_by: string;
  updated_by: string | null;
}

export interface TpvAdminReportSlotSummary {
  terminal: TpvTerminalNumber;
  state: 'missing' | 'partial' | 'photo' | 'unused';
  cobrado: number | null;
  propina: number | null;
  neto: number | null;
  ventaUploader: string | null;
  propinaUploader: string | null;
  unusedUploader: string | null;
}

/** Día en el listado admin (Master → Cortes TPV). */
export interface TpvAdminReportDay {
  date: string;
  complete: boolean;
  accounted: number;
  missing: TpvTerminalNumber[];
  slots: TpvAdminReportSlotSummary[];
  totals: { cobrado: number; propina: number; neto: number };
  rpt: TpvAdminReportRptSummary | null;
  hasRpt: boolean;
  /** Terminales 3/3 + cierre RPT guardado */
  corteCompleto: boolean;
}

export function buildAdminReportDay(
  corteDate: string,
  uploads: TpvCorteUpload[],
  rpt: TpvAdminReportRptSummary | null
): TpvAdminReportDay {
  const day = buildDayCompleteness(uploads, corteDate);
  let cobrado = 0;
  let propina = 0;
  let neto = 0;
  const slots: TpvAdminReportSlotSummary[] = day.slots.map((s) => {
    const tip =
      s.propinaUpload?.propina != null
        ? Number(s.propinaUpload.propina)
        : s.venta?.propina != null
          ? Number(s.venta.propina)
          : null;
    const cob =
      s.venta?.total_cobrado != null ? Number(s.venta.total_cobrado) : null;
    const n =
      s.state === 'photo' ? computeNetoBanco(cob, tip) : null;
    if (s.state === 'photo') {
      cobrado += cob ?? 0;
      propina += tip ?? 0;
      neto += n ?? 0;
    }
    return {
      terminal: s.terminal,
      state: s.state,
      cobrado: s.state === 'photo' || s.state === 'partial' ? cob : null,
      propina: s.state === 'photo' || s.state === 'partial' ? tip : null,
      neto: n,
      ventaUploader: s.venta?.uploader_username || null,
      propinaUploader: s.propinaUpload?.uploader_username || null,
      unusedUploader:
        s.state === 'unused' ? s.upload?.uploader_username || null : null,
    };
  });

  return {
    date: corteDate,
    complete: day.complete,
    accounted: day.accounted,
    missing: day.missing,
    slots,
    totals: {
      cobrado: Math.round(cobrado * 100) / 100,
      propina: Math.round(propina * 100) / 100,
      neto: Math.round(neto * 100) / 100,
    },
    rpt,
    hasRpt: Boolean(rpt),
    corteCompleto: day.complete && Boolean(rpt),
  };
}

/** Normaliza fila DB → TpvCorteUpload */
export function asTpvRow(r: Record<string, unknown>): TpvCorteUpload {
  const tn = Number(r.terminal_number);
  const terminal_number = (
    tn === 1 || tn === 2 || tn === 3 ? tn : 1
  ) as TpvTerminalNumber;
  const entry_kind: TpvEntryKind =
    r.entry_kind === 'unused' ? 'unused' : 'photo';
  let photo_kind: TpvPhotoKind | null = null;
  if (entry_kind === 'photo') {
    photo_kind = parsePhotoKind(r.photo_kind) || 'venta';
  }
  return {
    id: String(r.id),
    corte_date: String(r.corte_date).slice(0, 10),
    terminal_number,
    entry_kind,
    photo_kind,
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
