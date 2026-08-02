'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import {
  HR_STAFF_POLICY_LINKS,
  formatHrDate,
  hrLeaveDisplayLabel,
  isLeaveTomada,
  todayIsoCdmx,
  type HrLeaveRequest,
  type HrLeaveStatus,
} from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type ListPayload = {
  ready: boolean;
  requests: HrLeaveRequest[];
  message?: string | null;
  error?: string;
};

function statusStyle(
  status: HrLeaveStatus,
  opts?: { tomada?: boolean }
): { bg: string; color: string } {
  if (opts?.tomada) {
    return { bg: '#e0f2fe', color: '#075985' };
  }
  switch (status) {
    case 'aprobada':
      return { bg: '#ecfdf5', color: '#065f46' };
    case 'rechazada':
      return { bg: '#fef2f2', color: '#991b1b' };
    case 'cancelada':
      return { bg: '#f1f5f9', color: '#475569' };
    default:
      return { bg: SUITE.orangeSoft, color: SUITE.navy };
  }
}

export function StaffVacacionesClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<HrLeaveRequest[]>([]);
  const [schemaMsg, setSchemaMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hr/leave-requests', { cache: 'no-store' });
      const json = (await res.json()) as ListPayload;
      if (!res.ok) {
        setError((json as { error?: string }).error || 'No se pudo cargar');
        return;
      }
      setRequests(json.requests || []);
      setSchemaMsg(json.ready ? null : json.message || null);
    } catch {
      setError('Error de red al cargar solicitudes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-5">
      <p className="mb-1">
        <Link
          href="/staff"
          className="text-sm font-semibold"
          style={{ color: SUITE.orangeDeep }}
        >
          ← Volver a Staff
        </Link>
      </p>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {schemaMsg && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {schemaMsg}
        </div>
      )}

      <SuiteCard accent className="max-w-3xl">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Mis vacaciones
        </p>
        <h2 className="mt-2 text-xl font-bold" style={{ color: theme.title }}>
          Solicitud en Recursos Humanos
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Por ahora RH captura tu solicitud de vacaciones. En una siguiente fase
          podrás solicitar aquí y avisará a tu jefe directo.
        </p>
        <ul className="mt-3 space-y-1 text-xs" style={{ color: theme.muted }}>
          {HR_STAFF_POLICY_LINKS.filter((l) =>
            l.surfaces.includes('vacaciones')
          ).map((l) => (
            <li key={l.local_path}>
              <span
                className="font-semibold"
                style={{ color: SUITE.orangeDeep }}
              >
                Política
              </span>
              {' · '}
              {l.title}
            </li>
          ))}
        </ul>
      </SuiteCard>

      <SuiteCard className="max-w-3xl">
        <h3 className="text-base font-bold" style={{ color: theme.title }}>
          Mis solicitudes
        </h3>
        {loading ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Cargando…
          </p>
        ) : requests.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Aún no hay solicitudes registradas a tu nombre.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {requests.map((r) => {
              const today = todayIsoCdmx();
              const tomada = isLeaveTomada(r.status, r.date_to, today);
              const st = statusStyle(r.status, { tomada });
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <p
                      className="text-sm font-semibold"
                      style={{ color: theme.title }}
                    >
                      {formatHrDate(r.date_from)} → {formatHrDate(r.date_to)}
                      <span className="ml-2 font-normal text-slate-500">
                        ({r.days} día{Number(r.days) === 1 ? '' : 's'})
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Registrada {formatHrDate(r.created_at)}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ backgroundColor: st.bg, color: st.color }}
                  >
                    {hrLeaveDisplayLabel(r.status, r.date_to, today)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SuiteCard>
    </div>
  );
}
