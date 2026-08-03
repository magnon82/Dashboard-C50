/**
 * Matching determinista de personas (Excel ↔ expedientes ↔ hr_employees).
 * Capas: normalización → nicknames → token set → fuzzy; ambiguos no auto-vinculan.
 */

export type PersonMatchConfidence =
  | 'exact'
  | 'high'
  | 'medium'
  | 'low'
  | 'ambiguous'
  | 'none';

export type PersonMatchCandidate = {
  id: string;
  full_name: string;
  score: number;
};

export type PersonMatchResult = {
  employeeId: string | null;
  confidence: PersonMatchConfidence;
  score: number;
  /** true solo si es seguro escribir drive_folder_path / auto-link */
  autoLink: boolean;
  reason?: string;
  candidates?: PersonMatchCandidate[];
};

export type NamedPerson = {
  id: string;
  full_name: string;
  /** Alias cortos (Excel) opcionales para matching; no se muestran en UI. */
  aliases?: string[] | null;
};

/**
 * Basename de `drive_folder_path` (carpeta de expediente).
 * Fuente práctica del nombre completo canónico.
 */
export function folderBasenameFromPath(path: string | null | undefined): string {
  if (!path) return '';
  const parts = String(path)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  return (parts[parts.length - 1] || '').replace(/\s+/g, ' ').trim();
}

/** Cuenta tokens significativos (≥2, sin partículas). */
export function significantTokenCount(raw: string): number {
  return significantTokens(raw).length;
}


/**
 * Elige el nombre canónico: más tokens significativos gana;
 * empate → string más largo (típico expediente vs Excel corto).
 */
export function preferCanonicalFullName(a: string, b: string): string {
  const na = String(a || '').replace(/\s+/g, ' ').trim();
  const nb = String(b || '').replace(/\s+/g, ' ').trim();
  if (!na) return nb;
  if (!nb) return na;
  const ta = significantTokenCount(na);
  const tb = significantTokenCount(nb);
  if (tb > ta) return nb;
  if (ta > tb) return na;
  return nb.length > na.length ? nb : na;
}

/**
 * ¿Debemos conservar el nombre actual frente a un alias corto de Excel?
 * Sí si hay carpeta de expediente (basename ≈ current) o current es más completo.
 */
export function shouldKeepExistingFullName(
  current: string,
  incomingExcel: string,
  driveFolderPath?: string | null
): boolean {
  const cur = String(current || '').replace(/\s+/g, ' ').trim();
  const excel = String(incomingExcel || '').replace(/\s+/g, ' ').trim();
  if (!cur) return false;
  if (!excel) return true;
  const base = folderBasenameFromPath(driveFolderPath);
  if (base) {
    // Ya vinculado a expediente: nunca degradar a nombre Excel corto.
    if (normalizePersonKey(cur) === normalizePersonKey(base)) return true;
    if (significantTokenCount(cur) >= significantTokenCount(excel)) return true;
  }
  return preferCanonicalFullName(cur, excel) === cur;
}

/** Partículas que no cuentan como token significativo. */
const STOP = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'y',
  'e',
  'da',
  'do',
  'dos',
  'das',
  'van',
  'von',
]);

/**
 * Apodos / abreviaciones comunes ES-MX → formas canónicas.
 * Se expanden ambas direcciones al comparar.
 */
