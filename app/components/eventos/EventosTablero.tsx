'use client';

import { Card, Metric, Text } from '@tremor/react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { LEAD_STAGE_LABELS, formatMxn, type LeadStage } from '@/app/lib/eventos';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type Summary = {
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
    pax?: number | null;
    estimated_amount?: number | null;
  }>;
};

export function EventosTablero({
  summary,
  loading,
  onGoCrm,
  onGoCotizador,
  onGoOs,
}: {
  summary: Summary | null;
  loading: boolean;
  onGoCrm: () => void;
  onGoCotizador: () => void;
  onGoOs?: () => void;
}) {
  const k = summary?.kpis;
  const cards = [
    { label: 'Clientes CRM', value: k?.clients ?? '—', border: SUITE.navy },
    { label: 'Leads abiertos', value: k?.leadsOpen ?? '—', border: SUITE.orange },
    {
      label: 'Cotizaciones',
      value:
        k != null
          ? `${k.quotesDraft} borrador · ${k.quotesTotal} total`
          : '—',
      border: SUITE.navySoft,
    },
    {
      label: 'Pipeline estimado',
      value: k ? formatMxn(k.pipelineValue) : '—',
      border: '#C47B0A',
    },
    {
      label: 'Historial (clientes c/act.)',
      value: k?.activityClients ?? '—',
      border: SUITE.navy,
    },
    {
      label: 'Eventos indexados',
      value: k?.activityEvents ?? '—',
      border: SUITE.orange,
    },
  ];

  return (
    <div className="space-y-5">
      {!summary?.ready && (
        <SuiteCard accent>
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            Base de datos pendiente
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm" style={{ color: theme.muted }}>
            <li>
              Supabase → SQL Editor → ejecuta{' '}
              <code className="text-xs">supabase/eventos_module.sql</code> (tablas
              CRM + cotizador + seed de menús).
            </li>
            <li>Recarga esta página.</li>
            <li>
              En CRM → «Importar Excel clientes» si aún no hay clientes (
              <code className="text-xs">seed_event_clients.json</code>).
            </li>
          </ol>
          {summary?.error && (
            <p className="mt-2 text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
              Detalle: {summary.error}
            </p>
          )}
        </SuiteCard>
      )}

      {summary?.ready && !summary.activityReady && (
        <SuiteCard>
          <p className="text-sm" style={{ color: theme.muted }}>
            Historial OS/Sheets aún no indexado. Corre{' '}
            <code className="text-xs">
              python ingestor/build_event_client_activity.py
            </code>{' '}
            para generar{' '}
            <code className="text-xs">supabase/seed_event_client_activity.json</code>
            . Las Órdenes de servicio pueden listar desde Drive aunque falte el
            seed.
          </p>
        </SuiteCard>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Card
            key={c.label}
            className="!rounded-[24px] !p-5"
            style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${c.border}` }}
          >
            <Text className="!text-xs !font-semibold uppercase tracking-wide !text-slate-500">
              {c.label}
            </Text>
            <Metric className="!mt-2 !text-2xl" style={{ color: theme.title }}>
              {loading ? '…' : c.value}
            </Metric>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Pipeline por etapa
          </h3>
          <ul className="mt-4 space-y-2">
            {(Object.keys(LEAD_STAGE_LABELS) as LeadStage[]).map((stage) => (
              <li
                key={stage}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-700">
                  {LEAD_STAGE_LABELS[stage]}
                </span>
                <span className="font-bold" style={{ color: SUITE.navy }}>
                  {summary?.byStage?.[stage] ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </SuiteCard>

        <SuiteCard>
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Próximos eventos (leads)
          </h3>
          {(summary?.upcomingEvents || []).length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: theme.muted }}>
              Sin fechas próximas. Crea leads en CRM o cotiza un evento.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {summary!.upcomingEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-xl border border-slate-100 px-3 py-2 text-sm"
                >
                  <div className="font-semibold text-slate-800">
                    {ev.celebration || ev.title || 'Evento'}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {ev.company ? `${ev.company} · ` : ''}
                    {ev.event_date
                      ? new Date(ev.event_date + 'T12:00:00').toLocaleDateString(
                          'es-MX',
                          { day: 'numeric', month: 'short', year: 'numeric' }
                        )
                      : 'Sin fecha'}{' '}
                    · {LEAD_STAGE_LABELS[ev.stage as LeadStage] || ev.stage}
                    {ev.pax ? ` · ${ev.pax} pax` : ''}
                    {ev.estimated_amount
                      ? ` · Presupuesto por persona ${formatMxn(Number(ev.estimated_amount))}`
                      : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGoCrm}
              className="rounded-xl px-3 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              Ir a CRM
            </button>
            <button
              type="button"
              onClick={onGoCotizador}
              className="rounded-xl px-3 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: SUITE.orange }}
            >
              Nueva cotización
            </button>
            {onGoOs && (
              <button
                type="button"
                onClick={onGoOs}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Ver OS
              </button>
            )}
          </div>
        </SuiteCard>
      </div>

      <SuiteCard dark>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">
          Reglas comerciales
        </p>
        <p className="mt-2 text-sm text-white/90">
          Servicio 15% sobre subtotal · Hold: bloquea la fecha por 72 h hábiles
          (admin puede extender) · Sin hold si faltan &lt;15 días · Barra libre
          solo con alimentos · Grupos desde 10 pax · Pack desayunos ≥50 =
          $30,000
        </p>
      </SuiteCard>
    </div>
  );
}
