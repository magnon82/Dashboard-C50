import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireEventosSession } from '@/app/lib/eventos-api';
import { LEAD_STAGES } from '@/app/lib/eventos';
import { loadEventClientActivity } from '@/app/lib/eventos-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const emptyKpis = {
  clients: 0,
  leadsOpen: 0,
  quotesDraft: 0,
  quotesTotal: 0,
  upcoming: 0,
  pipelineValue: 0,
  activityClients: 0,
  activityEvents: 0,
};

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const today = new Date().toISOString().slice(0, 10);

    const [clients, leads, quotes, bookings, activity] = await Promise.all([
      sb.from('event_clients').select('id', { count: 'exact', head: true }),
      sb.from('event_leads').select('id, stage, event_date, estimated_amount'),
      sb.from('event_quotes').select('id, status, total, event_date'),
      sb
        .from('event_bookings')
        .select('id, event_date, status')
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(10),
      loadEventClientActivity(),
    ]);

    const activityClients = activity?.stats?.with_activity ?? 0;
    const activityEvents = activity?.stats?.events_total ?? 0;

    const err =
      clients.error || leads.error || quotes.error || bookings.error;
    if (err) {
      // Tablas aún no migradas → KPIs en cero con aviso
      return NextResponse.json({
        ready: false,
        error: err.message,
        kpis: {
          ...emptyKpis,
          activityClients,
          activityEvents,
        },
        byStage: Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])),
        upcomingEvents: [],
        activityReady: !!activity,
      });
    }

    const leadRows = leads.data || [];
    const quoteRows = quotes.data || [];
    const byStage = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<
      string,
      number
    >;
    let pipelineValue = 0;
    let leadsOpen = 0;
    for (const l of leadRows) {
      byStage[l.stage] = (byStage[l.stage] || 0) + 1;
      if (l.stage !== 'ganado' && l.stage !== 'perdido') {
        leadsOpen += 1;
        pipelineValue += Number(l.estimated_amount || 0);
      }
    }

    const quotesDraft = quoteRows.filter((q) => q.status === 'borrador').length;
    const upcomingFromLeads = leadRows
      .filter((l) => l.event_date && l.event_date >= today && l.stage !== 'perdido')
      .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))
      .slice(0, 8);

    return NextResponse.json({
      ready: true,
      kpis: {
        clients: clients.count || 0,
        leadsOpen,
        quotesDraft,
        quotesTotal: quoteRows.length,
        upcoming: upcomingFromLeads.length + (bookings.data?.length || 0),
        pipelineValue,
        activityClients,
        activityEvents,
      },
      byStage,
      upcomingEvents: upcomingFromLeads,
      upcomingBookings: bookings.data || [],
      activityReady: !!activity,
      activityGeneratedAt: activity?.generated_at || null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        error: e instanceof Error ? e.message : 'Error al cargar tablero',
        kpis: emptyKpis,
        byStage: Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])),
        upcomingEvents: [],
        activityReady: false,
      },
      { status: 200 }
    );
  }
}
