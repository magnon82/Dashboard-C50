'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  HR_RESGUARDO_KIND_LABELS,
  HR_RESGUARDO_STATUS_LABELS,
  flattenResguardoInventory,
  formatResguardoSpec,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';

const theme = getTheme('suite');

const EMPTY_COPY =
  'No hay equipos ni herramientas con resguardo vigente en el sistema. Cuando compartan el listado actual (fuente o Drive), se cargarán aquí los ítems vinculados a cada colaborador.';

function formatFecha(iso?: string): string {
  if (!iso) return '—';
  // YYYY-MM-DD o ISO completo
  const d = iso.length <= 10 ? `${iso}T12:00:00` : iso;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Inventario por equipo/herramienta → quién lo tiene. Crear/editar: perfil → Resguardos. */
export function RrhhResguardosPanel() {
  const [requests, setRequests] = useState<HrResguardoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/resguardo?limit=200', {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo cargar');
        setRequests([]);
      } else {
        setError(json.error || null);
        setRequests(json.requests || []);
      }
    } catch {
      setError('Error de red');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const inventory = useMemo(
    () => flattenResguardoInventory(requests, { activeOnly: true }),
    [requests]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter((row) => {
      const hay = [
        row.concepto,
        row.holderName,
        row.holderPuesto,
        row.marca,
        row.modelo,
        row.numero_serie,
        row.folio,
        HR_RESGUARDO_KIND_LABELS[row.kind],
        HR_RESGUARDO_STATUS_LABELS[row.status],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [inventory, query]);

  // Agrupar visualmente por concepto (mismo equipo / herramienta).
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const key = row.concepto.trim().toLowerCase();
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({
      key,
      concepto: rows[0]?.concepto || key,
      rows,
    }));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <SuiteCard accent className="max-w-5xl">
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Resguardos · inventario
        </p>
        <h3 className="mt-2 text-xl font-bold" style={{ color: theme.title }}>
          Equipo y herramientas en resguardo
        </h3>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: theme.muted }}>
          Consulta por ítem: qué equipo o herramienta está asignado y quién lo
          tiene. Solo se muestran resguardos vigentes (pendiente o entregado).
          Para capturar o editar una carta C50, abre el perfil del colaborador
          (clic en el nombre en Plantilla) → pestaña Resguardos.
        </p>
        <p className="mt-3 text-sm font-semibold" style={{ color: SUITE.navy }}>
          Ítems vigentes: {loading ? '…' : inventory.length}
        </p>
      </SuiteCard>

      <SuiteCard className="max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-base font-bold" style={{ color: theme.title }}>
            Por equipo / herramienta
          </h3>
          {!loading && inventory.length > 0 ? (
            <label className="block min-w-[200px] flex-1 max-w-xs">
              <span className="sr-only">Buscar</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar equipo, persona, serie…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          ) : null}
        </div>

        {loading ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Cargando…
          </p>
        ) : error && requests.length === 0 ? (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : inventory.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6"
          >
            <p className="text-sm leading-relaxed" style={{ color: theme.muted }}>
              {EMPTY_COPY}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: theme.muted }}>
            Ningún ítem coincide con «{query.trim()}».
          </p>
        ) : (
          <div
            className="mt-4 overflow-x-auto rounded-xl border border-slate-100"
            style={{ boxShadow: SUITE.shadow }}
          >
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: SUITE.navy, color: '#fff' }}>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">
                    Equipo / herramienta
                  </th>
                  <th className="px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wide w-16">
                    Cant.
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">
                    Marca / modelo / serie
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">
                    Quién lo tiene
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">
                    Folio · estado
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) =>
                  group.rows.map((row, i) => (
                    <tr
                      key={row.key}
                      className="border-t border-slate-100"
                      style={{
                        backgroundColor: i === 0 ? '#fff' : '#fafbfc',
                      }}
                    >
                      <td
                        className="px-3 py-2.5 align-top font-semibold"
                        style={{ color: theme.title }}
                      >
                        {i === 0 ? (
                          <>
                            {row.concepto}
                            <span
                              className="mt-0.5 block text-[11px] font-semibold uppercase tracking-wide"
                              style={{ color: SUITE.orangeDeep }}
                            >
                              {HR_RESGUARDO_KIND_LABELS[row.kind]}
                              {group.rows.length > 1
                                ? ` · ${group.rows.length} asignaciones`
                                : ''}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-300" aria-hidden>
                            ↳
                          </span>
                        )}
                      </td>
                      <td
                        className="px-2 py-2.5 text-center align-top tabular-nums"
                        style={{ color: theme.title }}
                      >
                        {row.cantidad}
                      </td>
                      <td
                        className="px-3 py-2.5 align-top"
                        style={{ color: theme.muted }}
                      >
                        {formatResguardoSpec(row)}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className="font-semibold"
                          style={{ color: theme.title }}
                        >
                          {row.holderName}
                        </span>
                        {row.holderPuesto ? (
                          <span
                            className="mt-0.5 block text-xs"
                            style={{ color: theme.muted }}
                          >
                            {row.holderPuesto}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className="font-medium"
                          style={{ color: theme.title }}
                        >
                          {row.folio || row.requestId.slice(0, 8)}
                        </span>
                        <span
                          className="mt-0.5 block text-[11px] font-bold uppercase tracking-wide"
                          style={{ color: SUITE.orangeDeep }}
                        >
                          {HR_RESGUARDO_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2.5 align-top whitespace-nowrap"
                        style={{ color: theme.muted }}
                      >
                        {formatFecha(row.fechaResguardo || row.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SuiteCard>
    </div>
  );
}
