'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import {
  HR_RESGUARDO_ACCEPT_LABELS,
  HR_RESGUARDO_KIND_LABELS,
  isResguardoAwaitingAcceptance,
  resguardoAcceptBadge,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type LinkedEmployee = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  suite_username: string | null;
};

type MinePayload = {
  ready: boolean;
  linkedEmployee: LinkedEmployee | null;
  requests: HrResguardoRequest[];
  pendingCount: number;
  message?: string | null;
  error?: string;
};

export function StaffResguardoClient() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<MinePayload | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/hr/resguardo/mine', { cache: 'no-store' });
      const json = (await res.json()) as MinePayload;
      if (!res.ok) {
        setError((json as { error?: string }).error || 'No se pudieron cargar');
        setPayload(null);
        return;
      }
      setPayload(json);
    } catch {
      setError('Error de red');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(id: string) {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch('/api/hr/resguardo/mine', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'accept' }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo aceptar');
        return;
      }
      await load();
    } catch {
      setError('Error de red al aceptar');
    } finally {
      setBusyId(null);
    }
  }

  const linked = payload?.linkedEmployee ?? null;
  const requests = payload?.requests || [];
  const pending = requests.filter(isResguardoAwaitingAcceptance);
  const others = requests.filter((r) => !isResguardoAwaitingAcceptance(r));

  return (
    <SuiteShell
      title="Mis resguardos"
      subtitle="Acepta el equipo / material que RH te asignó"
    >
      <p className="mb-4">
        <Link
          href="/staff"
          className="text-sm font-semibold hover:underline"
          style={{ color: SUITE.orangeDeep }}
        >
          ← Staff
        </Link>
      </p>

      {loading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando…
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {!loading && !linked ? (
        <SuiteCard>
          <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
            Sin vínculo
          </h2>
          <p className="mt-2 text-sm" style={{ color: SUITE.muted }}>
            {payload?.message ||
              'Tu usuario no está vinculado a un colaborador. Pide a Master el enlace en /admin → Usuarios.'}
          </p>
        </SuiteCard>
      ) : null}

      {!loading && linked ? (
        <div className="space-y-4 max-w-2xl">
          <p className="text-sm" style={{ color: theme.muted }}>
            {linked.full_name}
            {linked.puesto ? ` · ${linked.puesto}` : ''}
          </p>

          {pending.length === 0 ? (
            <SuiteCard>
              <p className="text-sm" style={{ color: SUITE.muted }}>
                No tienes resguardos pendientes de aceptar.
              </p>
            </SuiteCard>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Pendientes ({pending.length})
              </h2>
              {pending.map((r) => (
                <SuiteCard key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p
                        className="text-base font-bold"
                        style={{ color: SUITE.navy }}
                      >
                        {r.folio || 'Resguardo'} ·{' '}
                        {HR_RESGUARDO_KIND_LABELS[r.kind]}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: SUITE.muted }}>
                        Asignado{' '}
                        {new Date(r.created_at).toLocaleDateString('es-MX')}
                        {r.requested_by ? ` · @${r.requested_by}` : ''}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                      style={{
                        backgroundColor: SUITE.orangeSoft,
                        color: SUITE.navy,
                      }}
                    >
                      Pendiente
                    </span>
                  </div>
                  {r.items.length > 0 ? (
                    <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                      {r.items.map((it, idx) => (
                        <li key={`${r.id}-${idx}`} className="text-sm text-slate-700">
                          <span className="font-semibold">
                            {it.cantidad}× {it.concepto}
                          </span>
                          {[it.marca, it.modelo, it.numero_serie]
                            .filter(Boolean)
                            .length
                            ? ` · ${[it.marca, it.modelo, it.numero_serie]
                                .filter(Boolean)
                                .join(' / ')}`
                            : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void accept(r.id)}
                    className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                    style={{ backgroundColor: SUITE.navy }}
                  >
                    {busyId === r.id ? 'Aceptando…' : 'Aceptar resguardo'}
                  </button>
                </SuiteCard>
              ))}
            </div>
          )}

          {others.length > 0 ? (
            <div className="space-y-3 pt-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Historial
              </h2>
              {others.map((r) => {
                const badge = resguardoAcceptBadge(r);
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-slate-100 bg-white px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">
                        {r.folio || r.id.slice(0, 8)} ·{' '}
                        {HR_RESGUARDO_KIND_LABELS[r.kind]}
                      </p>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{
                          backgroundColor:
                            badge === 'recibido' ? '#ecfdf5' : '#f1f5f9',
                          color: badge === 'recibido' ? '#065f46' : '#475569',
                        }}
                      >
                        {HR_RESGUARDO_ACCEPT_LABELS[badge]}
                      </span>
                    </div>
                    {r.accepted_at ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Recibido{' '}
                        {new Date(r.accepted_at).toLocaleDateString('es-MX')}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </SuiteShell>
  );
}
