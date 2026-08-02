'use client';

import { useCallback, useEffect, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { RrhhResguardoForm } from '@/app/components/rrhh/RrhhResguardoForm';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  HR_RESGUARDO_KIND_LABELS,
  HR_RESGUARDO_STATUS_LABELS,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';

const theme = getTheme('suite');

export function RrhhResguardosPanel() {
  const [requests, setRequests] = useState<HrResguardoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/resguardo?limit=40', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo cargar');
        setRequests([]);
      } else {
        setError(json.error || null);
        setRequests(json.requests || []);
      }
    } catch {
      setError('Error de red');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pending = requests.filter((r) => r.status === 'pendiente');

  return (
    <div className="space-y-5">
      <SuiteCard accent className="max-w-3xl">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Resguardos · RH
        </p>
        <h3 className="mt-2 text-xl font-bold" style={{ color: theme.title }}>
          Cartas de resguardo
        </h3>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Captura y consulta de cartas de resguardo (formato C50). El expediente
          de cada persona se abre desde la fila en Plantilla (o Bajas del año).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold" style={{ color: SUITE.navy }}>
            Pendientes: {loading ? '…' : pending.length}
          </p>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="min-h-11 rounded-xl px-4 text-sm font-bold text-white"
            style={{ backgroundColor: SUITE.navy }}
          >
            {showForm ? 'Ocultar formulario' : 'Nuevo resguardo'}
          </button>
        </div>
      </SuiteCard>

      {showForm ? (
        <RrhhResguardoForm
          onCreated={() => {
            void refresh();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <SuiteCard className="max-w-3xl">
        <h3 className="text-base font-bold" style={{ color: theme.title }}>
          Listado
        </h3>
        {loading ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Cargando…
          </p>
        ) : error && requests.length === 0 ? (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : requests.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Sin resguardos registrados todavía.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold" style={{ color: theme.title }}>
                    {r.folio || r.id.slice(0, 8)} ·{' '}
                    {HR_RESGUARDO_KIND_LABELS[r.kind]}
                  </p>
                  <span
                    className="text-xs font-bold uppercase tracking-wide"
                    style={{ color: SUITE.orangeDeep }}
                  >
                    {HR_RESGUARDO_STATUS_LABELS[r.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                  {r.payload?.nombre || '—'}
                  {r.payload?.puesto ? ` · ${r.payload.puesto}` : ''} ·{' '}
                  {r.items.length} ítem{r.items.length === 1 ? '' : 's'}
                  {r.requested_by ? ` · @${r.requested_by}` : ''}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: theme.muted }}>
                  {new Date(r.created_at).toLocaleString('es-MX')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SuiteCard>
    </div>
  );
}
