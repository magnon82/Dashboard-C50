'use client';

import { SuiteCard } from '@/app/components/SuiteShell';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

export function EventosStubPanel({
  title,
  eyebrow = 'Próximo',
  body,
  bullets,
}: {
  title: string;
  eyebrow?: string;
  body: string;
  bullets?: string[];
}) {
  return (
    <SuiteCard accent className="max-w-3xl">
      <p
        className="text-xs font-bold uppercase tracking-[0.16em]"
        style={{ color: SUITE.orangeDeep }}
      >
        {eyebrow}
      </p>
      <h3 className="mt-2 text-xl font-bold" style={{ color: theme.title }}>
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: theme.muted }}>
        {body}
      </p>
      {bullets && bullets.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </SuiteCard>
  );
}
