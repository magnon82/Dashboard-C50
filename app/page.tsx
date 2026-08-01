'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { APP_MODULES, homePathForModules } from '@/app/lib/modules';
import { canSeeModule, canSeeAdmin, useSession } from '@/app/lib/useSession';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

export default function HubPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const visibleModules = APP_MODULES.filter((m) => canSeeModule(user, m.id));

  // Client fallback if middleware did not redirect (e.g. soft nav)
  useEffect(() => {
    if (loading || !user) return;
    const home = homePathForModules(user.modules);
    if (home !== '/') router.replace(home);
  }, [loading, user, router]);

  return (
    <SuiteShell
      title="Dashboard"
      subtitle={`${hoy}${user ? ` · ${user.username}` : ''}`}
    >
      <p className="mb-6 max-w-2xl text-sm" style={{ color: theme.muted }}>
        Centro de dashboards. Elige un módulo.
      </p>

      {loading ? (
        <p style={{ color: theme.muted }}>Cargando módulos…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((m) => {
            const isActive = m.status === 'activo';
            const dark = isActive;
            return (
              <Link key={m.id} href={m.href} className="group block">
                <SuiteCard dark={dark} className="h-full transition-transform group-hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className={`text-lg font-bold ${dark ? 'text-white' : ''}`}>
                      {m.label}
                    </h2>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: dark
                          ? 'rgba(255,255,255,0.15)'
                          : '#F1F5F9',
                        color: dark ? '#fff' : theme.muted,
                      }}
                    >
                      {isActive ? 'Activo' : 'Próximo'}
                    </span>
                  </div>
                  <p
                    className="mt-3 text-sm leading-relaxed"
                    style={{ color: dark ? 'rgba(255,255,255,0.75)' : theme.muted }}
                  >
                    {m.description}
                  </p>
                  <p
                    className="mt-5 text-sm font-bold"
                    style={{ color: dark ? SUITE.orange : SUITE.navy }}
                  >
                    {isActive ? 'Abrir →' : 'Ver plantilla →'}
                  </p>
                </SuiteCard>
              </Link>
            );
          })}

          {canSeeAdmin(user) && (
            <Link href="/admin" className="group block">
              <SuiteCard accent className="h-full transition-transform group-hover:-translate-y-0.5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-bold">Master Panel</h2>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep }}
                  >
                    Admin
                  </span>
                </div>
                <p className="mt-3 text-sm" style={{ color: theme.muted }}>
                  Usuarios, contraseñas y permisos por módulo.
                </p>
                <p className="mt-5 text-sm font-bold" style={{ color: SUITE.orangeDeep }}>
                  Abrir administración →
                </p>
              </SuiteCard>
            </Link>
          )}
        </div>
      )}
    </SuiteShell>
  );
}
