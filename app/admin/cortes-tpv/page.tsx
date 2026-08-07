'use client';

import Link from 'next/link';
import { SuiteShell } from '@/app/components/SuiteShell';
import { AdminCortesTpvReport } from '@/app/components/AdminCortesTpvReport';
import { SUITE } from '@/app/lib/themes';

export default function AdminCortesTpvPage() {
  return (
    <SuiteShell
      title="Cortes TPV"
      subtitle="Reporte admin · subir fotos de cualquier día · OCR igual que Staff"
      actions={
        <Link
          href="/admin"
          className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90"
          style={{ backgroundColor: SUITE.navy }}
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
