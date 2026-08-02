'use client';

import { AdminCortesTpvReport } from '@/app/components/AdminCortesTpvReport';

/**
 * Entrada Financieros en Master Panel → Cortes TPV (reporte + carga de fotos).
 * Reporte completo: /admin/cortes-tpv
 */
export function AdminCajaTpv() {
  return <AdminCortesTpvReport compact />;
}