const NICK_GROUPS: string[][] = [
  ['jose', 'pepe', 'chepe', 'josue'],
  ['ignacio', 'nacho'],
  ['maria', 'ma', 'mari'],
  ['alejandro', 'alex', 'ale'],
  ['alejandra', 'alexa', 'ale'],
  ['cristian', 'christian', 'cris'],
  ['cristina', 'cris'],
  ['elizabeth', 'elisabeth', 'eli', 'eliz'],
  ['elisa', 'eli'],
  ['francisco', 'paco', 'pancho', 'cisco'],
  ['eduardo', 'lalo', 'edu'],
  ['alberto', 'beto'],
  ['roberto', 'beto', 'robert'],
  ['antonio', 'tono', 'toño', 'tony'],
  ['guillermo', 'memo', 'willy'],
  ['jesus', 'chuy', 'chucho'],
  ['guadalupe', 'lupe', 'lupita'],
  ['enrique', 'kike', 'quique'],
  ['fernando', 'fer', 'nano', 'fdo', 'fdo.'],
  ['fernanda', 'fer', 'ferni'],
  ['gabriela', 'gaby', 'gabi'],
  ['gabriel', 'gabo', 'gabi'],
  ['valeria', 'vale'],
  ['valentina', 'vale', 'vali'],
  ['andres', 'andy', 'andre'],
  ['andrea', 'andy', 'andre'],
  ['daniel', 'dani'],
  ['daniela', 'dani'],
  ['miguel', 'mike', 'migue'],
  ['javier', 'javi'],
  ['rafael', 'rafa'],
  ['sebastian', 'sebas'],
  ['nicolas', 'nico'],
  ['mauricio', 'mau'],
  ['estefania', 'fany', 'steph', 'stef'],
  ['isabel', 'isa', 'chabela'],
  ['isabella', 'isa'],
  ['sofia', 'sofi'],
  ['samuel', 'sam'],
  ['samantha', 'sam', 'samy'],
  ['sergio', 'checo'],
  ['lorenzo', 'lencho'],
  ['catalina', 'cata'],
  ['carlos', 'charlie'],
  ['juan', 'juani'],
  ['luis', 'luisito'],
  ['ricardo', 'ricky', 'rico'],
  ['patricia', 'paty', 'pati'],
  ['beatriz', 'betty', 'beti'],
  ['veronica', 'vero'],
  ['adriana', 'adri'],
  ['adrian', 'adri'],
  ['monica', 'moni'],
  ['claudia', 'clau'],
  ['manuel', 'manu'],
  ['emmanuel', 'manu', 'emma'],
  ['joaquin', 'joaco'],
  ['benjamin', 'benja', 'benji'],
  ['diego', 'die'],
  ['pedro', 'pete'],
  ['pablo', 'paulo'],
  ['vicente', 'chente'],
  ['salvador', 'chava'],
  ['concepcion', 'concha', 'conchita'],
  ['dolores', 'lola', 'loles'],
  ['teresa', 'tere'],
  ['esperanza', 'espe'],
  ['rosario', 'chayo', 'charo'],
  ['asuncion', 'chona'],
  ['refugio', 'cuquis', 'cuquita'],
  ['soledad', 'chole'],
  ['margarita', 'marga', 'magui'],
];

/** token → set de equivalentes (incluye el propio). */
const NICK_MAP: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const group of NICK_GROUPS) {
    const set = new Set(group);
    for (const t of group) {
      const prev = m.get(t);
      if (!prev) {
        m.set(t, set);
        continue;
      }
      for (const x of set) prev.add(x);
      for (const x of prev) set.add(x);
      m.set(t, prev);
    }
  }
  for (const [, set] of m) {
    for (const x of [...set]) {
      const other = m.get(x);
      if (other && other !== set) {
        for (const y of other) set.add(y);
      }
      m.set(x, set);
    }
  }
  return m;
})();

/**
 * Nombres de pila frecuentes (ES-MX) para distinguir orden carpeta vs occidental.
 * Incluye formas canónicas de NICK_GROUPS + extras comunes.
 */
