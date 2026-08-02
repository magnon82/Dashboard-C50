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
import { EventosCalendario } from '@/app/components/eventos/EventosCalendario';
import { EventosBiblioteca } from '@/app/components/eventos/EventosBiblioteca';
import { EventosStubPanel } from '@/app/components/eventos/EventosStubPanel';
import {
  sanitizeEventMenuTextFields,
  type EventClient,
  type EventLead,
  type EventMenu,
} from '@/app/lib/eventos';

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
    celebration?: string | null;
    company?: string | null;
    event_date: string | null;
    stage: string;
    status?: string | null;
    pax?: number | null;
    estimated_amount?: number | null;
    source?: string;
    source_label?: string;
    detail?: string | null;
    lead_id?: string | null;
    digital_os_id?: string | null;
    os_path?: string | null;
    os_filename?: string | null;
    has_os?: boolean;
    has_anticipo?: boolean;
    quote_id?: string | null;
  }>;
};

export default function EventosPage() {
  const [section, setSection] = useState<EventosSection>('tablero');
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [clients, setClients] = useState<EventClient[]>([]);
  const [leads, setLeads] = useState<EventLead[]>([]);
  const [menus, setMenus] = useState<EventMenu[]>([]);
  const [menusError, setMenusError] = useState<string | null>(null);
  const [menusSource, setMenusSource] = useState<'supabase' | 'seed_json' | null>(
    null
  );
  const [persistQuotes, setPersistQuotes] = useState(true);
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
      setMenus(
        ((menuJson.menus || []) as EventMenu[]).map(sanitizeEventMenuTextFields)
      );
      setMenusError(menuJson.error || null);
      setMenusSource(
        menuJson.source === 'seed_json' || menuJson.source === 'supabase'
          ? menuJson.source
          : null
      );
      setPersistQuotes(menuJson.persistQuotes !== false && menuJson.ready !== false);
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
                ? `No hay menús (${menusError}). Sin catálogo no se puede cotizar.`
                : 'No hay menús. Sin catálogo no se puede cotizar.'
            }
            bullets={[
              'Abre Supabase → SQL Editor',
              'Pega y ejecuta supabase/eventos_module.sql + supabase/eventos_menus_bebidas_c50.sql (3 tiempos, desayunos, parejas, barra libre, bebidas C50)',
              'Recarga /eventos → Cotizador',
              'Opcional: CRM → Importar Excel clientes / Importar Seguimiento',
              'Precios con * aún requieren verificación operativa',
            ]}
          />
        ) : (
          <EventosCotizador
            menus={menus}
            clients={clients}
            onSaved={refresh}
            dbReady={summary?.ready !== false}
            menusFromSeed={menusSource === 'seed_json'}
            persistQuotes={persistQuotes}
          />
        ))}

      {section === 'calendario' && <EventosCalendario />}

      {section === 'os' && <EventosOrdenesServicio />}

      {section === 'biblioteca' && <EventosBiblioteca />}
    </SuiteShell>
  );
}
