import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireEventosSession } from '@/app/lib/eventos-api';
import {
  LEAD_STAGES,
  PIPELINE_CLOSED_COUNT_FROM,
  countsInPipelineClosedRecuento,
  mexicoTodayIso,
} from '@/app/lib/eventos';
import { loadEventClientActivity } from '@/app/lib/eventos-activity.server';
import {
  buildUpcomingCalendar,
  filterEnPuertaEvents,
} from '@/app/lib/eventos-calendario';
import { isAnticipoSinOs } from '@/app/lib/eventos-calendario-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPCOMING_LIMIT = 12;

const emptyKpis = {
  clients: 0,
  leadsOpen: 0,
  quotesDraft: 0,
  quotesTotal: 0,
  upcoming: 0,
  /** Eventos en puerta con anticipo y sin OS (PDF/digital). */
  anticipoSinOs: 0,
  pipelineValue: 0,
  activityClients: 0,
  activityEvents: 0,
};

export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const today = mexicoTodayIso();

    const [clients, leads, quotes, bookings, activity, calendar] =
      await Promise.all([
        sb.from('event_clients').select('id', { count: 'exact', head: true }),
        sb.from('event_leads').select(
          'id, title, celebration, company, stage, event_date, pax, estimated_amount, updated_at'
        ),
        sb.from('event_quotes').select('id, status, total, event_date'),
        sb
          .from('event_bookings')
          .select('id, event_date, status')
          .gte('event_date', today)
          .order('event_date', { ascending: true })
          .limit(10),
        loadEventClientActivity(),
        buildUpcomingCalendar(),
      ]);

    const activityClients = activity?.stats?.with_activity ?? 0;
    const activityEvents = activity?.stats?.events_total ?? 0;

    const err =
      clients.error || leads.error || quotes.error || bookings.error;
    if (err) {
      // Tablas aún no migradas → KPIs en cero con aviso; aún así mostrar en puerta
      const enPuerta = filterEnPuertaEvents(calendar.events || []);
      const anticipoSinOs = enPuerta.filter(isAnticipoSinOs).length;
      const upcomingEvents = enPuerta
        .slice(0, UPCOMING_LIMIT)
        .map(mapUpcomingRow);
      return NextResponse.json({
        ready: false,
        error: err.message,
        kpis: {
          ...emptyKpis,
          upcoming: enPuerta.length,
          anticipoSinOs,
          activityClients,
          activityEvents,
        },
        byStage: Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])),
        upcomingEvents,
        activityReady: !!activity,
        activityGeneratedAt: activity?.generated_at || null,
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
      // Ganado/Perdido: solo desde PIPELINE_CLOSED_COUNT_FROM (día CDMX vía updated_at).
      if (
        (l.stage === 'ganado' || l.stage === 'perdido') &&
        !countsInPipelineClosedRecuento(l.stage, l.updated_at)
      ) {
        continue;
      }
      byStage[l.stage] = (byStage[l.stage] || 0) + 1;
      if (l.stage !== 'ganado' && l.stage !== 'perdido') {
        leadsOpen += 1;
        pipelineValue += Number(l.estimated_amount || 0);
      }
    }

    const quotesDraft = quoteRows.filter((q) => q.status === 'borrador').length;

    // En puerta = Calendario sin cancelados (CRM + OS + activity + cotizaciones)
    const enPuerta = filterEnPuertaEvents(calendar.events || []);
    const anticipoSinOs = enPuerta.filter(isAnticipoSinOs).length;
    const upcomingEvents = enPuerta
      .slice(0, UPCOMING_LIMIT)
      .map(mapUpcomingRow);

    // Presupuesto por persona del lead cuando hay match por lead_id
    const amountByLead = new Map<string, number>();
    for (const l of leadRows) {
      if (l.estimated_amount != null) {
        amountByLead.set(String(l.id), Number(l.estimated_amount));
      }
    }
    for (const ev of upcomingEvents) {
      if (ev.lead_id && amountByLead.has(ev.lead_id)) {
        ev.estimated_amount = amountByLead.get(ev.lead_id)!;
      }
    }

    return NextResponse.json({
      ready: true,
      kpis: {
        clients: clients.count || 0,
        leadsOpen,
        quotesDraft,
        quotesTotal: quoteRows.length,
        upcoming: enPuerta.length,
        anticipoSinOs,
        pipelineValue,
        activityClients,
        activityEvents,
      },
      byStage,
      pipelineClosedCountFrom: PIPELINE_CLOSED_COUNT_FROM,
      upcomingEvents,
      upcomingBookings: bookings.data || [],
      activityReady: !!activity,
      activityGeneratedAt: activity?.generated_at || null,
      calendarError: calendar.error || undefined,
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

function mapUpcomingRow(ev: {
  id: string;
  event_date: string;
  title: string;
  client: string | null;
  pax: number | null;
  source: string;
  source_label: string;
  detail: string | null;
  stage: string | null;
  status?: string | null;
  notes?: string | null;
  lead_id: string | null;
  digital_os_id: string | null;
  os_path?: string | null;
  os_filename?: string | null;
  has_os?: boolean;
  has_anticipo?: boolean;
  folio?: string | null;
  quote_id: string | null;
}) {
  return {
    id: ev.id,
    title: ev.title,
    celebration: ev.title,
    company: ev.client,
    event_date: ev.event_date,
    stage: ev.stage || '',
    status: ev.status || null,
    notes: ev.notes || null,
    pax: ev.pax,
    estimated_amount: null as number | null,
    source: ev.source,
    source_label: ev.source_label,
    detail: ev.detail,
    lead_id: ev.lead_id,
    digital_os_id: ev.digital_os_id,
    os_path: ev.os_path || null,
    os_filename: ev.os_filename || null,
    has_os: Boolean(
      ev.has_os || ev.os_path || ev.digital_os_id || ev.source === 'os'
    ),
    // Flag del builder, o etiqueta Anticipos C50 si el merge solo dejó source_label
    has_anticipo: Boolean(
      ev.has_anticipo || /Anticipos\s*C50/i.test(ev.source_label || '')
    ),
    folio: ev.folio || null,
    quote_id: ev.quote_id,
  };
}
