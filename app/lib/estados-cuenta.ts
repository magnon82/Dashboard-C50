import { normRubroKey, type RubroRow } from '@/app/lib/presupuesto';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

export const SOURCE_ESTADO_MIFEL = 'estado_mifel';
export const SOURCE_ESTADO_BBVA = 'estado_bbva';
/** Índice de PDFs de pagos en COMPROBANTES BANCARIOS */
export const SOURCE_ESTADO_PDF_INDEX = 'estado_pdf_index';
/** Índice de PDFs de estados de cuenta en Administración\\Bancos */
export const SOURCE_ESTADO_CUENTA_PDF_INDEX = 'estado_cuenta_pdf_index';
export const SOURCE_FLUJO_MOV = 'flujo_efectivo_mov';
/** Pagos CXP (retornos de efectivo / proveedores / servicios) */
export const SOURCE_CXP = 'cxp';
/**
 * Ingresos bancarios semanales Mifel/BBVA desde presupuesto Excel (TOTAL, manual).
 * No son abonos de estado de cuenta; son agregados SEM del panel derecho.
 */
export const SOURCE_PRESUPUESTO_INGRESO = 'presupuesto_ingreso';

export const ESTADO_SOURCES = [
  SOURCE_ESTADO_MIFEL,
  SOURCE_ESTADO_BBVA,
] as const;

export type EstadoBank = 'MIFEL' | 'BBVA' | 'EFECTIVO' | 'CXP';
export type GastoCanal = 'all' | EstadoBank;
export type MatchStatus = 'matched' | 'unmatched' | 'overridden';
/** Clasificación de ingresos (presupuesto_ingreso + ventas efectivo) */
export type IngresoTipo = 'ventas' | 'entre_cuentas' | 'otro';
export type IngresoTipoFilter = 'all' | IngresoTipo;

export interface EstadoMovimientoPayload {
  bank?: EstadoBank | string;
  canal?: string;
  fecha?: string;
  descripcion?: string;
  concepto?: string;
  /** Razón social / encabezado RETORNOS DE EFECTIVO (secundario) */
  razon_social?: string | null;
  factura?: string | null;
  forma_pago?: string | null;
  bank_hint?: string | null;
  sheet?: string | null;
  folio?: string | null;
  referencia?: string | null;
  cargo?: number | null;
  abono?: number | null;
  ingreso?: number | null;
  egreso?: number | null;
  saldo_total?: number | null;
  saldo_efectivo?: number | null;
  rfc?: string | null;
  iva?: number | null;
  cheque?: string | null;
  matched_rubro?: string | null;
  matched_parent?: string | null;
  match_confidence?: number;
  match_status?: MatchStatus | string;
  match_source?: 'auto' | 'manual' | string;
  observaciones?: string;
  source_path?: string;
  /** Efectivo */
  categoria?: string;
  columna?: string;
  week?: number | null;
  week_annual?: number | null;
  year?: number | null;
  month?: number | null;
  week_source?: string;
  es_caja_chica?: boolean;
  /** presupuesto_ingreso: ventas vs anticipos del TOTAL */
  ventas?: number | null;
  anticipos_entrada?: number | null;
  /** ventas | entre_cuentas | otro */
  tipo?: string | null;
  nota?: string | null;
  source?: string | null;
}

export interface EstadoMovimiento {
  id: string;
  date: string;
  type: FinancialRecord['type'];
  amount: number;
  source_file: string;
  bank: EstadoBank | string;
  /** true = movimiento de flujo de efectivo */
  isEfectivo: boolean;
  /** true = pago CXP (retornos / proveedores) */
  isCxp: boolean;
  descripcion: string;
  /** Razón social CXP (detalle secundario) */
  razonSocial: string | null;
  folio: string | null;
  referencia: string | null;
  cargo: number | null;
  abono: number | null;
  matched_rubro: string | null;
  matched_parent: string | null;
  match_confidence: number;
  match_status: MatchStatus;
  observaciones: string;
  /** SEM del mes (presupuesto), solo efectivo / CXP */
  week: number | null;
  week_annual: number | null;
  categoria: string | null;
  es_caja_chica: boolean;
  /** presupuesto_ingreso / flujo_efectivo_mov ventas */
  ingresoTipo: IngresoTipo | null;
  raw: EstadoMovimientoPayload;
}

function parseJson<T>(raw: string | object | null | undefined): T | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export function isEstadoSource(source: string | null | undefined): boolean {
  return (
    source === SOURCE_ESTADO_MIFEL ||
    source === SOURCE_ESTADO_BBVA
  );
}

