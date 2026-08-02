'use client';

import { Card, Metric, Text } from '@tremor/react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { LEAD_STAGE_LABELS, formatMxn, type LeadStage } from '@/app/lib/eventos';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type UpcomingEvent = {
  id: string;
  title?: string;
  celebration?: string | null;
  company?: string | null;
  event_date: string | null;
  stage: string;
  pax?: number | null;
  estimated_amount?: number | null;
  source?: string;
  source_label?: string;
  detail?: string | null;
  lead_id?: string | null;
  digital_os_id?: string | null;
  quote_id?: string | null;
};

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
  upcomingEvents: UpcomingEvent[];
};

function formatEventDate(iso: string | null | undefined): string {
  if (!iso) return 'Sin fecha';
  return new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function daysUntilLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const [ty, tm, td] = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
    .split('-')
    .map(Number);
  const days = Math.round(
    (Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000
  );
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days > 1 && days <= 14) return `En ${days} días`;
  return '';
}

function stageOrSourceLabel(ev: UpcomingEvent): string {
  if (ev.stage && LEAD_STAGE_LABELS[ev.stage as LeadStage]) {
    return LEAD_STAGE_LABELS[ev.stage as LeadStage];
  }
  return ev.source_label || 'Evento';
}

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

  const upcoming = summary?.upcomingEvents || [];

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
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-bold" style={{ color: theme.title }}>
              Próximos eventos
            </h3>
            {k != null && k.upcoming > 0 && (
              <span className="text-xs font-semibold text-slate-500">
                {k.upcoming} en puerta
                {upcoming.length < k.upcoming
                  ? ` · mostrando ${upcoming.length}`
                  : ''}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Eventos en puerta: CRM, cotizaciones, OS e historial (hoy CDMX+).
          </p>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: theme.muted }}>
              {loading
                ? 'Cargando fechas próximas…'
                : 'Sin fechas próximas en CRM, OS ni historial. Crea un lead con fecha, cotiza un evento o regenera el seed de actividad.'}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((ev) => {
                const when = daysUntilLabel(ev.event_date);
                const showCompany =
                  ev.company &&
                  ev.company.trim().toLowerCase() !==
                    (ev.celebration || ev.title || '')
                      .trim()
                      .toLowerCase();
                const goOs = Boolean(ev.digital_os_id || ev.source === 'os');
                const goCrm = Boolean(ev.lead_id || ev.source === 'crm');
                return (
                  <li
                    key={ev.id}
                    className="rounded-xl border border-slate-100 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-800">
                          {ev.celebration || ev.title || 'Evento'}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">
                            {formatEventDate(ev.event_date)}
                          </span>
                          {when ? ` · ${when}` : ''}
                          {showCompany ? ` · ${ev.company}` : ''}
                          {' · '}
                          {stageOrSourceLabel(ev)}
                          {ev.pax ? ` · ${ev.pax} pax` : ''}
                          {ev.estimated_amount
                            ? ` · Presupuesto/pax ${formatMxn(Number(ev.estimated_amount))}`
                            : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {goCrm && (
                          <button
                            type="button"
                            onClick={onGoCrm}
                            className="rounded-lg px-2 py-1 text-[11px] font-bold text-white"
                            style={{ backgroundColor: SUITE.navy }}
                          >
                            CRM
                          </button>
                        )}
                        {ev.digital_os_id ? (
                          <a
                            href={`/eventos/os/${ev.digital_os_id}`}
                            className="rounded-lg px-2 py-1 text-[11px] font-bold text-white"
                            style={{ backgroundColor: SUITE.orange }}
                          >
                            Ver OS
                          </a>
                        ) : goOs && onGoOs ? (
                          <button
                            type="button"
                            onClick={onGoOs}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                          >
                            OS
                          </button>
                        ) : null}
                        {ev.quote_id ? (
                          <a
                            href={`/eventos/cotizacion/${ev.quote_id}`}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                          >
                            Cotiz.
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
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
