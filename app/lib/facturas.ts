import {
  parseIsoDate,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';
import {
  listPdfComprobantes,
  type PdfComprobanteHit,
} from '@/app/lib/estados-cuenta';

export const SOURCE_FACTURA_CFDI = 'factura_cfdi';

/** SAT TipoDeComprobante que cuentan como factura/gasto (no REP/pago). */
const CFDI_EXPENSE_TIPOS = new Set(['I', 'E']);

export interface FacturaItem {
  id: string;
  date: string;
  amount: number;
  uuid: string | null;
  folio: string | null;
  serie: string | null;
  emisor_rfc: string | null;
  emisor_nombre: string | null;
  receptor_rfc: string | null;
  /** SAT TipoDeComprobante: I/E/…; null si legacy sin campo. */
  tipo_comprobante: string | null;
  pdf_path: string | null;
  xml_path: string | null;
  has_pdf: boolean;
  has_xml: boolean;
  filename: string;
  gmail_id: string | null;
  subject: string | null;
}

/** True for CFDI complemento de pago / REP (TipoDeComprobante=P). */
export function isFacturaCfdiPagoRep(
  tipo: string | null | undefined
): boolean {
  return String(tipo || '').trim().toUpperCase() === 'P';
}

/**
 * True when CFDI should count as factura/gasto.
 * Missing tipo (legacy PDF) → allow. Explicit P/N/T → reject.
 */
export function isFacturaCfdiExpenseInvoice(
  tipo: string | null | undefined
): boolean {
  const t = String(tipo || '').trim().toUpperCase();
  if (!t) return true;
  return CFDI_EXPENSE_TIPOS.has(t);
}

export interface FacturaFaltante {
  id: string;
  date: string;
  amount: number;
  descripcion: string;
  razonSocial: string | null;
  folio: string | null;
  rfc: string | null;
  week: number | null;
  source_file: string;
  /** Best-effort match against indexed facturas (null = sin match) */
  matchedFacturaId: string | null;
  matchReason: string | null;
  /** IMSS / impuestos / institución de gobierno (sin CFDI típico). */
  gobierno: boolean;
  /** Nota corta para UI (p.ej. folio sin XML). */
  nota: string | null;
}

/** IMSS, SAT, SHCP, Hacienda, INFONAVIT, tesorería, etc. */
const GOV_TEXT_RE =
  /imss|infonavit|shcp|hacienda|impuesto|tesorer|secretaria|\bsat\b|\bisr\b|\biva\b|l[ií]nea\s*de\s*captura|instituto\s+mexicano/i;

export function isGobiernoGasto(...parts: Array<string | null | undefined>): boolean {
  return GOV_TEXT_RE.test(parts.filter(Boolean).join(' '));
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw || '{}')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function parseFacturaRecord(r: FinancialRecord): FacturaItem | null {
  if (r.source_file !== SOURCE_FACTURA_CFDI) return null;
  const d = parseJson(r.description);
  const tipo_comprobante = d.tipo_comprobante
    ? String(d.tipo_comprobante).trim().toUpperCase()
    : null;
  // Defensa en lectura: REP/pago (y N/T) no deben aparecer como factura/gasto
  // aunque hayan entrado a financial_records (ingest ya los omite).
  if (!isFacturaCfdiExpenseInvoice(tipo_comprobante)) return null;
  const pdf_path = d.pdf_path ? String(d.pdf_path) : null;
  const xml_path = d.xml_path ? String(d.xml_path) : null;
  return {
    id: r.id,
    date: String(d.fecha || r.date || '').slice(0, 10),
    amount: Number(d.total ?? r.amount) || 0,
    uuid: d.uuid ? String(d.uuid) : null,
    folio: d.folio != null ? String(d.folio) : null,
    serie: d.serie != null ? String(d.serie) : null,
    emisor_rfc: d.emisor_rfc ? String(d.emisor_rfc) : null,
    emisor_nombre:
      d.emisor_nombre
        ? String(d.emisor_nombre)
        : r.category && r.category !== 'Factura CFDI'
          ? r.category
          : null,
    receptor_rfc: d.receptor_rfc ? String(d.receptor_rfc) : null,
    tipo_comprobante,
    pdf_path,
    xml_path,
    has_pdf: Boolean(d.has_pdf ?? pdf_path),
    has_xml: Boolean(d.has_xml ?? xml_path),
    filename: String(d.filename || PathBasename(pdf_path || xml_path || '')),
    gmail_id: d.gmail_id ? String(d.gmail_id) : null,
    subject: d.subject ? String(d.subject) : null,
  };
}

/**
 * Suma de facturas CFDI (I/E) de un mes calendario — base de gastos
 * del Balance cuando hay sync Gmail/ERP. Excluye REP/pago (P) y N/T.
 */
export function sumFacturasGastoPorMes(
  records: FinancialRecord[],
  year: number,
  month: number
): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const r of records) {
    const f = parseFacturaRecord(r);
    if (!f) continue;
    const p = parseIsoDate(f.date);
    if (!p || p.y !== year || p.m !== month) continue;
    if (!Number.isFinite(f.amount) || f.amount === 0) continue;
    total += f.amount;
    count += 1;
  }
  return { total, count };
}

