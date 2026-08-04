'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { InstallAppPrompt } from '@/app/components/InstallAppPrompt';
import {
  calmNoAlert,
  formatEventosHubAlert,
  isHubAlertModule,
  pickRrhhHubAlert,
  type HubAlertModuleId,
  type HubModuleAlert,
} from '@/app/lib/hub-alerts';
import { APP_MODULES, homePathForModules } from '@/app/lib/modules';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/app/lib/product';
import { canSeeModule, canSeeAdmin, useSession } from '@/app/lib/useSession';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

type AlertMap = Partial<Record<HubAlertModuleId, HubModuleAlert>>;

function alertLineStyle(
  alert: HubModuleAlert | undefined,
  loading: boolean,
  dark: boolean
): { color: string } {
  if (loading || !alert) {
    return { color: dark ? 'rgba(255,255,255,0.55)' : theme.muted };
  }
  if (alert.severity === 'warn') {
    return { color: dark ? '#FBBF24' : '#92400e' };
  }
  return { color: dark ? 'rgba(255,255,255,0.65)' : theme.muted };
}

export default function HubPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [alerts, setAlerts] = useState<AlertMap>({});
  const [alertsLoading, setAlertsLoading] = useState(false);
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

  useEffect(() => {
    if (loading || !user) return;

    const wantEventos = canSeeModule(user, 'eventos');
    const wantRrhh = canSeeModule(user, 'rrhh');
    const wantVentasSync =
      canSeeModule(user, 'ventas') || canSeeModule(user, 'reportes-socios');
    const calmIds = (
      ['reportes-socios', 'staff', 'ventas', 'finanzas'] as const
    ).filter((id) => canSeeModule(user, id));

    const seed: AlertMap = {};
    for (const id of calmIds) seed[id] = calmNoAlert();
    setAlerts(seed);

    if (!wantEventos && !wantRrhh && !wantVentasSync) {
      setAlertsLoading(false);
      return;
    }

    let cancelled = false;
    setAlertsLoading(true);

    (async () => {
      const next: AlertMap = { ...seed };

      try {
        const fetches: Promise<void>[] = [];

        if (wantVentasSync) {
          fetches.push(
            (async () => {
              try {
                const res = await fetch('/api/ventas-sync-status', {
                  cache: 'no-store',
                });
                if (!res.ok) return;
                const json = (await res.json()) as {
                  hubAlert?: { text: string; severity: 'warn' | 'ok' };
                };
                const alert = json.hubAlert;
                if (!alert) return;
                if (canSeeModule(user, 'ventas')) next.ventas = alert;
                if (canSeeModule(user, 'reportes-socios')) {
                  next['reportes-socios'] = alert;
                }
              } catch {
                /* keep calm seed */
              }
            })()
          );
        }

        if (wantEventos) {
          fetches.push(
            (async () => {
              try {
                const res = await fetch('/api/eventos/summary', {
                  cache: 'no-store',
                });
                if (!res.ok) {
                  next.eventos = calmNoAlert();
                  return;
                }
                const json = (await res.json()) as {
                  kpis?: { anticipoSinOs?: number };
                  upcomingEvents?: {
                    event_date?: string | null;
                    title?: string | null;
                    celebration?: string | null;
                    company?: string | null;
                    folio?: string | null;
                    has_anticipo?: boolean;
                    has_os?: boolean;
                    os_path?: string | null;
                    digital_os_id?: string | null;
                    source?: string | null;
                    os_filename?: string | null;
                    source_label?: string | null;
                    status?: string | null;
                  }[];
                };
                const n = Number(json.kpis?.anticipoSinOs ?? 0);
                const upcoming = json.upcomingEvents || [];
                const nextEv =
                  upcoming.find((ev) => ev.event_date) ?? null;
                const anticipoEv =
                  upcoming.find(
                    (ev) =>
                      Boolean(ev.has_anticipo) &&
                      !ev.has_os &&
                      ev.status !== 'cancelado'
                  ) ?? null;
                next.eventos = formatEventosHubAlert(
                  Number.isFinite(n) ? n : 0,
                  nextEv,
                  anticipoEv
                );
              } catch {
                next.eventos = calmNoAlert();
              }
            })()
          );
        }

        if (wantRrhh) {
          fetches.push(
            (async () => {
              try {
                const [docsRes, sumRes] = await Promise.all([
                  fetch('/api/hr/employees/doc-alerts', { cache: 'no-store' }),
                  fetch('/api/hr/summary', { cache: 'no-store' }),
                ]);
                let withMissing: number | null = null;
                if (docsRes.ok) {
                  const docs = (await docsRes.json()) as {
                    withMissing?: number;
                    ready?: boolean;
                  };
                  if (
                    docs.ready !== false &&
                    typeof docs.withMissing === 'number'
                  ) {
                    withMissing = docs.withMissing;
                  }
                }
                let summaryAlerts:
                  | { severity: string; message: string }[]
                  | null = null;
                if (sumRes.ok) {
                  const sum = (await sumRes.json()) as {
                    alerts?: { severity: string; message: string }[];
                  };
                  summaryAlerts = sum.alerts ?? null;
                }
                next.rrhh = pickRrhhHubAlert({ withMissing, summaryAlerts });
              } catch {
                next.rrhh = calmNoAlert();
              }
            })()
          );
        }

        await Promise.all(fetches);
      } finally {
        if (!cancelled) {
          setAlerts(next);
          setAlertsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  return (
    <SuiteShell
      title={PRODUCT_NAME}
      subtitle={`${PRODUCT_TAGLINE} · ${hoy}${user ? ` · ${user.username}` : ''}`}
    >
      <p className="mb-6 max-w-2xl text-sm" style={{ color: theme.muted }}>
        Elige un módulo.
      </p>

      {loading ? (
        <p style={{ color: theme.muted }}>Cargando módulos…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((m) => {
            const isActive = m.status === 'activo';
            const dark = isActive;
            const hubId = isHubAlertModule(m.id) ? m.id : null;
            const useLiveAlert = isActive && hubId != null;
            const alert = hubId ? alerts[hubId] : undefined;
            const line = useLiveAlert
              ? alertsLoading && !alert
                ? '…'
                : alert?.text || 'Sin alertas'
              : m.description;
            const lineStyle = useLiveAlert
              ? alertLineStyle(alert, alertsLoading && !alert, dark)
              : { color: dark ? 'rgba(255,255,255,0.75)' : theme.muted };

            return (
              <Link key={m.id} href={m.href} className="group block">
                <SuiteCard
                  dark={dark}
                  className="h-full transition-transform group-hover:-translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2
                      className={`text-lg font-bold ${dark ? 'text-white' : ''}`}
                    >
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
                    className={`mt-3 text-sm leading-relaxed ${
                      useLiveAlert && alert?.severity === 'warn'
                        ? 'font-medium'
                        : ''
                    }`}
                    style={lineStyle}
                  >
                    {useLiveAlert && alert?.severity === 'warn' ? (
                      <span className="inline-flex items-start gap-2">
                        <span
                          className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: dark ? '#FBBF24' : SUITE.orangeDeep,
                          }}
                          aria-hidden
                        />
                        <span>
                          <span className="block">{line}</span>
                          {alert.detail ? (
                            <span className="mt-1 block text-[13px] font-normal opacity-90">
                              {alert.detail}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    ) : (
                      <>
                        <span className="block">{line}</span>
                        {useLiveAlert && alert?.detail ? (
                          <span className="mt-1 block text-[13px] opacity-90">
                            {alert.detail}
                          </span>
                        ) : null}
                      </>
                    )}
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
              <SuiteCard
                accent
                className="h-full transition-transform group-hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-bold">Master Panel</h2>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      backgroundColor: SUITE.orangeSoft,
                      color: SUITE.orangeDeep,
                    }}
                  >
                    Admin
                  </span>
                </div>
                <p className="mt-3 text-sm" style={{ color: theme.muted }}>
                  Usuarios, módulos y funciones (capabilities) del ERP · app
                  instalable.
                </p>
                <p
                  className="mt-5 text-sm font-bold"
                  style={{ color: SUITE.orangeDeep }}
                >
                  Abrir administración →
                </p>
              </SuiteCard>
            </Link>
          )}
        </div>
      )}

      <div className="mt-8 max-w-xl">
        <InstallAppPrompt />
      </div>
    </SuiteShell>
  );
}
