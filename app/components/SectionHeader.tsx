'use client';

import type { ReactNode } from 'react';
import { Title } from '@tremor/react';
import { getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

/** Cabecera de sección: título y controles en la misma línea, centrados verticalmente */
export function SectionHeader({
  title,
  children,
  className = 'mb-4',
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}
    >
      <div className="flex min-w-0 items-center">
        {typeof title === 'string' ? (
          <Title className="!m-0 !leading-none" style={{ color: theme.title }}>
            {title}
          </Title>
        ) : (
          title
        )}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

/** Estilo unificado para selects / filtros */
export const filterControlClass =
  'flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm';

export const filterSelectClass =
  'h-full bg-transparent font-semibold text-slate-800 outline-none';

/** Chip de año (comparativos) — misma altura que filtros */
export function yearChipClass(active: boolean) {
  return `inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-all ${
    active ? '' : 'bg-slate-100 text-slate-600'
  }`;
}
