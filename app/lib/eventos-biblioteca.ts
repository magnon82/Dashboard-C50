/**
 * Biblioteca de menús y políticas (PDFs / docs en Drive).
 * Solo lectura — no toca financial_records / ingest_eventos.py.
 */

import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { localDriveFsEnabled } from '@/app/lib/local-fs';
import { getEventosRoot, isPathUnderRoot } from '@/app/lib/eventos-paths';

const MI_UNIDAD = process.env.DRIVE_MI_UNIDAD_PATH?.trim() || 'I:\\Mi unidad';

export type BibliotecaCategory =
  | 'alimentos'
  | 'bebidas'
  | 'politicas'
  | 'manuales'
  | 'publicidad';

export type BibliotecaItem = {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  category: BibliotecaCategory;
  path: string;
  rel_path: string;
  ext: string;
  mtimeMs: number;
  openable: boolean;
  source: 'scan' | 'seed';
  sortOrder: number;
};

const SKIP_EXT = new Set([
  '.gsheet',
  '.gdoc',
  '.gslides',
  '.gform',
  '.tmp',
  '.lnk',
  '.ini',
]);

const OPENABLE_EXT = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
]);

/** Stems excluidos (case-insensitive, sin acentos). */
const EXCLUDED_STEMS = new Set([
  'minuta eventos-bodas 2019',
  'botanas pre bodas',
  'informacion pre bodas',
  'tabulador renta terraza 2022',
  'cotizacion eventos',
  'cenas en pareja',
  'nuevos precios evento',
  'parejas packingles feb25',
]);

type DocMeta = {
  title: string;
  description: string | null;
  category: BibliotecaCategory;
  order: number;
};

/**
 * Catálogo de títulos amigables (clave = stem normalizado).
 * Independiente del nombre de archivo en disco.
 */
const DOC_CATALOG: Record<string, DocMeta> = {
  'menu 3 tiempos 2025': {
    title: 'Menú 3 tiempos',
    description: 'Entrada, plato fuerte y postre para grupos desde 10 pax.',
    category: 'alimentos',
    order: 10,
  },
  'menu desayunos 2025': {
    title: 'Menú desayunos',
    description: 'Opciones de desayuno para eventos.',
    category: 'alimentos',
    order: 20,
  },
  'menu parejas es': {
    title: 'Menú parejas (español)',
    description: 'Paquete para cenas en pareja.',
    category: 'alimentos',
    order: 30,
  },
  'menu parejas en': {
    title: 'Menú parejas (inglés)',
    description: 'Couples package — English version.',
    category: 'alimentos',
    order: 40,
  },
  'menu c50 esp': {
    title: 'Menú C50 (español)',
    description: 'Carta general del restaurante.',
    category: 'alimentos',
    order: 60,
  },
  'menu-c50-english': {
    title: 'Menú C50 (inglés)',
    description: 'Restaurant menu — English.',
    category: 'alimentos',
    order: 70,
  },
  'barra libre eventos 2025': {
    title: 'Barra libre',
    description:
      'Nacional, internacional y refrescos (solo con alimentos). Carpeta Menús eventos vigentes.',
    category: 'bebidas',
    order: 10,
  },
  'barra libre de refrescos (2025)': {
    title: 'Barra libre de refrescos',
    description: 'Detalle de refrescos (gdoc; mismo paquete que el PDF de barra libre).',
    category: 'bebidas',
    order: 11,
  },
  'politica de eventos 2025': {
    title: 'Política de eventos',
    description: 'Se abre en pantalla (sin descargar Word).',
    category: 'politicas',
    order: 10,
  },
  'contrato renta terraza c50': {
    title: 'Contrato renta terraza',
    description:
      'Modelo de contrato para renta de terraza. Se abre en pantalla (sin descargar Word).',
    category: 'politicas',
    order: 20,
  },
  'manual de seguimiento eventos': {
    title: 'Manual de seguimiento',
    description:
      'Empieza aquí: pasos del proceso comercial, desde la consulta hasta el cierre.',
    category: 'manuales',
    order: 1,
  },
  'cenas empresariales': {
    title: 'Cenas empresariales',
    description: 'Material de publicidad para paquetes corporativos.',
    category: 'publicidad',
    order: 10,
  },
};

const CATEGORY_LABEL: Record<BibliotecaCategory, string> = {
  alimentos: 'Menús de alimentos',
  bebidas: 'Bebidas / barra libre',
  politicas: 'Políticas y contrato',
  manuales: 'Manuales',
  publicidad: 'Publicidad',
};

const CATEGORY_ORDER: Record<BibliotecaCategory, number> = {
  manuales: 0,
  alimentos: 1,
  bebidas: 2,
  politicas: 3,
  publicidad: 4,
};

export const BIBLIOTECA_CATEGORIES: BibliotecaCategory[] = [
  'manuales',
  'alimentos',
  'bebidas',
  'politicas',
  'publicidad',
];

export function bibliotecaCategoryLabel(
  cat: BibliotecaCategory | string
): string {
  return CATEGORY_LABEL[cat as BibliotecaCategory] || cat;
}

