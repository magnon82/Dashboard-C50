'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { FacturasIndex } from '@/app/components/FacturasIndex';
import { SUITE } from '@/app/lib/themes';

export default function FacturasPage() {
  return (
    <SuiteShell
      title="Facturas"
      subtitle="Consulta · índice CFDI (Gmail) y faltantes"
      actions={
        <button
          type="button"
          className="hidden h-9 rounded-xl px-3 text-xs font-semibold text-white sm:inline-flex sm:items-center"
          style={{ backgroundColor: SUITE.navy }}
          onClick={() => window.close()}
        >
          Cerrar ventana
        </button>
      }
    >
      <FacturasIndex />
    </SuiteShell>
  );
}
