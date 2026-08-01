import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireEventosSession } from '@/app/lib/eventos-api';
import { loadEventMenusSeed } from '@/app/lib/eventos-menus-seed';
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

/** Si el ítem 3 tiempos en DB aún es plano, aporta choice_groups del seed JSON. */
async function enrichChoiceGroupsFromSeed(
  menus: Array<{
    code?: string;
    id?: string;
    description?: string | null;
    notes?: string | null;
    items?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>
) {
  const needs = menus.some((m) =>
    (m.items || []).some((it) => !Array.isArray(it.choice_groups))
  );
  if (!needs) return menus;
  try {
    const seed = await loadEventMenusSeed();
    const byCode = new Map(seed.map((m) => [m.code, m]));
    return menus.map((m) => {
      const seedMenu = m.code ? byCode.get(String(m.code)) : undefined;
      if (!seedMenu?.items?.length) return m;
      const seedBySku = new Map(
        (seedMenu.items || [])
          .filter((i) => i.sku)
          .map((i) => [String(i.sku), i])
      );
      const seedPackage = seedMenu.items.find(
        (i) => Array.isArray(i.choice_groups) && i.choice_groups!.length > 0
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
  } catch {
    return menus;
  }
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
        return jsonUtf8({
          ready: false,
          source: 'seed_json',
          persistQuotes: false,
          menus: seedMenus,
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
      return jsonUtf8({
        ready: false,
        source: 'seed_json',
        persistQuotes: false,
        menus: seedMenus,
        hint: 'Tabla event_menus vacía — usando seed JSON. Re-ejecuta el seed en eventos_module.sql.',
      });
    }

    normalized = (await enrichChoiceGroupsFromSeed(
      normalized as Array<{
        code?: string;
        id?: string;
        description?: string | null;
        notes?: string | null;
        items?: Array<Record<string, unknown>>;
        [key: string]: unknown;
      }>
    )) as typeof normalized;

    return jsonUtf8({
      ready: true,
      source: 'supabase',
      persistQuotes: true,
      menus: sanitizeMenusPayload(normalized),
    });
  } catch (e) {
    try {
      const seedMenus = await loadEventMenusSeed();
      return jsonUtf8({
        ready: false,
        source: 'seed_json',
        persistQuotes: false,
        menus: seedMenus,
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
