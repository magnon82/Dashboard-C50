'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_MODULES, type ModuleId } from '@/app/lib/modules';
import { canSeeModule, canSeeAdmin, useSession } from '@/app/lib/useSession';

interface Props {
  activeId?: ModuleId | 'admin';
}

export function ModuleNav({ activeId }: Props) {
  const pathname = usePathname();
  const { user, loading } = useSession();

  const visible = APP_MODULES.filter((m) => canSeeModule(user, m.id));

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Módulos de la Business Management Suite">
      <Link
        href="/"
        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
          pathname === '/'
            ? 'bg-white text-slate-900'
            : 'bg-white/15 text-white hover:bg-white/25'
        }`}
      >
        Inicio
      </Link>
      {!loading &&
        visible.map((m) => {
          const active =
            activeId === m.id ||
            pathname === m.href ||
            pathname.startsWith(`${m.href}/`) ||
            (m.id === 'staff' &&
              (pathname === '/ventas/corte-tpv' ||
                pathname.startsWith('/ventas/corte-tpv/')));
          return (
            <Link
              key={m.id}
              href={m.href}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-white text-slate-900'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              {m.short}
            </Link>
          );
        })}
      {!loading && canSeeAdmin(user) && (
        <Link
          href="/admin"
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
            pathname.startsWith('/admin') || activeId === 'admin'
              ? 'bg-white text-slate-900'
              : 'bg-amber-400/90 text-slate-900 hover:bg-amber-300'
          }`}
        >
          Master Panel
        </Link>
      )}
    </nav>
  );
}
