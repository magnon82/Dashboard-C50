/**
 * GET /api/eventos/bebidas-popularidad
 * Ranking de bebidas según OS históricas (seed PDF + OS digitales).
 */
import { NextResponse } from 'next/server';
import { requireEventosSession } from '@/app/lib/eventos-api';
import { loadEventMenusSeed } from '@/app/lib/eventos-menus-seed';
import {
  attachOsCountsToMenus,
  buildCatalogNormIndex,
  buildPopularidadPayload,
  loadBebidasPopularidadSeed,
  matchDrinkSkusFromDescription,
  mergeDigitalCounts,
} from '@/app/lib/eventos-bebidas-popularidad';
import { getServiceSupabase } from '@/app/lib/users';
import { sanitizeEventMenuTextFields, type EventMenu } from '@/app/lib/eventos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JSON_UTF8 = { 'Content-Type': 'application/json; charset=utf-8' };

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  let menus: EventMenu[] = [];
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_menus')
      .select('*, items:event_menu_items(*)')
      .eq('active', true);
    if (!error && data?.length) {
      menus = data.map((m) =>
        sanitizeEventMenuTextFields({
          ...(m as EventMenu),
          items: ((m as EventMenu).items || []).filter(
            (it) => it.active !== false
          ),
        })
      );
    }
  } catch {
    /* fall through */
  }
  if (!menus.length) {
    menus = await loadEventMenusSeed();
  }

  const seed = await loadBebidasPopularidadSeed();
  const digitalBySku: Record<string, number> = {};
  let digitalOrders = 0;
  let digitalLines = 0;
  try {
    const sb = getServiceSupabase();
    const { data } = await sb
      .from('event_service_orders')
      .select('id, payload')
      .limit(2000);
    const catalog = buildCatalogNormIndex(menus);
    for (const row of data || []) {
      const payload = row.payload as {
        lines?: Array<{ description?: string }>;
      } | null;
      const descLines = Array.isArray(payload?.lines) ? payload!.lines! : [];
      if (!descLines.length) continue;
      digitalOrders += 1;
      const seen = new Set<string>();
      for (const ln of descLines) {
        for (const sku of matchDrinkSkusFromDescription(
          String(ln.description || ''),
          catalog
        )) {
          seen.add(sku);
        }
      }
      for (const sku of seen) {
        digitalBySku[sku] = (digitalBySku[sku] || 0) + 1;
        digitalLines += 1;
      }
    }
  } catch {
    /* opcional */
  }

  const bySku = mergeDigitalCounts(seed.by_sku || {}, digitalBySku);
  const withCounts = attachOsCountsToMenus(menus, bySku);
  const payload = buildPopularidadPayload(seed, bySku, withCounts, {
    digital_orders: digitalOrders,
    digital_lines_matched: digitalLines,
  });

  return NextResponse.json(
    {
      ready: true,
      ...payload,
    },
    { headers: JSON_UTF8 }
  );
}