function PathBasename(p: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

export function listFacturas(records: FinancialRecord[]): FacturaItem[] {
  const out: FacturaItem[] = [];
  for (const r of records) {
    const f = parseFacturaRecord(r);
    if (f) out.push(f);
  }
  out.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (a.emisor_nombre || '').localeCompare(b.emisor_nombre || '', 'es');
  });
  return out;
}

function amountClose(a: number, b: number, tolPct = 0.02, tolAbs = 1): boolean {
  if (!a || !b) return false;
  const delta = Math.abs(a - b);
  return delta <= Math.max(tolAbs, Math.abs(a) * tolPct);
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 999;
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/**
 * Gastos/CXP sin factura CFDI indexada (best-effort).
 * Incluye IMSS/impuestos/gobierno aunque tengan Fac en CXP (suele faltar XML).
 */
export function listFacturasFaltantes(
  records: FinancialRecord[],
  opts: { year?: number; month?: number; day?: number; dayTol?: number } = {}
): FacturaFaltante[] {
  const facturas = listFacturas(records);
  const dayTol = opts.dayTol ?? 10;
  const usedFacturaIds = new Set<string>();
  const faltantes: FacturaFaltante[] = [];

  for (const r of records) {
    if (r.type !== 'expense') continue;
    const src = r.source_file || '';
    // CXP pagos y gastos de presupuesto detalle / flujo / estados
    if (
      src !== 'cxp' &&
      src !== 'presupuesto_sem_detalle' &&
      src !== 'flujo_efectivo_mov' &&
      src !== 'estado_mifel' &&
      src !== 'estado_bbva'
    ) {
      continue;
    }
    const d = parseJson(r.description);
    const amount = Math.abs(Number(d.cargo ?? d.egreso ?? r.amount) || 0);
    if (!amount) continue;
    const fecha = String(d.fecha || r.date || '').slice(0, 10);
    if (!fecha) continue;
    if (opts.year || opts.month || opts.day) {
      const [y, m, day] = fecha.split('-').map(Number);
      if (opts.year && y !== opts.year) continue;
      if (opts.month && m !== opts.month) continue;
      if (opts.day && day !== opts.day) continue;
    }

    const folio =
      d.factura != null
        ? String(d.factura)
        : d.folio != null
          ? String(d.folio)
          : null;
    const rfc = d.rfc ? String(d.rfc) : null;
    const descripcion = String(
      d.concepto || d.descripcion || r.category || ''
    ).trim();
    const razonSocial =
      d.razon_social != null ? String(d.razon_social) : null;
    const category = String(r.category || '');
    const gobierno = isGobiernoGasto(
      descripcion,
      razonSocial,
      category,
      folio
    );

    // Prefer folio/RFC match (also covers Fac variants for tax payments)
    const matched = findFacturaForMovimiento(
      {
        amount,
        date: fecha,
        folio,
        rfc,
        razonSocial,
        descripcion: `${descripcion} ${category}`,
      },
      facturas,
      { dayTol }
    );
    if (matched && !usedFacturaIds.has(matched.id)) {
      usedFacturaIds.add(matched.id);
      continue;
    }

    // Include CXP even with Fac when CFDI is missing (grey "sin XML" in Gastos),
    // especially IMSS / impuestos / gobierno that rarely arrive as XML in Gmail.
    let nota: string | null = null;
    if (gobierno) {
      nota = folio
        ? 'Institución de gobierno · Fac sin CFDI indexado'
        : 'Institución de gobierno · sin CFDI (comprobante de pago)';
    } else if (folio && folio !== '—' && folio.trim()) {
      nota = 'Folio en CXP sin XML/PDF indexado';
    }

    faltantes.push({
      id: r.id,
      date: fecha,
      amount,
      descripcion,
      razonSocial,
      folio,
      rfc,
      week: d.week != null ? Number(d.week) : d.semana != null ? Number(d.semana) : null,
      source_file: src,
      matchedFacturaId: null,
      matchReason: null,
      gobierno,
      nota,
    });
  }

  // Government / tax first within same date, then others
  faltantes.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.gobierno !== b.gobierno) return a.gobierno ? -1 : 1;
    return (a.descripcion || '').localeCompare(b.descripcion || '', 'es');
  });
  return faltantes;
}

