/**
 * Escaneo local de Órdenes de servicio (PDF en Drive).
 * Solo lectura — no toca financial_records / ingest_eventos.py.
 */

import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import {
  loadEventClientActivity,
  normalizeClientKey,
} from '@/app/lib/eventos-activity';

const MI_UNIDAD = process.env.DRIVE_MI_UNIDAD_PATH?.trim() || 'I:\\Mi unidad';

export function getEventosOsRoot(): string {
  const fromEnv = process.env.EVENTOS_OS_PATH?.trim();
  if (fromEnv) return fromEnv;
  const eventos =
    process.env.EVENTOS_PATH?.trim() || path.join(MI_UNIDAD, 'Eventos');
  return path.join(eventos, 'Ordenes de servicio');
}

const SKIP_EXT = new Set(['.gsheet', '.gdoc', '.gslides', '.gform', '.tmp']);
const READABLE_EXT = new Set(['.pdf', '.xlsx', '.docx', '.doc']);

const PARENS = /\s*\(\d+\)\s*$/;
const G_ONLY = /^G\d+$/i;
/** Mes + día opcional: "MZO 12", "SEP 27", "DIC 11" */
const MONTH_THEN_DAY =
  /\b(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|MZO|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*\.?\s*(\d{1,2})\b/i;
/** Día + mes: "29 AGO", "05 JUL" */
const DAY_THEN_MONTH =
  /\b(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|MZO|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b/i;
const ISO_IN_NAME = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const DMY_IN_NAME = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/;
const YEAR_IN_NAME = /\b(20\d{2})\b/;

const MESES: Record<string, number> = {
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
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

const NOISE = new Set([
  '',
  'orden servicio',
  'orden de servicio',
  'cotizacion',
]);

export type EventOsItem = {
  id: string;
  filename: string;
  path: string;
  rel_path: string;
  label: string | null;
  folio: string | null;
  year: number | null;
  event_date: string | null;
  activity_date: string | null;
  mtimeMs: number;
  source: 'scan' | 'activity_seed';
  matched_client_name?: string | null;
};

function cleanOsLabel(stem: string): string | null {
  let label = stem.replace(PARENS, '').trim();
  label = label.replace(/orden\s*de?\s*servicio/gi, ' ');
  label = label.replace(/cotizaci[oó]n/gi, ' ');
  label = label.replace(/folio\s*\d+/gi, ' ');
  label = label.replace(/sin\s*folio|\bs\s*n\b/gi, ' ');
  label = label.replace(/\bG\s*[-]?\s*\d+(?:-\d+)?\b/gi, ' ');
  // year glued in «FOLIO 01 27ORDEN…» → leftover «27 BODA…»
  label = label.replace(/^\s*(20)?\d{2}\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/i, ' ');
  label = label.replace(/\s+/g, ' ').trim().replace(/^[-_]+|[-_]+$/g, '');
  if (!label || G_ONLY.test(label.replace(/\s/g, ''))) return null;
  const n = normalizeClientKey(label);
  if (NOISE.has(n) || n.startsWith('orden servicio')) return null;
  if (/^\d{1,4}$/.test(label)) return null;
  return label;
}

function parseFolio(stem: string): string | null {
  const folioM = stem.match(/FOLIO\s*(\d+)/i);
  if (folioM) return folioM[1];
  const gM = stem.match(/\bG\s*[-]?\s*(\d+(?:-\d+)?)\b/i);
  if (gM) return `G${gM[1]}`;
  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject JS overflow (e.g. Feb 31 → Mar)
  if (
    d.getFullYear() !== year ||
    d.getMonth() + 1 !== month ||
    d.getDate() !== day
  ) {
    return null;
  }
  return iso;
}

function monthToken(raw: string): number | null {
  return MESES[raw.toLowerCase().replace(/\.$/, '')] || null;
}

/** Extrae fecha del evento del nombre de archivo (+ año de carpeta si hace falta). */
export function eventDateFromStem(
  stem: string,
  folderYear: number | null
): string | null {
  const isoM = ISO_IN_NAME.exec(stem);
  if (isoM) {
    return toIsoDate(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));
  }

  const dmy = DMY_IN_NAME.exec(stem);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    // Preferir d/m/yyyy (es-MX); si mes > 12, intentar m/d/yyyy
    const asDmy = toIsoDate(year, month, day);
    if (asDmy) return asDmy;
    if (day <= 12 && month <= 31) return toIsoDate(year, day, month);
  }

  const yearInName = YEAR_IN_NAME.exec(stem);
  const year =
    (yearInName ? Number(yearInName[1]) : null) || folderYear || null;
  if (!year) return null;

  const dayFirst = DAY_THEN_MONTH.exec(stem);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const mon = monthToken(dayFirst[2]);
    if (mon) {
      const iso = toIsoDate(year, mon, day);
      if (iso) return iso;
    }
  }

  const monthFirst = MONTH_THEN_DAY.exec(stem);
  if (monthFirst) {
    const mon = monthToken(monthFirst[1]);
    const day = Number(monthFirst[2]);
    if (mon) {
      const iso = toIsoDate(year, mon, day);
      if (iso) return iso;
    }
  }

  return null;
}

