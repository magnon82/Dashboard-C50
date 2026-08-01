'use client';

import Link from 'next/link';
import { SuiteShell } from '@/app/components/SuiteShell';
import { SUITE } from '@/app/lib/themes';

export default function CorteTpvGuiaPage() {
  return (
    <SuiteShell
      title="Guía de fotos TPV"
      subtitle="Cómo fotografiar el ticket de cada terminal"
    >
      <div className="mx-auto max-w-lg px-3 pb-16 pt-3">
        <header className="mb-5">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: SUITE.orange }}
          >
            Cortes TPV · Carranza 50
          </p>
          <h1
            className="mt-1 text-2xl font-bold leading-tight"
            style={{ color: SUITE.navy }}
          >
            Cómo tomar la foto del ticket
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Por cada terminal (CAJA 1, 2 o 3) sube una foto nítida del ticket, o
            marca «No se utilizó». Lo más importante es el{' '}
            <strong>Reporte de propinas</strong>; también sirve la{' '}
            <strong>Totalización</strong> (ventas).
          </p>
        </header>

        <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
          <p
            className="text-xs font-bold uppercase tracking-wide"
            style={{ color: SUITE.orange }}
          >
            Consejos rápidos
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>Ticket completo en el encuadre: del encabezado hasta el final.</li>
            <li>Foto nítida, con buena luz y sin sombras fuertes.</li>
            <li>Fondo oscuro para que contraste el papel blanco.</li>
            <li>
              Debe verse: Banca Mifel · REST CARRANZA 50 · CAJA · totales · FIN DE
              REPORTE (si aparece).
            </li>
            <li>Si sale borrosa o cortada, vuelve a tomar la foto.</li>
          </ul>
        </section>

        <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
            1. Reporte de propinas (prioridad)
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Busca el título <strong>REPORTE DE PROPINAS</strong>. Incluye
            encabezado, totales de consumo/propina y <strong>FIN DE REPORTE</strong>.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ventas/tpv-guia/ejemplo-propina.png"
            alt="Ejemplo: foto correcta del Reporte de Propinas"
            className="mt-3 w-full rounded-xl bg-slate-100 object-contain"
          />
        </section>

        <section className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
            2. Totalización / ventas
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Busca el título <strong>TOTALIZACION</strong> con desglose crédito/débito
            y el <strong>TOTAL GENERAL</strong> al final.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ventas/tpv-guia/ejemplo-ventas.png"
            alt="Ejemplo: foto correcta de Totalización de ventas"
            className="mt-3 w-full rounded-xl bg-slate-100 object-contain"
          />
        </section>

        <p className="mb-6 text-center text-sm text-slate-500">
          CAJA en el ticket = número de terminal (T1, T2 o T3).
        </p>

        <Link
          href="/ventas/corte-tpv"
          className="flex min-h-14 w-full items-center justify-center rounded-2xl text-base font-bold text-white"
          style={{ backgroundColor: SUITE.orange }}
        >
          Volver a Cortes TPV
        </Link>
      </div>
    </SuiteShell>
  );
}
