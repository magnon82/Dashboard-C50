'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { TpvCorteClient } from '@/app/components/tpv/TpvCorteClient';

export default function CorteTpvPage() {
  return (
    <SuiteShell
      title="Cortes TPV"
      subtitle="Foto diaria · Terminales 1–3 · verificación bancaria"
    >
      <TpvCorteClient />
    </SuiteShell>
  );
}
