'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HrSummaryAlert } from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type SummaryPayload = {
  ready?: boolean;
  alerts?: HrSummaryAlert[];
  error?: string;
};

/**
 * Franja de alertas RR.HH. (tablero) — visible arriba de las secciones.
 */
export function RrhhAlertsBanner({
  onGoHorarios,
  onGoVacaciones,
  onGoPlantilla,
  onGoAsistencia,
}: {
  onGoHorarios?: () => void;
  onGoVacaciones?: () => void;
  onGoPlantilla?: () => void;
  onGoAsistencia?: () => void;
}) {
  const [alerts, setAlerts] = useState<HrSummaryAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/summary', { cache: 'no-store' });
      const json = (await res.json()) as SummaryPayload;
      setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || alerts.length === 0) return null;

  const go = (a: HrSummaryAlert) => {
    if (a.go === 'horarios') onGoHorarios?.();
    else if (a.go === 'vacaciones') onGoVacaciones?.();
    else if (a.go === 'asistencia') onGoAsistencia?.();
    else if (a.go === 'plantilla' || a.go === 'expedientes' || a.go === 'resguardos')
      onGoPlantilla?.();
  };

  const label = (goTo: HrSummaryAlert['go']): string | null => {
    if (goTo === 'vacaciones') return 'Vacaciones';
    if (goTo === 'horarios') return 'Horarios';
    if (goTo === 'asistencia') return 'Asistencia';
    if (goTo === 'plantilla' || goTo === 'expedientes') return 'Plantilla';
    if (goTo === 'resguardos') return 'Resguardos';
    return null;
  };

  return (
    <div
      className="mb-4 rounded-2xl bg-white px-4 py-3"
      style={{ boxShadow: SUITE.shadow, borderLeft: `4px solid ${SUITE.orange}` }}
      role="status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold" style={{ color: theme.title }}>
          Alertas
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold underline"
          style={{ color: theme.muted }}
        >
          Actualizar
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {alerts.map((a) => {
          const btn = label(a.go);
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm"
              style={{
                backgroundColor: a.severity === 'warn' ? '#fffbeb' : '#f8fafc',
                color: a.severity === 'warn' ? '#92400e' : theme.muted,
              }}
            >
              <span>{a.message}</span>
              {btn ? (
                <button
                  type="button"
                  className="text-xs font-semibold underline"
                  style={{ color: SUITE.orangeDeep }}
                  onClick={() => go(a)}
                >
                  Ir a {btn}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
