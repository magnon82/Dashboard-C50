/**
 * Separa un PDF paquete de alta (Documentos.pdf / DOCS.*) en un PDF por tipo.
 *
 * Estrategia (prioridad):
 *  1) Texto por página: pdftotext → streams PDF (FlateDecode + operadores Tj/TJ)
 *  2) Clasificación por palabras clave / patrones (CURP, Acta, INE…) — manda sobre orden
 *  3) OCR ligero (pdftoppm + tesseract) solo si casi no hay texto y hay ≤8 págs
 *  4) Heurística de orden mexicano solo para páginas sin señal: INE→Acta→CURP→Domicilio→CV
 *
 * Reglas duras:
 *  - Marca constancia CURP / RENAPO / SEGOB → curp (nunca acta), aunque cite acta.
 *  - Título/layout «Acta de Nacimiento» → acta (aunque traiga campo CURP).
 *  - Credencial INE/IFE → ine (nunca acta).
 */

import 'server-only';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { inflateSync } from 'zlib';
import { PDFDocument } from 'pdf-lib';
import type { HrDocTypeId } from '@/app/lib/hr-employee-profile';

const execFileAsync = promisify(execFile);

/** Tipos que el paquete de alta suele cubrir (mismo orden operativo C50). */
export const PACK_DOC_ORDER: HrDocTypeId[] = [
  'ine',
  'acta_nacimiento',
  'curp',
  'comprobante_domicilio',
  'cv',
];

export type PackPageRange = {
  docType: HrDocTypeId;
  /** Índices 0-based inclusive. */
  start: number;
  end: number;
};

export type PackSplitResult = {
  pageCount: number;
  method: 'keywords' | 'heuristic' | 'ocr' | 'single';
  parts: Array<{
    docType: HrDocTypeId;
    pages: number[];
    bytes: Uint8Array;
    pageLabel: string;
  }>;
};

export type PdfDocClassification = {
  docType: HrDocTypeId | null;
  scores: Partial<Record<HrDocTypeId, number>>;
  textSample: string;
  method: 'keywords' | 'ocr' | 'empty';
};

const KEYWORD_RULES: Array<{
  docType: HrDocTypeId;
  patterns: RegExp[];
  weight: number;
}> = [
  {
    docType: 'ine',
    weight: 3,
    patterns: [
      /\binstituto\s+nacional\s+electoral\b/,
      /\binstituto\s+federal\s+electoral\b/,
      /\bcredencial\s+para\s+votar\b/,
      /\bclave\s+de\s+elector\b/,
      // Evitar `\belector\b` / `\bine\b` sueltos: OCR y actas disparan falsos positivos.
      /\b(?:ine|ife)\b.{0,40}\b(?:votar|elector|credencial)\b/,
      /\b(?:votar|elector|credencial)\b.{0,40}\b(?:ine|ife)\b/,
    ],
  },
  {
    docType: 'curp',
    weight: 4,
    patterns: [
      // Marca de constancia (no el campo CURP de un acta).
      /\bconstancia\s+de\s+la\s+clave\s+unica\b/,
      /\bconstancia\s+de\s+(?:la\s+)?curp\b/,
      /\bclave\s+unica\s+de\s+registro\s+(?:de\s+)?poblacion\b/,
      /\brenapo\b/,
      /\bsegob\b/,
      /\bsecretaria\s+de\s+gobernacion\b/,
      /\bregistro\s+nacional\s+de\s+poblacion\b/,
      // OCR a menudo pierde "nacional"
      /\bregistro\s+de\s+poblacion\b/,
      /\bclave\s+unica\b/,
      // Folio CURP 18 chars (texto, espacios OCR, o pegado) — peso vía regla, no decide solo.
      /\b[a-z]{4}\s*\d{6}\s*[hm]\s*[a-z]{2}[a-z0-9]{3}\s*[0-9a-z]\s*\d\b/,
      /[a-z]{4}\d{6}[hm][a-z]{5}[0-9a-z]\d/,
    ],
  },
  {
    docType: 'acta_nacimiento',
    weight: 3,
    patterns: [
      /\bacta\s+de\s+nacimiento\b/,
      /\bcertificado\s+de\s+nacimiento\b/,
      /\bestados\s+unidos\s+mexicanos\b/,
      /\bidentificador\s+electronico\b/,
      /\bregistro\s+civil\b/,
      /\boficialia\b/,
      /\bnacido\s+en\b/,
      /\bfoja\b/,
      /\blibro\s+\d+/,
      /\bdatos\s+de\s+la\s+acta\b/,
      /\bdatos\s+de\s+la\s+persona\s+registrada\b/,
      /\bdatos\s+de\s+filiacion\b/,
      /\bentidad\s+de\s+registro\b/,
      /\bmunicipio\s+de\s+registro\b/,
      /\bnumero\s+de\s+acta\b/,
      /\bfecha\s+de\s+registro\b/,
    ],
  },
  {
    docType: 'comprobante_domicilio',
    weight: 2,
    patterns: [
      /\bcomprobante\s+de\s+domicilio\b/,
      /\bcfe\b/,
      /\bmegacable\b/,
      /\bmega\s*movil\b/,
      /\bmega\b/,
      /\btelmex\b/,
      /\btotalplay\b/,
      /\bizzi\b/,
      /\bpredial\b/,
      /\bsuscriptor\b/,
      /\bpaga\s+en\s+centros\s+de\s+cobro\b/,
      /\brecibo\s+de\s+(agua|luz|gas|telefono)\b/,
      /\bservicio\s+de\s+(agua|luz|gas)\b/,
      /\bperiodo\s+de\s+facturacion\b/,
    ],
  },
  {
    docType: 'cv',
    weight: 2,
    patterns: [
      /\bcurriculum\b/,
      /\bcurriculo\b/,
      /\bexperiencia\s+laboral\b/,
      /\bobjetivo\s+profesional\b/,
      /\beducacion\b/,
      /\bhabilidades\b/,
      /\breferencias\s+laborales\b/,
    ],
  },
];

