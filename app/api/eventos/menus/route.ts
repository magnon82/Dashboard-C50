import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireEventosSession } from '@/app/lib/eventos-api';
import { loadEventMenusSeed } from '@/app/lib/eventos-menus-seed';
import {
  attachOsCountsToMenus,
  buildCatalogNormIndex,
  buildPopularidadPayload,
  loadBebidasPopularidadSeed,
  matchDrinkSkusFromDescription,
  mergeDigitalCounts,
  type BebidasPopularidadPayload,
} from '@/app/lib/eventos-bebidas-popularidad';
import {
  sanitizeEventMenuTextFields,
  type EventMenu,
  type EventMenuItem,
  type MenuChoiceGroup,
} from '@/app/lib/eventos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JSON_UTF8 = { 'Content-Type': 'application/json; charset=utf-8' };

function jsonUtf8(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { ...init, headers: JSON_UTF8 });
}

function sanitizeMenusPayload(menus: unknown[]): EventMenu[] {
  return menus.map((m) =>
    sanitizeEventMenuTextFields(m as EventMenu)
  );
}

function isMissingTableError(message: string): boolean {
  return /PGRST205|does not exist|schema cache|Could not find the table/i.test(
    message
  );
}

type MenuRow = {
  code?: string;
  id?: string;
  name?: string;
  description?: string | null;
  notes?: string | null;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

const DRINK_MENU_SEED_CODES = [
  'barra_libre_2025',
  'bebidas_a_la_carta',
] as const;

/** Catálogos de alimentos aportados desde seed si faltan en DB (menú regular C50). */
const FOOD_SEED_APPEND_CODES = ['menu_regular_c50'] as const;

const SEED_APPEND_CODES = [
  ...DRINK_MENU_SEED_CODES,
  ...FOOD_SEED_APPEND_CODES,
] as const;

/** Ítems de barra libre / Bebidas C50 desde seed, reusando ids de DB por SKU. */
function overlayDrinkItemsFromSeed(
  m: MenuRow,
  seedMenu: {
    name?: string;
    description?: string | null;
    notes?: string | null;
    items?: Array<Record<string, unknown> & { id?: string; sku?: string | null }>;
  }
): MenuRow {
  const seedItems = seedMenu.items || [];
  const dbBySku = new Map(
    (m.items || [])
      .filter((i) => i.sku != null)
      .map((i) => [String(i.sku), i])
  );
  return {
    ...m,
    name: seedMenu.name ?? m.name,
    description: seedMenu.description ?? m.description,
    notes: seedMenu.notes ?? m.notes,
    items: seedItems.map((si) => {
      const db = si.sku ? dbBySku.get(String(si.sku)) : undefined;
      return {
        id: (db?.id as string | undefined) ?? si.id,
        menu_id: m.id,
        sku: si.sku,
        name: si.name,
        description: si.description,
        unit: si.unit,
        unit_price: si.unit_price,
        min_pax: si.min_pax,
        is_vegetarian: si.is_vegetarian,
        active: true,
        sort_order: si.sort_order,
        price_source: si.price_source,
        price_verified: si.price_verified,
        choice_groups: null,
      };
    }),
  };
}

/**
 * Sincroniza min_pax del seed (reglas comerciales); aporta choice_groups si DB
 * aún es plana; fuerza choice_groups del PDF vigente en menú 3 tiempos (evita
 * extras viejos en DB/OS); y, si barra libre / bebidas_a_la_carta en DB están
 * vacíos o cortos, sustituye ítems desde seed JSON reutilizando ids por SKU.
 * Si faltan esos catálogos enteros en DB, los aporta desde seed.
 */
async function enrichCatalogFromSeed(menus: MenuRow[]) {
  const needsChoiceGroups = menus.some((m) =>
    (m.items || []).some((it) => !Array.isArray(it.choice_groups))
  );
  const needsTresTiemposOverlay = menus.some(
    (m) => String(m.code || '') === 'menu_3_tiempos_2025'
  );
  const presentCodes = new Set(menus.map((m) => String(m.code || '')));
  const missingAppendCodes = SEED_APPEND_CODES.filter(
    (c) => !presentCodes.has(c)
  );
  try {
    const seed = await loadEventMenusSeed();
    const byCode = new Map(seed.map((m) => [m.code, m]));
    /** Catálogo presente en DB pero con menos ítems que el seed (vacío / stub). */
    const needsSeedItemsOverlay = menus.some((m) => {
      const code = String(m.code || '');
      if (!(SEED_APPEND_CODES as readonly string[]).includes(code)) {
        return false;
      }
      const seedMenu = byCode.get(code);
      const seedLen = seedMenu?.items?.length || 0;
      return seedLen > 0 && seedLen > (m.items || []).length;
    });
    const appendMissingFromSeed = (base: MenuRow[]): MenuRow[] => {
      if (!missingAppendCodes.length) return base;
      const extras: MenuRow[] = [];
      for (const code of missingAppendCodes) {
        const seedMenu = byCode.get(code);
        if (!seedMenu) continue;
        extras.push({
          ...(seedMenu as MenuRow),
          items: (seedMenu.items || []).map((si) => ({
            ...si,
            menu_id: seedMenu.id,
            choice_groups: Array.isArray(si.choice_groups)
              ? si.choice_groups
              : null,
          })),
        });
      }
      return extras.length ? [...base, ...extras] : base;
    };
    // Reglas comerciales del seed (p. ej. desayunos min_pax 50) ganan sobre DB vieja
    const withSeedRules = menus.map((m) => {
      const seedMenu = m.code ? byCode.get(String(m.code)) : undefined;
      if (!seedMenu) return m;
      return {
        ...m,
        name: seedMenu.name ?? m.name,
        min_pax: seedMenu.min_pax ?? m.min_pax,
        requires_food: seedMenu.requires_food ?? m.requires_food,
      };
    });
    if (
      !needsChoiceGroups &&
      !needsSeedItemsOverlay &&
      !needsTresTiemposOverlay &&
      !missingAppendCodes.length
    ) {
      return withSeedRules;
    }
    if (
      !needsChoiceGroups &&
      !needsSeedItemsOverlay &&
      !needsTresTiemposOverlay
    ) {
      return appendMissingFromSeed(withSeedRules);
    }
    const enriched = withSeedRules.map((m) => {
      const seedMenu = m.code ? byCode.get(String(m.code)) : undefined;
      if (!seedMenu?.items?.length) return m;

      // Barra libre / Bebidas C50 / Menú regular: seed completo si DB vacía, stub o parcial
      const code = String(m.code || '');
      if (
        (SEED_APPEND_CODES as readonly string[]).includes(code) &&
        seedMenu.items.length > (m.items || []).length
      ) {
        return overlayDrinkItemsFromSeed(m, seedMenu);
      }

      const seedPackage = seedMenu.items.find(
        (i) => Array.isArray(i.choice_groups) && i.choice_groups!.length > 0
      );

      // Menú 3 tiempos: seed PDF vigente siempre gana (no reintroducir fuertes
      // de stubs OS / carta C50 que puedan quedar en choice_groups de DB).
      if (
        String(m.code) === 'menu_3_tiempos_2025' &&
        seedPackage?.choice_groups?.length
      ) {
        const dbPackage =
          (m.items || []).find((i) => String(i.sku || '') === '3T-MENU') ||
          (m.items || []).find(
            (i) =>
              Array.isArray(i.choice_groups) &&
              (i.choice_groups as unknown[]).length > 0
          );
        return {
          ...m,
          description: seedMenu.description ?? m.description,
          notes: seedMenu.notes ?? m.notes,
          items: [
            {
              id: (dbPackage?.id as string | undefined) ?? seedPackage.id,
              menu_id: m.id,
              sku: seedPackage.sku,
              name: seedPackage.name,
              description: seedPackage.description,
              unit: seedPackage.unit,
              unit_price: seedPackage.unit_price,
              min_pax: seedPackage.min_pax,
              is_vegetarian: seedPackage.is_vegetarian,
              active: true,
              sort_order: seedPackage.sort_order,
              price_source: seedPackage.price_source,
              price_verified: seedPackage.price_verified,
              choice_groups: seedPackage.choice_groups as MenuChoiceGroup[],
            } satisfies Partial<EventMenuItem>,
          ],
        };
      }

      if (!needsChoiceGroups) return m;

      const seedBySku = new Map(
        (seedMenu.items || [])
          .filter((i) => i.sku)
          .map((i) => [String(i.sku), i])
      );
      const items = (m.items || []).map((it) => {
        if (Array.isArray(it.choice_groups) && it.choice_groups.length > 0) {
          return it;
        }
        const sku = it.sku != null ? String(it.sku) : '';
        const fromSku = sku ? seedBySku.get(sku) : undefined;
        if (fromSku?.choice_groups?.length) {
          return { ...it, choice_groups: fromSku.choice_groups };
        }
        return it;
      });

      const allMissing = items.every(
        (it) => !Array.isArray(it.choice_groups) || it.choice_groups.length === 0
      );
      if (
        allMissing &&
        seedPackage &&
        String(m.code || '').includes('3_tiempos')
      ) {
        return {
          ...m,
          description: seedMenu.description ?? m.description,
          notes: seedMenu.notes ?? m.notes,
          items: [
            {
              id: seedPackage.id,
              menu_id: m.id,
              sku: seedPackage.sku,
              name: seedPackage.name,
              description: seedPackage.description,
              unit: seedPackage.unit,
              unit_price: seedPackage.unit_price,
              min_pax: seedPackage.min_pax,
              is_vegetarian: seedPackage.is_vegetarian,
              active: true,
              sort_order: seedPackage.sort_order,
              price_source: seedPackage.price_source,
              price_verified: seedPackage.price_verified,
              choice_groups: seedPackage.choice_groups as MenuChoiceGroup[],
            } satisfies Partial<EventMenuItem>,
          ],
        };
      }
      return { ...m, items };
    });
    return appendMissingFromSeed(enriched);
  } catch {
    return menus;
  }
}

async function loadDigitalDrinkCounts(
  menus: EventMenu[]
): Promise<{ bySku: Record<string, number>; orders: number; lines: number }> {
  const bySku: Record<string, number> = {};
  let orders = 0;
  let lines = 0;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_service_orders')
      .select('id, payload')
      .limit(2000);
    if (error || !data?.length) return { bySku, orders, lines };

    const catalog = buildCatalogNormIndex(menus);
    for (const row of data) {
      const payload = row.payload as { lines?: Array<{ description?: string }> } | null;
      const descLines = Array.isArray(payload?.lines) ? payload!.lines! : [];
      if (!descLines.length) continue;
      orders += 1;
      const seen = new Set<string>();
      for (const ln of descLines) {
        const skus = matchDrinkSkusFromDescription(
          String(ln.description || ''),
          catalog
        );
        for (const sku of skus) seen.add(sku);
      }
      for (const sku of seen) {
        bySku[sku] = (bySku[sku] || 0) + 1;
        lines += 1;
      }
    }
  } catch {
    /* tablas ausentes / sin credenciales */
  }
  return { bySku, orders, lines };
}

