/**
 * Popularidad histórica de bebidas (OS PDF + líneas digitales).
 * Seed: supabase/seed_event_bebidas_popularidad.json
 * (python scripts/build_eventos_bebidas_popularidad.py)
 */

import { readFile } from 'fs/promises';
import path from 'path';
import type { EventMenu, EventMenuItem } from '@/app/lib/eventos';

export type BebidaPopularidadRow = {
  sku: string;
  name: string;
  menu_code: string;
  os_count: number;
  examples?: string[];
};

export type BebidasPopularidadPayload = {
  generated_at: string | null;
  source: Record<string, unknown> | null;
  stats: {
    pdfs_scanned?: number;
    pdfs_with_text?: number;
    pdfs_empty_or_scan?: number;
    pdfs_with_drink_match?: number;
    skus_matched?: number;
    digital_orders?: number;
    digital_lines_matched?: number;
  };
  by_sku: Record<string, number>;
  top: BebidaPopularidadRow[];
  barra: BebidaPopularidadRow[];
  carta_top: BebidaPopularidadRow[];
};

type SeedFile = {
  generated_at?: string;
  source?: Record<string, unknown>;
  stats?: BebidasPopularidadPayload['stats'];
  by_sku?: Record<string, number>;
  top?: BebidaPopularidadRow[];
  barra?: BebidaPopularidadRow[];
  carta_top?: BebidaPopularidadRow[];
};