function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasCurpCode(n: string): boolean {
  return (
    /\b[a-z]{4}\s*\d{6}\s*[hm]\s*[a-z]/.test(n) ||
    /[a-z]{4}\d{6}[hm][a-z]{5}[0-9a-z]\d/.test(n)
  );
}

/** Título / marca de constancia CURP (SEGOB / RENAPO). Independiente del acta. */
export function curpConstanciaBrandSignals(nRaw: string): boolean {
  const n = normalizeText(nRaw);
  return (
    /\bconstancia\s+de\s+la\s+clave\s+unica\b/.test(n) ||
    /\bconstancia\s+de\s+(?:la\s+)?curp\b/.test(n) ||
    /\bconstancia\b.{0,80}\bclave\s+unica\b/.test(n) ||
    /\bclave\s+unica\s+de\s+registro\s+(?:de\s+)?poblacion\b/.test(n) ||
    /\bclave\s+unica\b.{0,40}\b(?:registro|poblacion|curp)\b/.test(n) ||
    /\brenapo\b/.test(n) ||
    (/\bsegob\b/.test(n) &&
      (/\bcurp\b/.test(n) || /\bclave\s+unica\b/.test(n) || hasCurpCode(n))) ||
    (/\bsecretaria\s+de\s+gobernacion\b/.test(n) &&
      (/\bcurp\b/.test(n) ||
        /\bclave\s+unica\b/.test(n) ||
        /\bconstancia\b/.test(n) ||
        hasCurpCode(n))) ||
    (/\bcurp\b/.test(n) &&
      /\bregistro\s+(nacional\s+de\s+)?poblacion\b/.test(n) &&
      !/\bacta\s+de\s+nacimiento\b/.test(n))
  );
}

function hasActaTitle(n: string): boolean {
  return (
    /\bacta\s+de\s+nacimiento\b/.test(n) ||
    /\bcertificado\s+de\s+nacimiento\b/.test(n)
  );
}

/** Layout / marca de acta electrónica o de registro civil. */
function hasActaLayout(n: string): boolean {
  return (
    /\bdatos\s+de\s+la\s+persona\s+registrada\b/.test(n) ||
    /\bdatos\s+de\s+filiacion\b/.test(n) ||
    /\bentidad\s+de\s+registro\b/.test(n) ||
    /\bmunicipio\s+de\s+registro\b/.test(n) ||
    /\boficialia\b/.test(n) ||
    /\bfoja\b/.test(n) ||
    /\bdatos\s+de\s+la\s+acta\b/.test(n) ||
    /\bidentificador\s+electronico\b/.test(n) ||
    (/\bestados\s+unidos\s+mexicanos\b/.test(n) && hasActaTitle(n)) ||
    (/\bregistro\s+civil\b/.test(n) &&
      (/\blibro\b/.test(n) || /\bnumero\s+de\s+acta\b/.test(n) || /\bfoja\b/.test(n)))
  );
}

/**
 * Layout / título de Acta.
 * El acta moderna trae campo CURP — eso no la convierte en constancia.
 * Si hay marca de constancia CURP, nunca es acta.
 */
export function clearlyActaSignals(nRaw: string): boolean {
  const n = normalizeText(nRaw);
  if (curpConstanciaBrandSignals(n)) return false;

  const titleActa = hasActaTitle(n);
  const layout = hasActaLayout(n);

  if (titleActa && layout) return true;
  // Título solo: actas escaneadas a menudo solo exponen el encabezado.
  if (titleActa) return true;
  // Layout fuerte sin título OCR (borde / folio electrónico).
  if (
    layout &&
    (/\bidentificador\s+electronico\b/.test(n) ||
      /\bdatos\s+de\s+filiacion\b/.test(n) ||
      /\bdatos\s+de\s+la\s+persona\s+registrada\b/.test(n))
  ) {
    return true;
  }
  return false;
}

export function clearlyIneSignals(nRaw: string): boolean {
  const n = normalizeText(nRaw);
  return (
    /\binstituto\s+nacional\s+electoral\b/.test(n) ||
    /\binstituto\s+federal\s+electoral\b/.test(n) ||
    /\bcredencial\s+para\s+votar\b/.test(n) ||
    /\bclave\s+de\s+elector\b/.test(n) ||
    (/\b(?:ine|ife)\b/.test(n) &&
      (/\bvotar\b/.test(n) ||
        /\belector\b/.test(n) ||
        /\bcredencial\b/.test(n)))
  );
}

/**
 * Constancia CURP / RENAPO / SEGOB.
 * Marca de constancia gana aunque el texto legal cite “acta de nacimiento”.
 * Un folio CURP suelto en un acta NO basta.
 */
export function clearlyCurpConstanciaSignals(nRaw: string): boolean {
  const n = normalizeText(nRaw);
  if (curpConstanciaBrandSignals(n)) return true;
  // Sin marca de constancia: no reclamar si el documento es claramente un acta.
  if (clearlyActaSignals(n)) return false;
  return (
    (/\bclave\s+unica\b/.test(n) &&
      /\bregistro\s+(nacional\s+de\s+)?poblacion\b/.test(n) &&
      !hasActaTitle(n)) ||
    (/\bconstancia\b/.test(n) &&
      /\bcurp\b/.test(n) &&
      !hasActaTitle(n) &&
      !hasActaLayout(n))
  );
}

/**
 * Recibo / factura de servicios (CFE, MEGA, Telmex…).
 * El titular puede ser familiar, amigo o arrendador — no se exige el nombre del empleado.
 */
