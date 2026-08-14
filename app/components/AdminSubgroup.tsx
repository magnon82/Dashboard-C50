'use client';

import type { ReactNode } from 'react';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

/**
 * Shell compartido para subgrupos colapsables del Master Panel
 * (bajo Cortes TPV, Financieros, Datos e inventario, etc.).
 *
 * Patrón visual: card blanca, borde superior naranja Suite, título navy
 * text-lg, botón Mostrar/Ocultar navy relleno.
 */
export function AdminSubgroup({
  title,
  description,
  open,
  onOpenChange,
  actions,
  children,
  flushBody = false,
}: {
  title: string;
  description?: ReactNode;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Controles extra a la izquierda del botón Mostrar/Ocultar (p. ej. Actualizar). */
  actions?: ReactNode;
  children?: ReactNode;
  /** Contenido a borde (mapa SVG); el header sigue con padding. */
  flushBody?: boolean;
}) {
  return (
    <section
      className="mb-8 overflow-hidden rounded-[24px] border border-slate-100 bg-white"
      style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${SUITE.orange}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold" style={{ color: theme.title }}>
            {title}
          </h2>
          {description ? (
            <div className="mt-1 text-sm leading-relaxed" style={{ color: theme.muted }}>
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: SUITE.navy }}
            aria-expanded={open}
          >
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {open ? (
        flushBody ? (
          children
        ) : (
          <div className="space-y-4 border-t border-slate-100 px-5 py-4">{children}</div>
        )
      ) : null}
    </section>
  );
}
