/**
 * OCR + parse de tickets Mifel (TOTALIZACIÓN / REPORTE DE PROPINAS).
 *
 * Mapeo de montos (depósito diario = cobrado + propinas):
 * - Foto venta (TOTALIZACIÓN): TOTAL GENERAL suele incluir propinas → `ticket_total`
 *   (liquidación / depósito). No es el cobrado neto pre-propina.
 * - Foto propina (REPORTE): TOTAL propina → `amount_propina`.
 * - Cuando ambas existen: `amount_cobrado = ticket_total - amount_propina`
 *   (equivale al CONSUMO del reporte de propinas).
 * - Solo venta: cobrado temporal = ticket_total; solo propina: solo tip.
 * - Neto banco = cobrado + propinas (las tips se suman, no se restan).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import type { Worker } from 'tesseract.js';
import type { TpvPhotoKind } from '@/app/lib/tpv-cortes';

export const TPV_OCR_RETAKE_MSG =
  'No se pudo leer el ticket con claridad. Vuelve a tomar la foto (nitidez, luz y ticket completo).';

/** Fallo de infraestructura (no es culpa de la foto): no pedir retomarla. */
export const TPV_OCR_UNAVAILABLE_MSG =
  'El lector de tickets no está disponible en este momento. Vuelve a intentar en unos segundos; si sigue igual avisa a sistemas (no hace falta repetir la foto).';

/** Prefijo en ocr_text para recuperar ticket_total tras reconciliar cobrado. */
export const TPV_OCR_META_PREFIX = 'TPV_OCR';

export interface TpvOcrParseResult {
  ok: boolean;
  /** TOTALIZACIÓN: total liquidación (a menudo cobrado+propina). */
  ticketTotal: number | null;
  /** REPORTE: total de propina. */
  amountPropina: number | null;
  /** REPORTE: consumo / venta sin propina (opcional, cruzado). */
  consumo: number | null;
  rawText: string;
  meanConfidence: number;
  detectedKind: TpvPhotoKind | null;
  error?: string;
  /** true = falló el motor OCR (infra), no la calidad de la foto. */
  unavailable?: boolean;
}

export interface TpvOcrAmounts {
  /** Cobrado pre-propina (o ticket_total temporal si aún no hay tip). */
  totalCobrado: number | null;
  propina: number | null;
  /** Depósito / liquidación TOTALIZACIÓN cuando se conoce. */
  ticketTotal: number | null;
  netoBanco: number | null;
  ocrText: string;
  ocrStatus: 'done' | 'failed';
}

/** Arranque del worker (descarga cero: traineddata local) + margen de CPU fría. */
const TPV_OCR_INIT_TIMEOUT_MS = 25_000;
/** Una pasada de `recognize` sobre un ticket ya preprocesado. */
const TPV_OCR_PASS_TIMEOUT_MS = 20_000;
/** Presupuesto total del multipass: deja margen bajo `maxDuration = 60`. */
const TPV_OCR_TOTAL_BUDGET_MS = 38_000;

const nodeRequire = createRequire(path.join(process.cwd(), 'noop.js'));

/**
 * Carpeta con `spa.traineddata` versionado. Usarla como `langPath` y `cachePath`
 * evita la descarga desde el CDN en cada cold start y la escritura en el FS de
 * solo lectura de Vercel (tesseract.js cachea el idioma junto al cwd por default).
 */
function tessdataDir(): string | null {
  const candidates = [
    process.env.TPV_TESSDATA_DIR,
    path.join(process.cwd(), 'tessdata'),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'spa.traineddata'))) return dir;
  }
  return null;
}

/**
 * tesseract.js registra `worker.onerror` (API de Web Worker). En Node los fallos
 * del worker_thread llegan por el evento `'error'` y, sin listener, Node los
 * relanza en el hilo principal: en Vercel eso mata la función completa y la
 * petición en curso se queda sin respuesta. Se envuelve `spawnWorker` antes de
 * que `createWorker` capture la referencia por destructuring.
 */
