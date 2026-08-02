'use client';

import Link from 'next/link';
import { SuiteShell } from '@/app/components/SuiteShell';
import { AdminCortesTpvReport } from '@/app/components/AdminCortesTpvReport';
import { SUITE } from '@/app/lib/themes';

export default function AdminCortesTpvPage() {
  return (
    <SuiteShell
      title="Cortes TPV"
      subtitle="Reporte admin · fotos por terminal · edición de montos y slots"
      actions={
        <Link
          href="/admin"
          className="inline-flex min-h-10 items-center rounded-xl border border-white/25 px-3 text-sm font-semibold text-white/90 hover:bg-white/10"
        >
          ← Master Panel
        </Link>
      }
    >
      <div className="mb-4">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: SUITE.navy }}
        >
          Financieros · Caja
        </p>
      </div>
      <AdminCortesTpvReport />
    </SuiteShell>
  );
}