const GIVEN_NAME_SET: Set<string> = (() => {
  const extra = [
    'aaron',
    'abigail',
    'adela',
    'agustin',
    'agustina',
    'alan',
    'alberto',
    'alejandra',
    'alejandro',
    'alex',
    'alexa',
    'alexis',
    'alfonso',
    'alfred',
    'alfredo',
    'ramses',
    'alice',
    'alicia',
    'alina',
    'amanda',
    'ana',
    'anabel',
    'anahi',
    'andrea',
    'andres',
    'angel',
    'angela',
    'angelo',
    'anita',
    'anna',
    'anthony',
    'antonia',
    'antonio',
    'ariadna',
    'ariel',
    'armando',
    'arturo',
    'axel',
    'barbara',
    'beatriz',
    'benjamin',
    'bertha',
    'blanca',
    'brenda',
    'brian',
    'bruno',
    'camila',
    'carlos',
    'carmen',
    'carolina',
    'catalina',
    'cecilia',
    'celia',
    'cesar',
    'christian',
    'christopher',
    'cindy',
    'clara',
    'claudia',
    'constanza',
    'cristian',
    'cristina',
    'cristobal',
    'daniel',
    'daniela',
    'dante',
    'david',
    'deborah',
    'delfina',
    'diana',
    'diego',
    'dolores',
    'dulce',
    'edgar',
    'edith',
    'eduardo',
    'elias',
    'elisa',
    'elizabeth',
    'elsa',
    'elvira',
    'emily',
    'emma',
    'emmanuel',
    'enrique',
    'erick',
    'erik',
    'ernesto',
    'esperanza',
    'esteban',
    'estefania',
    'ester',
    'esther',
    'eugenio',
    'eva',
    'evelyn',
    'fabian',
    'fabiola',
    'fatima',
    'federico',
    'felipe',
    'felix',
    'fernanda',
    'fernando',
    'fidel',
    'flor',
    'francisco',
    'gabriela',
    'gabriel',
    'gael',
    'gerardo',
    'german',
    'gilberto',
    'gloria',
    'graciela',
    'gregorio',
    'guadalupe',
    'guillermo',
    'gustavo',
    'hector',
    'helena',
    'hugo',
    'ignacio',
    'ines',
    'irene',
    'iris',
    'irving',
    'isaac',
    'isabel',
    'isabella',
    'isaias',
    'israel',
    'ivan',
    'jacobo',
    'jaime',
    'javier',
    'jennifer',
    'jenny',
    'jerome',
    'jessica',
    'jesus',
    'jimena',
    'joana',
    'joanna',
    'joaquin',
    'joel',
    'johana',
    'johanna',
    'jonathan',
    'jorge',
    'jose',
    'josefina',
    'josue',
    'juan',
    'juana',
    'julia',
    'julian',
    'julieta',
    'julio',
    'karen',
    'karina',
    'karla',
    'kate',
    'kevin',
    'laura',
    'leonardo',
    'leonor',
    'leslie',
    'leticia',
    'liliana',
    'linda',
    'lizbeth',
    'lorenzo',
    'lourdes',
    'lucia',
    'luciano',
    'luis',
    'luisa',
    'luz',
    'magdalena',
    'manuel',
    'marcela',
    'marco',
    'marcos',
    'margaret',
    'margarita',
    'maria',
    'mariana',
    'maribel',
    'mario',
    'marisol',
    'marta',
    'martha',
    'martin',
    'martina',
    'mateo',
    'matias',
    'mauricio',
    'maximiliano',
    'mayra',
    'melanie',
    'melissa',
    'mercedes',
    'michael',
    'miguel',
    'miriam',
    'moises',
    'monica',
    'montserrat',
    'nancy',
    'natalia',
    'nathalia',
    'nayeli',
    'nelson',
    'nicolas',
    'nicole',
    'noemi',
    'norma',
    'octavio',
    'olga',
    'oliver',
    'omar',
    'orlando',
    'oscar',
    'pablo',
    'paola',
    'patricia',
    'patrick',
    'paul',
    'paula',
    'paulina',
    'pedro',
    'perla',
    'peter',
    'pilar',
    'rafael',
    'ramiro',
    'ramon',
    'raquel',
    'raul',
    'raymond',
    'rebeca',
    'rebecca',
    'regina',
    'renata',
    'rene',
    'ricardo',
    'richard',
    'robert',
    'roberto',
    'rocio',
    'rodolfo',
    'rodrigo',
    'roman',
    'romeo',
    'rosa',
    'rosalba',
    'rosario',
    'ruben',
    'ruth',
    'salvador',
    'samuel',
    'sandra',
    'santiago',
    'sara',
    'sarah',
    'saul',
    'sebastian',
    'sergio',
    'silvia',
    'sofia',
    'soledad',
    'sonia',
    'stephanie',
    'susan',
    'susana',
    'tania',
    'teresa',
    'thomas',
    'tomas',
    'ulises',
    'valentin',
    'valentina',
    'valeria',
    'vanessa',
    'veronica',
    'vicente',
    'victor',
    'victoria',
    'virginia',
    'viviana',
    'wendy',
    'william',
    'xavier',
    'ximena',
    'yahir',
    'yamileth',
    'yolanda',
    'yvonne',
    'zoe',
  ];
  const s = new Set<string>(extra);
  for (const group of NICK_GROUPS) {
    for (const t of group) {
      // Evitar apodos de 2–3 letras como «ma», «fer» como nombre de pila
      if (t.length >= 4) s.add(t);
    }
  }
  // Excepciones cortas muy comunes
  s.add('ana');
  s.add('luz');
  s.add('eva');
  s.add('sol');
  return s;
})();

