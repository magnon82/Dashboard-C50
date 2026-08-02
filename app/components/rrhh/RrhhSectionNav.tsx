'use client';

import { SUITE } from '@/app/lib/themes';

export type RrhhSection =
  | 'plantilla'
  | 'horarios'
  | 'nomina'
  | 'vacaciones'
  | 'biblioteca';

const SECTIONS: { id: RrhhSection; label: string }[] = [
  { id: 'plantilla', label: 'Plantilla' },
  { id: 'horarios', label: 'Horarios' },
  { id: 'nomina', label: 'Nómina' },
  { id: 'vacaciones', label: 'Vacaciones' },
  { id: 'biblioteca', label: 'Biblioteca' },
];

export function RrhhSectionNav({
  active,
  onChange,
}: {
  active: RrhhSection;
  onChange: (id: RrhhSection) => void;
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