let cachedSeed: SeedFile | null = null;

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/[^\w\s/+.-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readUtf8(file: string): Promise<string> {
  const buf = await readFile(file);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

export async function loadBebidasPopularidadSeed(): Promise<SeedFile> {
  if (cachedSeed) return cachedSeed;
  const file = path.join(
    process.cwd(),
    'supabase',
    'seed_event_bebidas_popularidad.json'
  );
  try {
    const raw = await readUtf8(file);
    cachedSeed = JSON.parse(raw) as SeedFile;
  } catch {
    cachedSeed = { by_sku: {}, top: [], barra: [], carta_top: [], stats: {} };
  }
  return cachedSeed;
}

/** Alias / frases frecuentes en OS → SKU (alineado al script Python). */
const DESCRIPTION_ALIASES: Array<{ sku: string; patterns: RegExp[] }> = [
  {
    sku: 'BAR-INT',
    patterns: [/barra\s*libre\s*internacional/i, /barra\s+internacional/i],
  },
  {
    sku: 'BAR-NAC',
    patterns: [/barra\s*libre\s*nacional/i, /barra\s+nacional/i],
  },
  {
    sku: 'BAR-REF',
    patterns: [
      /barra\s*libre\s*(de\s+)?refrescos/i,
      /barra\s*(de\s+)?refrescos/i,
      /descorche[\s\S]{0,120}refrescos/i,
    ],
  },
  { sku: 'BEB-MAR', patterns: [/margarita/i] },
  { sku: 'BEB-MOJ', patterns: [/mojito/i] },
  { sku: 'BEB-MEZ', patterns: [/mezcalita/i] },
  { sku: 'BEB-GAV', patterns: [/paloma|gavil[aá]n/i] },
  {
    sku: 'BEB-CERV',
    patterns: [/cervezas?\s+nacionales?/i],
  },
  { sku: 'BEB-AMER', patterns: [/caf[eé]\s+americano/i] },
  { sku: 'BEB-LIM', patterns: [/limonada/i] },
  { sku: 'BEB-NAR', patterns: [/naranjada/i] },
  { sku: 'BEB-PINA', patterns: [/pi[nñ]a\s+colada/i] },
];

/**
 * Empareja descripción de línea (OS digital / cotización) a SKUs del catálogo.
 */
export function matchDrinkSkusFromDescription(
  description: string,
  catalogByNormName: Map<string, string>
): string[] {
  const text = description || '';
  if (!text.trim()) return [];
  const hits = new Set<string>();
  const n = normKey(text);

  for (const { sku, patterns } of DESCRIPTION_ALIASES) {
    if (patterns.some((p) => p.test(text) || p.test(n))) hits.add(sku);
  }

  // Match por nombre de catálogo (más largos primero)
  const names = [...catalogByNormName.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (name.length < 4) continue;
    if (n.includes(name)) {
      const sku = catalogByNormName.get(name);
      if (sku) hits.add(sku);
    }
  }
  return [...hits];
}

export function buildCatalogNormIndex(
  menus: EventMenu[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of menus) {
    if (
      m.code !== 'barra_libre_2025' &&
      m.code !== 'bebidas_a_la_carta'
    ) {
      continue;
    }
    for (const it of m.items || []) {
      const sku = it.sku?.trim();
      if (!sku || sku.endsWith('-XH') || sku === 'BEB-CARTA') continue;
      const base = (it.name || '')
        .replace(/\s*\((copeo|botella|copa|jarra)\)\s*$/i, '')
        .trim();
      const key = normKey(base);
      if (key && !map.has(key)) map.set(key, sku);
    }
  }
  return map;
}

/** Suma conteos de líneas digitales sobre el seed PDF. */
export function mergeDigitalCounts(
  seedBySku: Record<string, number>,
  digitalHits: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...seedBySku };
  for (const [sku, n] of Object.entries(digitalHits)) {
    out[sku] = (out[sku] || 0) + n;
  }
  return out;
}

export function attachOsCountsToMenus(
  menus: EventMenu[],
  bySku: Record<string, number>
): EventMenu[] {
  return menus.map((m) => {
    if (
      m.code !== 'barra_libre_2025' &&
      m.code !== 'bebidas_a_la_carta'
    ) {
      return m;
    }
    const items = [...(m.items || [])]
      .map((it) => {
        const sku = it.sku?.trim() || '';
        const os_count = sku ? bySku[sku] || 0 : 0;
        return { ...it, os_count } satisfies EventMenuItem;
      })
      .sort((a, b) => {
        const ca = a.os_count || 0;
        const cb = b.os_count || 0;
        if (cb !== ca) return cb - ca;
        return Number(a.sort_order || 0) - Number(b.sort_order || 0);
      });
    return { ...m, items };
  });
}

export function buildPopularidadPayload(
  seed: SeedFile,
  bySku: Record<string, number>,
  menus: EventMenu[],
  extraStats?: Partial<BebidasPopularidadPayload['stats']>
): BebidasPopularidadPayload {
  const nameBySku = new Map<string, { name: string; menu_code: string }>();
  for (const m of menus) {
    for (const it of m.items || []) {
      if (it.sku) {
        nameBySku.set(it.sku, { name: it.name, menu_code: m.code });
      }
    }
  }

  const rows = Object.entries(bySku)
    .filter(([, n]) => n > 0)
    .map(([sku, os_count]) => {
      const meta = nameBySku.get(sku);
      const seedRow =
        seed.top?.find((r) => r.sku === sku) ||
        seed.barra?.find((r) => r.sku === sku) ||
        seed.carta_top?.find((r) => r.sku === sku);
      return {
        sku,
        name: meta?.name || seedRow?.name || sku,
        menu_code:
          meta?.menu_code ||
          seedRow?.menu_code ||
          (sku.startsWith('BAR-') ? 'barra_libre_2025' : 'bebidas_a_la_carta'),
        os_count,
        examples: seedRow?.examples,
      } satisfies BebidaPopularidadRow;
    })
    .sort((a, b) => b.os_count - a.os_count || a.name.localeCompare(b.name, 'es'));

  const barra = rows.filter((r) => r.menu_code === 'barra_libre_2025');
  const carta_top = rows
    .filter((r) => r.menu_code === 'bebidas_a_la_carta')
    .slice(0, 60);

  return {
    generated_at: seed.generated_at || null,
    source: seed.source || null,
    stats: { ...(seed.stats || {}), ...(extraStats || {}) },
    by_sku: bySku,
    top: rows.slice(0, 40),
    barra,
    carta_top,
  };
}