function isStopToken(norm: string): boolean {
  return STOP.has(norm);
}

/** Segundos de nombres compuestos con partícula (María del Carmen, José de Jesús…). */
const COMPOUND_GIVEN_SECONDS = new Set([
  'angeles',
  'carmen',
  'concepcion',
  'jesus',
  'lourdes',
  'luz',
  'pilar',
  'rosario',
  'socorro',
]);

function isLikelyGivenName(norm: string): boolean {
  if (!norm || norm.length < 2 || isStopToken(norm)) return false;
  return GIVEN_NAME_SET.has(norm);
}

/** ¿La unidad cuenta como nombre de pila? Partículas → apellido salvo compuestos conocidos. */
function isLikelyGivenUnit(unit: string): boolean {
  const toks = personTokens(unit);
  if (toks.length === 0) return false;
  const core = unitGivenNorm(unit);
  if (toks.length > 1 && isStopToken(toks[0]!)) {
    return COMPOUND_GIVEN_SECONDS.has(core);
  }
  return isLikelyGivenName(core);
}

/** Agrupa partículas con el siguiente token significativo (p. ej. «DE LA ROSA»). */
function nameUnits(raw: string): string[] {
  const tokens = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const units: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const parts: string[] = [];
    while (i < tokens.length && isStopToken(stripPersonName(tokens[i]!))) {
      parts.push(tokens[i]!);
      i += 1;
    }
    if (i < tokens.length) {
      parts.push(tokens[i]!);
      i += 1;
      units.push(parts.join(' '));
    } else if (parts.length > 0) {
      if (units.length > 0) {
        units[units.length - 1] = `${units[units.length - 1]} ${parts.join(' ')}`;
      } else {
        units.push(parts.join(' '));
      }
    }
  }
  return units;
}

function unitGivenNorm(unit: string): string {
  const toks = personTokens(unit);
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]!;
    if (!isStopToken(t)) return t;
  }
  return toks[toks.length - 1] || '';
}

function leadingGivenRun(units: string[]): number {
  let n = 0;
  for (const u of units) {
    if (isLikelyGivenUnit(u)) n += 1;
    else break;
  }
  return n;
}

function trailingGivenRun(units: string[]): number {
  let n = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    if (isLikelyGivenUnit(units[i]!)) n += 1;
    else break;
  }
  return n;
}

