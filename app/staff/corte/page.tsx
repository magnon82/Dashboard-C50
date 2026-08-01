'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { StaffCorteClient } from '@/app/components/staff/StaffCorteClient';

export default function StaffCortePage() {
  return (
    <SuiteShell
      title="Corte del día"
      subtitle="Terminales TPV + cierre · un solo flujo"
    >
      <StaffCorteClient />
    </SuiteShell>
  );
}
