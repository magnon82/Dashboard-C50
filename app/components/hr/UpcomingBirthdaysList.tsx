'use client';

import {
  formatBirthdayCountdown,
  formatHrDate,
  formatHrPuesto,
  type HrBirthdayUpcoming,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type Props = {
  upcoming: HrBirthdayUpcoming[];
  loading?: boolean;
  emptyMessage?: string;
  /** Cap list height; omit for full page scroll. */
  maxHeightClass?: string;
};

/**
 * Lista «Próximos cumpleaños» (cercano → lejano).
 * Compartida por RH (`RrhhCumpleanos`) y Staff (`StaffCumpleanosClient`).
 */
export function UpcomingBirthdaysList({
  upcoming,
  loading = false,
  emptyMessage = 'Sin fechas de nacimiento en plantilla.',
  maxHeightClass = 'max-h-[28rem]',
}: Props) {
  const byNextDate = (() => {
    const map = new Map<string, HrBirthdayUpcoming[]>();
    for (const b of upcoming) {
      const list = map.get(b.next_date) || [];
      list.push(b);
      map.set(b.next_date, list);
    }
    return map;
  })();

  if (loading) {
    return (
      <p className="mt-4 text-sm" style={{ color: theme.muted }}>
        Cargando…
      </p>
    );
  }

  if (upcoming.length === 0) {
    return (
      <p className="mt-4 text-sm" style={{ color: theme.muted }}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul
      className={`mt-4 space-y-2 overflow-y-auto pr-1 ${maxHeightClass}`.trim()}
    >
      {upcoming.map((b) => {
        const sameDay = byNextDate.get(b.next_date) || [];
        return (
          <li
            key={b.employee_id}
            className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5"
            style={{
              backgroundColor:
                b.days_until === 0 ? SUITE.orangeSoft : '#f8fafc',
            }}
          >
            <div className="min-w-0">
              <p
                className="truncate text-sm font-semibold"
                style={{ color: theme.title }}
              >
                {formatHrListName(b.full_name)}
              </p>
              <p className="text-xs" style={{ color: theme.muted }}>
                {formatHrPuesto(b.puesto) || b.area || '—'}
                {sameDay.length > 1 ? ` · ${sameDay.length} ese día` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className="text-sm font-bold"
                style={{
                  color: b.days_until <= 7 ? SUITE.orangeDeep : SUITE.navy,
                }}
              >
                {formatBirthdayCountdown(b.days_until)}
              </p>
              <p
                className="text-xs capitalize"
                style={{ color: theme.muted }}
              >
                {formatHrDate(b.next_date).replace(/\s+\d{4}$/, '')}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