function isMostlyUppercaseName(raw: string): boolean {
  const letters = String(raw || '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (!letters) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  return upper / letters.length >= 0.75;
}

/**
 * Title Case ES-MX para nombres: «JUAN ROMAN» → «Juan Roman».
 * Partículas (de, del, la…) en minúscula salvo al inicio.
 */
function toHrDisplayCase(name: string): string {
  const tokens = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) return '';

  return tokens
    .map((tok, i) => {
      const lower = tok.toLocaleLowerCase('es-MX');
      const norm = stripPersonName(tok);
      if (i > 0 && isStopToken(norm)) return lower;
      if (!lower) return tok;
      return lower.charAt(0).toLocaleUpperCase('es-MX') + lower.slice(1);
    })
    .join(' ');
}

/**
 * Nombre para listados RH: nombres de pila primero + solo primer apellido + Title Case.
 * Detecta orden carpeta (APELLIDOS NOMBRES) vs occidental (NOMBRES APELLIDOS).
 * No muta `hr_employees.full_name` — solo presentación (salvo callers que
 * persisten el resultado vía `canonicalHrEmployeeName`).
 *
 * @example
 * formatHrListName('SANCHEZ CORTES JUAN ROMAN') // 'Juan Roman Sanchez'
 * formatHrListName('RAMIREZ CRUZ JUAN ROBERTO') // 'Juan Roberto Ramirez'
 * formatHrListName('LOERA GONZALEZ SERGIO') // 'Sergio Loera'
 * formatHrListName('ANA PAULA VILLAR TORRES') // 'Ana Paula Villar'
 * formatHrListName('ROMAN SANCHEZ') // 'Roman Sanchez'
 * formatHrListName('GALLARDO ÁVILA LUIS FERNANDO') // 'Luis Fernando Gallardo'
 * formatHrListName('DE LA ROSA MARIA') // 'Maria de la Rosa'
 * formatHrListName('TORRIJOS DE LA CRUZ JOANA ELIZABETH') // 'Joana Elizabeth Torrijos'
 * formatHrListName('Joana Elizabeth Torrijos') // 'Joana Elizabeth Torrijos'
 *
 * Conserva el segundo nombre de pila (Roman / Roberto / Fernando / Joana) —
 * no lo reduce a «Juan Sanchez» / «Elizabeth Torrijos».
 */
