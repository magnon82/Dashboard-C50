'use client';

/**
 * Acceso compacto a Drive / Biblioteca / resguardos.
 * Expedientes personales y Archivo / Bajas viven en Plantilla
 * (`RrhhPlantilla` → botón Archivo / Bajas; desajustes Altas↔baja allí).
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

type AuditRow = {
  id: string;
  full_name: string;
  kind: string;
  note: string;
};

export function RrhhExpedientes({
  onGoBiblioteca,
  onGoPlantillaArchivo,
  initialShowResguardos = false,
}: {
  onGoBiblioteca?: () => void;
  /** Ir a Plantilla → Archivo / Bajas para CTA de desajustes. */
  onGoPlantillaArchivo?: () => void;
  initialShowResguardos?: boolean;
}) {
  const [index, setIndex] = useState<IndexPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResguardos, setShowResguardos] = useState(initialShowResguardos);
  const [mismatches, setMismatches] = useState<AuditRow[]>([]);

  useEffect(() => {
    if (initialShowResguardos) setShowResguardos(true);
  }, [initialShowResguardos]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch('/api/hr/expedientes', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/hr/expedientes?audit=1', { cache: 'no-store' }).then((r) =>
        r.json()
      ),
    ])
      .then(([idx, audit]: [IndexPayload, { mismatches?: AuditRow[] }]) => {
        if (cancelled) return;
        setIndex(idx);
        setMismatches(audit.mismatches || []);
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
  const altasStuck = mismatches.filter((m) => m.kind === 'baja_still_in_altas');

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
          Índice en servidor
        </h3>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Prioridad: índice Supabase (`drive_folder_path` + status). Altas =
          vigentes; Bajas = archivo. Consulta cada persona desde Plantilla
          (Expediente) o Archivo / Bajas. Aquí: Drive y desajustes.
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

      {altasStuck.length > 0 ? (
        <SuiteCard className="max-w-3xl border border-amber-200 bg-amber-50/80">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
            Archivado en sistema (carpeta aún en Altas) · {altasStuck.length}
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            Corrige desde Archivo / Bajas (mover carpeta en Drive o reactivar).
            No se da de baja automáticamente a activos.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-950">
            {altasStuck.slice(0, 12).map((m) => (
              <li key={m.id} className="font-semibold">
                {m.full_name}
              </li>
            ))}
          </ul>
          {onGoPlantillaArchivo ? (
            <button
              type="button"
              onClick={onGoPlantillaArchivo}
              className="mt-3 rounded-lg px-3 py-1.5 text-xs font-bold text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              Ir a Archivo / Bajas →
            </button>
          ) : (
            <p className="mt-2 text-xs text-amber-900/80">
              Abre Plantilla → Archivo / Bajas para corregir.
            </p>
          )}
        </SuiteCard>
      ) : null}

      {showResguardos ? <RrhhResguardosPanel /> : null}
    </div>
  );
}
