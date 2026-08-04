'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SuiteShell, SuiteCard } from '@/app/components/SuiteShell';
import { useSession } from '@/app/lib/useSession';
import { SUITE, getTheme } from '@/app/lib/themes';

const theme = getTheme('suite');

export default function StaffPage() {
  const { user, loading } = useSession();
  const showCorte = Boolean(user?.canAccessStaffCorte);
  const [pendingResguardos, setPendingResguardos] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/hr/resguardo/mine', { cache: 'no-store' });
        const json = (await res.json()) as {
          pendingCount?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setPendingResguardos(null);
          return;
        }
        setPendingResguardos(
          typeof json.pendingCount === 'number' ? json.pendingCount : 0
        );
      } catch {
        if (!cancelled) setPendingResguardos(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  const hasPendingResguardo =
    pendingResguardos != null && pendingResguardos > 0;

  return (
    <SuiteShell
      title="Staff"
      subtitle="Operación de piso · Carranza 50"
    >
      <p className="mb-6 max-w-2xl text-sm" style={{ color: theme.muted }}>
        Herramientas de piso: cierre diario, propinas, horario, resguardos y
        cumpleaños del equipo.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
        {!loading && showCorte ? (
          <Link href="/staff/corte" className="group block">
            <SuiteCard
              dark
              className="h-full transition-transform group-hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-bold text-white">Corte del día</h2>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    color: '#fff',
                  }}
                >
                  Principal
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-white/75">
                prepara la cámara de tu teléfono
              </p>
              <p className="mt-5 text-sm font-bold" style={{ color: SUITE.orange }}>
                Presiona aqui para realizar el corte diario
              </p>
            </SuiteCard>
          </Link>
        ) : null}

        <Link href="/staff/propinas" className="group block">
          <SuiteCard
            accent
            className="h-full transition-transform group-hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
                Propinas
              </h2>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: SUITE.orangeSoft,
                  color: SUITE.navy,
                }}
              >
                Calculadora
              </span>
            </div>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: SUITE.muted }}
            >
              Calculadora manual de propinas
            </p>
            <p
              className="mt-5 text-sm font-bold"
              style={{ color: SUITE.orangeDeep }}
            >
              Abrir calculadora →
            </p>
          </SuiteCard>
        </Link>

        <Link href="/staff/horario" className="group block">
          <SuiteCard
            className="h-full transition-transform group-hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
                Mi horario
              </h2>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: SUITE.orangeSoft,
                  color: SUITE.navy,
                }}
              >
                En curso + próxima
              </span>
            </div>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: SUITE.muted }}
            >
              Semana de horario en curso y la próxima si RH ya la publicó
            </p>
            <p
              className="mt-5 text-sm font-bold"
              style={{ color: SUITE.orangeDeep }}
            >
              Ver horario →
            </p>
          </SuiteCard>
        </Link>

        <Link href="/staff/resguardo" className="group block">
          <SuiteCard
            className="h-full transition-transform group-hover:-translate-y-0.5"
            style={
              hasPendingResguardo
                ? {
                    boxShadow: `0 0 0 2px ${SUITE.orange}, ${SUITE.shadow}`,
                  }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
                Mis resguardos
              </h2>
              {hasPendingResguardo ? (
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: '#DC2626',
                    color: '#fff',
                  }}
                >
                  {pendingResguardos} por confirmar
                </span>
              ) : (
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: SUITE.orangeSoft,
                    color: SUITE.navy,
                  }}
                >
                  Equipo
                </span>
              )}
            </div>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: SUITE.muted }}
            >
              Acepta el equipo o material que RH te asignó
            </p>
            {hasPendingResguardo ? (
              <p
                className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold leading-snug"
                style={{
                  backgroundColor: '#FEF2F2',
                  color: '#B91C1C',
                  border: '1px solid #FECACA',
                }}
              >
                Tienes {pendingResguardos} resguardo
                {pendingResguardos === 1 ? '' : 's'} pendiente
                {pendingResguardos === 1 ? '' : 's'} de confirmar. Entra y
                acéptalo{pendingResguardos === 1 ? '' : 's'}.
              </p>
            ) : null}
            <p
              className="mt-5 text-sm font-bold"
              style={{
                color: hasPendingResguardo ? '#B91C1C' : SUITE.orangeDeep,
              }}
            >
              {hasPendingResguardo
                ? 'Confirmar resguardos →'
                : 'Ver resguardos →'}
            </p>
          </SuiteCard>
        </Link>

        <Link href="/staff/cumpleanos" className="group block">
          <SuiteCard
            className="h-full transition-transform group-hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
                Cumpleaños
              </h2>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  backgroundColor: SUITE.orangeSoft,
                  color: SUITE.navy,
                }}
              >
                Equipo
              </span>
            </div>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: SUITE.muted }}
            >
              Próximos cumpleaños del staff, del más cercano al más lejano
            </p>
            <p
              className="mt-5 text-sm font-bold"
              style={{ color: SUITE.orangeDeep }}
            >
              Ver cumpleaños →
            </p>
          </SuiteCard>
        </Link>
      </div>
    </SuiteShell>
  );
}
