'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { FinanzasMatchVentasCorte } from '@/app/components/FinanzasMatchVentasCorte';
import { SUITE } from '@/app/lib/themes';

export default function MatchVentasCortePage() {
  return (
    <SuiteShell
      title="Match ventas vs corte"
      subtitle="Infocaja diario vs corte TPV / tómbola · desde ago 2026 (CDMX)"
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
      <FinanzasMatchVentasCorte />
    </SuiteShell>
  );
}