export function clearlyDomicilioSignals(nRaw: string): boolean {
  const n = normalizeText(nRaw);
  if (
    clearlyCurpConstanciaSignals(n) ||
    clearlyIneSignals(n) ||
    clearlyActaSignals(n)
  ) {
    return false;
  }
  return (
    /\bcomprobante\s+de\s+domicilio\b/.test(n) ||
    /\bmegacable\b/.test(n) ||
    /\bmega\s*movil\b/.test(n) ||
    (/\bmega\b/.test(n) &&
      (/\bsuscriptor\b/.test(n) ||
        /\bcobro\b/.test(n) ||
        /\bfactur/.test(n) ||
        /\btelefono\b/.test(n))) ||
    /\bcfe\b/.test(n) ||
    /\bluz\s+y\s+fuerza\b/.test(n) ||
    /\btelmex\b/.test(n) ||
    /\btotalplay\b/.test(n) ||
    /\bizzi\b/.test(n) ||
    /\bpredial\b/.test(n) ||
    /\bsuscriptor\b/.test(n) ||
    /\bpaga\s+en\s+centros\s+de\s+cobro\b/.test(n) ||
    /\bperiodo\s+de\s+facturacion\b/.test(n) ||
    /\brecibo\s+de\s+(agua|luz|gas|telefono)\b/.test(n) ||
    /\bservicio\s+de\s+(agua|luz|gas|internet|telefonia)\b/.test(n)
  );
}

function pageTextIsWeak(nRaw: string): boolean {
  return normalizeText(nRaw).replace(/\s+/g, '').length < 12;
}

function scorePageText(text: string): Map<HrDocTypeId, number> {
  const n = normalizeText(text);
  const scores = new Map<HrDocTypeId, number>();
  for (const rule of KEYWORD_RULES) {
    let s = 0;
    for (const re of rule.patterns) {
      if (re.test(n)) s += rule.weight;
    }
    if (s > 0) scores.set(rule.docType, s);
  }

  const curp = scores.get('curp') || 0;
  const acta = scores.get('acta_nacimiento') || 0;
  const ine = scores.get('ine') || 0;
  const brandCurp = curpConstanciaBrandSignals(n);
  const clearlyActa = clearlyActaSignals(n);
  const clearlyIne = clearlyIneSignals(n);
  const clearlyCurpDoc = clearlyCurpConstanciaSignals(n);

  // Prioridad: marca constancia CURP > Acta (título/layout) > INE > scores.
  // El acta moderna incluye folio CURP; eso no la convierte en constancia.
  if (brandCurp || (clearlyCurpDoc && !clearlyActa)) {
    scores.delete('acta_nacimiento');
    scores.delete('ine');
    scores.set('curp', Math.max(curp, 12));
  } else if (clearlyActa && !clearlyIne) {
    scores.delete('ine');
    scores.set('acta_nacimiento', Math.max(acta, 12));
    // Campo CURP del acta: no competir con la constancia.
    if (curp > 0) scores.set('curp', Math.min(curp, 2));
  } else if (clearlyIne && !clearlyActa) {
    scores.delete('acta_nacimiento');
    scores.set('ine', Math.max(ine, 12));
  } else if (clearlyActa && clearlyIne) {
    if (hasActaTitle(n)) {
      scores.delete('ine');
      scores.set('acta_nacimiento', Math.max(acta, 12));
      if (curp > 0) scores.set('curp', Math.min(curp, 2));
    } else {
      scores.delete('acta_nacimiento');
      scores.set('ine', Math.max(ine, 12));
    }
  } else if (curp > 0 && acta > 0) {
    // Empate débil: preferir título de acta sobre folio CURP suelto.
    if (hasActaTitle(n) || hasActaLayout(n)) {
      scores.set('acta_nacimiento', Math.max(acta, 10));
      scores.set('curp', Math.min(curp, 2));
    } else if (
      /\brenapo\b/.test(n) ||
      /\bclave\s+unica\b/.test(n) ||
      /\bregistro\s+(nacional\s+de\s+)?poblacion\b/.test(n) ||
      /\bsegob\b/.test(n) ||
      /\bconstancia\b/.test(n)
    ) {
      scores.delete('acta_nacimiento');
      scores.set('curp', Math.max(curp, acta) + 4);
    }
    // Folio CURP solo + keywords débiles de acta: no forzar curp ni acta.
  } else if (acta > 0 && !clearlyActa && !brandCurp) {
    // OCR: sin título de acta; folio CURP + registro población → constancia.
    if (
      (hasCurpCode(n) || /\bregistro\s+de\s+poblacion\b/.test(n)) &&
      !/\bregistro\s+civil\b/.test(n) &&
      !/\boficialia\b/.test(n) &&
      !/\bidentificador\s+electronico\b/.test(n)
    ) {
      scores.set('curp', Math.max(curp, 8));
      scores.delete('acta_nacimiento');
    }
  }

  // INE débil vs acta: si hay score INE residual pero el texto es acta, quitar INE.
  if ((scores.get('ine') || 0) > 0 && clearlyActaSignals(n)) {
    scores.delete('ine');
  }

  return scores;
}

/**
 * Clasifica texto ya extraído (keywords + reglas duras).
 * Útil para pruebas y reparación de slots.
 */
export function detectDocTypeFromText(text: string): HrDocTypeId | null {
  const scoresMap = scorePageText(text);
  const n = normalizeText(text);
  // Constancia CURP primero: nunca debe caer en slot de acta.
  if (clearlyCurpConstanciaSignals(n) || curpConstanciaBrandSignals(n)) {
    return 'curp';
  }
  if (clearlyDomicilioSignals(n)) {
    return 'comprobante_domicilio';
  }
  if (clearlyActaSignals(n) && !clearlyIneSignals(n)) {
    return 'acta_nacimiento';
  }
  if (clearlyIneSignals(n) && !clearlyActaSignals(n)) {
    return 'ine';
  }
  return pickDocType(scoresMap, 3) || pickDocType(scoresMap, 2);
}

