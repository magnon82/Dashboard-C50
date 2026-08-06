'use client';

import Link from 'next/link';
import { SuiteShell } from '@/app/components/SuiteShell';
import { RrhhHorarios } from '@/app/components/rrhh/RrhhHorarios';
import { StaffHorarioClient } from '@/app/components/staff/StaffHorarioClient';
import { canEditSchedules, useSession } from '@/app/lib/useSession';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

export default function StaffHorarioPage() {
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

  if (canEdit) {
    return (
      <SuiteShell
        title="Horarios"
        subtitle="Edición · mismas herramientas que RR.HH. (datos sincronizados)"
      >
        <p className="mb-4">
          <Link
            href="/staff"
            className="text-sm font-semibold"
            style={{ color: SUITE.orangeDeep }}
          >
            ← Volver a Staff
          </Link>
        </p>
        <RrhhHorarios />
      </SuiteShell>
    );
  }

  return <StaffHorarioClient />;
}
