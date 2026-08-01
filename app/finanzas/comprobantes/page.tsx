'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { ComprobantesIndex } from '@/app/components/ComprobantesIndex';
import { SUITE } from '@/app/lib/themes';

export default function ComprobantesPage() {
  return (
    <SuiteShell
      title="Comprobantes"
      subtitle="Consulta independiente · PDFs de pagos"
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
      <ComprobantesIndex defaultOpen standalone />
    </SuiteShell>
  );
}