export function isFlujoMovSource(source: string | null | undefined): boolean {
  return source === SOURCE_FLUJO_MOV;
}

export function isCxpSource(source: string | null | undefined): boolean {
  return source === SOURCE_CXP;
}

export function isPresupuestoIngresoSource(
  source: string | null | undefined
): boolean {
  return source === SOURCE_PRESUPUESTO_INGRESO;
}

export function isGastoSource(source: string | null | undefined): boolean {
  return isEstadoSource(source) || isFlujoMovSource(source) || isCxpSource(source);
}

function conceptoFromCxpCategory(category: string | null | undefined): string {
  const c = String(category || '').trim();
  if (c.toUpperCase().startsWith('CXP:')) {
    return c.slice(4).trim();
  }
  return c;
}

function parseCxpMovimiento(r: FinancialRecord): EstadoMovimiento | null {
  if (!isCxpSource(r.source_file)) return null;
  const d: EstadoMovimientoPayload =
    parseJson<EstadoMovimientoPayload>(r.description) || {};

  // Preferir CONCEPTO; legacy: descripción «razón · concepto · Fac…»
  const fromCat = conceptoFromCxpCategory(r.category);
  let concepto =
    (d.concepto || d.descripcion || '').trim() || fromCat;
  let razonSocial = (d.razon_social || '').trim() || null;

  if (!d.concepto && !d.descripcion && typeof r.description === 'string') {
    const raw = r.description.trim();
    if (raw && !raw.startsWith('{')) {
      const parts = raw.split(' · ').map((p) => p.trim()).filter(Boolean);
      // Legacy: razón social primero; concepto segundo si existe
      if (parts.length >= 2 && fromCat && parts[1] === fromCat) {
        razonSocial = parts[0];
        concepto = fromCat;
      } else if (fromCat) {
        concepto = fromCat;
        if (parts[0] && parts[0] !== fromCat) razonSocial = parts[0];
      } else if (parts.length) {
        concepto = parts[1] || parts[0];
        if (parts.length >= 2) razonSocial = parts[0];
      }
    }
  }

  if (!concepto) concepto = fromCat || 'CXP';

  const cargo =
    d.cargo ??
    (r.type === 'expense' ? Number(r.amount) || null : null);

  return {
    id: r.id,
    date: (d.fecha || r.date || '').slice(0, 10),
    type: r.type,
    amount: Number(r.amount) || 0,
    source_file: SOURCE_CXP,
    bank: 'CXP',
    isEfectivo: false,
    isCxp: true,
    descripcion: concepto,
    razonSocial,
    folio: d.factura ?? d.folio ?? null,
    referencia: razonSocial,
    cargo: cargo != null && cargo !== 0 ? Math.abs(Number(cargo)) : null,
    abono: null,
    matched_rubro: d.matched_rubro ?? null,
    matched_parent: d.matched_parent ?? null,
    match_confidence: Number(d.match_confidence) || 0,
    match_status: 'unmatched',
    observaciones: d.observaciones || d.forma_pago || '',
    week: d.week != null ? Number(d.week) : null,
    week_annual: d.week_annual != null ? Number(d.week_annual) : null,
    categoria: 'Retornos de efectivo',
    es_caja_chica: false,
    ingresoTipo: null,
    raw: {
      ...d,
      bank: 'CXP',
      canal: 'CXP',
      concepto,
      descripcion: concepto,
      razon_social: razonSocial,
    },
  };
}

