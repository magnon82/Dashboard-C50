import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireEventosSession } from '@/app/lib/eventos-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      // Tablas pendientes → UI muestra empty state, no 500
      return NextResponse.json({
        ready: false,
        menus: [],
        error: error.message,
      });
    }

    const normalized = (menus || []).map((m) => ({
      ...m,
      items: ((m.items as unknown[]) || [])
        .filter((it) => (it as { active?: boolean }).active !== false)
        .sort(
          (a, b) =>
            Number((a as { sort_order?: number }).sort_order || 0) -
            Number((b as { sort_order?: number }).sort_order || 0)
        ),
    }));

    return NextResponse.json({
      ready: normalized.length > 0,
      menus: normalized,
    });
  } catch (e) {
    return NextResponse.json({
      ready: false,
      menus: [],
      error: e instanceof Error ? e.message : 'Error al leer menús',
    });
  }
}
