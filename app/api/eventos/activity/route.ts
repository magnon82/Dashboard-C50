import { NextResponse } from 'next/server';
import { loadEventClientActivity } from '@/app/lib/eventos-activity.server';
import { requireEventosSession } from '@/app/lib/eventos-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Timeline cliente↔evento (más reciente → antiguo) desde
 * supabase/seed_event_client_activity.json
 * (generado por ingestor/build_event_client_activity.py).
 */
export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get('limit') || 100) || 100)
  );
  const matchedOnly = url.searchParams.get('matched') === '1';
  const q = url.searchParams.get('q')?.trim().toLowerCase() || '';

  const payload = await loadEventClientActivity();
  if (!payload) {
    return NextResponse.json({
      ready: false,
      error:
        'No hay seed_event_client_activity.json. Corre: python ingestor/build_event_client_activity.py',
      clients: [],
      count: 0,
    });
  }

  let clients = payload.clients.filter((c) => c.last_activity_at);
  if (matchedOnly) {
    clients = clients.filter((c) => c.matched_seed);
  }
  if (q) {
    clients = clients.filter((c) => {
      const hay = [c.company_name, c.contact_name, c.email, c.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  clients = clients
    .slice()
    .sort((a, b) =>
      String(b.last_activity_at || '').localeCompare(
        String(a.last_activity_at || '')
      )
    )
    .slice(0, limit);

  return NextResponse.json({
    ready: true,
    generated_at: payload.generated_at,
    sources_note: payload.sources_note,
    stats: payload.stats,
    clients,
    count: clients.length,
  });
}
