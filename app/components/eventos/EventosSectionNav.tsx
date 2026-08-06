'use client';

import { SUITE } from '@/app/lib/themes';

export type EventosSection =
  | 'tablero'
  | 'crm'
  | 'cotizador'
  | 'calendario'
  | 'os'
  | 'global'
  | 'biblioteca';

const SECTIONS: { id: EventosSection; label: string }[] = [
  { id: 'tablero', label: 'Tablero' },
  { id: 'crm', label: 'CRM' },
  { id: 'cotizador', label: 'Cotizador' },
  { id: 'calendario', label: 'Calendario' },
  { id: 'os', label: 'Órdenes de servicio' },
  { id: 'global', label: 'Global' },
  { id: 'biblioteca', label: 'Biblioteca' },
];

export function EventosSectionNav({
  active,
  onChange,
}: {
  active: EventosSection;
  onChange: (id: EventosSection) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {SECTIONS.map((s) => {
        const isActive = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className="rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors"
            style={
              isActive
                ? { backgroundColor: SUITE.navy, color: '#fff' }
                : {
                    backgroundColor: '#fff',
                    color: SUITE.navy,
                    boxShadow: SUITE.shadow,
                  }
            }
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
