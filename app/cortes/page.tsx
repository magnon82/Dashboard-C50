'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { CortesOperacion } from '@/app/components/CortesOperacion';

export default function CortesPage() {
  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <SuiteShell
      title="Cortes y operación"
      subtitle={`Cortes diarios, tómbola y cancelaciones · ${hoy}`}
    >
      <CortesOperacion />
    </SuiteShell>
  );
}
