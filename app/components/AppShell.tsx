'use client';

import { SuiteShell } from '@/app/components/SuiteShell';

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

/** Compat: usa el shell unificado del suite */
export function AppShell({ title, subtitle, children, actions }: Props) {
  return (
    <SuiteShell title={title} subtitle={subtitle} actions={actions}>
      {children}
    </SuiteShell>
  );
}
