'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { HrSummaryAlert } from '@/app/lib/hr';
import { SUITE } from '@/app/lib/themes';

/**
 * Banner in-app para alertas personales (preferencias Master).
 * Se muestra al abrir Staff / hub cuando hay avisos activos.
 */
export function PersonalAlertsBanner({
  hrefForAlert,
}: {
  hrefForAlert?: (a: HrSummaryAlert) => string;
}) {
  const [alerts, setAlerts] = useState<HrSummaryAlert[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/hr/alerts/mine', { cache: 'no-store' });
        const json = (await res.json()) as {
          alerts?: HrSummaryAlert[];
        };
        if (cancelled) return;
        setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
      } catch {
        if (!cancelled) setAlerts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div
      className="mb-4 rounded-2xl px-4 py-3"
      style={{
        backgroundColor: '#fffbeb',
        borderLeft: `4px solid ${SUITE.orange}`,
        boxShadow: SUITE.shadow,
      }}
      role="status"
    >
      <p className="text-sm font-bold text-amber-950">Avisos para ti</p>
      <ul className="mt-2 space-y-1.5">
        {alerts.map((a) => {
          const href =
            hrefForAlert?.(a) ||
            (a.go === 'horarios' ? '/staff/horario' : '/staff');
          return (
            <li key={a.id} className="text-sm text-amber-900">
              <Link href={href} className="font-medium underline-offset-2 hover:underline">
                {a.message}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
