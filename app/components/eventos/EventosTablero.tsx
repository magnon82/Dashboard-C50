'use client';

import { Card, Metric, Text } from '@tremor/react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  LEAD_STAGE_LABELS,
  PIPELINE_CLOSED_COUNT_FROM,
  daysUntilEventMexico,
  formatMxn,
  type LeadStage,
} from '@/app/lib/eventos';
import { isAnticipoSinOs } from '@/app/lib/eventos-calendario-shared';
import { getTheme, SUITE } from '@/app/lib/themes';

function formatPipelineCutoffLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const theme = getTheme('suite');

type UpcomingEvent = {
  id: string;
  title?: string;
  celebration?: string | null;
  company?: string | null;
  event_date: string | null;
  stage: string;
  status?: string | null;
  notes?: string | null;
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
  folio?: string | null;
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
    anticipoSinOs?: number;
    pipelineValue: number;
    activityClients?: number;
    activityEvents?: number;
  };
  byStage: Record<string, number>;
  /** YYYY-MM-DD: Ganado/Perdido solo cuentan desde esta fecha (CDMX). */
  pipelineClosedCountFrom?: string;
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

/** Días civiles hasta el evento (hoy CDMX = 0). */
function daysUntil(iso: string | null | undefined): number | null {
  return daysUntilEventMexico(iso);
}

function daysUntilLabel(iso: string | null | undefined): string {
  const days = daysUntil(iso);
  if (days === null) return '';
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days > 1 && days <= 14) return `En ${days} días`;
  return '';
}

/** Evento en menos de 7 días (hoy CDMX → día 6 inclusive). */
function isNearEvent(iso: string | null | undefined): boolean {
  const days = daysUntil(iso);
  return days !== null && days >= 0 && days < 7;
}

function stageOrSourceLabel(ev: UpcomingEvent): string {
  if (ev.status === 'cancelado') return 'Cancelado';
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
  ];

  // Defensa UI: en puerta no incluye cancelados (el API ya filtra).
  const upcoming = (summary?.upcomingEvents || []).filter(
    (ev) => ev.status !== 'cancelado'
  );

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
              En CRM, agrega clientes manualmente si aún no hay ninguno.
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
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>
            Ganado y Perdido: recuento desde{' '}
            {formatPipelineCutoffLabel(
              summary?.pipelineClosedCountFrom || PIPELINE_CLOSED_COUNT_FROM
            )}{' '}
            (cierras anteriores en cero).
          </p>
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
                const near =
                  ev.status !== 'cancelado' && isNearEvent(ev.event_date);
                const showCompany =
                  ev.company &&
                  ev.company.trim().toLowerCase() !==
                    (ev.celebration || ev.title || '')
                      .trim()
                      .toLowerCase();
                const goOs = Boolean(
                  ev.has_os || ev.digital_os_id || ev.source === 'os'
                );
                const goCrm = Boolean(ev.lead_id || ev.source === 'crm');
                const anticipoSinOs = isAnticipoSinOs({
                  has_anticipo: Boolean(ev.has_anticipo),
                  source_label: ev.source_label || undefined,
                  has_os: Boolean(ev.has_os),
                  os_path: ev.os_path || null,
                  os_filename: ev.os_filename || null,
                  digital_os_id: ev.digital_os_id || null,
                  status: ev.status || null,
                  source: (ev.source as 'crm' | 'os' | 'activity') || 'activity',
                });
                const cardClass =
                  ev.status === 'cancelado'
                    ? 'border-rose-200 bg-rose-50/60'
                    : anticipoSinOs && near
                      ? 'border-amber-300 border-l-[5px] border-l-orange-500 bg-amber-50/70 shadow-sm shadow-orange-100/80'
                      : anticipoSinOs
                        ? 'border-amber-200 bg-amber-50/50'
                        : near
                          ? 'border-orange-300 border-l-[5px] border-l-orange-500 bg-orange-50/90 shadow-sm shadow-orange-100/80'
                          : 'border-slate-100 bg-white';
                return (
                  <li
                    key={ev.id}
                    className={`rounded-xl border px-3 py-2 text-sm ${cardClass}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div
                            className={`font-semibold ${
                              ev.status === 'cancelado'
                                ? 'text-slate-500 line-through'
                                : 'text-slate-800'
                            }`}
                          >
                            {ev.celebration || ev.title || 'Evento'}
                          </div>
                          {ev.status === 'cancelado' && (
                            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
                              Cancelado
                            </span>
                          )}
                          {anticipoSinOs && (
                            <span
                              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900"
                              title="Hay anticipo registrado pero aún no hay orden de servicio"
                            >
                              <span
                                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600"
                                aria-hidden
                              />
                              Anticipo sin OS
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">
                            {formatEventDate(ev.event_date)}
                          </span>
                          {when && ev.status !== 'cancelado' ? (
                            <span
                              className={
                                near
                                  ? 'font-bold text-orange-800'
                                  : undefined
                              }
                            >
                              {` · ${when}`}
                            </span>
                          ) : null}
                          {showCompany ? ` · ${ev.company}` : ''}
                          {' · '}
                          {stageOrSourceLabel(ev)}
                          {ev.pax ? ` · ${ev.pax} pax` : ''}
                          {ev.estimated_amount
                            ? ` · Presupuesto/pax ${formatMxn(Number(ev.estimated_amount))}`
                            : ''}
                        </div>
                        {ev.status === 'cancelado' && ev.notes && (
                          <p className="mt-1 text-xs text-rose-900/80">{ev.notes}</p>
                        )}
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
                          <>
                            <a
                              href={`/eventos/os/${ev.digital_os_id}`}
                              className="rounded-lg px-2 py-1 text-[11px] font-bold text-white"
                              style={{ backgroundColor: SUITE.orange }}
                              title="Abrir orden de servicio digital"
                            >
                              Consultar
                            </a>
                            <a
                              href={`/eventos/os/${ev.digital_os_id}?print=1`}
                              className="rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-900 hover:bg-orange-100"
                              title="Abrir diálogo para guardar PDF"
                            >
                              Descargar
                            </a>
                          </>
                        ) : ev.os_path ? (
                          <>
                            <a
                              href={`/api/eventos/os?open=${encodeURIComponent(ev.os_path)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                              title={ev.os_filename || 'Ver PDF'}
                            >
                              Consultar
                            </a>
                            <a
                              href={`/api/eventos/os?open=${encodeURIComponent(ev.os_path)}&download=1`}
                              className="rounded-lg px-2 py-1 text-[11px] font-bold text-white"
                              style={{ backgroundColor: SUITE.orange }}
                              title={ev.os_filename || 'Descargar PDF'}
                              download={ev.os_filename || true}
                            >
                              Descargar
                            </a>
                          </>
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
    </div>
  );
}