async function withDrinkPopularidad(menus: EventMenu[]): Promise<{
  menus: EventMenu[];
  bebidasPopularidad: BebidasPopularidadPayload;
}> {
  const seed = await loadBebidasPopularidadSeed();
  const digital = await loadDigitalDrinkCounts(menus);
  const bySku = mergeDigitalCounts(seed.by_sku || {}, digital.bySku);
  const enriched = attachOsCountsToMenus(sanitizeMenusPayload(menus), bySku);
  const bebidasPopularidad = buildPopularidadPayload(seed, bySku, enriched, {
    digital_orders: digital.orders,
    digital_lines_matched: digital.lines,
  });
  return { menus: enriched, bebidasPopularidad };
}

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data: menus, error } = await sb
      .from('event_menus')
      .select('*, items:event_menu_items(*)')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      if (isMissingTableError(error.message)) {
        const seedMenus = await loadEventMenusSeed();
        const { menus: withPop, bebidasPopularidad } =
          await withDrinkPopularidad(seedMenus);
        return jsonUtf8({
          ready: false,
          source: 'seed_json',
          persistQuotes: false,
          menus: withPop,
          bebidasPopularidad,
          error: error.message,
          hint: 'Catálogo local activo. Ejecuta supabase/eventos_module.sql para persistir cotizaciones.',
        });
      }
      return jsonUtf8({
        ready: false,
        source: 'supabase',
        menus: [],
        error: error.message,
      });
    }

    let normalized = (menus || []).map((m) => ({
      ...m,
      items: ((m.items as unknown[]) || [])
        .filter((it) => (it as { active?: boolean }).active !== false)
        .map((it) => {
          const row = it as {
            choice_groups?: unknown;
            [key: string]: unknown;
          };
          const cg = row.choice_groups;
          return {
            ...row,
            choice_groups: Array.isArray(cg) ? cg : null,
          };
        })
        .sort(
          (a, b) =>
            Number((a as { sort_order?: number }).sort_order || 0) -
            Number((b as { sort_order?: number }).sort_order || 0)
        ),
    }));

    if (normalized.length === 0) {
      const seedMenus = await loadEventMenusSeed();
      const { menus: withPop, bebidasPopularidad } =
        await withDrinkPopularidad(seedMenus);
      return jsonUtf8({
        ready: false,
        source: 'seed_json',
        persistQuotes: false,
        menus: withPop,
        bebidasPopularidad,
        hint: 'Tabla event_menus vacía — usando seed JSON. Re-ejecuta el seed en eventos_module.sql.',
      });
    }

    normalized = (await enrichCatalogFromSeed(
      normalized as MenuRow[]
    )) as typeof normalized;

    const { menus: withPop, bebidasPopularidad } = await withDrinkPopularidad(
      sanitizeMenusPayload(normalized)
    );

    return jsonUtf8({
      ready: true,
      source: 'supabase',
      persistQuotes: true,
      menus: withPop,
      bebidasPopularidad,
    });
  } catch (e) {
    try {
      const seedMenus = await loadEventMenusSeed();
      const { menus: withPop, bebidasPopularidad } =
        await withDrinkPopularidad(seedMenus);
      return jsonUtf8({
        ready: false,
        source: 'seed_json',
        persistQuotes: false,
        menus: withPop,
        bebidasPopularidad,
        error: e instanceof Error ? e.message : 'Error al leer menús',
        hint: 'Catálogo local activo. Ejecuta supabase/eventos_module.sql para persistir cotizaciones.',
      });
    } catch {
      return jsonUtf8({
        ready: false,
        menus: [],
        error: e instanceof Error ? e.message : 'Error al leer menús',
      });
    }
  }
}
