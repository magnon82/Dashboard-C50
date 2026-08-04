'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { UpcomingBirthdaysList } from '@/app/components/hr/UpcomingBirthdaysList';
import type { HrBirthdayUpcoming } from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type Payload = {
  ready: boolean;
  today?: string;
  upcoming: HrBirthdayUpcoming[];
  count: number;
  plantillaCount?: number;
  message?: string | null;
  error?: string;
  code?: string | null;
  nacimientoColumnMissing?: boolean;
};

export function StaffCumpleanosClient() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/hr/birthdays', { cache: 'no-store' });
      const json = (await res.json()) as Payload;
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

  const upcoming = payload?.upcoming ?? [];
  const schemaHint =
    payload?.nacimientoColumnMissing === true ||
    payload?.code === 'nacimiento_schema_missing';

  return (
    <SuiteShell
      title="Cumpleaños"
      subtitle="Plantilla vigente · próximos primero"
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

      {error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {schemaHint ? (
        <SuiteCard className="mb-4">
          <p className="text-sm text-amber-800">
            Aún no hay fechas de nacimiento disponibles. RH puede capturarlas en
            Cumpleaños.
          </p>
        </SuiteCard>
      ) : null}

      <SuiteCard>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold" style={{ color: theme.title }}>
              Próximos cumpleaños
            </h2>
            <p className="mt-1 text-xs" style={{ color: theme.muted }}>
              Del más cercano al más lejano
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-10 rounded-xl px-3.5 text-sm font-semibold"
            style={{
              backgroundColor: SUITE.orangeSoft,
              color: SUITE.navy,
            }}
          >
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>

        <UpcomingBirthdaysList
          upcoming={upcoming}
          loading={loading}
          emptyMessage={
            payload?.message ||
            'Sin fechas de nacimiento en plantilla.'
          }
          maxHeightClass="max-h-[min(36rem,70vh)]"
        />
      </SuiteCard>
    </SuiteShell>
  );
}
