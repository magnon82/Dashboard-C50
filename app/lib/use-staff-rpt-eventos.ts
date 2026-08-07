'use client';

import { useEffect, useState } from 'react';
import {
  INFOCAJA_YEAR_FROM,
  todayMexicoIso,
} from '@/app/lib/ventas-semana';

/**
 * Eventos por día desde staff_rpt_diario (OS+extra).
 * Fallback ERP cuando Sheets `financial_records` source_file=eventos no tiene el día.
 * Default: desde (INFOCAJA_YEAR_FROM−1)-01-01 hasta hoy CDMX (cubre WTD vs año anterior).
 */
export function useStaffRptEventos(opts?: {
  from?: string;
  to?: string;
}): Record<string, number> {
  const from = opts?.from ?? `${INFOCAJA_YEAR_FROM - 1}-01-01`;
  const to = opts?.to ?? todayMexicoIso();
  const [byDate, setByDate] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!from || !to || from > to) {
        if (!cancelled) setByDate({});
        return;
      }
      try {
        const qs = new URLSearchParams({ from, to });
        const res = await fetch(`/api/ventas/staff-rpt-eventos?${qs}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as { byDate?: Record<string, number> };
        if (!cancelled && res.ok && json.byDate) {
          setByDate(json.byDate);
        }
      } catch {
        /* staff_rpt opcional */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return byDate;
}