/** Tokens genéricos que no deben decidir un match de fecha de evento. */
const DATE_MATCH_STOP = new Set([
  'y',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'boda',
  'preboda',
  'rompe',
  'hielos',
  'rompehielos',
  'evento',
  'cena',
  'cumpleanos',
  'os',
  'orden',
  'servicio',
  'folio',
  'sin',
]);

function significantTokens(key: string): Set<string> {
  return new Set(
    key
      .split(' ')
      .filter((t) => t.length >= 3 && !DATE_MATCH_STOP.has(t) && !/^g\d/i.test(t))
  );
}

function isWeakOsLabel(label: string | null | undefined): boolean {
  const key = normalizeClientKey(label);
  if (!key) return true;
  if (G_ONLY.test(key.replace(/\s/g, ''))) return true;
  if (/^os g\d/.test(key)) return true;
  if (significantTokens(key).size === 0) return true;
  return false;
}

function bestDateFromList(
  dates: string[],
  year: number | null,
  requireYear: boolean
): string | null {
  if (!dates.length) return null;
  const uniq = [...new Set(dates)].sort().reverse();
  if (year) {
    const sameYear = uniq.filter((d) => d.startsWith(String(year)));
    if (sameYear.length) return sameYear[0];
    if (requireYear) return null;
  }
  return requireYear ? null : uniq[0];
}

/**
 * Fecha de anticipos/seguimiento por clave exacta o fuzzy (nombres propios).
 * Fuzzy exige año de carpeta coincidente para evitar cruces tipo "boda X"→"boda Y".
 */
export function pickActivityEventDate(
  rawName: string | null | undefined,
  byClientKey: Map<string, string[]>,
  year: number | null
): string | null {
  const key = normalizeClientKey(rawName);
  if (!key || isWeakOsLabel(rawName)) return null;

  const exact = byClientKey.get(key);
  if (exact?.length) {
    // Con año de carpeta OS: solo fechas de ese año (evita PSL 2025→2023)
    return bestDateFromList(exact, year, year != null);
  }

  const keyTokens = significantTokens(key);
  if (!keyTokens.size) return null;

  let bestScore = 0;
  let bestDates: string[] | null = null;

  for (const [ck, dates] of byClientKey) {
    if (!ck || !dates.length) continue;
    const ckTokens = significantTokens(ck);
    if (!ckTokens.size) continue;

    let score = 0;
    if (key.includes(ck) || ck.includes(key)) {
      score =
        Math.min(key.length, ck.length) / Math.max(key.length, ck.length);
    }
    let inter = 0;
    for (const t of keyTokens) if (ckTokens.has(t)) inter += 1;
    if (inter >= 2) {
      score = Math.max(
        score,
        inter / Math.max(keyTokens.size, ckTokens.size)
      );
    } else if (
      inter === 1 &&
      keyTokens.size <= 2 &&
      [...keyTokens].some((t) => t.length >= 4 && ckTokens.has(t))
    ) {
      // Token distintivo corto: «bdmx» ⊂ «evento capacitacion bdmx»
      score = Math.max(score, 0.55);
    }
    if (score < 0.5) continue;
    if (score > bestScore) {
      bestScore = score;
      bestDates = dates;
    }
  }

  if (!bestDates) return null;
  // Fuzzy: solo mismo año de carpeta OS
  return bestDateFromList(bestDates, year, true);
}

