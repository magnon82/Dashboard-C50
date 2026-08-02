'use client';

import Link from 'next/link';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

export default function StaffPage() {
  return (
    <SuiteShell
      title="Staff"
      subtitle="Operación de piso · Carranza 50"
    >
      <p className="mb-6 max-w-2xl text-sm" style={{ color: theme.muted }}>
        Herramientas de piso: cierre diario (terminales + WI / Eventos /
        efectivo) y calculadora de propinas. La guía de fotos está dentro del
        corte y en Master Panel.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
        <Link href="/staff/corte" className="group block">
          <SuiteCard
            dark
            className="h-full transition-transform group-hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-white">Corte del día</h2>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  color: '#fff',
                }}
              >
                Principal
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              prepara la cámara de tu teléfono
            </p>
            <p className="mt-5 text-sm font-bold" style={{ color: SUITE.orange }}>
              Presiona aqui para realizar el corte diario
            </p>
          </SuiteCard>
        </Link>

        <Link href="/staff/propinas" className="group block">
          <SuiteCard
            accent
            className="h-full transition-transform group-hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
                Propinas
              </h2>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: SUITE.orangeSoft,
                  color: SUITE.navy,
                }}
              >
                Calculadora
              </span>
            </div>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: SUITE.muted }}
            >
              Asistente para cálculo de propinas
            </p>
            <p
              className="mt-5 text-sm font-bold"
              style={{ color: SUITE.orangeDeep }}
            >
              Abrir calculadora →
            </p>
          </SuiteCard>
        </Link>
      </div>
    </SuiteShell>
  );
}
