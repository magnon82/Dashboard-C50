import { NextResponse } from 'next/server';
import { requireEventosSession } from '@/app/lib/eventos-api';
import { buildUpcomingCalendar } from '@/app/lib/eventos-calendario';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/eventos/calendario
 * Próximos eventos locales (hoy CDMX+): activity seed + OS + CRM leads.
 */
export async function GET() {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const payload = await buildUpcomingCalendar();
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        today: new Date().toLocaleDateString('en-CA', {
          timeZone: 'America/Mexico_City',
        }),
        events: [],
        count: 0,
        sources: { activity: false, os: false, crm: false },
        note: 'Vista local de próximas fechas. Sync GCal: próximo.',
        error: e instanceof Error ? e.message : 'Error al armar calendario',
      },
      { status: 200 }
    );
  }
}