/**
 * Elige el tipo ganador. Umbral bajo si hay señal CURP/INE/Acta inequívoca.
 */
function pickDocType(
  scores: Map<HrDocTypeId, number>,
  minScore = 3
): HrDocTypeId | null {
  let best: HrDocTypeId | null = null;
  let bestScore = 0;
  for (const [docType, s] of scores) {
    if (s > bestScore) {
      bestScore = s;
      best = docType;
    }
  }
  if (!best || bestScore < minScore) return null;
  return best;
}

/**
 * Cuántas páginas típicas por tipo según total del paquete.
 * Asume orden: INE, Acta, CURP, Domicilio, CV.
 */
export function heuristicPageCounts(pageCount: number): number[] {
  const n = Math.max(0, Math.floor(pageCount));
  if (n === 0) return [0, 0, 0, 0, 0];
  if (n === 1) return [1, 0, 0, 0, 0];
  if (n === 2) return [1, 1, 0, 0, 0];
  // 3 págs: INE + acta + domicilio (la última hoja suele ser recibo; CURP
  // se detecta por keywords/OCR si realmente está ahí).
  if (n === 3) return [1, 1, 0, 1, 0];
  if (n === 4) return [1, 1, 1, 1, 0];
  if (n === 5) return [1, 1, 1, 1, 1];
  if (n === 6) return [2, 1, 1, 1, 1]; // INE frente+reverso
  if (n === 7) return [2, 2, 1, 1, 1]; // INE + acta 2 págs
  if (n === 8) return [2, 2, 1, 1, 2];
  // 9+: INE 2, Acta 2, CURP 1, Domicilio 1, resto CV
  const fixed = [2, 2, 1, 1];
  const used = fixed.reduce((a, b) => a + b, 0);
  return [...fixed, Math.max(1, n - used)];
}

export function rangesFromCounts(
  counts: number[],
  order: HrDocTypeId[] = PACK_DOC_ORDER
): PackPageRange[] {
  const ranges: PackPageRange[] = [];
  let cursor = 0;
  for (let i = 0; i < order.length; i++) {
    const count = counts[i] || 0;
    if (count <= 0) continue;
    const start = cursor;
    const end = cursor + count - 1;
    ranges.push({ docType: order[i], start, end });
    cursor = end + 1;
  }
  return ranges;
}

/** Páginas (0-based) asignadas a un rango; soporta runs no contiguos vía labels. */
function pagesForDocType(
  docType: HrDocTypeId,
  ranges: PackPageRange[],
  pageLabels?: Array<HrDocTypeId | null>
): number[] {
  if (pageLabels?.length) {
    const pages: number[] = [];
    for (let i = 0; i < pageLabels.length; i++) {
      if (pageLabels[i] === docType) pages.push(i);
    }
    if (pages.length) return pages;
  }
  const r = ranges.find((x) => x.docType === docType);
  if (!r) return [];
  const out: number[] = [];
  for (let i = r.start; i <= r.end; i++) out.push(i);
  return out;
}

function decodePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\\d{1,3}/g, '');
}

/** Operadores de texto PDF + literales (…). */
function extractTextFromContent(content: string): string {
  const chunks: string[] = [];

  const tjArr = /\[([\s\S]*?)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = tjArr.exec(content))) {
    const inner = m[1];
    const lit = /\((?:\\.|[^\\)])*\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = lit.exec(inner))) {
      chunks.push(decodePdfLiteral(lm[0].slice(1, -1)));
    }
  }

  const tj = /\((?:\\.|[^\\)])*\)\s*T[jJ]/g;
  while ((m = tj.exec(content))) {
    const lit = m[0].match(/^\((?:\\.|[^\\)])*\)/);
    if (lit) chunks.push(decodePdfLiteral(lit[0].slice(1, -1)));
  }

  // Literales sueltos (forms / metadata embebida)
  const loose = /\((?:\\.|[^\\)]){3,180}\)/g;
  let n = 0;
  while ((m = loose.exec(content)) && n < 200) {
    chunks.push(decodePdfLiteral(m[0].slice(1, -1)));
    n += 1;
  }

  return chunks.join('\n');
}

/**
 * Infla streams FlateDecode del PDF y junta texto de operadores.
 * Sirve cuando no hay pdftotext (p. ej. Windows sin Poppler).
 */
export function extractTextFromPdfBytes(pdfBytes: Buffer): string {
  const raw = pdfBytes.toString('latin1');
  const chunks: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    const header = raw.slice(Math.max(0, m.index - 320), m.index);
    let data = Buffer.from(m[1], 'latin1');
    // El delimitador stream suele comerse un \n; algunos PDFs traen \r\n tras stream
    if (data.length && data[0] === 0x0d && data[1] === 0x0a) {
      data = data.subarray(2);
    } else if (data.length && data[0] === 0x0a) {
      data = data.subarray(1);
    }
    const flate = /\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode/.test(
      header
    );
    try {
      const decoded = flate ? inflateSync(data) : data;
      const text = extractTextFromContent(decoded.toString('latin1'));
      if (text.trim()) chunks.push(text);
    } catch {
      try {
        const decoded = inflateSync(data);
        const text = extractTextFromContent(decoded.toString('latin1'));
        if (text.trim()) chunks.push(text);
      } catch {
        /* ignore */
      }
    }
    if (chunks.length > 80) break;
  }

  if (!chunks.length) {
    chunks.push(crudeWholePdfStrings(pdfBytes));
  }
  return chunks.join('\n');
}