function parseEfectivoMovimiento(r: FinancialRecord): EstadoMovimiento | null {
  if (!isFlujoMovSource(r.source_file)) return null;
  const d: EstadoMovimientoPayload =
    parseJson<EstadoMovimientoPayload>(r.description) || {};
  const cargo =
    d.cargo ??
    d.egreso ??
    (r.type === 'expense' ? Number(r.amount) || null : null);
  const abono =
    d.abono ??
    d.ingreso ??
    (r.type === 'income' ? Number(r.amount) || null : null);

  const week = d.week != null ? Number(d.week) : null;
  const isIncome =
    (abono != null && abono > 0) || r.type === 'income';
  const ingresoTipo = isIncome ? classifyEfectivoIngresoTipo(d) : null;

  let descripcion = (d.descripcion || d.concepto || r.category || '').trim();
  if (ingresoTipo === 'ventas') {
    descripcion =
      week != null ? `Ventas efectivo · SEM ${week}` : 'Ventas efectivo';
  }

  return {
    id: r.id,
    date: (d.fecha || r.date || '').slice(0, 10),
    type: r.type,
    amount: Number(r.amount) || 0,
    source_file: SOURCE_FLUJO_MOV,
    bank: 'EFECTIVO',
    isEfectivo: true,
    isCxp: false,
    descripcion,
    razonSocial: null,
    folio: null,
    referencia: d.categoria || r.category || null,
    cargo: cargo != null && cargo !== 0 ? Math.abs(Number(cargo)) : null,
    abono: abono != null && abono !== 0 ? Math.abs(Number(abono)) : null,
    matched_rubro: d.matched_rubro ?? null,
    matched_parent: d.matched_parent ?? null,
    match_confidence: Number(d.match_confidence) || 0,
    match_status: 'unmatched',
    observaciones: d.observaciones || '',
    week,
    week_annual: d.week_annual != null ? Number(d.week_annual) : null,
    categoria:
      ingresoTipo === 'ventas'
        ? 'Ventas'
        : ingresoTipo === 'otro'
          ? 'Otros ingresos'
          : d.categoria || r.category || null,
    es_caja_chica: Boolean(d.es_caja_chica),
    ingresoTipo,
    raw: {
      ...d,
      bank: 'EFECTIVO',
      canal: 'EFECTIVO',
      tipo: ingresoTipo || d.tipo || null,
      concepto: d.concepto || d.descripcion || undefined,
    },
  };
}

/** Ventas en caja: columna Ventas, tipo persistido, o conceptos EFECTIVO SEMANA / ingreso ventas. */
function classifyEfectivoIngresoTipo(
  d: EstadoMovimientoPayload
): IngresoTipo | null {
  const tipoRaw = String(d.tipo || '').toLowerCase();
  if (
    tipoRaw === 'ventas' ||
    tipoRaw === 'entre_cuentas' ||
    tipoRaw === 'otro'
  ) {
    return tipoRaw;
  }
  const col = String(d.columna || '').toLowerCase();
  const cat = String(d.categoria || '').toLowerCase();
  if (col === 'ventas' || cat === 'ventas') return 'ventas';
  if (col === 'otros_ingresos' || cat === 'otros ingresos') return 'otro';
  const concept = `${d.concepto || ''} ${d.descripcion || ''}`;
  if (/EFECTIVO\s+SEM(?:ANA)?\b/i.test(concept)) return 'ventas';
  if (
    /INGRESO\s+.*VENTAS/i.test(concept) ||
    /VENTAS\s+(?:EN\s+)?(?:CAJA|EFECTIVO)/i.test(concept) ||
    /VENTAS\s+CAJA/i.test(concept)
  ) {
    return 'ventas';
  }
  return null;
}

/** Ingresos Mifel/BBVA semanales tipados a mano en presupuesto Excel (TOTAL). */
function parsePresupuestoIngresoMovimiento(
  r: FinancialRecord
): EstadoMovimiento | null {
  if (!isPresupuestoIngresoSource(r.source_file)) return null;
  const d: EstadoMovimientoPayload = parseJson(r.description) || {};
  const bankRaw = String(d.bank || '').toUpperCase();
  const bank: EstadoBank =
    bankRaw === 'BBVA' ? 'BBVA' : bankRaw === 'MIFEL' ? 'MIFEL' : 'MIFEL';
  const abono =
    d.abono != null && Number(d.abono) !== 0
      ? Math.abs(Number(d.abono))
      : r.type === 'income' && Number(r.amount)
        ? Math.abs(Number(r.amount))
        : null;
  const week = d.week != null ? Number(d.week) : null;

  const tipoRaw = String(d.tipo || '').toLowerCase();
  let ingresoTipo: IngresoTipo | null = null;
  if (
    tipoRaw === 'ventas' ||
    tipoRaw === 'entre_cuentas' ||
    tipoRaw === 'otro'
  ) {
    ingresoTipo = tipoRaw;
  } else {
    // Legacy rows (pre-split): infer from amount split when possible
    const ventas = Number(d.ventas) || 0;
    const anticipos = Number(d.anticipos_entrada) || 0;
    if (ventas > 0 && anticipos <= 0) ingresoTipo = 'ventas';
    else if (anticipos > 0 && ventas <= 0) ingresoTipo = 'otro';
    else ingresoTipo = null;
  }

  let descripcion = (d.descripcion || d.concepto || r.category || '').trim();
  if (!descripcion) {
    if (ingresoTipo === 'ventas') {
      descripcion =
        week != null
          ? `Ventas ${bank} · SEM ${week}`
          : `Ventas ${bank}`;
    } else if (ingresoTipo === 'entre_cuentas') {
      descripcion =
        week != null
          ? `Entre cuentas ${bank} · SEM ${week}`
          : `Entre cuentas ${bank}`;
    } else {
      descripcion =
        week != null
          ? `Ingresos ${bank} · SEM ${week} (presupuesto)`
          : `Ingresos ${bank} (presupuesto)`;
    }
  }

  return {
    id: r.id,
    date: (d.fecha || r.date || '').slice(0, 10),
    type: r.type === 'income' ? 'income' : r.type,
    amount: Number(r.amount) || abono || 0,
    source_file: SOURCE_PRESUPUESTO_INGRESO,
    bank,
    isEfectivo: false,
    isCxp: false,
    descripcion,
    razonSocial: null,
    folio: null,
    referencia: week != null ? `SEM ${week}` : 'presupuesto',
    cargo: null,
    abono,
    matched_rubro: null,
    matched_parent: null,
    match_confidence: 0,
    match_status: 'unmatched',
    observaciones:
      d.observaciones ||
      d.nota ||
      'Fuente: presupuesto Excel (TOTAL · ventas/anticipos, llenado manual)',
    week,
    week_annual: d.week_annual != null ? Number(d.week_annual) : null,
    categoria: r.category || `Ingreso ${bank}`,
    es_caja_chica: false,
    ingresoTipo,
    raw: { ...d, bank, canal: bank, tipo: ingresoTipo || d.tipo },
  };
}

