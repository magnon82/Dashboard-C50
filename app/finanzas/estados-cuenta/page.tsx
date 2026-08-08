'use client';

import { SuiteShell } from '@/app/components/SuiteShell';
import { EstadosCuentaPdfIndex } from '@/app/components/EstadosCuentaPdfIndex';
import { SUITE } from '@/app/lib/themes';

export default function EstadosCuentaConsultaPage() {
  return (
    <SuiteShell
      title="Estados de Cuenta"
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
      <EstadosCuentaPdfIndex defaultOpen standalone />
    </SuiteShell>
  );
}