async function tryPdftotextPerPage(
  pdfBytes: Buffer
): Promise<string[] | null> {
  try {
    const dir = await mkdtemp(path.join(tmpdir(), 'hr-pack-'));
    const pdfPath = path.join(dir, 'pack.pdf');
    try {
      await writeFile(pdfPath, pdfBytes);
      const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pageCount = doc.getPageCount();
      const texts: string[] = [];
      for (let i = 1; i <= pageCount; i++) {
        try {
          const { stdout } = await execFileAsync(
            'pdftotext',
            [
              '-f',
              String(i),
              '-l',
              String(i),
              '-layout',
              '-enc',
              'UTF-8',
              pdfPath,
              '-',
            ],
            { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }
          );
          texts.push(String(stdout || ''));
        } catch {
          texts.push('');
        }
      }
      return texts;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch {
    return null;
  }
}

/**
 * Una página → PDF mínimo → extracción de streams (aisla texto por folio).
 */
async function extractTextsViaPdfLibPages(
  pdfBytes: Buffer,
  pageCount: number
): Promise<string[]> {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const texts: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    try {
      const one = await PDFDocument.create();
      const [copied] = await one.copyPages(src, [i]);
      one.addPage(copied);
      const bytes = Buffer.from(await one.save({ useObjectStreams: false }));
      texts.push(extractTextFromPdfBytes(bytes));
    } catch {
      texts.push('');
    }
  }
  return texts;
}

/** JPEGs embebidos (escaneos /DCTDecode). El más grande suele ser la página. */
export function extractEmbeddedJpegs(pdfBytes: Buffer): Buffer[] {
  const raw = pdfBytes.toString('latin1');
  const images: Buffer[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    const header = raw.slice(Math.max(0, m.index - 480), m.index);
    if (!/DCTDecode/.test(header)) continue;
    let data = Buffer.from(m[1], 'latin1');
    if (data.length && data[0] === 0x0d && data[1] === 0x0a) {
      data = data.subarray(2);
    } else if (data.length && data[0] === 0x0a) {
      data = data.subarray(1);
    }
    while (
      data.length &&
      (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)
    ) {
      data = data.subarray(0, data.length - 1);
    }
    if (data.length > 8_000 && data[0] === 0xff && data[1] === 0xd8) {
      images.push(data);
    }
  }
  images.sort((a, b) => b.length - a.length);
  return images;
}

async function preprocessForOcr(img: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(img)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .sharpen({ sigma: 1.2 })
      .png()
      .toBuffer();
  } catch {
    return img;
  }
}

