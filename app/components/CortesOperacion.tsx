'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';
import { Card, Text } from '@tremor/react';
import { VentasCortesReportCard } from '@/app/components/VentasCortesReportCard';
import { VentasTombolaSemanalCard } from '@/app/components/VentasTombolaSemanalCard';
import { InfocajaSyncBanner } from '@/app/components/InfocajaSyncBanner';
import {
  SectionHeader,
  filterControlClass,
  filterSelectClass,
} from '@/app/components/SectionHeader';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  MESES,
  formatShort,
  buildCorteCancelacionesDescuentos,
  availableCorteCancelacionesMonths,
  latestMonthWithCorteCancelaciones,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';

const theme = getTheme('suite');

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Cortes diarios, cancelaciones/descuentos y tómbola semanal.
 * Antes vivía dentro de Ventas; ahora es módulo propio en /cortes.
 */
export function CortesOperacion() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [corteFilter, setCorteFilter] = useState<
    'todos' | 'descuentos' | 'cancelaciones'
  >('todos');
  const [corteCollapsed, setCorteCollapsed] = useState(true);
  const [corteYear, setCorteYear] = useState(() => new Date().getFullYear());
  const [corteMonth, setCorteMonth] = useState(() => new Date().getMonth() + 1);
  const [didSnapCorteMonth, setDidSnapCorteMonth] = useState(false);
  const [corteOpenId, setCorteOpenId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRecords() {
      setDataError(null);
      try {
        const res = await fetch('/api/financial-records', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) {
          setDataError(json.error || 'No se pudieron cargar los datos');
          setRecords([]);
          return;
        }
        setRecords(json.records || []);
      } catch (e) {
        setDataError(
          e instanceof Error ? e.message : 'Error de red al cargar datos'
        );
        setRecords([]);
      } finally {
        setLoading(false);
      }
    }
    void fetchRecords();
  }, []);

  const corteMesesDisponibles = useMemo(
    () => availableCorteCancelacionesMonths(records),
    [records]
  );

  const corteMesesConDatos = useMemo(() => {
    return new Set(
      corteMesesDisponibles
        .filter((m) => m.year === corteYear)
        .map((m) => m.month)
    );
  }, [corteMesesDisponibles, corteYear]);

  useEffect(() => {
    if (didSnapCorteMonth || loading) return;
    const latest = latestMonthWithCorteCancelaciones(records);
    if (latest) {
      const currentHasData = corteMesesDisponibles.some(
        (m) => m.year === corteYear && m.month === corteMonth
      );
      if (!currentHasData) {
        setCorteYear(latest.year);
        setCorteMonth(latest.month);
        setCorteOpenId(null);
      }
    }
    setDidSnapCorteMonth(true);
  }, [
    records,
    corteMesesDisponibles,
    corteYear,
    corteMonth,
    didSnapCorteMonth,
    loading,
  ]);

  const corteMesActual = useMemo(
    () => buildCorteCancelacionesDescuentos(records, corteYear, corteMonth),
    [records, corteYear, corteMonth]
  );

  const corteMesLabel = `${MESES[corteMonth - 1]} ${corteYear}`;

  const corteItemsFiltrados = useMemo(() => {
    const items = corteMesActual.days.flatMap((d) => d.items);
    if (corteFilter === 'descuentos') {
      return items.filter((i) => i.kind === 'descuento');
    }
    if (corteFilter === 'cancelaciones') {
      return items.filter((i) => i.kind === 'cancelacion');
    }
    return items;
  }, [corteMesActual, corteFilter]);

  const corteTotalFiltrado = useMemo(
    () => corteItemsFiltrados.reduce((a, i) => a + i.amount, 0),
    [corteItemsFiltrados]
  );

  const cardClass = 'rounded-[24px] border-0 p-5 md:p-6';
  const cardStyle = {
    backgroundColor: theme.cardBg,
    boxShadow: SUITE.shadow,
  } as const;

  return (
    <>
      <InfocajaSyncBanner />
      {dataError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">No se cargaron los datos</p>
          <p className="mt-1">{dataError}</p>
        </div>
      )}
      {loading && (
        <p className="mb-6 text-center" style={{ color: theme.muted }}>
          Cargando datos…
        </p>
      )}

      <div className="space-y-6">
        <VentasCortesReportCard className="mb-0" />

        <Card className={cardClass} style={cardStyle}>
          <SectionHeader title={`Cancelaciones y descuentos · ${corteMesLabel}`}>
            <label className={`${filterControlClass} bg-white shadow-sm`}>
              <span className="shrink-0 text-slate-500">Mes</span>
              <select
                className={`${filterSelectClass} min-w-[9.5rem] cursor-pointer bg-white`}
                value={corteMonth}
                onChange={(e) => {
                  setCorteMonth(Number(e.target.value));
                  setCorteOpenId(null);
                }}
                aria-label="Mes de cancelaciones y descuentos"
              >
                {MESES.map((m, i) => {
                  const mesNum = i + 1;
                  const tiene = corteMesesConDatos.has(mesNum);
                  return (
                    <option key={m} value={mesNum}>
                      {m}
                      {tiene ? '' : ' (sin datos)'}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              type="button"
              aria-label="Mes anterior"
              disabled={corteMonth <= 1}
              onClick={() => {
                setCorteMonth((m) => Math.max(1, m - 1));
                setCorteOpenId(null);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Mes siguiente"
              disabled={corteMonth >= 12}
              onClick={() => {
                setCorteMonth((m) => Math.min(12, m + 1));
                setCorteOpenId(null);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
            <label className={filterControlClass}>
              <span className="text-slate-500">Ver</span>
              <select
                className={`${filterSelectClass} min-w-[10rem] cursor-pointer`}
                value={corteFilter}
                onChange={(e) => {
                  setCorteFilter(
                    e.target.value as 'todos' | 'descuentos' | 'cancelaciones'
                  );
                  setCorteOpenId(null);
                }}
              >
                <option value="todos">Todos</option>
                <option value="descuentos">Solo descuentos</option>
                <option value="cancelaciones">Solo cancelaciones</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setCorteCollapsed((v) => !v);
                setCorteOpenId(null);
              }}
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {corteCollapsed ? 'Mostrar desglose' : 'Ocultar desglose'}
            </button>
          </SectionHeader>
          <Text className="-mt-2 mb-4 text-sm text-slate-500">
            Clic en un renglón para ver el motivo
          </Text>
          <div className="mb-3 text-sm text-slate-600">
            <span className="font-semibold text-rose-700">
              Canc. {money(corteMesActual.totalCancelaciones)}
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-semibold text-amber-700">
              Desc. {money(corteMesActual.totalDescuentos)}
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="font-bold text-slate-800">
              Total {money(corteMesActual.total)}
            </span>
          </div>
          {!corteCollapsed && (
            <>
              {corteItemsFiltrados.length === 0 ? (
                <p className="py-8 text-center text-slate-400">
                  Sin registros para el filtro seleccionado.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr
                        className="text-center text-xs uppercase tracking-wide text-white"
                        style={{ backgroundColor: theme.tableHead }}
                      >
                        <th className="px-4 py-3">Fecha</th>
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Detalle</th>
                        <th className="px-4 py-3">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corteItemsFiltrados.map((item, i) => {
                        const isOpen = corteOpenId === item.id;
                        const detalle =
                          item.producto ||
                          item.persona ||
                          item.motivo ||
                          item.grupo ||
                          (item.kind === 'descuento'
                            ? 'Descuento'
                            : 'Cancelación');
                        const motivoLines = [
                          item.motivo && `Motivo: ${item.motivo}`,
                          item.grupo && `Grupo: ${item.grupo}`,
                          item.persona && `Persona: ${item.persona}`,
                          item.producto && `Producto: ${item.producto}`,
                          item.mesero && `Mesero: ${item.mesero}`,
                          item.autorizo && `Autorizó: ${item.autorizo}`,
                          item.mesa && `Mesa: ${item.mesa}`,
                          item.hora && `Hora: ${item.hora}`,
                        ].filter(Boolean) as string[];
                        return (
                          <Fragment key={item.id}>
                            <tr
                              onClick={() =>
                                setCorteOpenId((cur) =>
                                  cur === item.id ? null : item.id
                                )
                              }
                              className={`cursor-pointer ${
                                i % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                              } ${isOpen ? 'bg-amber-50' : 'hover:bg-amber-50/70'}`}
                            >
                              <td className="px-4 py-2.5 text-slate-600">
                                {formatShort(item.date)}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                    item.kind === 'cancelacion'
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {item.kind === 'cancelacion'
                                    ? 'Cancelación'
                                    : 'Descuento'}
                                </span>
                              </td>
                              <td className="max-w-xs truncate px-4 py-2.5 text-slate-700">
                                {detalle}
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                                {money(item.amount)}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-amber-50/80">
                                <td colSpan={4} className="px-4 py-3 text-sm">
                                  <div className="rounded-lg border border-amber-100 bg-white px-4 py-3 text-slate-700">
                                    {motivoLines.length > 0 ? (
                                      <ul className="space-y-1">
                                        {motivoLines.map((line) => (
                                          <li key={line}>{line}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p>Sin detalle de motivo</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr
                        className="font-bold text-white"
                        style={{ backgroundColor: theme.tableFoot }}
                      >
                        <td className="px-4 py-3" colSpan={3}>
                          Total filtrado · {corteMesLabel}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {money(corteTotalFiltrado)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        <VentasTombolaSemanalCard className="mb-0" />
      </div>
    </>
  );
}