const GOV_MATCH_KEYS = [
  'imss',
  'infonavit',
  'hacienda',
  'shcp',
  'impuesto',
  'tesorer',
  'sat',
  'isr',
  'iva',
] as const;

function sharedGobiernoKey(a: string, b: string): string | null {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  for (const k of GOV_MATCH_KEYS) {
    if (al.includes(k) && bl.includes(k)) return k;
  }
  return null;
}

/** Match a gasto/factura row to a payment comprobante PDF by amount/vendor/week. */
export function findComprobanteForFacturaLike(
  opts: {
    amount: number;
    date: string;
    vendor?: string | null;
    week?: number | null;
    bank?: string | null;
  },
  records: FinancialRecord[],
  /** Pass a precomputed list to avoid O(n) rebuild per row (API list path). */
  pdfsPrecomputed?: PdfComprobanteHit[]
): PdfComprobanteHit | null {
  const pdfs = pdfsPrecomputed ?? listPdfComprobantes(records);
  if (!pdfs.length || !opts.amount) return null;
  const facturaDate = String(opts.date || '').slice(0, 10);
  const [y, mo] = facturaDate.split('-').map(Number);
  const vendorQ = (opts.vendor || '').toLowerCase().trim();
  const vendorIsGov = isGobiernoGasto(vendorQ);
  let best: PdfComprobanteHit | null = null;
  let bestScore = -1;

  for (const p of pdfs) {
    if (!amountClose(opts.amount, p.amount)) continue;
    const payDate = String(p.date || '').slice(0, 10);
    // Operación habitual: llega la factura y luego se paga.
    // No ligar un comprobante con fecha anterior a la factura/gasto.
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(facturaDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(payDate) &&
      payDate < facturaDate
    ) {
      continue;
    }
    const [py, pm] = payDate.split('-').map(Number);
    if (y && py && y !== py) continue;
    // Prefer same month; allow +N months after invoice (gov tax calendars wider)
    const monthTol = vendorIsGov ? 2 : 1;
    if (mo && pm) {
      const monthDelta = (py - y) * 12 + (pm - mo);
      if (monthDelta < 0 || monthDelta > monthTol) continue;
    }

    const hay = `${p.vendor} ${p.concepto} ${p.body} ${p.filename}`.toLowerCase();
    let score = 1;
    if (mo && pm && mo === pm) score += 1;
    // Prefer payment on/near the invoice date (same day best)
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(facturaDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(payDate)
    ) {
      const daysAfter = Math.round(
        (new Date(payDate + 'T12:00:00').getTime() -
          new Date(facturaDate + 'T12:00:00').getTime()) /
          86400000
      );
      if (daysAfter === 0) score += 3;
      else if (daysAfter <= 7) score += 2;
      else if (daysAfter <= 31) score += 1;
    }
    if (opts.week != null && /sem\s*(\d+)/i.test(p.body || p.concepto || '')) {
      const wm = (p.body || p.concepto || '').match(/sem\s*(\d+)/i);
      if (wm && Number(wm[1]) === opts.week) score += 2;
    }
    if (vendorQ) {
      if (hay.includes(vendorQ.slice(0, 10))) score += 2;
      const govKey = sharedGobiernoKey(vendorQ, hay);
      if (govKey) score += 3;
    }
    if (opts.bank && p.bank && opts.bank.toUpperCase() === p.bank.toUpperCase()) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function normFolio(v: string | null | undefined): string {
  return String(v || '')
    .trim()
    .replace(/^fac(tura)?\s*/i, '')
    .replace(/^#/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Digits only, strip leading zeros (CXP "5740" ↔ CFDI "QROFA-05740"). */
function folioDigits(v: string | null | undefined): string {
  const d = normFolio(v).replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/^0+/, '') || '0';
}

/**
 * CXP often truncates SAT "Número de operación" (26171020658 vs 261710206658).
 * True when equal, one contains the other (≥8 digits), or single-digit insert/delete.
 */
function folioDigitsNearlyEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 8 || b.length < 8) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (longer.length - shorter.length !== 1) return false;
  for (let i = 0; i < longer.length; i++) {
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) return true;
  }
  return false;
}

