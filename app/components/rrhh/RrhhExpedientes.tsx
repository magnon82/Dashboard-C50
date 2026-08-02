'use client';

/**
 * Expedientes personales viven en Plantilla (filas + Bajas del año).
 * Este componente queda como acceso compacto a Drive / Biblioteca /
 * resguardos si se necesita fuera del listado unificado.
 */
import { useEffect, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { RrhhResguardosPanel } from '@/app/components/rrhh/RrhhResguardosPanel';
import { HR_EXPEDIENTES_DIR } from '@/app/lib/hr';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type IndexPayload = {
  ready: boolean;
  source?: string;
  path?: string;
  exists?: boolean;
  rootExists?: boolean;
  driveUrl?: string | null;
  linkedCount?: number;
  message?: string;
  error?: string;
};

export function RrhhExpedientes({
  onGoBiblioteca,
  initialShowResguardos = false,
}: {
  onGoBiblioteca?: () => void;
  initialShowResguardos?: boolean;
}) {
  const [index, setIndex] = useState<IndexPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResguardos, setShowResguardos] = useState(initialShowResguardos);

  useEffect(() => {
    if (initialShowResguardos) setShowResguardos(true);
  }, [initialShowResguardos]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/hr/expedientes', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: IndexPayload) => {
        if (!cancelled) setIndex(json);
      })
      .catch(() => {
        if (!cancelled) {
          setIndex({
            ready: false,
            error: 'Error de red al cargar expedientes',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dbBacked =
    index?.source === 'supabase' ||
    index?.ready === true ||
    (index?.linkedCount ?? 0) > 0;
  const localMounted =
    index?.rootExists === true && index?.exists === true;

  return (
    <div className="space-y-5">
      <SuiteCard accent className="max-w-3xl">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Expedientes · solo RH
        </p>
        <h3 className="mt-2 text-xl font-bold" style={{ color: theme.title }}>
          Carpetas en Drive
        </h3>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Consulta el expediente de cada persona desde la plantilla vigente
          (botón Expediente) o en Bajas del año. Aquí solo el acceso a Drive.
        </p>
        <p className="mt-2 font-mono text-[11px] text-slate-400">
          {loading
            ? '…'
            : index?.driveUrl
              ? 'drive.google.com · Expedientes'
              : dbBacked
                ? 'Índice en servidor (Supabase)'
                : index?.path || HR_EXPEDIENTES_DIR}
          {!loading && localMounted
            ? ' · local'
            : !loading && dbBacked
              ? ' · online'
              : ''}
          {!loading && index?.linkedCount
            ? ` · ${index.linkedCount} vinculados`
            : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {index?.driveUrl ? (
            <a
              href={index.driveUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
              style={{ backgroundColor: SUITE.orangeDeep }}
            >
              Abrir en Drive
            </a>
          ) : null}
          {onGoBiblioteca ? (
            <button
              type="button"
              onClick={onGoBiblioteca}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Biblioteca (perfiles / exámenes) →
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowResguardos((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {showResguardos ? 'Ocultar inventario' : 'Ver resguardos'}
          </button>
        </div>
        {!dbBacked && (index?.message || index?.error) ? (
          <p className="mt-3 text-sm rounded-lg px-3 py-2 text-amber-800 bg-amber-50">
            {index.message || index.error}
          </p>
        ) : null}
      </SuiteCard>

      {showResguardos ? <RrhhResguardosPanel /> : null}
    </div>
  );
}