async function ocrImageBuffers(images: Buffer[]): Promise<string> {
  if (!images.length) return '';
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa', 1, { logger: () => undefined });
  try {
    const parts: string[] = [];
    // Máx 2 imágenes/página (frente); la más grande primero.
    for (const img of images.slice(0, 2)) {
      try {
        const prepared = await preprocessForOcr(img);
        const {
          data: { text },
        } = await worker.recognize(prepared);
        if (text?.trim()) parts.push(text);
      } catch {
        /* next image */
      }
    }
    return parts.join('\n');
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

/**
 * OCR: 1) JPEG embebido (sin Poppler) 2) pdftoppm si existe.
 * Pensado para escaneos típicos de expediente.
 */
async function tryOcrPerPage(
  pdfBytes: Buffer,
  pageCount: number
): Promise<string[] | null> {
  if (pageCount <= 0 || pageCount > 8) return null;

  // Camino preferido: partir por página con pdf-lib y OCR del JPEG embebido.
  try {
    const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const texts: string[] = [];
    let any = false;
    for (let i = 0; i < pageCount; i++) {
      try {
        const one = await PDFDocument.create();
        const [copied] = await one.copyPages(src, [i]);
        one.addPage(copied);
        const pageBuf = Buffer.from(
          await one.save({ useObjectStreams: false })
        );
        const jpegs = extractEmbeddedJpegs(pageBuf);
        if (jpegs.length) {
          const text = await ocrImageBuffers(jpegs);
          texts.push(text);
          if (normalizeText(text).replace(/\s+/g, '').length >= 12) any = true;
        } else {
          texts.push('');
        }
      } catch {
        texts.push('');
      }
    }
    if (any) return texts;
  } catch {
    /* fallback pdftoppm */
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'hr-pack-ocr-'));
    const pdfPath = path.join(dir, 'pack.pdf');
    await writeFile(pdfPath, pdfBytes);
    const prefix = path.join(dir, 'page');
    try {
      await execFileAsync(
        'pdftoppm',
        ['-png', '-r', '110', pdfPath, prefix],
        { timeout: 25000 }
      );
    } catch {
      return null;
    }

    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('spa', 1, { logger: () => undefined });
    try {
      const texts: string[] = [];
      for (let i = 1; i <= pageCount; i++) {
        const imgPath = `${prefix}-${i}.png`;
        try {
          const img = await preprocessForOcr(await readFile(imgPath));
          const {
            data: { text },
          } = await worker.recognize(img);
          texts.push(String(text || ''));
        } catch {
          texts.push('');
        }
      }
      return texts;
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  } catch {
    return null;
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Intento ligero: strings ASCII/Latin1 visibles en el PDF (sin inflar streams).
 */
function crudeWholePdfStrings(pdfBytes: Buffer): string {
  const raw = pdfBytes.toString('latin1');
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){3,200}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    chunks.push(decodePdfLiteral(m[0].slice(1, -1)));
    if (chunks.length > 400) break;
  }
  return chunks.join('\n');
}

function usefulTextRatio(texts: string[]): number {
  if (!texts.length) return 0;
  const useful = texts.filter((t) => normalizeText(t).replace(/\s+/g, '').length >= 12)
    .length;
  return useful / texts.length;
}

function classifyPagesFromTexts(
  texts: string[]
): { labels: Array<HrDocTypeId | null>; strong: boolean } {
  const labels: Array<HrDocTypeId | null> = texts.map((t) => {
    const scores = scorePageText(t);
    // CURP / INE / acta: aceptar con umbral 3; cv/domicilio a veces 2
    const best = pickDocType(scores, 3);
    if (best) return best;
    let soft: HrDocTypeId | null = null;
    let softScore = 0;
    for (const [docType, s] of scores) {
      if (
        (docType === 'comprobante_domicilio' || docType === 'cv') &&
        s >= 2 &&
        s > softScore
      ) {
        softScore = s;
        soft = docType;
      }
    }
    return soft;
  });

  // Post-pass duro: corregir etiquetas vs señales inequívocas.
  for (let i = 0; i < labels.length; i++) {
    const raw = texts[i] || '';
    const detected = detectDocTypeFromText(raw);
    if (!detected) continue;
    if (
      labels[i] === 'acta_nacimiento' &&
      detected === 'curp' &&
      (clearlyCurpConstanciaSignals(raw) || curpConstanciaBrandSignals(raw))
    ) {
      labels[i] = 'curp';
    } else if (
      (labels[i] === 'ine' || labels[i] === 'curp') &&
      detected === 'acta_nacimiento' &&
      clearlyActaSignals(raw) &&
      !curpConstanciaBrandSignals(raw)
    ) {
      labels[i] = 'acta_nacimiento';
    } else if (
      labels[i] === 'acta_nacimiento' &&
      detected === 'ine' &&
      clearlyIneSignals(raw)
    ) {
      labels[i] = 'ine';
    } else if (
      (labels[i] === 'curp' ||
        labels[i] === 'cv' ||
        labels[i] === 'acta_nacimiento') &&
      clearlyDomicilioSignals(raw)
    ) {
      labels[i] = 'comprobante_domicilio';
    } else if (
      labels[i] === 'curp' &&
      pageTextIsWeak(raw) &&
      !clearlyCurpConstanciaSignals(raw) &&
      !hasCurpCode(normalizeText(raw))
    ) {
      // Últimas hojas escaneadas (recibo MEGA/CFE) sin OCR: no forzar CURP.
      labels[i] = 'comprobante_domicilio';
    }
  }

  const labeled = labels.filter(Boolean).length;
  const strong = labeled >= Math.max(1, Math.ceil(texts.length * 0.35));
  return { labels, strong };
}

function applyKeywordLabels(
  labels: Array<HrDocTypeId | null>,
  pageCount: number
): {
  pageLabels: HrDocTypeId[];
  ranges: PackPageRange[];
} {
  const claimed = new Set<HrDocTypeId>();
  for (const lab of labels) {
    if (lab) claimed.add(lab);
  }

  const fallback = rangesFromCounts(heuristicPageCounts(pageCount));
  const pageLabels = labels.map((lab, idx) => {
    if (lab) return lab;
    // Solo rellenar con tipos aún no tomados por keyword (evita pisar CURP→acta).
    for (const r of fallback) {
      if (idx >= r.start && idx <= r.end && !claimed.has(r.docType)) {
        return r.docType;
      }
    }
    // Tipos ya reclamados: sobrante → CV (o primer hueco libre)
    for (const docType of PACK_DOC_ORDER) {
      if (!claimed.has(docType) && docType === 'cv') return 'cv';
    }
    for (const docType of [...PACK_DOC_ORDER].reverse()) {
      if (!claimed.has(docType)) return docType;
    }
    return 'cv';
  });

  // Segunda pasada: si heurística asignó acta a una pág sin keyword pero otra
  // pág ya es curp y esta posición “parece” curp en orden clásico… se deja.
  // Garantía: si alguna label keyword era curp en idx, pageLabels[idx] ya es curp.

  const ranges = PACK_DOC_ORDER.map((docType) => {
    const pages = pageLabels
      .map((t, i) => (t === docType ? i : -1))
      .filter((i) => i >= 0);
    if (!pages.length) return null;
    return {
      docType,
      start: pages[0],
      end: pages[pages.length - 1],
    } satisfies PackPageRange;
  }).filter(Boolean) as PackPageRange[];

  return { pageLabels, ranges };
}

/**
 * Clasifica un PDF ya separado (1+ páginas) por contenido.
 * Usado para reparar slots mal etiquetados (p. ej. CURP en acta_nacimiento).
 */
export async function classifyPdfBuffer(
  pdfBytes: Buffer | Uint8Array
): Promise<PdfDocClassification> {
  const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  let text = '';
  let usedOcr = false;

  const pdftotextPages = await tryPdftotextPerPage(buf);
  if (pdftotextPages?.length) {
    text = pdftotextPages.join('\n');
  }
  if (normalizeText(text).replace(/\s+/g, '').length < 12) {
    text = extractTextFromPdfBytes(buf);
  }
  if (normalizeText(text).replace(/\s+/g, '').length < 12) {
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const n = src.getPageCount();
      const per = await extractTextsViaPdfLibPages(buf, n);
      text = per.join('\n');
    } catch {
      /* keep */
    }
  }

  // Escaneos: OCR de JPEG embebido (sin pdftotext/pdftoppm).
  if (normalizeText(text).replace(/\s+/g, '').length < 24) {
    try {
      const jpegs = extractEmbeddedJpegs(buf);
      if (jpegs.length) {
        const ocrText = await ocrImageBuffers(jpegs);
        if (normalizeText(ocrText).replace(/\s+/g, '').length >= 12) {
          text = ocrText;
          usedOcr = true;
        }
      } else {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const ocrPages = await tryOcrPerPage(buf, src.getPageCount());
        if (ocrPages?.length) {
          const ocrText = ocrPages.join('\n');
          if (normalizeText(ocrText).replace(/\s+/g, '').length >= 12) {
            text = ocrText;
            usedOcr = true;
          }
        }
      }
    } catch {
      /* keep text layer */
    }
  }

  const scoresMap = scorePageText(text);
  const scores: Partial<Record<HrDocTypeId, number>> = {};
  for (const [k, v] of scoresMap) scores[k] = v;

  const docType = detectDocTypeFromText(text);

  const hasText = normalizeText(text).replace(/\s+/g, '').length >= 12;
  return {
    docType,
    scores,
    textSample: text.slice(0, 240),
    method: !hasText ? 'empty' : usedOcr ? 'ocr' : 'keywords',
  };
}