/**
 * Keys for a CFDI folio: raw, serie+folio, digits-only, and letter-prefix stripped
 * (QROFA-05884 → 5884; PAG136247 → 136247; VCC6014690 → 6014690).
 */
function facturaFolioKeys(f: FacturaItem): string[] {
  const keys = new Set<string>();
  const folio = normFolio(f.folio);
  const serie = normFolio(f.serie).replace(/-+$/, ''); // "QROFA-" → "QROFA"
  if (folio) keys.add(folio);
  if (serie && folio) {
    keys.add(`${serie}${folio}`);
    keys.add(`${serie}-${folio}`);
  }
  const digFolio = folioDigits(f.folio);
  const digCombo = folioDigits(`${serie}${f.folio || ''}`);
  if (digFolio) keys.add(digFolio);
  if (digCombo) keys.add(digCombo);
  // Folio already embeds serie: "QROFA-05884" / "PAG136247"
  const embedded = folio.match(/^([A-Z]+)[-_]?(\d+)$/);
  if (embedded) {
    keys.add(embedded[1] + embedded[2]);
    keys.add(`${embedded[1]}-${embedded[2]}`);
    keys.add(folioDigits(embedded[2]));
  }
  return [...keys].filter(Boolean);
}

/** Normalize a CXP "NO. DE FACTURA" cell into candidate folio strings. */
function cxpFolioCandidates(raw: string): string[] {
  const parts = String(raw || '')
    .split(/[/,;|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    out.push(part);
    // "VCC 6014690" / "Fac 791" / float residue "791.0"
    const cleaned = part.replace(/\.0$/i, '').trim();
    if (cleaned !== part) out.push(cleaned);
    const m = cleaned.match(/^([A-Za-z]+)\s*[-_]?\s*(\d+)$/);
    if (m) {
      out.push(m[2]);
      out.push(`${m[1]}${m[2]}`);
      out.push(`${m[1]}-${m[2]}`);
    }
  }
  return out;
}

function significantVendorTokens(s: string): string[] {
  const stop = new Set([
    'sa',
    'de',
    'cv',
    's',
    'rl',
    'sab',
    'the',
    'y',
    'la',
    'el',
    'los',
    'las',
    'del',
    'sociedad',
    'anonima',
    'anónima',
  ]);
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !stop.has(t));
}

function vendorLooseMatch(
  vendor: string,
  emisor: string | null | undefined
): boolean {
  if (!vendor || !emisor) return false;
  const v = vendor.toLowerCase().replace(/\s+/g, ' ').trim();
  const e = emisor.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!v || !e) return false;
  const vKey = v.slice(0, 12);
  const eKey = e.slice(0, 12);
  if (e.includes(vKey) || v.includes(eKey)) return true;
  // Token overlap: "SUKARNE SA DE CV" ↔ "SUKARNE"; "PROPIMEX…" ↔ "PROPIMEX S DE RL…"
  const vt = significantVendorTokens(v);
  const et = significantVendorTokens(e);
  if (vt.some((t) => et.includes(t) || e.includes(t)) || et.some((t) => v.includes(t))) {
    return true;
  }
  // Tax / government: "SECRETARIA DE HACIENDA" ↔ "SAT" / "SHCP" / "Impuestos"
  return Boolean(sharedGobiernoKey(v, e));
}

/**
 * Best-effort match gasto/CXP → factura_cfdi
 * (folio normalizado / serie+folio / dígitos únicos, luego monto±1 + proveedor + fecha±7).
 */