export function formatHrListName(fullName: string): string {
  const cleaned = String(fullName || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const units = nameUnits(cleaned);
  if (units.length <= 1) return toHrDisplayCase(cleaned);

  const lead = leadingGivenRun(units);
  const trail = trailingGivenRun(units);

  // Dos unidades: solo reordenar si el nombre de pila va al final (carpeta).
  // Evita invertir «Lopez Gomez» (dos apellidos sin pila clara).
  if (units.length === 2) {
    if (trail > lead) {
      return toHrDisplayCase([units[1]!, units[0]!].join(' '));
    }
    return toHrDisplayCase(units.join(' '));
  }

  let folderStyle: boolean;
  if (trail > lead) folderStyle = true;
  else if (lead > trail) folderStyle = false;
  else if (trail === 0 && lead === 0) {
    // Sin nombres reconocidos: expedientes C50 suelen ser APELLIDOS + NOMBRES
    folderStyle = true;
  } else {
    // Empate (p. ej. pila en ambos extremos): mayúsculas → carpeta
    folderStyle = isMostlyUppercaseName(cleaned);
  }

  let given: string[];
  let firstApellido: string;

  if (folderStyle) {
    const givenCount = trail > 0 ? trail : Math.max(1, units.length - 2);
    const apeCount = units.length - givenCount;
    if (apeCount < 1) {
      // Todo parece nombre de pila — devolver tal cual
      return toHrDisplayCase(units.join(' '));
    }
    given = units.slice(apeCount);
    firstApellido = units[0]!;
  } else {
    const givenCount = lead > 0 ? lead : Math.max(1, units.length - 2);
    const apeStart = givenCount;
    if (apeStart >= units.length) return toHrDisplayCase(units.join(' '));
    given = units.slice(0, givenCount);
    firstApellido = units[apeStart]!;
  }

  return toHrDisplayCase([...given, firstApellido].join(' '));
}

/** Alias de presentación — mismo helper que `formatHrListName`. */
export const formatHrDisplayName = formatHrListName;

/**
 * Nombre a persistir en `hr_employees.full_name` al vincular expediente:
 * «Nombres + primer apellido» (Title Case), no el basename ALL CAPS de carpeta.
 */
export function canonicalHrEmployeeName(
  folderOrFullName: string,
  fallback?: string
): string {
  const fromFolder = formatHrListName(folderOrFullName);
  if (fromFolder) return fromFolder;
  const fb = formatHrListName(fallback || '');
  return fb || String(fallback || folderOrFullName || '').replace(/\s+/g, ' ').trim();
}


const AUTO_LINK_MIN = 0.85;
const MEDIUM_MIN = 0.72;
const AMBIGUITY_GAP = 0.08;
const FUZZY_STRING_MIN = 0.88;

/** Normaliza: minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function stripPersonName(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Tokens en orden original (post-normalize). */
export function personTokens(raw: string): string[] {
  return stripPersonName(raw).split(' ').filter(Boolean);
}

/** Tokens significativos (≥2 chars, sin partículas). */
export function significantTokens(raw: string): string[] {
  return personTokens(raw).filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Clave ordenada (token sort) — compatible con normalizePersonName de nómina. */
export function normalizePersonKey(raw: string): string {
  return personTokens(raw).sort().join(' ');
}

function nickEquivalents(token: string): Set<string> {
  return NICK_MAP.get(token) ?? new Set([token]);
}

/** ¿Dos tokens coinciden tras nicknames? */
function tokensEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const ea = nickEquivalents(a);
  if (ea.has(b)) return true;
  // Prefijo corto (ma ↔ maria ya está en mapa; typo leve 1 char si len≥4)
  if (a.length >= 4 && b.length >= 4) {
    const d = levenshtein(a, b);
    if (d <= 1) return true;
  }
  return false;
}

function expandTokenSet(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    for (const x of nickEquivalents(t)) out.add(x);
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (Math.abs(m - n) > Math.max(m, n) * 0.4 && Math.abs(m - n) > 4) {
    return Math.max(m, n);
  }
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/** Similitud de conjuntos de tokens con nicknames (Jaccard sobre equivalentes). */
function tokenSetScore(aToks: string[], bToks: string[]): number {
  if (aToks.length === 0 || bToks.length === 0) return 0;
  const aExp = expandTokenSet(aToks);
  const bExp = expandTokenSet(bToks);
  let inter = 0;
  for (const t of aExp) {
    if (bExp.has(t)) inter += 1;
  }
  const union = aExp.size + bExp.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Conteo de tokens significativos de A que tienen match en B. */
function significantOverlap(aSig: string[], bSig: string[]): number {
  let n = 0;
  const used = new Set<number>();
  for (const a of aSig) {
    for (let i = 0; i < bSig.length; i++) {
      if (used.has(i)) continue;
      if (tokensEquivalent(a, bSig[i]!)) {
        used.add(i);
        n += 1;
        break;
      }
    }
  }
  return n;
}

/** ¿A es subconjunto de B (con nicknames)? */
function isTokenSubset(subset: string[], superset: string[]): boolean {
  if (subset.length === 0) return false;
  return subset.every((s) =>
    superset.some((t) => tokensEquivalent(s, t))
  );
}

/**
 * Nombres de pila distintos en query vs candidato (p. ej. Roman vs Roberto).
 * Evita fuzzy-merge de homónimos Juan Roman Sanchez ≠ Juan Roberto Ramirez.
 */
function conflictingGivenNames(qSig: string[], cSig: string[]): boolean {
  const qGiven = qSig.filter((t) => isLikelyGivenName(t));
  const cGiven = cSig.filter((t) => isLikelyGivenName(t));
  if (qGiven.length === 0 || cGiven.length === 0) return false;
  // ¿Hay algún given de Q que no casa con ninguno de C, y viceversa?
  const qHasUnmatched = qGiven.some(
    (qg) => !cGiven.some((cg) => tokensEquivalent(qg, cg))
  );
  const cHasUnmatched = cGiven.some(
    (cg) => !qGiven.some((qg) => tokensEquivalent(cg, qg))
  );
  // Conflicto real: ambos lados tienen given(s) y no hay intersección
  const anyOverlap = qGiven.some((qg) =>
    cGiven.some((cg) => tokensEquivalent(qg, cg))
  );
  return !anyOverlap && qHasUnmatched && cHasUnmatched;
}

function scorePairRaw(query: string, candidateName: string): number {
  const qKey = normalizePersonKey(query);
  const cKey = normalizePersonKey(candidateName);
  if (!qKey || !cKey) return 0;
  if (qKey === cKey) return 1;

  const qToks = personTokens(query);
  const cToks = personTokens(candidateName);
  const qSig = qToks.filter((t) => t.length >= 2 && !STOP.has(t));
  const cSig = cToks.filter((t) => t.length >= 2 && !STOP.has(t));

  // Discriminadores de pila: nunca auto-vincular Roman↔Roberto, etc.
  if (conflictingGivenNames(qSig, cSig)) {
    return Math.min(0.55, stringSimilarity(qKey, cKey) * 0.5);
  }

  const overlap = significantOverlap(qSig, cSig);
  const setScore = tokenSetScore(qSig, cSig);
  const strScore = stringSimilarity(qKey, cKey);

  // Token-set equality after nick expand
  if (setScore >= 0.99 && overlap >= 2) return 0.98;

  // Subconjunto (orden distinto / nombre incompleto)
  if (
    overlap >= 2 &&
    (isTokenSubset(qSig, cSig) || isTokenSubset(cSig, qSig))
  ) {
    const coverage =
      overlap / Math.max(Math.min(qSig.length, cSig.length), 1);
    return Math.min(0.95, 0.82 + coverage * 0.12);
  }

  // Fuzzy combinado
  let score = Math.max(setScore * 0.55 + strScore * 0.45, strScore * 0.9);

  // Bonus por solape significativo
  if (overlap >= 2) {
    score = Math.max(score, 0.7 + Math.min(overlap, 4) * 0.05);
    score = Math.max(score, setScore * 0.7 + 0.2);
  }

  // Sin solape mínimo, solo aceptar similitud de string muy alta
  if (overlap < 2 && strScore < FUZZY_STRING_MIN) {
    score = Math.min(score, 0.65);
  }

  return Math.min(1, score);
}

/**
 * Score con forma lista «nombres + 1 apellido» como identidad canónica.
 * Evita falsos positivos por 2º apellido en carpeta (Carmona Resendiz Eduardo
 * ⊇ Eduardo Resendiz) y une cáscaras tipo CRISTIAN SUAREZ RUIZ ↔ Cristian Alfonso Suarez.
 */
function scorePair(query: string, candidateName: string): number {
  const fq = formatHrListName(query) || query;
  const fc = formatHrListName(candidateName) || candidateName;
  return scorePairRaw(fq, fc);
}

function confidenceFromScore(
  score: number,
  exact: boolean
): Exclude<PersonMatchConfidence, 'ambiguous' | 'none'> {
  if (exact || score >= 0.99) return 'exact';
  if (score >= AUTO_LINK_MIN) return 'high';
  if (score >= MEDIUM_MIN) return 'medium';
  return 'low';
}

/**
 * Empareja un nombre contra candidatos. No auto-vincula si hay empate cercano.
 */
export function matchPerson(
  query: string,
  candidates: NamedPerson[],
  opts?: { minAutoScore?: number }
): PersonMatchResult {
  const minAuto = opts?.minAutoScore ?? AUTO_LINK_MIN;
  const qKey = normalizePersonKey(query);
  if (!qKey || candidates.length === 0) {
    return {
      employeeId: null,
      confidence: 'none',
      score: 0,
      autoLink: false,
      reason: 'empty',
    };
  }

  const qSig = significantTokens(query);
  const scored: PersonMatchCandidate[] = [];

  for (const c of candidates) {
    const names = [c.full_name, ...(c.aliases || [])].filter(Boolean);
    let bestScore = 0;
    let bestLabel = c.full_name;
    for (const label of names) {
      const score = scorePair(query, label);
      if (score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    }
    if (bestScore < 0.5) continue;
    // Regla de seguridad: ≥2 tokens significativos o similitud string alta
    const cSig = significantTokens(bestLabel);
    const overlap = significantOverlap(qSig, cSig);
    const strSim = stringSimilarity(qKey, normalizePersonKey(bestLabel));
    if (overlap < 2 && strSim < FUZZY_STRING_MIN) continue;
    // Mostrar siempre el full_name canónico del candidato (no el alias).
    scored.push({ id: c.id, full_name: c.full_name, score: bestScore });
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return {
      employeeId: null,
      confidence: 'none',
      score: 0,
      autoLink: false,
      reason: 'no_candidates',
    };
  }

  const best = scored[0]!;
  const second = scored[1];
  const exact = best.score >= 0.995;
  const gap = second ? best.score - second.score : 1;

  // Empate cercano → no auto-vincular, salvo ganador exacto (clave idéntica)
  // o duplicados de la misma persona (query ⊆ ambos) → preferir nombre más completo.
  if (
    !exact &&
    second &&
    second.score >= MEDIUM_MIN &&
    gap < AMBIGUITY_GAP &&
    best.id !== second.id
  ) {
    const bestToks = significantTokens(best.full_name);
    const secondToks = significantTokens(second.full_name);
    const samePersonDup =
      qSig.length >= 2 &&
      isTokenSubset(qSig, bestToks) &&
      isTokenSubset(qSig, secondToks);
    if (samePersonDup) {
      const winner =
        best.full_name.replace(/\s+/g, '').length >=
        second.full_name.replace(/\s+/g, '').length
          ? best
          : second;
      return {
        employeeId: winner.id,
        confidence: 'high',
        score: winner.score,
        autoLink: true,
        reason: 'duplicate_prefer_longer',
        candidates: scored.slice(0, 3),
      };
    }
    return {
      employeeId: null,
      confidence: 'ambiguous',
      score: best.score,
      autoLink: false,
      reason: 'close_candidates',
      candidates: scored.slice(0, 3),
    };
  }

  const confidence = confidenceFromScore(best.score, exact);
  const autoLink = best.score >= minAuto && confidence !== 'low';

  return {
    employeeId: autoLink ? best.id : null,
    confidence,
    score: best.score,
    autoLink,
    reason: exact ? 'exact' : confidence,
    candidates: scored.slice(0, 3),
  };
}

/**
 * Compat: id del empleado si match auto-linkeable (exact/high, no ambiguo).
 * Firma alineada con el antiguo matchEmployeeId de schedule-import.
 */
export function matchEmployeeId(
  name: string,
  byKey: Map<string, NamedPerson>,
  all: NamedPerson[]
): string | null {
  const key = normalizePersonKey(name);
  if (!key) return null;
  const exact = byKey.get(key);
  if (exact) return exact.id;

  const result = matchPerson(name, all);
  return result.autoLink ? result.employeeId : null;
}

/** Estado de vínculo para UI. */
export type PersonLinkStatus = 'linked' | 'ambiguous' | 'unlinked';

export function linkStatusFromMatch(m: PersonMatchResult): PersonLinkStatus {
  if (m.autoLink && m.employeeId) return 'linked';
  if (m.confidence === 'ambiguous') return 'ambiguous';
  if (m.employeeId && (m.confidence === 'high' || m.confidence === 'exact')) {
    return 'linked';
  }
  return 'unlinked';
}