export function isBibliotecaCategory(v: string): v is BibliotecaCategory {
  return (BIBLIOTECA_CATEGORIES as string[]).includes(v);
}

/** Stem normalizado: sin extensión, minúsculas, sin acentos, espacios colapsados. */
export function normalizeBibliotecaStem(filenameOrStem: string): string {
  const stem = path.parse(filenameOrStem).name;
  return stem
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isExcludedBibliotecaStem(filename: string): boolean {
  return EXCLUDED_STEMS.has(normalizeBibliotecaStem(filename));
}

function lookupMeta(filename: string): DocMeta | null {
  return DOC_CATALOG[normalizeBibliotecaStem(filename)] ?? null;
}

function friendlyName(filename: string): string {
  const meta = lookupMeta(filename);
  if (meta) return meta.title;
  return path.parse(filename).name.replace(/\s+/g, ' ').trim() || filename;
}

export function getMenuC50Root(): string {
  return (
    process.env.MENU_C50_PATH?.trim() || path.join(MI_UNIDAD, 'Menú C50')
  );
}

export function getMenusVigentesRoot(): string {
  return path.join(getEventosRoot(), 'Menús', 'Menús eventos vigentes');
}

/** Raíces permitidas para listar / abrir. */
export function getBibliotecaAllowedRoots(): string[] {
  return [getEventosRoot(), getMenuC50Root()].filter(Boolean);
}

export function isUnderBibliotecaRoots(filePath: string): boolean {
  return getBibliotecaAllowedRoots().some((root) =>
    isPathUnderRoot(filePath, root)
  );
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    default:
      return 'application/octet-stream';
  }
}

export function bibliotecaContentType(filePath: string): {
  contentType: string;
  inline: boolean;
} {
  const ext = path.extname(filePath).toLowerCase();
  return {
    contentType: contentTypeForExt(ext),
    inline: ext === '.pdf',
  };
}

export function isBibliotecaOpenable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return OPENABLE_EXT.has(ext);
}