/**
 * Texto útil de un PDF: capa de streams; si es basura/escaneo, OCR de JPEGs embebidos.
 * `forceOcr` intenta OCR aunque la capa de texto tenga bytes (p. ej. JPEG mal interpretado).
 */
export async function extractPdfTextWithOcr(
  pdfBytes: Buffer | Uint8Array,
  opts?: { forceOcr?: boolean }
): Promise<{ text: string; method: 'streams' | 'ocr' | 'empty' }> {
  const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  let text = extractTextFromPdfBytes(buf);
  const letterCount = (normalizeText(text).match(/[a-z0-9]/gi) || []).length;
  const looksLikeGarbage =
    letterCount < 40 ||
    /JFIF|Exif|Adobe|stream/i.test(text.slice(0, 200)) ||
    (text.match(/[\x00-\x08\x0e-\x1f]/g) || []).length > 20;

  if (!opts?.forceOcr && letterCount >= 40 && !looksLikeGarbage) {
    return { text, method: 'streams' };
  }

  try {
    const jpegs = extractEmbeddedJpegs(buf);
    if (jpegs.length) {
      const ocrText = await ocrImageBuffers(jpegs);
      const ocrLetters = (normalizeText(ocrText).match(/[a-z0-9]/gi) || [])
        .length;
      if (ocrLetters >= 12) {
        return { text: ocrText, method: 'ocr' };
      }
    }
  } catch {
    /* keep streams */
  }

  if (letterCount >= 12 && !looksLikeGarbage) {
    return { text, method: 'streams' };
  }
  return { text: looksLikeGarbage ? '' : text, method: 'empty' };
}

/**
 * Parte el buffer PDF en un archivo por tipo documental.
 */
export async function splitPackPdf(
  pdfBytes: Buffer | Uint8Array
): Promise<PackSplitResult> {
  const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const pageCount = src.getPageCount();

  if (pageCount <= 0) {
    return { pageCount: 0, method: 'single', parts: [] };
  }

  if (pageCount === 1) {
    const classified = await classifyPdfBuffer(buf);
    if (classified.docType && PACK_DOC_ORDER.includes(classified.docType)) {
      const parts = await buildParts(
        src,
        [{ docType: classified.docType, start: 0, end: 0 }],
        [classified.docType],
        'keywords'
      );
      return { pageCount, method: 'keywords', parts };
    }
    const counts = heuristicPageCounts(1);
    const ranges = rangesFromCounts(counts);
    const parts = await buildParts(src, ranges, undefined, 'single');
    return { pageCount, method: 'single', parts };
  }

  let method: PackSplitResult['method'] = 'heuristic';
  let pageLabels: HrDocTypeId[] | undefined;
  let ranges = rangesFromCounts(heuristicPageCounts(pageCount));

  let texts: string[] | null = await tryPdftotextPerPage(buf);

  if (!texts || usefulTextRatio(texts) < 0.35) {
    const libTexts = await extractTextsViaPdfLibPages(buf, pageCount);
    if (!texts || usefulTextRatio(libTexts) > usefulTextRatio(texts || [])) {
      texts = libTexts;
    }
  }

  if (texts && usefulTextRatio(texts) < 0.35) {
    const ocrTexts = await tryOcrPerPage(buf, pageCount);
    if (ocrTexts && usefulTextRatio(ocrTexts) > usefulTextRatio(texts)) {
      texts = ocrTexts;
      method = 'ocr';
    }
  }

  if (texts?.length === pageCount) {
    const { labels, strong } = classifyPagesFromTexts(texts);
    if (strong) {
      const applied = applyKeywordLabels(labels, pageCount);
      pageLabels = applied.pageLabels;
      ranges = applied.ranges;
      if (method !== 'ocr') method = 'keywords';
    }
  }

  let parts = await buildParts(src, ranges, pageLabels, method);

  // Seguridad final: reasignar partes mal etiquetadas (CURP↔acta, INE↔acta).
  if (texts?.length === pageCount) {
    const fixedLabels: HrDocTypeId[] = Array.from(
      { length: pageCount },
      (_, i) => {
        const existing = parts.find((part) => part.pages.includes(i));
        return existing?.docType || 'cv';
      }
    );
    let changed = false;

    for (const part of parts) {
      const partText = part.pages.map((i) => texts![i] || '').join('\n');
      const detected = detectDocTypeFromText(partText);
      if (!detected || detected === part.docType) continue;
      if (
        (part.docType === 'acta_nacimiento' &&
          detected === 'curp' &&
          (clearlyCurpConstanciaSignals(partText) ||
            curpConstanciaBrandSignals(partText))) ||
        (part.docType === 'ine' &&
          detected === 'acta_nacimiento' &&
          clearlyActaSignals(partText) &&
          !curpConstanciaBrandSignals(partText)) ||
        (part.docType === 'acta_nacimiento' &&
          detected === 'ine' &&
          clearlyIneSignals(partText)) ||
        (part.docType === 'curp' &&
          detected === 'acta_nacimiento' &&
          clearlyActaSignals(partText) &&
          !curpConstanciaBrandSignals(partText)) ||
        ((part.docType === 'curp' ||
          part.docType === 'cv' ||
          part.docType === 'acta_nacimiento') &&
          detected === 'comprobante_domicilio' &&
          clearlyDomicilioSignals(partText)) ||
        (part.docType === 'curp' &&
          clearlyDomicilioSignals(partText))
      ) {
        for (const p of part.pages) {
          fixedLabels[p] = clearlyDomicilioSignals(partText)
            ? 'comprobante_domicilio'
            : detected;
        }
        changed = true;
      }
    }

    // Última hoja del paquete marcada CURP sin señales CURP → domicilio
    // (recibo escaneado; titular puede no ser el empleado).
    const lastIdx = pageCount - 1;
    if (
      lastIdx >= 0 &&
      fixedLabels[lastIdx] === 'curp' &&
      !clearlyCurpConstanciaSignals(texts![lastIdx] || '') &&
      !hasCurpCode(normalizeText(texts![lastIdx] || ''))
    ) {
      const lastText = texts![lastIdx] || '';
      if (
        clearlyDomicilioSignals(lastText) ||
        pageTextIsWeak(lastText)
      ) {
        fixedLabels[lastIdx] = 'comprobante_domicilio';
        changed = true;
      }
    }

    if (changed) {
      const applied = applyKeywordLabels(fixedLabels, pageCount);
      parts = await buildParts(
        src,
        applied.ranges,
        applied.pageLabels,
        method === 'heuristic' ? 'keywords' : method
      );
      return {
        pageCount,
        method: method === 'heuristic' ? 'keywords' : method,
        parts,
      };
    }
  }

  return { pageCount, method, parts };
}