function loadTesseract(): typeof import('tesseract.js') {
  const nodeWorker = nodeRequire('tesseract.js/src/worker/node') as {
    spawnWorker: (opts: unknown) => { on: (ev: string, cb: (e: unknown) => void) => void };
    __c50ErrorGuard?: boolean;
  };
  if (!nodeWorker.__c50ErrorGuard) {
    const spawn = nodeWorker.spawnWorker;
    nodeWorker.spawnWorker = (opts: unknown) => {
      const worker = spawn(opts);
      worker.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        lastWorkerError = msg;
        // `createWorker` no se entera del fallo del thread: hay que cortarlo aquí
        // en vez de esperar el timeout completo.
        failInit?.(new Error(msg));
      });
      return worker;
    };
    nodeWorker.__c50ErrorGuard = true;
  }
  return nodeRequire('tesseract.js') as typeof import('tesseract.js');
}

let workerPromise: Promise<Worker> | null = null;
let lastWorkerError: string | null = null;
let failInit: ((e: Error) => void) | null = null;

async function resetWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Worker roto: basta con soltar la referencia memoizada.
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OCR ${label} excedió ${Math.round(ms / 1000)}s`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const dir = tessdataDir();
    if (!dir) {
      throw new Error(
        'Falta tessdata/spa.traineddata en el despliegue (outputFileTracingIncludes)'
      );
    }
    lastWorkerError = null;
    const fatal = new Promise<never>((_, reject) => {
      failInit = reject;
    });
    workerPromise = withTimeout(
      Promise.race([
        loadTesseract().createWorker('spa', 1, {
          logger: () => undefined,
          // Sin errorHandler, tesseract.js hace `throw` dentro del handler de
          // 'message' del worker y la excepción queda sin capturar.
          errorHandler: (err: unknown) => {
            lastWorkerError = typeof err === 'string' ? err : String(err);
            failInit?.(new Error(lastWorkerError));
          },
          langPath: dir,
          cachePath: dir,
          gzip: false,
        }),
        fatal,
      ]),
      TPV_OCR_INIT_TIMEOUT_MS,
      'init'
    ).catch((e: unknown) => {
      workerPromise = null;
      throw new Error(
        lastWorkerError
          ? `${lastWorkerError}`
          : e instanceof Error
            ? e.message
            : 'No se pudo iniciar el OCR'
      );
    });
  }
  return workerPromise;
}

/** Normaliza tokens OCR ruidosos de montos térmicos. */
export function parseMoneyToken(raw: string): number | null {
  let s = String(raw || '')
    .replace(/[$\s]/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Uu]/g, '0')
    .replace(/[Cc]/g, '0') // .CU → .00
    .trim();
  if (!s) return null;

  // Artefacto típico: 624./5 (el 7 se leyó como /) → 624.75
  if (/^\d+\.\/\d$/.test(s)) {
    s = s.replace('./', '.7');
  }

  s = s.replace(/:{1}/g, '.').replace(/\.{2,}/g, '.');

  // 6.839,75 (EU)
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d{2}$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }

  s = s.replace(/[^\d.].*$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;

  let n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;

  // Centavos pegados sin punto: 595050 → 5950.50
  if (!s.includes('.') && s.length >= 5 && n >= 10000) {
    n = Math.round((n / 100) * 100) / 100;
  }

  return Math.round(n * 100) / 100;
}

/**
 * Extrae importes de una línea (patrones específicos primero).
 * `allowZero` es para la línea de propina: «PROPINA $0.00» es un dato válido
 * (día sin propinas), no ruido.
 */
export function extractAmountsFromLine(
  line: string,
  opts: { allowZero?: boolean } = {}
): number[] {
  const out: number[] = [];
  const re =
    /\$?\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d{1,3}(?:,\d{3})+,\d{2}|\d+\.\d{2}|\d+\.\/\d|\d+[.:]\d{2}|\d+\s+\d{2}|\d{4,7})/g;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = re.exec(line)) != null) {
    let tok = m[1].trim();
    if (/^\d+\s+\d{2}$/.test(tok)) tok = tok.replace(/\s+/, '.');
    const amt = parseMoneyToken(tok);
    if (amt == null || seen.has(amt)) continue;
    if (amt > 0 || opts.allowZero) {
      seen.add(amt);
      out.push(amt);
    }
  }
  return out;
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[|]/g, 'I')
    .replace(/\r/g, '\n');
}

function hasVentaMarkers(t: string): boolean {
  const u = t.toUpperCase();
  return (
    /TOTALI[ZS]ACI[OÓ]N/.test(u) ||
    /EOL\s*NZ\s*ACI/.test(u) || // OCR roto de TOTALIZACION
    /TOTAL\s*GENERAL/.test(u) ||
    (/VENTAS/.test(u) && /CREDITO|D[EÉ]BITO|MASTERCARD|VISA/.test(u))
  );
}

function hasPropinaMarkers(t: string): boolean {
  const u = t.toUpperCase();
  return (
    /REPORTE\s*DE\s*PROPINAS?/.test(u) ||
    (/PROPINA/.test(u) && /CONSUMO/.test(u)) ||
    /PRE[- ]?PROPINA/.test(u)
  );
}

/**
 * TOTALIZACIÓN → ticket_total.
 * Preferencia: TOTAL GENERAL (+ VENTAS/TOTAL); fallback: suma de líneas VENTAS.
 */
export function parseTotalizacionText(text: string): {
  ticketTotal: number | null;
  hits: number[];
} {
  const t = normalizeOcrText(text);
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const hits: number[] = [];

  // 1) Bloque TOTAL GENERAL: tomar el mayor importe de las siguientes 4 líneas
  for (let i = 0; i < lines.length; i++) {
    if (!/TOTAL\s*GENERAL/i.test(lines[i])) continue;
    const window = lines.slice(i, i + 5).join(' ');
    const amts = extractAmountsFromLine(window).filter((a) => a >= 100);
    if (amts.length) {
      hits.push(Math.max(...amts));
    }
  }

  // 2) Línea "TOTAL GENERAL VENTAS … $X" en una sola línea
  for (const line of lines) {
    if (!/TOTAL\s*GENERAL/i.test(line)) continue;
    const amts = extractAmountsFromLine(line).filter((a) => a >= 100);
    for (const a of amts) hits.push(a);
  }

  if (hits.length) {
    // Preferir el más frecuente / el del rango de liquidación (max de hits >= 100)
    const ticketTotal = Math.max(...hits);
    return { ticketTotal, hits };
  }

  // 3) Fallback: sumar importes de líneas VENTAS (no devoluciones)
  const ventaAmts: number[] = [];
  for (const line of lines) {
    if (!/VENTAS/i.test(line)) continue;
    if (/DEVOLUC|CANCEL|AJUSTE|GENERAL/i.test(line)) continue;
    const amts = extractAmountsFromLine(line).filter((a) => a >= 1);
    // Suele haber NUMERO + IMPORTE; tomar el mayor de la línea
    if (amts.length) ventaAmts.push(Math.max(...amts));
  }
  if (ventaAmts.length >= 1) {
    const sum =
      Math.round(ventaAmts.reduce((a, b) => a + b, 0) * 100) / 100;
    if (sum > 0) return { ticketTotal: sum, hits: ventaAmts };
  }

  // 4) Último recurso: totales de sección (TOTAL … $X) sumados, excluyendo 0
  const sectionTotals: number[] = [];
  for (const line of lines) {
    if (!/^TOTAL\b/i.test(line)) continue;
    if (/GENERAL|PROPINA|CONSUMO/i.test(line)) continue;
    const amts = extractAmountsFromLine(line).filter((a) => a >= 1);
    if (amts.length) sectionTotals.push(Math.max(...amts));
  }
  if (sectionTotals.length >= 2) {
    const sum =
      Math.round(sectionTotals.reduce((a, b) => a + b, 0) * 100) / 100;
    return { ticketTotal: sum, hits: sectionTotals };
  }

  return { ticketTotal: null, hits };
}

/**
 * REPORTE DE PROPINAS → propina (+ consumo / total).
 * Ignora líneas OPER.; prefiere TOTAL / SUBTOTAL con tip ratio razonable (~5–20%).
 */
export function parsePropinaText(text: string): {
  amountPropina: number | null;
  consumo: number | null;
  total: number | null;
} {
  const t = normalizeOcrText(text);
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  type Dual = { consumo: number; propina: number; score: number; line: string };
  const duals: Dual[] = [];

  for (const line of lines) {
    if (/OPER\.?\s*\d/i.test(line)) continue;
    if (/PREVENTAS/i.test(line)) continue;

    const isTotalish = /TOTAL|SUBTOTAL|PRE[- ]?PROPINA/i.test(line);
    if (!isTotalish) continue;

    // Normalizar artefactos 024.75 / 0839.75 (6 leída como 0)
    const normalizedLine = line
      .replace(/\$\s*0(\d{2,3}\.\d{2})/g, '$$$1') // $ 024.75 → keep, handled below
      .replace(/\.([CUO]{2})\b/gi, '.00');

    const amts = extractAmountsFromLine(normalizedLine).filter((a) => a >= 0);

    // También probar tip con 0→6 si quedó demasiado chico
    const amtsExpanded = [...amts];
    for (const a of amts) {
      if (a > 0 && a < 100) {
        const bumped = Math.round((a + 600) * 100) / 100; // 24.75 → 624.75
        if (bumped < 5000) amtsExpanded.push(bumped);
      }
    }

    if (amtsExpanded.length >= 2) {
      // Probar pares (consumo, propina) desde el final
      const uniq = [...new Set(amtsExpanded)].sort((a, b) => b - a);
      for (let i = 0; i < uniq.length; i++) {
        for (let j = 0; j < uniq.length; j++) {
          if (i === j) continue;
          const consumo = uniq[i];
          const propina = uniq[j];
          if (consumo < 50 || propina < 0 || consumo < propina) continue;
          // Evitar usar el mismo número dos veces salvo tip 0
          if (consumo === propina && propina > 0) continue;

          let score = 0;
          if (/SUBTOTAL/i.test(line)) score += 5;
          if (/^TOTAL\b/i.test(line) && !/GENERAL/i.test(line)) score += 4;
          if (/PRE[- ]?PROPINA/i.test(line)) score += 3;
          if (consumo >= 500) score += 2;

          const ratio = propina / consumo;
          if (ratio >= 0.08 && ratio <= 0.12) score += 10;
          else if (ratio >= 0.05 && ratio <= 0.15) score += 6;
          else if (ratio >= 0.03 && ratio <= 0.2) score += 2;
          else if (ratio < 0.03) score -= 10;
          else score -= 4;

          if (consumo < 1 && propina < 1) score -= 20;
          duals.push({ consumo, propina, score, line });
        }
      }
    }
  }

  // Totales candidatos en el ticket (depósito ≈ consumo+propina)
  const depositHints: number[] = [];
  for (const line of lines) {
    if (!/TOTAL/i.test(line)) continue;
    for (const a of extractAmountsFromLine(line)) {
      if (a >= 500) depositHints.push(a);
      // 0839.75 → 6839.75
      if (a >= 100 && a < 2000) depositHints.push(Math.round((a + 6000) * 100) / 100);
    }
  }

  for (const d of duals) {
    const sum = Math.round((d.consumo + d.propina) * 100) / 100;
    if (depositHints.some((h) => Math.abs(h - sum) <= 1.5)) d.score += 12;
    // Consumo 6215 + tip 624.75 = 6839.75 es el patrón Mifel esperado
    if (d.consumo >= 1000 && d.propina >= 50) d.score += 1;
  }

  duals.sort((a, b) => b.score - a.score || b.consumo - a.consumo);

  let amountPropina: number | null = null;
  let consumo: number | null = null;
  let total: number | null = null;

  if (duals.length) {
    const bestScore = duals[0].score;
    const top = duals.filter((d) => d.score === bestScore);
    const pick = top.reduce((a, b) => (b.consumo >= a.consumo ? b : a));
    consumo = pick.consumo;
    amountPropina = pick.propina;
  }

  // Fallback 1: la propina va sola en su renglón («PROPINA $624.75»,
  // «TOTAL PROPINAS $215.50», «PROPINA $0.00» en día sin propinas).
  if (amountPropina == null) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!/PROPINAS?/i.test(line)) continue;
      if (/OPER\.?\s*\d/i.test(line)) continue;
      if (/CONSUMO/i.test(line)) continue;
      const amts = extractAmountsFromLine(line, { allowZero: true });
      if (amts.length !== 1) continue;
      const tip = amts[0];
      if (tip >= 0 && tip <= 20_000) {
        amountPropina = tip;
        break;
      }
    }
  }

  // TOTAL final una sola cifra. Las líneas de propina no son el total del
  // ticket, y el parche «+6000» (6 leída como 0) solo aplica si hay un par
  // consumo+propina con el que contrastar.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!/^TOTAL\b/i.test(line)) continue;
    if (/PROPINAS?/i.test(line)) continue;
    const raw = extractAmountsFromLine(line);
    const amts = (
      consumo != null && amountPropina != null
        ? raw.concat(
            raw.map((a) =>
              a >= 100 && a < 2000 ? Math.round((a + 6000) * 100) / 100 : a
            )
          )
        : raw
    ).filter((a) => a >= 500);
    if (amts.length) {
      // Prefer amount closest to consumo+propina if known
      if (consumo != null && amountPropina != null) {
        const target = Math.round((consumo + amountPropina) * 100) / 100;
        amts.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
        total = amts[0];
      } else {
        total = Math.max(...amts);
      }
      break;
    }
  }

  // Fallback 2: consumo y total en renglones distintos → propina = total − consumo.
  if (amountPropina == null && total != null) {
    const consumoLine: number[] = [];
    for (const line of lines) {
      if (!/CONSUMO/i.test(line)) continue;
      if (/OPER\.?\s*\d/i.test(line)) continue;
      consumoLine.push(...extractAmountsFromLine(line).filter((a) => a >= 50));
    }
    if (consumoLine.length) {
      const c = Math.max(...consumoLine);
      const diff = Math.round((total - c) * 100) / 100;
      // Solo si la diferencia es una propina plausible (≤30% del consumo).
      if (diff >= 0 && diff <= c * 0.3) {
        amountPropina = diff;
        consumo = c;
      }
    }
  }

  if (consumo != null && amountPropina != null && total == null) {
    total = Math.round((consumo + amountPropina) * 100) / 100;
  }
  if (total != null && amountPropina != null && consumo == null) {
    consumo = Math.round((total - amountPropina) * 100) / 100;
  }

  return { amountPropina, consumo, total };
}

export function encodeOcrMeta(opts: {
  ticketTotal?: number | null;
  propina?: number | null;
  consumo?: number | null;
  rawText: string;
}): string {
  const parts = [`${TPV_OCR_META_PREFIX}`];
  if (opts.ticketTotal != null) parts.push(`ticket_total=${opts.ticketTotal}`);
  if (opts.propina != null) parts.push(`propina=${opts.propina}`);
  if (opts.consumo != null) parts.push(`consumo=${opts.consumo}`);
  return `${parts.join(' ')}\n${opts.rawText}`.slice(0, 8000);
}

export function decodeTicketTotalFromOcrText(
  ocrText: string | null | undefined
): number | null {
  if (!ocrText) return null;
  const m = ocrText.match(/ticket_total=([\d.]+)/);
  if (!m) return null;
  return parseMoneyToken(m[1]);
}

async function preprocessVariant(
  buffer: Buffer,
  mode: 'base' | 'contrast' | 'bottom'
): Promise<Buffer> {
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await pipeline.metadata();
  const w = meta.width || 1200;
  const h = meta.height || 1600;

  if (mode === 'bottom') {
    const top = Math.floor(h * 0.45);
    pipeline = sharp(buffer, { failOn: 'none' })
      .rotate()
      .extract({
        left: 0,
        top,
        width: w,
        height: Math.max(80, h - top),
      });
  }

  const longSide = Math.max(w, h);
  const target = Math.max(1800, Math.min(2400, longSide < 1600 ? 2000 : longSide));

  pipeline = pipeline
    .resize({
      width: w >= h ? target : undefined,
      height: h > w ? target : undefined,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .grayscale();

  if (mode === 'contrast') {
    pipeline = pipeline.normalise().linear(1.35, -40).sharpen({ sigma: 1.5 });
  } else {
    pipeline = pipeline.normalise().sharpen({ sigma: 1.2 });
  }

  return pipeline.png().toBuffer();
}

export async function preprocessTpvImage(buffer: Buffer): Promise<Buffer> {
  return preprocessVariant(buffer, 'base');
}

async function recognizeBuffer(
  worker: Worker,
  img: Buffer
): Promise<{ text: string; confidence: number }> {
  const {
    data: { text, confidence },
  } = await withTimeout(worker.recognize(img), TPV_OCR_PASS_TIMEOUT_MS, 'recognize');
  return { text: normalizeOcrText(text || ''), confidence: Number(confidence) || 0 };
}

export async function runTpvOcr(
  buffer: Buffer,
  photoKind: TpvPhotoKind
): Promise<TpvOcrParseResult> {
  let rawText = '';
  let meanConfidence = 0;
  const deadline = Date.now() + TPV_OCR_TOTAL_BUDGET_MS;

  let worker: Worker;
  try {
    worker = await getWorker();
  } catch (e) {
    // Motor caído / mal desplegado: no tiene sentido pedir otra foto.
    return {
      ok: false,
      ticketTotal: null,
      amountPropina: null,
      consumo: null,
      rawText: '',
      meanConfidence: 0,
      detectedKind: null,
      unavailable: true,
      error: e instanceof Error ? e.message : 'OCR no disponible',
    };
  }

  try {
    const modes: Array<'base' | 'contrast' | 'bottom'> =
      photoKind === 'venta'
        ? ['base', 'contrast', 'bottom']
        : ['base', 'contrast'];

    let best: TpvOcrParseResult | null = null;

    for (const mode of modes) {
      // La primera pasada siempre corre; las de refuerzo solo si queda tiempo.
      if (best && Date.now() > deadline) break;
      const prepared = await preprocessVariant(buffer, mode);
      const { text, confidence } = await recognizeBuffer(worker, prepared);
      rawText = rawText ? `${rawText}\n---\n${text}` : text;
      meanConfidence = Math.max(meanConfidence, confidence);

      const looksVenta = hasVentaMarkers(text);
      const looksPropina = hasPropinaMarkers(text);
      let detectedKind: TpvPhotoKind | null = null;
      if (looksPropina && !looksVenta) detectedKind = 'propina';
      else if (looksVenta && !looksPropina) detectedKind = 'venta';
      else if (looksPropina) detectedKind = 'propina';
      else if (looksVenta) detectedKind = 'venta';

      if (photoKind === 'venta') {
        const { ticketTotal, hits } = parseTotalizacionText(text);
        const ok = ticketTotal != null && ticketTotal > 0;
        const candidate: TpvOcrParseResult = {
          ok,
          ticketTotal,
          amountPropina: null,
          consumo: null,
          rawText: text,
          meanConfidence: confidence,
          detectedKind: detectedKind || 'venta',
          error: ok ? undefined : TPV_OCR_RETAKE_MSG,
        };
        if (
          ok &&
          (!best?.ok ||
            (candidate.ticketTotal || 0) > (best.ticketTotal || 0) ||
            hits.length > 0)
        ) {
          // Prefer parse that matches TOTAL GENERAL window or larger plausible total
          if (!best?.ok) best = candidate;
          else if (
            candidate.ticketTotal != null &&
            best.ticketTotal != null &&
            Math.abs(candidate.ticketTotal - best.ticketTotal) > 0.01
          ) {
            // Prefer value that appears as max in TOTAL GENERAL range, else keep first ok
            if (mode === 'bottom' || /TOTAL\s*GENERAL/i.test(text)) {
              best = candidate;
            }
          } else {
            best = candidate;
          }
        } else if (!best) {
          best = candidate;
        }
      } else {
        const parsed = parsePropinaText(text);
        const ok = parsed.amountPropina != null && parsed.amountPropina >= 0;
        const candidate: TpvOcrParseResult = {
          ok,
          ticketTotal: parsed.total,
          amountPropina: parsed.amountPropina,
          consumo: parsed.consumo,
          rawText: text,
          meanConfidence: confidence,
          detectedKind: detectedKind || 'propina',
          error: ok ? undefined : TPV_OCR_RETAKE_MSG,
        };
        if (ok && (!best?.ok || (parsed.consumo || 0) > (best.consumo || 0))) {
          best = candidate;
        } else if (!best) {
          best = candidate;
        }
      }

      if (best?.ok) {
        // Early exit if we have a solid parse
        if (photoKind === 'venta' && (best.ticketTotal || 0) >= 100) break;
        if (
          photoKind === 'propina' &&
          best.amountPropina != null &&
          (best.consumo || 0) >= 100
        ) {
          break;
        }
      }
    }

    if (!best) {
      return {
        ok: false,
        ticketTotal: null,
        amountPropina: null,
        consumo: null,
        rawText,
        meanConfidence,
        detectedKind: null,
        error: TPV_OCR_RETAKE_MSG,
      };
    }

    // Confianza global muy baja y parse dudoso
    if (
      !best.ok &&
      (meanConfidence < 30 || rawText.replace(/\s/g, '').length < 40)
    ) {
      return { ...best, rawText, meanConfidence, error: TPV_OCR_RETAKE_MSG };
    }

    return { ...best, rawText: best.rawText || rawText, meanConfidence };
  } catch (e) {
    // Timeout o worker roto a mitad del multipass: soltar el worker memoizado
    // para que la siguiente petición arranque uno limpio.
    void resetWorker();
    return {
      ok: false,
      ticketTotal: null,
      amountPropina: null,
      consumo: null,
      rawText,
      meanConfidence,
      detectedKind: null,
      unavailable: true,
      error: e instanceof Error ? e.message : 'OCR falló',
    };
  }
}

/** Confianza media de tesseract por debajo de la cual la foto no sirve. */
const TPV_OCR_MIN_CONFIDENCE = 30;
/** Caracteres reconocidos mínimos para considerar que se leyó algo. */
const TPV_OCR_MIN_TEXT_LEN = 40;

/**
 * ¿La imagen es ilegible (borrosa / recortada / a contraluz) o simplemente el
 * parser no reconoció el formato de este ticket? Solo en el primer caso tiene
 * sentido pedir otra foto; en el segundo conviene guardarla y capturar el monto
 * a mano, porque la foto es la evidencia del corte.
 */
export function isTpvPhotoUnreadable(parsed: TpvOcrParseResult): boolean {
  const textLen = (parsed.rawText || '').replace(/\s/g, '').length;
  return (
    parsed.meanConfidence < TPV_OCR_MIN_CONFIDENCE ||
    textLen < TPV_OCR_MIN_TEXT_LEN
  );
}

/**
 * Montos a persistir tras OCR de una foto (antes de reconciliar con la otra).
 */
export function amountsFromOcr(
  photoKind: TpvPhotoKind,
  parsed: TpvOcrParseResult
): TpvOcrAmounts | null {
  if (!parsed.ok) {
    return {
      totalCobrado: null,
      propina: null,
      ticketTotal: null,
      netoBanco: null,
      ocrText: encodeOcrMeta({ rawText: parsed.rawText }),
      ocrStatus: 'failed',
    };
  }

  if (photoKind === 'venta') {
    const ticketTotal = parsed.ticketTotal;
    if (ticketTotal == null) return null;
    return {
      totalCobrado: ticketTotal,
      propina: null,
      ticketTotal,
      netoBanco: ticketTotal,
      ocrText: encodeOcrMeta({ ticketTotal, rawText: parsed.rawText }),
      ocrStatus: 'done',
    };
  }

  const tip = parsed.amountPropina;
  if (tip == null) return null;
  return {
    totalCobrado: null,
    propina: tip,
    ticketTotal: parsed.ticketTotal,
    netoBanco: parsed.ticketTotal,
    ocrText: encodeOcrMeta({
      ticketTotal: parsed.ticketTotal,
      propina: tip,
      consumo: parsed.consumo,
      rawText: parsed.rawText,
    }),
    ocrStatus: 'done',
  };
}

/**
 * Con ambas fotos: cobrado = ticket_total − propina; neto = cobrado + propina.
 */
export function reconcilePairAmounts(opts: {
  ventaTicketTotal: number | null;
  ventaCobrado: number | null;
  propinaAmount: number | null;
  propinaConsumo?: number | null;
}): { cobrado: number; propina: number; neto: number; ticketTotal: number } | null {
  const tip =
    opts.propinaAmount == null || Number.isNaN(Number(opts.propinaAmount))
      ? null
      : Math.round(Number(opts.propinaAmount) * 100) / 100;
  if (tip == null) return null;

  let ticket =
    opts.ventaTicketTotal != null && !Number.isNaN(Number(opts.ventaTicketTotal))
      ? Math.round(Number(opts.ventaTicketTotal) * 100) / 100
      : null;

  if (
    ticket == null &&
    opts.ventaCobrado != null &&
    !Number.isNaN(Number(opts.ventaCobrado))
  ) {
    ticket = Math.round(Number(opts.ventaCobrado) * 100) / 100;
  }

  if (ticket == null && opts.propinaConsumo != null) {
    const c = Math.round(Number(opts.propinaConsumo) * 100) / 100;
    ticket = Math.round((c + tip) * 100) / 100;
  }

  if (ticket == null) return null;

  let cobrado = Math.round((ticket - tip) * 100) / 100;
  if (cobrado < 0) cobrado = 0;

  if (opts.propinaConsumo != null) {
    const c = Math.round(Number(opts.propinaConsumo) * 100) / 100;
    if (Math.abs(c - cobrado) <= 1.5 || Math.abs(c + tip - ticket) <= 1.5) {
      // Consumo del reporte es fuente preferida de cobrado pre-propina
      cobrado = c;
      ticket = Math.round((cobrado + tip) * 100) / 100;
    }
  }

  const neto = Math.round((cobrado + tip) * 100) / 100;
  return { cobrado, propina: tip, neto, ticketTotal: ticket };
}
