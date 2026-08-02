'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { StaffPropinasClient } from '@/app/components/staff/StaffPropinasClient';

export default function StaffPropinasPage() {
  return (
    <SuiteShell
      title="Propinas"
      subtitle="Asistente para cálculo de propinas"
    >
      <StaffPropinasClient />
    </SuiteShell>
  );
}