export function parseEstadoMovimiento(r: FinancialRecord): EstadoMovimiento | null {
  if (isFlujoMovSource(r.source_file)) return parseEfectivoMovimiento(r);
  if (isCxpSource(r.source_file)) return parseCxpMovimiento(r);
  if (isPresupuestoIngresoSource(r.source_file)) {
    return parsePresupuestoIngresoMovimiento(r);
  }
  if (!isEstadoSource(r.source_file)) return null;
  const d: EstadoMovimientoPayload =
    parseJson<EstadoMovimientoPayload>(r.description) || {};
  const bank =
    d.bank ||
    (r.source_file === SOURCE_ESTADO_BBVA ? 'BBVA' : 'MIFEL');
  const statusRaw = String(d.match_status || 'unmatched');
  const match_status: MatchStatus =
    statusRaw === 'matched' || statusRaw === 'overridden'
      ? statusRaw
      : 'unmatched';

  return {
    id: r.id,
    date: (d.fecha || r.date || '').slice(0, 10),
    type: r.type,
    amount: Number(r.amount) || 0,
    source_file: r.source_file || SOURCE_ESTADO_MIFEL,
    bank,
    isEfectivo: false,
    isCxp: false,
    descripcion: d.descripcion || r.category || '',
    razonSocial: null,
    folio: d.folio ?? null,
    referencia: d.referencia ?? null,
    cargo: d.cargo ?? (r.type === 'expense' ? Number(r.amount) || null : null),
    abono: d.abono ?? (r.type === 'income' ? Number(r.amount) || null : null),
    matched_rubro: d.matched_rubro ?? null,
    matched_parent: d.matched_parent ?? null,
    match_confidence: Number(d.match_confidence) || 0,
    match_status,
    observaciones: d.observaciones || '',
    week: null,
    week_annual: null,
    categoria: null,
    es_caja_chica: false,
    ingresoTipo: null,
    raw: { ...d, bank },
  };
}