/**
 * Completa event_date faltante desde seed de actividad
 * (os_pdf por ruta, anticipos/seguimiento por nombre de cliente).
 */
async function enrichEventDatesFromActivity(
  items: EventOsItem[]
): Promise<EventOsItem[]> {
  if (!items.some((it) => !it.event_date)) return items;
  const payload = await loadEventClientActivity();
  if (!payload) return items;

  const byRel = new Map<string, string>();
  const byFolioYear = new Map<string, string>();
  const byClientKey = new Map<string, string[]>();

  const pushClientDate = (key: string, date: string) => {
    if (!key || !date) return;
    const arr = byClientKey.get(key) || [];
    arr.push(date);
    byClientKey.set(key, arr);
  };

  const pushFolioDate = (folio: string | null | undefined, date: string) => {
    if (!folio || !date) return;
    const y = date.slice(0, 4);
    byFolioYear.set(`${String(folio).toUpperCase()}|${y}`, date);
  };

  for (const client of payload.clients) {
    for (const t of client.timeline || []) {
      const ed = t.event_date || null;
      if (!ed) continue;
      if (t.source === 'os_pdf' && t.detail) {
        const rel = t.detail.replace(/\\/g, '/');
        byRel.set(rel, ed);
        pushFolioDate(t.folio, ed);
      }
      if (
        t.source === 'anticipos_c50' ||
        t.source === 'seguimiento' ||
        t.source === 'seguimiento_eventos'
      ) {
        pushClientDate(normalizeClientKey(client.company_name), ed);
        pushClientDate(normalizeClientKey(t.label), ed);
        pushFolioDate(t.folio, ed);
        // Folio G embebido en etiqueta: «Rompehielos (G1-26)»
        const gEmbed = String(t.label || '').match(
          /\bG\s*[-]?\s*(\d+(?:-\d+)?)\b/i
        );
        if (gEmbed) pushFolioDate(`G${gEmbed[1]}`, ed);
      }
    }
  }

  return items.map((it) => {
    if (it.event_date) {
      return {
        ...it,
        activity_date: it.event_date,
      };
    }

    const fromRel = it.rel_path
      ? byRel.get(it.rel_path.replace(/\\/g, '/'))
      : null;
    if (fromRel) {
      return { ...it, event_date: fromRel, activity_date: fromRel };
    }

    if (it.folio && it.year) {
      const fromFolio = byFolioYear.get(
        `${String(it.folio).toUpperCase()}|${it.year}`
      );
      if (fromFolio) {
        return { ...it, event_date: fromFolio, activity_date: fromFolio };
      }
    }

    for (const raw of [it.matched_client_name, it.label]) {
      const picked = pickActivityEventDate(raw, byClientKey, it.year);
      if (picked) {
        return { ...it, event_date: picked, activity_date: picked };
      }
    }

    return it;
  });
}

/** event_date desc; sin fecha al final (mtime desc). */
export function sortOsByEventDate(items: EventOsItem[]): void {
  items.sort((a, b) => {
    const ea = a.event_date || '';
    const eb = b.event_date || '';
    if (ea && eb && ea !== eb) return eb.localeCompare(ea);
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
    const da = a.activity_date || '';
    const db = b.activity_date || '';
    if (da !== db) return db.localeCompare(da);
    return a.filename.localeCompare(b.filename, 'es');
  });
}

export function isUnderOsRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Empareja etiqueta OS con nombres de clientes CRM (exacto / contención / tokens). */
export function matchClientName(
  label: string | null | undefined,
  clientNames: string[]
): string | null {
  const key = normalizeClientKey(label);
  if (!key || !clientNames.length) return null;

  const indexed = clientNames.map((name) => ({
    name,
    key: normalizeClientKey(name),
  }));

  const exact = indexed.find((c) => c.key === key);
  if (exact) return exact.name;

  let best: string | null = null;
  let bestScore = 0;
  const keyTokens = new Set(key.split(' ').filter(Boolean));

  for (const c of indexed) {
    if (!c.key) continue;
    if (key.includes(c.key) || c.key.includes(key)) {
      const score = Math.min(key.length, c.key.length) / Math.max(key.length, c.key.length);
      if (score > bestScore) {
        bestScore = score;
        best = c.name;
      }
      continue;
    }
    const st = new Set(c.key.split(' ').filter(Boolean));
    if (!st.size) continue;
    let inter = 0;
    for (const t of keyTokens) if (st.has(t)) inter += 1;
    if (inter >= 2 || (inter === 1 && keyTokens.size === 1 && st.size <= 2)) {
      const score = inter / Math.max(keyTokens.size, st.size);
      if (score > bestScore) {
        bestScore = score;
        best = c.name;
      }
    }
  }
  return bestScore >= 0.45 ? best : null;
}

