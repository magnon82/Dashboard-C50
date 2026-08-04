'use client';

import {
  HR_DRIVE_ONLY_PERFILES,
  HR_PERFILES_DRIVE_ROOT,
  HR_PUESTO_PERFIL_COVERAGE,
  hrPerfilCoverageSummary,
  hrPerfilDrivePath,
  hrPerfilStatusLabel,
  type HrPerfilLinkStatus,
} from '@/app/lib/hr-puesto-perfiles-map';
import { SUITE } from '@/app/lib/themes';

function StatusPill({ status }: { status: HrPerfilLinkStatus }) {
  const bg =
    status === 'ok'
      ? '#ECFDF5'
      : status === 'parcial'
        ? '#FFF7ED'
        : '#FEF2F2';
  const color =
    status === 'ok'
      ? '#047857'
      : status === 'parcial'
        ? '#C2410C'
        : '#B91C1C';
  return (
    <span
      className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: bg, color }}
    >
      {hrPerfilStatusLabel(status)}
    </span>
  );
}

/**
 * Mapa Plantilla → Puesto → Perfil/KPI Drive para el master panel (/admin).
 */
export function AdminHrPuestosMap({
  compact = false,
}: {
  /** Versión densa bajo el nodo RR.HH. del mapa de orígenes. */
  compact?: boolean;
}) {
  const summary = hrPerfilCoverageSummary();

  return (
    <div
      className={
        compact
          ? 'mt-3 space-y-2'
          : 'space-y-3 rounded-xl border px-3.5 py-3'
      }
      style={
        compact
          ? undefined
          : { borderColor: SUITE.border, background: '#FCFDFE' }
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-[11px] font-bold uppercase tracking-[0.12em]"
            style={{ color: SUITE.muted }}
          >
            Red de recursos RR.HH.
          </p>
          <p className="mt-0.5 text-sm font-bold" style={{ color: SUITE.navy }}>
            Plantilla → Puesto → Perfil / KPI
          </p>
          {!compact ? (
            <p className="mt-0.5 text-xs" style={{ color: SUITE.muted }}>
              Ligues curados a{' '}
              <code className="text-[10px]">{HR_PERFILES_DRIVE_ROOT}</code>.
              Descripción de puesto ≠ expediente personal.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
            style={{ background: SUITE.orangeSoft, color: SUITE.orangeDeep }}
          >
            {summary.conDrive}/{summary.total} con carpeta
          </span>
          {summary.parciales > 0 ? (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: '#FFF7ED', color: '#C2410C' }}
            >
              {summary.parciales} parcial
            </span>
          ) : null}
          {summary.huecos > 0 ? (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: '#FEF2F2', color: '#B91C1C' }}
            >
              {summary.huecos} sin perfil
            </span>
          ) : null}
        </div>
      </div>

      <p className="text-[11px] leading-snug" style={{ color: SUITE.muted }}>
        Plantilla → Empleado → Puesto (ligado) · Descripción / KPI / protocolos →
        Drive (a completar por puesto). Horarios, nómina y expediente ya cuelgan
        del empleado.
      </p>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: SUITE.border }}>
        <table className="min-w-full text-left text-[11px]">
          <thead>
            <tr style={{ background: '#F1F5F9', color: SUITE.navy }}>
              <th className="px-2 py-1.5 font-bold">Puesto</th>
              <th className="px-2 py-1.5 font-bold">Equipo</th>
              <th className="px-2 py-1.5 font-bold">Drive</th>
              <th className="px-2 py-1.5 font-bold">Desc.</th>
              <th className="px-2 py-1.5 font-bold">KPI</th>
              {!compact ? (
                <th className="px-2 py-1.5 font-bold">Act.</th>
              ) : null}
              <th className="px-2 py-1.5 font-bold">Nota</th>
            </tr>
          </thead>
          <tbody>
            {HR_PUESTO_PERFIL_COVERAGE.map((row) => {
              const path = hrPerfilDrivePath(row.driveRel);
              return (
                <tr
                  key={row.catalogo}
                  className="border-t"
                  style={{ borderColor: SUITE.border }}
                >
                  <td className="px-2 py-1.5 font-semibold" style={{ color: SUITE.navy }}>
                    {row.catalogo}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: SUITE.muted }}>
                    {row.equipo}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px]" style={{ color: SUITE.navySoft }}>
                    {row.driveRel ? (
                      <span title={path ?? undefined}>{row.driveRel}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusPill status={row.descripcion} />
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusPill status={row.kpi} />
                  </td>
                  {!compact ? (
                    <td className="px-2 py-1.5">
                      <StatusPill status={row.actividades} />
                    </td>
                  ) : null}
                  <td className="max-w-[220px] px-2 py-1.5" style={{ color: SUITE.muted }}>
                    {row.nota}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!compact ? (
        <div>
          <p
            className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em]"
            style={{ color: SUITE.muted }}
          >
            Drive sin puesto en plantilla
          </p>
          <ul className="space-y-1">
            {HR_DRIVE_ONLY_PERFILES.map((d) => (
              <li
                key={d.driveRel}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]"
              >
                <code className="font-mono text-[10px]" style={{ color: SUITE.navy }}>
                  {d.driveRel}
                </code>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: '#E8EEF7', color: SUITE.navySoft }}
                >
                  {d.estado}
                </span>
                <span style={{ color: SUITE.muted }}>
                  {d.docs} · {d.nota}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