function classifyByPath(
  full: string,
  filename: string,
  eventosRoot: string
): BibliotecaCategory {
  const meta = lookupMeta(filename);
  if (meta) return meta.category;

  const lower = full.toLowerCase();
  const name = filename.toLowerCase();
  const norm = lower.replace(/\//g, '\\');

  if (/barra\s*libre/i.test(name)) return 'bebidas';

  if (/manual/i.test(name)) return 'manuales';

  if (
    /politica|pol[ií]tica|contrato/i.test(name) ||
    norm.includes('\\contratos\\')
  ) {
    return 'politicas';
  }

  const rel = path.relative(eventosRoot, full).replace(/\\/g, '/');
  if (!rel.includes('/') && /politica|manual|contrato/i.test(name)) {
    return /manual/i.test(name) ? 'manuales' : 'politicas';
  }

  if (
    norm.includes('\\publicidad') ||
    /cena|paquete|publicidad/i.test(name)
  ) {
    return 'publicidad';
  }

  if (
    norm.includes('\\menús eventos vigentes\\') ||
    norm.includes('\\menus eventos vigentes\\') ||
    norm.includes('\\menú c50\\') ||
    norm.includes('\\menu c50\\') ||
    /men[uú]/i.test(name)
  ) {
    return 'alimentos';
  }

  return 'publicidad';
}

type ScanTarget = {
  dir: string;
  /** Si true, solo archivos en este directorio (no subcarpetas). */
  shallow: boolean;
  /** Filtro opcional de nombre. */
  nameTest?: (name: string) => boolean;
};

function buildScanTargets(eventosRoot: string): ScanTarget[] {
  const vigentes = getMenusVigentesRoot();
  const contratos = path.join(eventosRoot, 'Contratos');
  const publicidad = path.join(eventosRoot, 'Publicidad Paquetes');
  const menuC50 = getMenuC50Root();

  const rootPolicyNames = (name: string) =>
    /politica|pol[ií]tica|manual de seguimiento/i.test(name);

  return [
    { dir: vigentes, shallow: true },
    { dir: menuC50, shallow: true },
    { dir: contratos, shallow: true },
    { dir: publicidad, shallow: true },
    { dir: eventosRoot, shallow: true, nameTest: rootPolicyNames },
  ];
}

function toItem(opts: {
  filename: string;
  full: string;
  eventosRoot: string;
  category: BibliotecaCategory;
  mtimeMs: number;
  openable: boolean;
  source: 'scan' | 'seed';
}): BibliotecaItem {
  const meta = lookupMeta(opts.filename);
  const rel = path.relative(opts.eventosRoot, opts.full).replace(/\\/g, '/');
  const rel_path =
    rel.startsWith('..') || path.isAbsolute(rel)
      ? path
          .relative(path.dirname(opts.eventosRoot), opts.full)
          .replace(/\\/g, '/')
      : rel;
  const ext = path.extname(opts.filename).toLowerCase();
  return {
    id: `${opts.source}:${rel_path}`,
    name: friendlyName(opts.filename),
    description: meta?.description ?? null,
    filename: opts.filename,
    category: opts.category,
    path: opts.full,
    rel_path,
    ext,
    mtimeMs: opts.mtimeMs,
    openable: opts.openable,
    source: opts.source,
    sortOrder: meta?.order ?? 500,
  };
}

async function collectFromDir(
  target: ScanTarget,
  eventosRoot: string,
  seen: Set<string>
): Promise<BibliotecaItem[]> {
  if (!existsSync(target.dir)) return [];
  let entries;
  try {
    entries = await readdir(target.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: BibliotecaItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (target.nameTest && !target.nameTest(entry.name)) continue;
    if (isExcludedBibliotecaStem(entry.name)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (SKIP_EXT.has(ext) || entry.name.toLowerCase() === 'desktop.ini') {
      continue;
    }
    if (!OPENABLE_EXT.has(ext)) continue;

    const full = path.join(target.dir, entry.name);
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }

    items.push(
      toItem({
        filename: entry.name,
        full,
        eventosRoot,
        category: classifyByPath(full, entry.name, eventosRoot),
        mtimeMs: st.mtimeMs,
        openable: true,
        source: 'scan',
      })
    );
  }

  // shallow only — no recursion for biblioteca (OS has its own section)
  void target.shallow;
  return items;
}

/** Catálogo conocido cuando Drive no está montado (sin Abrir). */
export function bibliotecaSeedItems(): BibliotecaItem[] {
  const eventos = getEventosRoot();
  const vigentes = getMenusVigentesRoot();
  const menuC50 = getMenuC50Root();

  const rows: Array<{ filename: string; dir: string }> = [
    { filename: 'Menú 3 tiempos 2025.pdf', dir: vigentes },
    { filename: 'Menú desayunos 2025.pdf', dir: vigentes },
    { filename: 'Menú parejas ES.pdf', dir: vigentes },
    { filename: 'Menú parejas EN.pdf', dir: vigentes },
    { filename: 'Barra libre eventos 2025.pdf', dir: vigentes },
    { filename: 'Menú C50 Esp.pdf', dir: menuC50 },
    { filename: 'Menu-C50-English.pdf', dir: menuC50 },
    { filename: 'Politica de eventos 2025.docx', dir: eventos },
    {
      filename: 'Manual de seguimiento eventos.docx',
      dir: eventos,
    },
    {
      filename: 'Contrato renta terraza C50.docx',
      dir: path.join(eventos, 'Contratos'),
    },
    {
      filename: 'Cenas empresariales.pdf',
      dir: path.join(eventos, 'Publicidad Paquetes'),
    },
  ];

  return rows
    .filter((r) => !isExcludedBibliotecaStem(r.filename))
    .map((r) => {
      const full = path.join(r.dir, r.filename);
      const category = classifyByPath(full, r.filename, eventos);
      return toItem({
        filename: r.filename,
        full,
        eventosRoot: eventos,
        category,
        mtimeMs: 0,
        openable: false,
        source: 'seed',
      });
    });
}

export function sortBibliotecaItems(items: BibliotecaItem[]): void {
  items.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 9;
    const cb = CATEGORY_ORDER[b.category] ?? 9;
    if (ca !== cb) return ca - cb;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, 'es');
  });
}

export async function listBiblioteca(opts?: {
  q?: string;
  category?: BibliotecaCategory | 'all';
}): Promise<{
  items: BibliotecaItem[];
  root: string;
  rootExists: boolean;
  menusRoot: string;
  menusRootExists: boolean;
  source: 'scan' | 'seed' | 'none';
}> {
  const root = getEventosRoot();
  const menusRoot = getMenusVigentesRoot();
  const canScan = localDriveFsEnabled();
  const rootExists = canScan && existsSync(root);
  const menusRootExists = canScan && existsSync(menusRoot);

  let items: BibliotecaItem[] = [];
  let source: 'scan' | 'seed' | 'none' = 'none';

  if (rootExists || (canScan && existsSync(getMenuC50Root()))) {
    const seen = new Set<string>();
    for (const target of buildScanTargets(root)) {
      const chunk = await collectFromDir(target, root, seen);
      items.push(...chunk);
    }
    if (items.length) source = 'scan';
  }

  if (!items.length) {
    items = bibliotecaSeedItems();
    if (items.length) source = 'seed';
  }

  // Defensa extra: excluir aunque el scan previo no filtrara
  items = items.filter((it) => !isExcludedBibliotecaStem(it.filename));

  if (opts?.category && opts.category !== 'all') {
    items = items.filter((it) => it.category === opts.category);
  }

  if (opts?.q?.trim()) {
    const needle = opts.q.trim().toLowerCase();
    items = items.filter((it) => {
      const hay = [
        it.name,
        it.description || '',
        it.filename,
        it.rel_path,
        bibliotecaCategoryLabel(it.category),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  sortBibliotecaItems(items);

  return {
    items,
    root,
    rootExists,
    menusRoot,
    menusRootExists,
    source,
  };
}