export function findFacturaForMovimiento(
  mov: {
    amount: number;
    date: string;
    folio?: string | null;
    rfc?: string | null;
    razonSocial?: string | null;
    descripcion?: string | null;
  },
  facturas: FacturaItem[],
  opts: { dayTol?: number } = {}
): FacturaItem | null {
  if (!facturas.length) return null;
  const dayTol = opts.dayTol ?? 7;

    // CXP sometimes stores "93687 / 93773 / 93800", "VCC 6014690", "791.0"
    const candidates = cxpFolioCandidates(String(mov.folio || ''));
    if (!candidates.length && mov.folio) candidates.push(String(mov.folio));

    for (const part of candidates) {
      const folioQ = normFolio(part);
      const digQ = folioDigits(part);
      if (!folioQ || folioQ === '—' || folioQ === '-') continue;

      const exactHits = facturas.filter((f) => {
        const keys = facturaFolioKeys(f);
        return keys.includes(folioQ) || (digQ !== '' && keys.includes(digQ));
      });
      if (exactHits.length === 1) return exactHits[0];
      if (exactHits.length > 1) {
        const amount = Math.abs(mov.amount) || 0;
        const vendor = (mov.razonSocial || mov.descripcion || '').toLowerCase();
        const rfc = (mov.rfc || '').trim().toUpperCase();
        let narrowed = exactHits.filter((f) =>
          amountClose(amount, f.amount, 0.02, 1)
        );
        if (narrowed.length === 1) return narrowed[0];
        const pool = narrowed.length ? narrowed : exactHits;
        const vendorNarrowed = pool.filter(
          (f) =>
            (rfc && f.emisor_rfc && rfc === f.emisor_rfc.toUpperCase()) ||
            vendorLooseMatch(vendor, f.emisor_nombre)
        );
        if (vendorNarrowed.length === 1) return vendorNarrowed[0];
        if (vendorNarrowed.length > 1 && amount) {
          const both = vendorNarrowed.filter((f) =>
            amountClose(amount, f.amount, 0.02, 1)
          );
          if (both.length === 1) return both[0];
        }
      }

      // Partial / trailing digits: prefer unique; else amount (+ vendor) disambiguate.
      // Allow short folios (≥3) when vendor/RFC also matches (MR & AB "235").
      // SAT operación: CXP may drop a digit (26171020658 ↔ 261710206658).
      if (digQ && digQ.length >= 3) {
        const partial = facturas.filter((f) => {
          const keys = facturaFolioKeys(f);
          return keys.some(
            (k) =>
              k === digQ ||
              (/^\d+$/.test(k) &&
                (k.endsWith(digQ) || folioDigitsNearlyEqual(k, digQ)))
          );
        });
        if (partial.length === 1) return partial[0];
        if (partial.length > 1) {
          const amount = Math.abs(mov.amount) || 0;
          let narrowed = partial.filter((f) =>
            amountClose(amount, f.amount, 0.02, 1)
          );
          if (narrowed.length === 1) return narrowed[0];
          const vendor = (mov.razonSocial || mov.descripcion || '').toLowerCase();
          const rfc = (mov.rfc || '').trim().toUpperCase();
          const vendorNarrowed = (narrowed.length ? narrowed : partial).filter(
            (f) =>
              (rfc && f.emisor_rfc && rfc === f.emisor_rfc.toUpperCase()) ||
              vendorLooseMatch(vendor, f.emisor_nombre)
          );
          if (vendorNarrowed.length === 1) return vendorNarrowed[0];
          if (vendorNarrowed.length > 1 && amount) {
            const both = vendorNarrowed.filter((f) =>
              amountClose(amount, f.amount, 0.02, 1)
            );
            if (both.length === 1) return both[0];
          }
          // Government: further narrow by vendor keywords when several digit hits
          if (isGobiernoGasto(mov.razonSocial, mov.descripcion, mov.folio)) {
            const govHit = narrowed.filter((f) =>
              isGobiernoGasto(f.emisor_nombre, f.filename, f.subject)
            );
            if (govHit.length === 1) return govHit[0];
          }
        }
      }
    }

  const amount = Math.abs(mov.amount) || 0;
  if (!amount || !mov.date) return null;
  const rfc = (mov.rfc || '').trim().toUpperCase();
  const vendor = (mov.razonSocial || mov.descripcion || '').toLowerCase();

  let best: FacturaItem | null = null;
  let bestScore = 0;
  const govMov = isGobiernoGasto(mov.razonSocial, mov.descripcion, mov.folio);
  const effectiveDayTol = govMov ? Math.max(dayTol, 14) : dayTol;
  for (const f of facturas) {
    // Fallback: monto ±1 peso (o 2%), fecha ±dayTol, RFC o nombre proveedor
    if (!amountClose(amount, f.amount, 0.02, 1)) continue;
    const days = daysBetween(mov.date, f.date);
    if (days > effectiveDayTol) continue;
    let score = 1 - days / (effectiveDayTol + 1);
    const rfcHit =
      Boolean(rfc) &&
      Boolean(f.emisor_rfc) &&
      rfc === f.emisor_rfc!.toUpperCase();
    const vendorHit = vendorLooseMatch(vendor, f.emisor_nombre);
    const govHit =
      govMov && isGobiernoGasto(f.emisor_nombre, f.filename, f.subject);
    if (rfcHit) score += 2;
    if (vendorHit) score += 1;
    if (govHit) score += 1;
    // Require RFC or vendor signal for amount/date fallback (avoid false positives)
    if (!rfcHit && !vendorHit && !govHit) continue;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** Companion PDF next to an XML (same stem, .pdf). */
export function companionPdfPathFromXml(xmlPath: string | null | undefined): string | null {
  if (!xmlPath) return null;
  const lower = xmlPath.toLowerCase();
  if (!lower.endsWith('.xml')) return null;
  return xmlPath.slice(0, -4) + '.pdf';
}

/** Effective PDF path: stored pdf_path, else companion beside xml_path. */
export function facturaEffectivePdfPath(f: {
  pdf_path?: string | null;
  xml_path?: string | null;
  has_pdf?: boolean;
}): string | null {
  if (f.pdf_path) return f.pdf_path;
  // has_pdf without path is rare; still try companion from XML
  return companionPdfPathFromXml(f.xml_path);
}

/** URL de archivo de factura vía `?open=`. `download: true` fuerza attachment. */
export function facturaOpenHref(
  filePath: string,
  opts?: { download?: boolean }
): string {
  const base = `/api/facturas?open=${encodeURIComponent(filePath)}`;
  return opts?.download ? `${base}&download=1` : base;
}

/** URL para ver PDF en el navegador (Content-Disposition: inline). */
export function facturaPdfViewHref(f: FacturaItem): string | null {
  if (f.id && (f.has_pdf || facturaEffectivePdfPath(f) || f.gmail_id)) {
    return `/api/facturas?id=${encodeURIComponent(f.id)}&format=pdf`;
  }
  const pdf = facturaEffectivePdfPath(f);
  return pdf ? facturaOpenHref(pdf) : null;
}

/** URL de descarga PDF (preferido) o XML vía API existente. */
export function facturaDownloadHref(f: FacturaItem): string | null {
  if (f.id && (f.has_pdf || facturaEffectivePdfPath(f) || f.xml_path || f.gmail_id)) {
    const format =
      f.has_pdf || facturaEffectivePdfPath(f) ? 'pdf' : f.has_xml || f.xml_path ? 'xml' : 'pdf';
    return `/api/facturas?id=${encodeURIComponent(f.id)}&format=${format}&download=1`;
  }
  const filePath = facturaEffectivePdfPath(f) || f.xml_path;
  return filePath ? facturaOpenHref(filePath, { download: true }) : null;
}

/** Descarga XML: por id (Vercel/Gmail) o path local. */
export function facturaXmlHref(f: FacturaItem): string | null {
  if (!(f.has_xml || f.xml_path)) return null;
  if (f.id) {
    return `/api/facturas?id=${encodeURIComponent(f.id)}&format=xml&download=1`;
  }
  return f.xml_path ? facturaOpenHref(f.xml_path, { download: true }) : null;
}

/** Descarga PDF aunque no haya XML (acuse / solo PDF). */
export function facturaPdfHref(f: FacturaItem): string | null {
  if (!(f.has_pdf || facturaEffectivePdfPath(f) || f.gmail_id)) return null;
  if (f.id) {
    return `/api/facturas?id=${encodeURIComponent(f.id)}&format=pdf&download=1`;
  }
  const pdf = facturaEffectivePdfPath(f);
  return pdf ? facturaOpenHref(pdf, { download: true }) : null;
}

export function facturaLabel(f: FacturaItem): string {
  const sf = [f.serie, f.folio].filter(Boolean).join('-');
  return sf || f.folio || f.filename || 'Factura';
}