async function buildParts(
  src: PDFDocument,
  ranges: PackPageRange[],
  pageLabels: Array<HrDocTypeId | null> | undefined,
  method: PackSplitResult['method']
): Promise<PackSplitResult['parts']> {
  const parts: PackSplitResult['parts'] = [];
  for (const docType of PACK_DOC_ORDER) {
    const pages = pagesForDocType(docType, ranges, pageLabels);
    if (!pages.length) continue;
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pages);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save({ useObjectStreams: false });
    const pageLabel =
      pages.length === 1
        ? `p.${pages[0] + 1}`
        : `p.${pages[0] + 1}–${pages[pages.length - 1] + 1}`;
    parts.push({
      docType,
      pages,
      bytes,
      pageLabel,
    });
  }
  void method;
  return parts;
}

/** True si varios tipos del pack apuntan al mismo storage_path. */
export function detectSharedPackPaths(
  rows: Array<{ doc_type: string; storage_path: string | null; status?: string }>
): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.storage_path) continue;
    if (!PACK_DOC_ORDER.includes(r.doc_type as HrDocTypeId)) continue;
    counts.set(r.storage_path, (counts.get(r.storage_path) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([p]) => p);
}

/** ¿Notas de pull sugieren split por heurística / paquete? */
export function notesSuggestPackSplit(notes: string | null | undefined): boolean {
  const n = String(notes || '').toLowerCase();
  return (
    n.includes('paquete') ||
    n.includes('heuristic') ||
    n.includes('keywords') ||
    n.includes('documentos.pdf') ||
    n.includes('docs.pdf')
  );
}

/** Extrae una página (0-based) como PDF de una sola página. */
export async function extractPdfPageBytes(
  pdfBytes: Buffer | Uint8Array,
  pageIndex: number
): Promise<Uint8Array> {
  const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const n = src.getPageCount();
  if (pageIndex < 0 || pageIndex >= n) {
    throw new Error(`Página fuera de rango (${pageIndex + 1}/${n})`);
  }
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(src, [pageIndex]);
  out.addPage(copied);
  return out.save({ useObjectStreams: false });
}

/**
 * Vista previa de una página: JPEG embebido (escaneos) o PNG vía pdftoppm.
 * null si no hay forma de rasterizar en este entorno.
 */
export async function renderPdfPagePreview(
  pdfBytes: Buffer | Uint8Array,
  pageIndex: number
): Promise<{ mime: 'image/jpeg' | 'image/png'; bytes: Buffer } | null> {
  const pageBuf = Buffer.from(await extractPdfPageBytes(pdfBytes, pageIndex));
  const jpegs = extractEmbeddedJpegs(pageBuf);
  if (jpegs.length) {
    // La más grande suele ser la página completa.
    const best = jpegs.slice().sort((a, b) => b.length - a.length)[0];
    if (best.length >= 800) {
      return { mime: 'image/jpeg', bytes: best };
    }
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'hr-page-prev-'));
    const pdfPath = path.join(dir, 'page.pdf');
    await writeFile(pdfPath, pageBuf);
    const prefix = path.join(dir, 'out');
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', '120', '-f', '1', '-l', '1', pdfPath, prefix],
      { timeout: 15000 }
    );
    const imgPath = `${prefix}-1.png`;
    const png = await readFile(imgPath);
    if (png.length >= 200) return { mime: 'image/png', bytes: png };
  } catch {
    /* sin Poppler / fallo */
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return null;
}

export type PageReviewSignal = {
  suggested: HrDocTypeId | null;
  scores: Partial<Record<HrDocTypeId, number>>;
  method: PdfDocClassification['method'];
  textSample: string;
  bestScore: number;
  secondScore: number;
  conflicted: boolean;
  lowConfidence: boolean;
};

/** Señales de clasificación + confianza para una página (o PDF ya de 1 pág). */
export async function analyzePdfPageSignals(
  pagePdfBytes: Buffer | Uint8Array
): Promise<PageReviewSignal> {
  const classification = await classifyPdfBuffer(pagePdfBytes);
  const entries = Object.entries(classification.scores)
    .map(([k, v]) => [k as HrDocTypeId, Number(v) || 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const bestScore = entries[0]?.[1] || 0;
  const secondScore = entries[1]?.[1] || 0;
  const conflicted =
    bestScore > 0 &&
    secondScore > 0 &&
    bestScore - secondScore <= 2 &&
    entries[0][0] !== entries[1][0];
  const lowConfidence =
    classification.method === 'empty' ||
    classification.docType == null ||
    (bestScore > 0 && bestScore < 4);

  return {
    suggested:
      classification.docType && PACK_DOC_ORDER.includes(classification.docType)
        ? classification.docType
        : null,
    scores: classification.scores,
    method: classification.method,
    textSample: classification.textSample,
    bestScore,
    secondScore,
    conflicted,
    lowConfidence,
  };
}

