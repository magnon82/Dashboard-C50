'use client';

import { useCallback, useEffect, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import {
  EventosSectionNav,
  type EventosSection,
} from '@/app/components/eventos/EventosSectionNav';
import { EventosTablero } from '@/app/components/eventos/EventosTablero';
import { EventosCrm } from '@/app/components/eventos/EventosCrm';
import { EventosCotizador } from '@/app/components/eventos/EventosCotizador';
import { EventosOrdenesServicio } from '@/app/components/eventos/EventosOrdenesServicio';
import { EventosStubPanel } from '@/app/components/eventos/EventosStubPanel';
import type { EventClient, EventLead, EventMenu } from '@/app/lib/eventos';

type SummaryPayload = {
  ready: boolean;
  error?: string;
  activityReady?: boolean;
  activityGeneratedAt?: string | null;
  kpis: {
    clients: number;
    leadsOpen: number;
    quotesDraft: number;
    quotesTotal: number;
    upcoming: number;
    pipelineValue: number;
    activityClients?: number;
    activityEvents?: number;
  };
  byStage: Record<string, number>;
  upcomingEvents: Array<{
    id: string;
    title?: string;
    event_date: string | null;
    stage: string;
    estimated_amount?: number | null;
  }>;
};

export default function EventosPage() {
  const [section, setSection] = useState<EventosSection>('tablero');
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [clients, setClients] = useState<EventClient[]>([]);
  const [leads, setLeads] = useState<EventLead[]>([]);
  const [menus, setMenus] = useState<EventMenu[]>([]);
  const [menusError, setMenusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, cliRes, leadRes, menuRes] = await Promise.all([
        fetch('/api/eventos/summary', { cache: 'no-store' }),
        fetch('/api/eventos/clients?sort=activity', { cache: 'no-store' }),
        fetch('/api/eventos/leads', { cache: 'no-store' }),
        fetch('/api/eventos/menus', { cache: 'no-store' }),
      ]);
      const [sumJson, cliJson, leadJson, menuJson] = await Promise.all([
        sumRes.json(),
        cliRes.json(),
        leadRes.json(),
        menuRes.json(),
      ]);
      setSummary(sumJson);
      setClients(cliJson.clients || []);
      setLeads(leadJson.leads || []);
      setMenus(menuJson.menus || []);
      setMenusError(menuJson.error || null);
    } catch {
      setSummary({
        ready: false,
        error: 'Error de red',
        kpis: {
          clients: 0,
          leadsOpen: 0,
          quotesDraft: 0,
          quotesTotal: 0,
          upcoming: 0,
          pipelineValue: 0,
          activityClients: 0,
          activityEvents: 0,
        },
        byStage: {},
        upcomingEvents: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SuiteShell title="Eventos" subtitle={`Operación comercial · ${hoy}`}>
      <EventosSectionNav active={section} onChange={setSection} />

      {section === 'tablero' && (
        <EventosTablero
          summary={summary}
          loading={loading}
          onGoCrm={() => setSection('crm')}
          onGoCotizador={() => setSection('cotizador')}
          onGoOs={() => setSection('os')}
        />
      )}

      {section === 'crm' && (
        <EventosCrm
          clients={clients}
          leads={leads}
          loading={loading}
          onRefresh={refresh}
          dbReady={
            summary?.ready !== false || clients.length > 0 || leads.length > 0
          }
        />
      )}

      {section === 'cotizador' &&
        (menus.length === 0 ? (
          <EventosStubPanel
            title="Catálogo no disponible"
            eyebrow="Configuración"
            body={
              menusError
                ? `No hay menús en Supabase (${menusError}). Ejecuta supabase/eventos_module.sql en el SQL Editor (incluye seed de 3 tiempos, desayunos, parejas y barra libre) y recarga.`
                : 'No hay menús en Supabase. Ejecuta supabase/eventos_module.sql (incluye seed de 3 tiempos, desayunos, parejas y barra libre) y recarga.'
            }
            bullets={[
              'SQL Editor → pegar supabase/eventos_module.sql → Run',
              'Recarga /eventos → Cotizador',
              'Precios con * aún requieren verificación operativa',
            ]}
          />
        ) : (
          <EventosCotizador
            menus={menus}
            clients={clients}
            onSaved={refresh}
          />
        ))}

      {section === 'calendario' && (
        <EventosStubPanel
          title="Calendario compartido"
          body="La sync con Google Calendar compartido del equipo de eventos llega en Fase 2. Por ahora las fechas viven en leads y cotizaciones; la tabla event_bookings ya está lista como stub."
          bullets={[
            'Hold 72 h hábiles (sin hold si faltan <15 días)',
            'Admin puede extender hold',
            'GCal: un calendario compartido, no uno por usuario',
          ]}
        />
      )}

      {section === 'os' && <EventosOrdenesServicio />}

      {section === 'biblioteca' && (
        <EventosStubPanel
          title="Biblioteca de menús y políticas"
          body="Acceso rápido a PDFs vigentes en Drive (Menús eventos vigentes, políticas, OS). En Fase 2 se listarán y abrirán desde aquí."
          bullets={[
            'Menú 3 tiempos 2025',
            'Desayunos / Parejas ES·EN / Barra libre',
            'Política de eventos 2025',
          ]}
        />
      )}
    </SuiteShell>
  );
}
