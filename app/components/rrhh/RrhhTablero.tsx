'use client';

import { SuiteCard } from '@/app/components/SuiteShell';
import { type HrSummaryAlert, type HrSummaryKpis } from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type Summary = {
  ready: boolean;
  error?: string;
  kpis: HrSummaryKpis;
  alerts?: HrSummaryAlert[];
  note?: string;
};

export function RrhhTablero({
  summary,
  loading,
  onGoPlantilla,
  onGoHorarios,
  onGoVacaciones,
  onGoExpedientes,
  onGoResguardos,
}: {
  summary: Summary | null;
  loading: boolean;
  onGoPlantilla: () => void;
  onGoHorarios?: () => void;
  onGoVacaciones?: () => void;
  onGoExpedientes?: () => void;
  onGoResguardos?: () => void;
}) {
  const k = summary?.kpis;
  const alerts = summary?.alerts ?? [];

  const cards = [
    { label: 'Plantilla vigente', value: k?.plantilla ?? '—', border: SUITE.navy },
    {
      label: 'Empleados en catálogo',
      value: k?.employeesTotal ?? '—',
      border: SUITE.orange,
    },
    {
      label: 'Vacaciones por aprobar',
      value: k?.leavePending ?? '—',
      border: '#0f766e',
    },
    {
      label: 'Salen en ≤2 días hábiles',
      value: k?.leaveUpcoming ?? '—',
      border: '#c2410c',
    },
    {
      label: 'Resguardos pendientes',
      value: k?.resguardoPending ?? '—',
      border: '#be185d',
    },
    {
      label: 'Horario semana actual',
      value: k?.currentWeekPublished ? 'Publicado' : 'Sin publicar',
      border: k?.currentWeekPublished ? '#0369a1' : '#b45309',
    },
    {
      label: 'Horarios en borrador',
      value: k?.scheduleDraft ?? '—',
      border: '#7c3aed',
    },
    {
      label: 'Saldos vacaciones bajos',
      value: k?.leaveLowBalance ?? '—',
      border: '#0f766e',
    },
    {
      label: 'Nóminas abiertas',
      value: k?.payrollOpen ?? '—',
      border: '#b45309',
    },
  ];

  const goAction = (go: HrSummaryAlert['go']) => {
    if (!go) return;
    const map: Record<NonNullable<HrSummaryAlert['go']>, (() => void) | undefined> =
      {
        plantilla: onGoPlantilla,
        horarios: onGoHorarios,
        vacaciones: onGoVacaciones,
        expedientes: onGoExpedientes || onGoPlantilla,
        resguardos: onGoResguardos || onGoExpedientes || onGoPlantilla,
        asistencia: onGoHorarios,
      };
    map[go]?.();
  };

  const goLabel = (go: HrSummaryAlert['go']): string | null => {
    if (go === 'vacaciones') return 'Ir a Vacaciones';
    if (go === 'horarios') return 'Ir a Horarios';
    if (go === 'asistencia') return 'Ir a Asistencia';
    if (go === 'expedientes' || go === 'plantilla') return 'Ir a Plantilla';
    if (go === 'resguardos') return 'Ver resguardos';
    return null;
  };

  return (
    <div className="space-y-5">
      {!loading && summary && !summary.ready && summary.error && (
        <p className="max-w-3xl text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          {summary.error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl bg-white px-4 py-4"
            style={{
              boxShadow: SUITE.shadow,
              borderLeft: `4px solid ${c.border}`,
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: theme.muted }}
            >
              {c.label}
            </p>
            <p
              className="mt-2 text-2xl font-bold tabular-nums"
              style={{ color: theme.title }}
            >
              {loading ? '…' : c.value}
            </p>
          </div>
        ))}
      </div>

      {!loading && summary?.ready && alerts.length > 0 && (
        <SuiteCard className="max-w-3xl">
          <p className="text-sm font-bold" style={{ color: theme.title }}>
            Alertas
          </p>
          <ul className="mt-3 space-y-2">
            {alerts.map((a) => {
              const label = goLabel(a.go);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3 py-2"
                  style={{
                    backgroundColor:
                      a.severity === 'warn' ? '#fffbeb' : '#f8fafc',
                  }}
                >
                  <span
                    className="text-sm"
                    style={{
                      color: a.severity === 'warn' ? '#92400e' : theme.muted,
                    }}
                  >
                    {a.message}
                  </span>
                  {label ? (
                    <button
                      type="button"
                      className="text-xs font-semibold underline"
                      style={{ color: SUITE.orangeDeep }}
                      onClick={() => goAction(a.go)}
                    >
                      {label}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SuiteCard>
      )}

      {!loading && summary?.ready && alerts.length === 0 && (
        <SuiteCard className="max-w-3xl">
          <p className="text-sm" style={{ color: theme.muted }}>
            Sin alertas: vacaciones, salidas próximas y resguardos al día
            {k?.currentWeekPublished
              ? '; horario de la semana publicado'
              : ''}
            .
          </p>
        </SuiteCard>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onGoPlantilla}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: SUITE.navy }}
        >
          Ver plantilla →
        </button>
        {onGoHorarios && (
          <button
            type="button"
            onClick={onGoHorarios}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{
              backgroundColor: '#fff',
              color: SUITE.navy,
              boxShadow: SUITE.shadow,
            }}
          >
            Horarios →
          </button>
        )}
      </div>
    </div>
  );
}