export function filterEstadoMovimientos(
  records: FinancialRecord[],
  opts: {
    bank?: GastoCanal;
    year?: number;
    month?: number;
    /** Día del mes (1–31); solo aplica si hay fecha parseable */
    day?: number | 'all';
    week?: number | 'all';
    status?: 'all' | MatchStatus;
    /** Solo egresos (cargos) — útil para revisión de gastos */
    expensesOnly?: boolean;
    /** Solo ingresos (abonos) — efectivo, presupuesto Excel bancos, abonos estado */
    incomeOnly?: boolean;
    /** Filtro opcional ventas / entre_cuentas / otro (presupuesto + efectivo) */
    ingresoTipo?: IngresoTipoFilter;
    /** Busca en descripción, folio, referencia, RFC, cheque, categoría */
    query?: string;
  } = {}
): EstadoMovimiento[] {
  const bank = opts.bank || 'all';
  const status = opts.status || 'all';
  const week = opts.week ?? 'all';
  const day = opts.day ?? 'all';
  const ingresoTipo = opts.ingresoTipo || 'all';
  const q = (opts.query || '').trim().toLowerCase();
  const out: EstadoMovimiento[] = [];

  for (const r of records) {
    const m = parseEstadoMovimiento(r);
    if (!m) continue;
    if (
      bank !== 'all' &&
      String(m.bank).toUpperCase() !== String(bank).toUpperCase()
    ) {
      continue;
    }
    if (opts.year || opts.month) {
      // presupuesto_ingreso: SEM lunes puede caer fuera del mes civil;
      // year/month del payload son los del Excel de presupuesto.
      const rawY =
        m.raw.year != null
          ? Number(m.raw.year)
          : null;
      const rawM =
        m.raw.month != null
          ? Number(m.raw.month)
          : null;
      if (rawY != null && !Number.isNaN(rawY) && rawM != null && !Number.isNaN(rawM)) {
        if (opts.year && rawY !== opts.year) continue;
        if (opts.month && rawM !== opts.month) continue;
      } else {
        const [y, mo] = m.date.split('-').map(Number);
        if (opts.year && y !== opts.year) continue;
        if (opts.month && mo !== opts.month) continue;
      }
    }
    if (day !== 'all') {
      const d = Number(String(m.date || '').slice(8, 10));
      if (!d || d !== day) continue;
    }
    if (week !== 'all' && m.week !== week) continue;
    if (status !== 'all' && m.match_status !== status) continue;
    if (opts.expensesOnly && !(m.cargo && m.cargo > 0)) continue;
    if (opts.incomeOnly && !(m.abono && m.abono > 0)) continue;
    if (ingresoTipo !== 'all') {
      if (m.ingresoTipo !== ingresoTipo) continue;
    }
    if (q) {
      const hay = [
        m.descripcion,
        m.razonSocial,
        m.folio,
        m.referencia,
        m.categoria,
        m.raw.rfc,
        m.raw.cheque,
        m.raw.forma_pago,
        m.observaciones,
        m.matched_rubro,
        m.ingresoTipo,
        m.week != null ? `sem ${m.week}` : '',
        m.week_annual != null ? `semana ${m.week_annual}` : '',
        m.es_caja_chica ? 'caja chica' : '',
        m.isCxp ? 'cxp retornos' : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(m);
  }

  out.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.descripcion.localeCompare(b.descripcion, 'es');
  });
  return out;
}

export interface PdfComprobanteHit {
  filename: string;
  rel_path: string;
  bank: string;
  amount: number;
  date: string;
  vendor: string;
  body: string;
  concepto: string;
}

function parsePdfIndexRecord(r: FinancialRecord): PdfComprobanteHit | null {
  if (r.source_file !== SOURCE_ESTADO_PDF_INDEX) return null;
  const d =
    typeof r.description === 'object' && r.description
      ? (r.description as Record<string, unknown>)
      : (() => {
          try {
            return JSON.parse(String(r.description || '{}')) as Record<
              string,
              unknown
            >;
          } catch {
            return {};
          }
        })();
  const filename = String(d.filename || '');
  const rel_path = String(d.rel_path || '');
  if (!filename && !rel_path) return null;
  const body = String(d.body || '');
  const storedConcepto = String(d.concepto || '').trim();
  return {
    filename,
    rel_path,
    bank: String(d.bank || ''),
    amount: Number(d.amount ?? r.amount) || 0,
    date: (r.date || '').slice(0, 10),
    vendor: String(d.vendor || ''),
    body,
    concepto:
      storedConcepto ||
      body.replace(/\(\d{2,4}\)/g, '').replace(/[-_]+/g, ' ').trim(),
  };
}

