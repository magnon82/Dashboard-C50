'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SuiteShell } from '@/app/components/SuiteShell';
import { RrhhHorarios } from '@/app/components/rrhh/RrhhHorarios';
import { StaffHorarioClient } from '@/app/components/staff/StaffHorarioClient';
import { canEditSchedules, useSession } from '@/app/lib/useSession';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

function StaffHorarioPageInner() {
  const searchParams = useSearchParams();
  const viewOnly = searchParams.get('view') === '1';
  const { user, loading } = useSession();
  const canEdit = canEditSchedules(user);

  if (loading) {
    return (
      <SuiteShell title="Horario" subtitle="Cargando…">
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando…
        </p>
      </SuiteShell>
    );
  }

  if (canEdit && !viewOnly) {
    return (
      <SuiteShell
        title="Horarios"
        subtitle="Staff · edición (mismas herramientas que RR.HH., datos sincronizados)"
      >
        <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/staff"
            className="text-sm font-semibold"
            style={{ color: SUITE.orangeDeep }}
          >
            ← Volver a Staff
          </Link>
          <Link
            href="/staff/horario?view=1"
            className="text-sm font-semibold"
            style={{ color: SUITE.navy }}
          >
            Vista consulta (equipo)
          </Link>
        </p>
        <RrhhHorarios />
      </SuiteShell>
    );
  }

  return <StaffHorarioClient canEdit={canEdit} />;
}

export default function StaffHorarioPage() {
  return (
    <Suspense
      fallback={
        <SuiteShell title="Horario" subtitle="Cargando…">
          <p className="text-sm" style={{ color: theme.muted }}>
            Cargando…
          </p>
        </SuiteShell>
      }
    >
      <StaffHorarioPageInner />
    </Suspense>
  );
}
