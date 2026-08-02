'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { StaffVacacionesClient } from '@/app/components/staff/StaffVacacionesClient';

export default function StaffVacacionesPage() {
  return (
    <SuiteShell
      title="Mis vacaciones"
      subtitle="Solicitud y seguimiento · sujeta a aprobación de RH"
    >
      <StaffVacacionesClient />
    </SuiteShell>
  );
}
