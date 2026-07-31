'use client';

import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

interface Props {
  title: string;
  description: string;
}

export function ModulePlaceholder({ title, description }: Props) {
  return (
    <SuiteShell title={title} subtitle="Módulo en preparación">
      <SuiteCard accent className="max-w-3xl">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Próximamente
        </p>
        <h2 className="mt-2 text-xl font-bold md:text-2xl" style={{ color: theme.title }}>
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed" style={{ color: theme.muted }}>
          {description}
        </p>
        <a
          href="/ventas"
          className="mt-6 inline-flex rounded-xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ backgroundColor: SUITE.orange }}
        >
          Ir a Ventas
        </a>
      </SuiteCard>
    </SuiteShell>
  );
}