/** Índice de PDFs de COMPROBANTES BANCARIOS (tras --index-pdfs). */
export function listPdfComprobantes(
  records: FinancialRecord[]
): PdfComprobanteHit[] {
  const out: PdfComprobanteHit[] = [];
  for (const r of records) {
    const hit = parsePdfIndexRecord(r);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Heurística: mismo banco + monto cercano + mismo año-mes.
 * Si no hay índice PDF, usa source_path del movimiento.
 */
export function findPdfForMovimiento(
  m: EstadoMovimiento,
  pdfs: PdfComprobanteHit[]
): PdfComprobanteHit | null {
  if (m.isEfectivo || m.isCxp) return null;
  if (m.raw.source_path) {
    return {
      filename: m.raw.source_path,
      rel_path: m.raw.source_path,
      bank: String(m.bank),
      amount: Math.abs(m.cargo || m.abono || m.amount || 0),
      date: m.date,
      vendor: '',
      body: '',
      concepto: '',
    };
  }
  if (!pdfs.length) return null;
  const amount = Math.abs(m.cargo || m.abono || m.amount || 0);
  if (!amount) return null;
  const [y, mo] = m.date.split('-').map(Number);
  const bank = String(m.bank).toUpperCase();
  let best: PdfComprobanteHit | null = null;
  let bestDelta = Infinity;
  for (const p of pdfs) {
    if (p.bank && p.bank.toUpperCase() !== bank) continue;
    const [py, pm] = p.date.split('-').map(Number);
    if (y && py && y !== py) continue;
    if (mo && pm && mo !== pm) continue;
    const delta = Math.abs(p.amount - amount);
    if (delta < bestDelta && delta <= Math.max(1, amount * 0.02)) {
      bestDelta = delta;
      best = p;
    }
  }
  return best;
}

/** Totales de cargo (gastos) por rubro normalizado, para comparar vs presupuesto. */
export function estadoTotalsByRubro(
  movements: EstadoMovimiento[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) {
    if (!m.matched_rubro) continue;
    const cargo = m.cargo != null && m.cargo !== 0 ? Math.abs(m.cargo) : 0;
    if (!cargo) continue;
    const key = normRubroKey(m.matched_rubro);
    map.set(key, (map.get(key) || 0) + cargo);
  }
  return map;
}

export function compareEstadoVsPresupuesto(
  movements: EstadoMovimiento[],
  rubroRows: RubroRow[]
): Array<{
  rubro: string;
  parent: string | null;
  presupuesto: number;
  estado: number;
  delta: number;
}> {
  const byEstado = estadoTotalsByRubro(movements);
  const out: Array<{
    rubro: string;
    parent: string | null;
    presupuesto: number;
    estado: number;
    delta: number;
  }> = [];

  for (const row of rubroRows) {
    if (row.isParent) continue;
    const key = normRubroKey(row.rubro);
    const estado = byEstado.get(key) || 0;
    if (estado === 0 && row.presupuesto === 0) continue;
    if (estado === 0) continue;
    out.push({
      rubro: row.rubro,
      parent: row.parent,
      presupuesto: row.presupuesto,
      estado,
      delta: estado - row.presupuesto,
    });
  }

  out.sort((a, b) => b.estado - a.estado);
  return out;
}

export function availableEstadoMonths(
  records: FinancialRecord[]
): Array<{ year: number; month: number }> {
  const set = new Set<string>();
  for (const r of records) {
    const m = parseEstadoMovimiento(r);
    if (!m) continue;
    const rawY =
      m.raw.year != null ? Number(m.raw.year) : null;
    const rawM =
      m.raw.month != null ? Number(m.raw.month) : null;
    if (rawY != null && !Number.isNaN(rawY) && rawM != null && !Number.isNaN(rawM)) {
      set.add(`${rawY}-${String(rawM).padStart(2, '0')}`);
      continue;
    }
    if (!m.date) continue;
    const [y, mo] = m.date.split('-');
    if (y && mo) set.add(`${y}-${mo}`);
  }
  return Array.from(set)
    .map((k) => {
      const [y, m] = k.split('-').map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

/** SEM del mes presentes en movimientos de efectivo / CXP / presupuesto_ingreso. */
export function availableEfectivoWeeks(
  records: FinancialRecord[],
  year: number,
  month: number
): number[] {
  const set = new Set<number>();
  for (const r of records) {
    if (
      !isFlujoMovSource(r.source_file) &&
      !isCxpSource(r.source_file) &&
      !isPresupuestoIngresoSource(r.source_file)
    ) {
      continue;
    }
    const m = parseEstadoMovimiento(r);
    if (!m?.week) continue;
    const rawY =
      m.raw.year != null ? Number(m.raw.year) : null;
    const rawM =
      m.raw.month != null ? Number(m.raw.month) : null;
    if (rawY != null && !Number.isNaN(rawY) && rawM != null && !Number.isNaN(rawM)) {
      if (rawY === year && rawM === month) set.add(m.week);
      continue;
    }
    const [y, mo] = m.date.split('-').map(Number);
    if (y === year && mo === month) set.add(m.week);
  }
  return Array.from(set).sort((a, b) => a - b);
}