async function walkOsFiles(root: string): Promise<EventOsItem[]> {
  const items: EventOsItem[] = [];
  const stack: string[] = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXT.has(ext) || !READABLE_EXT.has(ext)) continue;

      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }

      const rel = path.relative(root, full).replace(/\\/g, '/');
      const parts = rel.split('/');
      const year =
        parts[0] && /^\d{4}$/.test(parts[0]) ? Number(parts[0]) : null;
      const stem = path.parse(entry.name).name;
      const folio = parseFolio(stem);
      const label = cleanOsLabel(stem);
      const event_date = eventDateFromStem(stem, year);
      const mtimeMs = st.mtimeMs;
      // activity_date = fecha evento si existe; si no, mtime (solo fallback de display)
      const activity_date =
        event_date || new Date(mtimeMs).toISOString().slice(0, 10);

      items.push({
        id: `scan:${rel}`,
        filename: entry.name,
        path: full,
        rel_path: rel,
        label,
        folio,
        year,
        event_date,
        activity_date,
        mtimeMs,
        source: 'scan',
      });
    }
  }

  return items;
}

/** Fallback: filas os_pdf del seed de actividad (sin abrir PDF en disco). */
async function fromActivitySeed(): Promise<EventOsItem[]> {
  const payload = await loadEventClientActivity();
  if (!payload) return [];
  const items: EventOsItem[] = [];
  for (const client of payload.clients) {
    for (const t of client.timeline || []) {
      if (t.source !== 'os_pdf') continue;
      const rel = t.detail || '';
      const filename = rel ? path.basename(rel) : t.label || 'OS';
      const stem = path.parse(filename).name;
      const folderYear =
        rel && /^\d{4}\//.test(rel) ? Number(rel.slice(0, 4)) : null;
      const fromName = eventDateFromStem(stem, folderYear);
      const event_date = t.event_date || fromName || null;
      const date = event_date || t.date || null;
      const mtimeMs = date
        ? new Date(`${date}T12:00:00`).getTime()
        : 0;
      items.push({
        id: `seed:${rel || `${client.client_key}-${date}-${t.folio}`}`,
        filename,
        path: '',
        rel_path: rel,
        label: t.label || client.company_name,
        folio: t.folio || null,
        year: folderYear || (date ? Number(date.slice(0, 4)) : null),
        event_date,
        activity_date: date,
        mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
        source: 'activity_seed',
        matched_client_name: client.company_name,
      });
    }
  }
  return items;
}

export async function listEventOs(opts?: {
  year?: number;
  q?: string;
  clientNames?: string[];
}): Promise<{
  items: EventOsItem[];
  root: string;
  rootExists: boolean;
  source: 'scan' | 'activity_seed' | 'none';
}> {
  const root = getEventosOsRoot();
  const rootExists = existsSync(root);
  let items: EventOsItem[] = [];
  let source: 'scan' | 'activity_seed' | 'none' = 'none';

  if (rootExists) {
    items = await walkOsFiles(root);
    source = items.length ? 'scan' : 'none';
  }

  if (!items.length) {
    items = await fromActivitySeed();
    if (items.length) source = 'activity_seed';
  }

  const clientNames = opts?.clientNames || [];
  if (clientNames.length) {
    items = items.map((it) => ({
      ...it,
      matched_client_name:
        it.matched_client_name ||
        matchClientName(it.label, clientNames),
    }));
  }

  // Completar fecha del evento desde anticipos/seguimiento del seed
  items = await enrichEventDatesFromActivity(items);

  if (opts?.year) {
    items = items.filter((it) => it.year === opts.year);
  }
  if (opts?.q?.trim()) {
    const needle = opts.q.trim().toLowerCase();
    items = items.filter((it) => {
      const hay = [
        it.label,
        it.folio,
        it.filename,
        it.rel_path,
        it.matched_client_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  sortOsByEventDate(items);

  return { items, root, rootExists, source };
}
