'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { APP_MODULES } from '@/app/lib/modules';
import { canSeeModule, canSeeAdmin, useSession } from '@/app/lib/useSession';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

const NAV_ICONS: Record<string, string> = {
  home: '⌂',
  staff: '☷',
  ventas: '◈',
  finanzas: '＄',
  rrhh: '♟',
  eventos: '◎',
  'reportes-socios': '▦',
  cocina: '♨',
  barra: '◐',
  calidad: '★',
  inventarios: '▣',
  admin: '⚙',
};

function navActive(pathname: string, href: string, moduleId: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  // Staff también opera Cortes TPV bajo /ventas/corte-tpv
  if (
    moduleId === 'staff' &&
    (pathname === '/ventas/corte-tpv' || pathname.startsWith('/ventas/corte-tpv/'))
  ) {
    return true;
  }
  return false;
}

function roleLabel(user: { canEdit: boolean; modules: string[] } | null): string {
  if (!user) return '…';
  if (user.canEdit) return 'Administrador';
  const mods = user.modules.filter((m) => m !== '*');
  if (mods.length === 1 && mods[0] === 'staff') return 'Staff';
  return 'Solo lectura';
}

export function SuiteShell({ title, subtitle, children, actions }: Props) {
  const pathname = usePathname();
  const { user, loading } = useSession();
  const [open, setOpen] = useState(false);

  const visible = APP_MODULES.filter((m) => canSeeModule(user, m.id));

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
      active
        ? 'bg-white/15 text-white'
        : 'text-white/75 hover:bg-white/10 hover:text-white'
    }`;

  const sidebar = (
    <aside
      className="flex h-full w-[240px] flex-col overflow-y-auto rounded-[28px] p-5 text-white shadow-xl"
      style={{ backgroundColor: theme.sidebarBg, boxShadow: SUITE.shadow }}
    >
      <div className="mb-8 flex flex-col items-center text-center">
        <div
          className="mb-3 flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold"
          style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: SUITE.orange }}
        >
          {(user?.username || 'C').slice(0, 1).toUpperCase()}
        </div>
        <p className="text-sm font-bold uppercase tracking-wide">
          {user?.username || 'Usuario'}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: theme.sidebarMuted }}>
          {roleLabel(user)}
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1" aria-label="Navegación">
        <Link href="/" className={linkClass(pathname === '/')} onClick={() => setOpen(false)}>
          <span className="w-5 text-center opacity-80">{NAV_ICONS.home}</span>
          Inicio
        </Link>
        {!loading &&
          visible.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className={linkClass(navActive(pathname, m.href, m.id))}
              onClick={() => setOpen(false)}
            >
              <span className="w-5 text-center opacity-80">{NAV_ICONS[m.id] || '•'}</span>
              {m.short}
            </Link>
          ))}
        {!loading && canSeeAdmin(user) && (
          <Link
            href="/admin"
            className={linkClass(pathname.startsWith('/admin'))}
            onClick={() => setOpen(false)}
          >
            <span className="w-5 text-center opacity-80">{NAV_ICONS.admin}</span>
            Master Panel
          </Link>
        )}
      </nav>

      <button
        type="button"
        onClick={logout}
        className="mt-4 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        Salir
      </button>
    </aside>
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: theme.pageBg }}>
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-5 p-4 md:p-6">
        {/* Desktop sidebar — sticky so it stays in view while main content scrolls */}
        <div className="sticky top-6 hidden h-[calc(100vh-3rem)] shrink-0 self-start lg:block">
          {sidebar}
        </div>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
            />
            <div className="absolute bottom-4 left-4 top-4 z-50">{sidebar}</div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: theme.muted }}
              >
                Cluster Culinario · Carranza 50
              </p>
              <h1
                className="mt-1 text-2xl font-bold tracking-tight md:text-3xl"
                style={{ color: theme.title }}
              >
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                  {subtitle}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm lg:hidden"
                aria-label="Abrir menú"
                onClick={() => setOpen(true)}
              >
                <span className="block h-0.5 w-5 bg-slate-700" />
                <span className="mt-1 block h-0.5 w-5 bg-slate-700" />
                <span className="mt-1 block h-0.5 w-5 bg-slate-700" />
              </button>
            </div>
          </header>

          <div className="flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SuiteCard({
  children,
  className = '',
  accent,
  dark,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={`rounded-[24px] p-5 md:p-6 ${className}`}
      style={{
        backgroundColor: dark ? SUITE.navy : SUITE.card,
        color: dark ? '#fff' : SUITE.text,
        boxShadow: SUITE.shadow,
        borderTop: accent ? `4px solid ${SUITE.orange}` : undefined,
      }}
    >
      {children}
    </div>
  );
}
