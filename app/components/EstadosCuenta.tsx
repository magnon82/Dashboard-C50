'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
} from 'react';
import {
  filterControlClass,
  filterSelectClass,
  SectionHeader,
} from '@/app/components/SectionHeader';
import {
  availableEfectivoWeeks,
  availableEstadoMonths,
  filterEstadoMovimientos,
  findPdfForMovimiento,
  isPlausibleEstadoYear,
  listPdfComprobantes,
  SOURCE_PRESUPUESTO_INGRESO,
  type EstadoMovimiento,
  type GastoCanal,
  type IngresoTipoFilter,
  type MatchStatus,
} from '@/app/lib/estados-cuenta';
import {
  facturaLabel,
  facturaPdfHref,
  facturaXmlHref,
  findFacturaForMovimiento,
  listFacturas,
  type FacturaItem,
} from '@/app/lib/facturas';
import { RUBRO_CATALOG, type RubroRow } from '@/app/lib/presupuesto';
import { getTheme, SUITE } from '@/app/lib/themes';
import { MESES, type FinancialRecord } from '@/app/lib/ventas-semana';

const theme = getTheme('suite');
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const ALL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const PAGE_SIZE = 10;

function money(v: number) {
  return `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function statusLabel(s: MatchStatus) {
  if (s === 'matched') return 'Conciliado';
  if (s === 'overridden') return 'Manual';
  return 'Sin match';
}

function statusStyle(s: MatchStatus): CSSProperties {
  if (s === 'matched') {
    return { backgroundColor: '#E8F5E9', color: '#1B5E20' };
  }
  if (s === 'overridden') {
    return { backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep };
  }
  return { backgroundColor: '#F1F5F9', color: '#475569' };
}

function origenLabel(bank: string) {
  if (bank === 'EFECTIVO') return 'Efectivo';
  if (bank === 'CXP') return 'CXP';
  return bank;
}

function ingresoTipoLabel(tipo: string | null | undefined) {
  if (tipo === 'ventas') return 'Ventas';
  if (tipo === 'entre_cuentas') return 'Entre cuentas';
  if (tipo === 'otro') return 'Otros ingresos';
  return null;
}

function ingresoTipoStyle(tipo: string | null | undefined): CSSProperties {
  if (tipo === 'ventas') {
    return { backgroundColor: '#E8F5E9', color: '#1B5E20' };
  }
  if (tipo === 'entre_cuentas') {
    return { backgroundColor: SUITE.orangeSoft, color: SUITE.orangeDeep };
  }
  if (tipo === 'otro') {
    return { backgroundColor: '#E2E8F0', color: '#1E3A5F' };
  }
  return { backgroundColor: '#F1F5F9', color: '#475569' };
}

function FacturaRefLink({
  factura,
  label,
  mutedFallback,
}: {
  factura: FacturaItem | null;
  label: string;
  mutedFallback?: string;
}) {
  if (!label || label === '—') {
    return (
      <span className="text-slate-400">{mutedFallback || 'sin factura'}</span>
    );
  }

  const xmlHref = factura ? facturaXmlHref(factura) : null;
  const pdfHref = factura ? facturaPdfHref(factura) : null;

  if (!xmlHref && !pdfHref) {
    // Folio en CXP/estado pero sin CFDI ni acuse/comprobante indexado
    return (
      <span className="text-slate-500" title="Referencia sin XML/PDF indexado">
        {label}
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          sin XML
        </span>
      </span>
    );
  }

  return (
    <div className="min-w-0">
      <span
        className="font-semibold"
        style={{ color: SUITE.orangeDeep }}
        title={factura ? `Factura ${facturaLabel(factura)}` : undefined}
      >
        {label}
      </span>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] font-semibold leading-tight">
        {xmlHref ? (
          <a
            href={xmlHref}
            title="Descargar XML"
            className="underline-offset-2 hover:underline"
            style={{ color: SUITE.orangeDeep }}
            onClick={(e) => e.stopPropagation()}
          >
            XML
          </a>
        ) : (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            title="Sin XML indexado"
          >
            sin XML
          </span>
        )}
        {pdfHref ? (
          <>
            <span className="text-slate-300" aria-hidden>
              ·
            </span>
            <a
              href={pdfHref}
              title={
                xmlHref
                  ? 'Descargar PDF'
                  : 'Acuse / comprobante PDF (sin CFDI XML)'
              }
              className="underline-offset-2 hover:underline"
              style={{ color: SUITE.orangeDeep }}
              onClick={(e) => e.stopPropagation()}
            >
              PDF
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface Props {
  records: FinancialRecord[];
  rubroRows: RubroRow[];
  year: number;
  month: number;
  loading?: boolean;
  canEdit?: boolean;
  onUpdated?: (record: FinancialRecord) => void;
  /** Start expanded (also used by standalone consultation page). */
  defaultOpen?: boolean;
  /** Full-page tool chrome: always open, no collapse toggle. */
  standalone?: boolean;
  /** Gastos = cargos/egresos; Ingresos = abonos / efectivo ingresos. */
  mode?: 'gastos' | 'ingresos';
}

const RUBRO_OPTIONS = RUBRO_CATALOG.filter((r) => !r.isParent);

export function EstadosCuenta({
  records,
  rubroRows: _rubroRows,
  year: presupuestoYear,
  month: presupuestoMonth,
  loading,
  canEdit = true,
  onUpdated,
  defaultOpen = false,
  standalone = false,
  mode = 'gastos',
}: Props) {
  const isIngresos = mode === 'ingresos';
  const [origen, setOrigen] = useState<GastoCanal>('all');
  const [ingresoTipo, setIngresoTipo] = useState<IngresoTipoFilter>('all');
  const [browseYear, setBrowseYear] = useState(presupuestoYear);
  const [browseMonth, setBrowseMonth] = useState(presupuestoMonth);
  const [browseDay, setBrowseDay] = useState<number | 'all'>('all');
  const [open, setOpen] = useState(defaultOpen || standalone);
  const [week, setWeek] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  /** Avoid re-applying last-month-with-data after the user changes Mes. */
  const [monthDefaultApplied, setMonthDefaultApplied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftObs, setDraftObs] = useState<Record<string, string>>({});

  const estadoMonths = useMemo(
    () =>
      availableEstadoMonths(records, {
        incomeOnly: isIngresos,
        expensesOnly: !isIngresos,
      }),
    [records, isIngresos]
  );

  const yearsAvailable = useMemo(() => {
    const ys = new Set(
      estadoMonths.map((m) => m.year).filter((y) => isPlausibleEstadoYear(y))
    );
    if (isPlausibleEstadoYear(presupuestoYear)) ys.add(presupuestoYear);
    if (isPlausibleEstadoYear(browseYear)) ys.add(browseYear);
    ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [estadoMonths, presupuestoYear, browseYear]);

  const monthsWithData = useMemo(() => {
    return new Set(
      estadoMonths
        .filter((m) => m.year === browseYear)
        .map((m) => m.month)
    );
  }, [estadoMonths, browseYear]);

  // On first load: jump to the latest month that actually has data for this mode.
  useEffect(() => {
    if (monthDefaultApplied) return;
    if (loading) return;
    if (!records.length) {
      setMonthDefaultApplied(true);
      return;
    }
    if (!estadoMonths.length) {
      setMonthDefaultApplied(true);
      return;
    }
    const currentHasData =
      isPlausibleEstadoYear(browseYear) &&
      estadoMonths.some(
        (m) => m.year === browseYear && m.month === browseMonth
      );
    if (!currentHasData) {
      const latest = estadoMonths[0];
      setBrowseYear(latest.year);
      setBrowseMonth(latest.month);
      setBrowseDay('all');
      setWeek('all');
    }
    setMonthDefaultApplied(true);
  }, [
    loading,
    records.length,
    estadoMonths,
    browseYear,
    browseMonth,
    monthDefaultApplied,
  ]);

  const weeksAvailable = useMemo(
    () => availableEfectivoWeeks(records, browseYear, browseMonth),
    [records, browseYear, browseMonth]
  );

  // Gastos: always all origins (no Origen filter). Ingresos: respect bank filter.
  const bankFilter: GastoCanal = isIngresos ? origen : 'all';

  const showWeekFilter =
    bankFilter === 'all' ||
    bankFilter === 'EFECTIVO' ||
    (!isIngresos && bankFilter === 'CXP');

  const pdfs = useMemo(() => listPdfComprobantes(records), [records]);

  const facturas = useMemo(() => listFacturas(records), [records]);

  const movements = useMemo(
    () =>
      filterEstadoMovimientos(records, {
        bank: bankFilter,
        year: browseYear,
        month: browseMonth,
        day: browseDay,
        week: showWeekFilter ? week : 'all',
        query,
        expensesOnly: !isIngresos,
        incomeOnly: isIngresos,
        ingresoTipo: isIngresos ? ingresoTipo : 'all',
      }),
    [
      records,
      bankFilter,
      browseYear,
      browseMonth,
      browseDay,
      week,
      showWeekFilter,
      query,
      isIngresos,
      ingresoTipo,
    ]
  );

  useEffect(() => {
    setShowAll(false);
  }, [
    bankFilter,
    browseYear,
    browseMonth,
    browseDay,
    week,
    query,
    isIngresos,
    ingresoTipo,
  ]);

  const visibleMovements = useMemo(
    () => (showAll ? movements : movements.slice(0, PAGE_SIZE)),
    [movements, showAll]
  );

  const hasMore = movements.length > PAGE_SIZE && !showAll;

  const totals = useMemo(() => {
    let cargos = 0;
    let abonos = 0;
    let cajaChica = 0;
    for (const m of movements) {
      if (m.cargo) cargos += Math.abs(m.cargo);
      if (m.abono) abonos += Math.abs(m.abono);
      if (m.es_caja_chica && m.cargo) cajaChica += Math.abs(m.cargo);
    }
    return { cargos, abonos, cajaChica, n: movements.length };
  }, [movements]);

  /** Propinas de tarjetas (Infocaja) — no son movimientos listados; solo KPI. */
  const propinasBancarias = useMemo(() => {
    if (!isIngresos) return 0;
    let sum = 0;
    for (const r of records) {
      if (r.source_file !== 'infocaja') continue;
      if (r.category !== 'Infocaja Propina') continue;
      const p = String(r.date || '').slice(0, 10).split('-').map(Number);
      const y = p[0];
      const m = p[1];
      const d = p[2];
      if (!y || !m) continue;
      if (y !== browseYear || m !== browseMonth) continue;
      if (browseDay !== 'all' && d !== browseDay) continue;
      sum += Math.abs(Number(r.amount) || 0);
    }
    return sum;
  }, [isIngresos, records, browseYear, browseMonth, browseDay]);

  async function patch(
    id: string,
    body: Record<string, unknown>
  ): Promise<FinancialRecord | null> {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch('/api/estados-cuenta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Error ${res.status}`);
        return null;
      }
      return json.record as FinancialRecord;
    } catch {
      setError('No se pudo guardar el cambio');
      return null;
    } finally {
      setSavingId(null);
    }
  }

  function saveObs(m: EstadoMovimiento) {
    if (m.isEfectivo || m.isCxp) return;
    const value = draftObs[m.id] ?? m.observaciones;
    startTransition(() => {
      void patch(m.id, { observaciones: value }).then((rec) => {
        if (rec && onUpdated) onUpdated(rec);
      });
    });
  }

  function saveRubro(m: EstadoMovimiento, value: string) {
    if (m.isEfectivo || m.isCxp) return;
    startTransition(() => {
      if (!value) {
        void patch(m.id, { matched_rubro: null, matched_parent: null }).then(
          (rec) => {
            if (rec && onUpdated) onUpdated(rec);
          }
        );
        return;
      }
      const [parentPart, rubroPart] = value.includes('::')
        ? value.split('::')
        : ['', value];
      const parent = parentPart || null;
      const rubro = rubroPart;
      void patch(m.id, {
        matched_rubro: rubro || null,
        matched_parent: parent,
      }).then((rec) => {
        if (rec && onUpdated) onUpdated(rec);
      });
    });
  }

  const colCount = isIngresos ? 7 : 6;
  const sectionTitle = isIngresos ? 'Revisión de ingresos' : 'Revisión de gastos';

  return (
    <section className={standalone ? 'mb-0' : 'mb-8'}>
      {!standalone && (
        <SectionHeader
          title={
            <h2
              className="m-0 text-xl font-semibold leading-tight"
              style={{ color: theme.title }}
            >
              {sectionTitle}
            </h2>
          }
        >
          <button
            type="button"
            className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Ocultar' : 'Mostrar'}
          </button>
        </SectionHeader>
      )}

      {!open && !standalone ? null : (
        <>
          <div
            className={`mb-3 flex flex-wrap items-center gap-2${
              standalone ? ' rounded-[20px] bg-white p-4' : ''
            }`}
            style={standalone ? { boxShadow: SUITE.shadow } : undefined}
          >
            {isIngresos && (
              <label className={filterControlClass}>
                <span className="text-slate-500">Origen</span>
                <select
                  className={filterSelectClass}
                  value={origen}
                  onChange={(e) => {
                    setOrigen(e.target.value as GastoCanal);
                    setWeek('all');
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="MIFEL">MIFEL</option>
                  <option value="BBVA">BBVA</option>
                  <option value="EFECTIVO">Efectivo</option>
                </select>
              </label>
            )}
            {isIngresos && (
              <label className={filterControlClass}>
                <span className="text-slate-500">Tipo ingreso</span>
                <select
                  className={filterSelectClass}
                  value={ingresoTipo}
                  onChange={(e) =>
                    setIngresoTipo(e.target.value as IngresoTipoFilter)
                  }
                >
                  <option value="all">Todos</option>
                  <option value="ventas">Ventas</option>
                  <option value="entre_cuentas">Entre cuentas</option>
                  <option value="otro">Otros ingresos</option>
                </select>
              </label>
            )}
            <label className={filterControlClass}>
              <span className="text-slate-500">Año</span>
              <select
                className={filterSelectClass}
                value={browseYear}
                onChange={(e) => {
                  setBrowseYear(Number(e.target.value));
                  setWeek('all');
                }}
              >
                {yearsAvailable.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Mes</span>
              <select
                className={filterSelectClass}
                value={browseMonth}
                onChange={(e) => {
                  setBrowseMonth(Number(e.target.value));
                  setBrowseDay('all');
                  setWeek('all');
                }}
              >
                {ALL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {MESES[m - 1]}
                    {monthsWithData.has(m) ? '' : ' · sin datos'}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterControlClass}>
              <span className="text-slate-500">Día</span>
              <select
                className={filterSelectClass}
                value={browseDay === 'all' ? 'all' : String(browseDay)}
                onChange={(e) => {
                  const v = e.target.value;
                  setBrowseDay(v === 'all' ? 'all' : Number(v));
                }}
              >
                <option value="all">Todos</option>
                {ALL_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            {showWeekFilter && (
              <label className={filterControlClass}>
                <span className="text-slate-500">Semana</span>
                <select
                  className={filterSelectClass}
                  value={week === 'all' ? 'all' : String(week)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setWeek(v === 'all' ? 'all' : Number(v));
                  }}
                >
                  <option value="all">Todas</option>
                  {weeksAvailable.map((w) => (
                    <option key={w} value={w}>
                      SEM {w}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={filterControlClass}>
              <span className="text-slate-500">Buscar</span>
              <input
                className={filterSelectClass}
                style={{ minWidth: 180 }}
                placeholder="Concepto, razón social, folio…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          {error && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div
            className={`mb-4 grid gap-3 sm:grid-cols-2 ${
              isIngresos ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
            }`}
          >
            {(isIngresos
              ? [
                  { label: 'Movimientos', value: String(totals.n) },
                  { label: 'Total ingresos', value: money(totals.abonos) },
                  {
                    label: 'Propinas (Bancarias)',
                    value: money(propinasBancarias),
                  },
                  {
                    label: 'Mostrando',
                    value: `${visibleMovements.length} de ${totals.n}`,
                  },
                ]
              : [
                  { label: 'Movimientos', value: String(totals.n) },
                  { label: 'Cargos (gastos)', value: money(totals.cargos) },
                  {
                    label: 'Caja chica (en filtro)',
                    value: money(totals.cajaChica),
                  },
                ]
            ).map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-[20px] bg-white px-4 py-3"
                style={{ boxShadow: SUITE.shadow }}
              >
                <p
                  className="text-[11px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: theme.muted }}
                >
                  {kpi.label}
                </p>
                <p
                  className="mt-1 text-lg font-semibold"
                  style={{ color: SUITE.navy }}
                >
                  {loading ? '…' : kpi.value}
                </p>
              </div>
            ))}
          </div>

          {isIngresos && (
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              Propinas de tarjetas (bancarias); se cubren con efectivo a meseros.
            </p>
          )}

          <div
            className="overflow-x-auto rounded-[24px] bg-white"
            style={{ boxShadow: SUITE.shadow }}
          >
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: theme.tableHead, color: '#fff' }}>
                  <th className="px-3 py-2.5 text-center font-semibold">Fecha</th>
                  {isIngresos && (
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Origen
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-center font-semibold">Sem</th>
                  <th className="px-3 py-2.5 text-center font-semibold">
                    Descripción
                  </th>
                  {isIngresos ? (
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Abono
                    </th>
                  ) : (
                    <th className="px-3 py-2.5 text-center font-semibold">
                      Cargo
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-center font-semibold">Ref.</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Cargando movimientos…
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      {isIngresos
                        ? 'Sin ingresos para este filtro. Incluye efectivo, ingresos Mifel/BBVA del presupuesto Excel y abonos de estado de cuenta.'
                        : 'Sin gastos para este filtro. Estados de cuenta: COMPROBANTES BANCARIOS + ingest. Efectivo: FLUJO EFECTIVO + ingest_saldos_flujo.'}
                    </td>
                  </tr>
                ) : (
                  visibleMovements.map((m) => {
                    const busy = savingId === m.id || pending;
                    const rowOpen = expandedId === m.id;
                    const pdf = findPdfForMovimiento(m, pdfs);
                    const matchedFac = !isIngresos
                      ? findFacturaForMovimiento(
                          {
                            amount: Math.abs(m.cargo || m.amount || 0),
                            date: m.date,
                            folio: m.folio,
                            rfc: m.raw.rfc ? String(m.raw.rfc) : null,
                            razonSocial: m.razonSocial,
                            descripcion: m.descripcion,
                          },
                          facturas
                        )
                      : null;
                    const refLabel = m.isCxp
                      ? m.folio
                        ? `Fac ${m.folio}`
                        : m.razonSocial || '—'
                      : m.isEfectivo
                        ? m.categoria || '—'
                        : m.folio || m.referencia || '—';
                    return (
                      <Fragment key={m.id}>
                        <tr className="border-t border-slate-100 align-top">
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                            {m.date}
                          </td>
                          {isIngresos && (
                            <td
                              className="px-3 py-2 font-medium"
                              style={{ color: SUITE.navy }}
                            >
                              {origenLabel(String(m.bank))}
                              {m.es_caja_chica && (
                                <span
                                  className="ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: SUITE.orangeSoft,
                                    color: SUITE.orangeDeep,
                                  }}
                                >
                                  Caja chica
                                </span>
                              )}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                            {m.week != null ? `SEM ${m.week}` : '—'}
                          </td>
                          <td className="max-w-[280px] px-3 py-2">
                            <div className="line-clamp-2" title={m.descripcion}>
                              {m.descripcion || '—'}
                              {isIngresos &&
                                ingresoTipoLabel(m.ingresoTipo) && (
                                  <span
                                    className="ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                    style={ingresoTipoStyle(m.ingresoTipo)}
                                  >
                                    {ingresoTipoLabel(m.ingresoTipo)}
                                  </span>
                                )}
                              {!isIngresos && m.es_caja_chica && (
                                <span
                                  className="ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: SUITE.orangeSoft,
                                    color: SUITE.orangeDeep,
                                  }}
                                >
                                  Caja chica
                                </span>
                              )}
                            </div>
                            {m.isCxp && m.razonSocial ? (
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                {m.razonSocial}
                              </p>
                            ) : null}
                            {m.isEfectivo && m.categoria && (
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                {m.categoria}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {isIngresos
                              ? m.abono
                                ? money(Math.abs(m.abono))
                                : '—'
                              : m.cargo
                                ? money(Math.abs(m.cargo))
                                : '—'}
                          </td>
                          <td className="max-w-[140px] px-3 py-2 text-xs text-slate-600">
                            {!isIngresos && !m.isEfectivo ? (
                              <FacturaRefLink
                                factura={matchedFac}
                                label={refLabel}
                              />
                            ) : (
                              <span className="truncate">{refLabel}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-xs font-semibold underline-offset-2 hover:underline"
                              style={{ color: SUITE.navy }}
                              onClick={() =>
                                setExpandedId(rowOpen ? null : m.id)
                              }
                            >
                              {rowOpen ? 'Ocultar' : 'Ver detalle'}
                            </button>
                          </td>
                        </tr>
                        {rowOpen && (
                          <tr className="border-t border-slate-50 bg-slate-50/80">
                            <td colSpan={colCount} className="px-4 py-3">
                              {m.isEfectivo ? (
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Concepto
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.concepto || m.descripcion || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Categoría (columna)
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.categoria || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Tipo
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.ingresoTipo === 'ventas'
                                        ? 'Ventas efectivo (caja · mismo tipo que TPV/MIFEL)'
                                        : m.ingresoTipo === 'otro'
                                          ? 'Otros ingresos (flujo efectivo)'
                                          : m.cargo
                                            ? 'Egreso'
                                            : m.abono
                                              ? 'Ingreso'
                                              : '—'}
                                      {m.es_caja_chica
                                        ? ' · Caja chica (presupuesto efectivo)'
                                        : ''}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Semana presupuesto
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.week != null
                                        ? `SEM ${m.week} · ${MESES[(browseMonth || 1) - 1]} ${browseYear}`
                                        : '—'}
                                      {m.week_annual != null
                                        ? ` (anual #${m.week_annual})`
                                        : ''}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Monto
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.cargo
                                        ? `Cargo ${money(Math.abs(m.cargo))}`
                                        : m.abono
                                          ? `Abono ${money(Math.abs(m.abono))}`
                                          : money(m.amount)}
                                    </p>
                                  </div>
                                </div>
                              ) : m.isCxp ? (
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Concepto
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.descripcion || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Razón social
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.razonSocial || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      No. de factura
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      <FacturaRefLink
                                        factura={matchedFac}
                                        label={m.folio || '—'}
                                      />
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Semana o mes
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.week != null ? `SEM ${m.week}` : '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Forma de pago
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.forma_pago ||
                                        m.observaciones ||
                                        '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      IVA / Monto
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.iva != null
                                        ? `IVA ${money(Number(m.raw.iva))} · `
                                        : ''}
                                      {m.cargo
                                        ? `Pagado ${money(Math.abs(m.cargo))}`
                                        : money(m.amount)}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      RFC
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.rfc || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Cheque
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.cheque || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      IVA
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.iva != null
                                        ? money(Number(m.raw.iva))
                                        : '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Saldo en estado
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      {m.raw.saldo_total != null
                                        ? money(Number(m.raw.saldo_total))
                                        : '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-500">
                                      Folio / referencia
                                    </p>
                                    <p style={{ color: SUITE.navy }}>
                                      <FacturaRefLink
                                        factura={matchedFac}
                                        label={
                                          [
                                            m.folio || null,
                                            m.referencia || null,
                                          ]
                                            .filter(Boolean)
                                            .join(' · ') || '—'
                                        }
                                      />
                                    </p>
                                  </div>
                                  {!isIngresos && (
                                    <div>
                                      <p className="font-semibold text-slate-500">
                                        Comprobante PDF
                                      </p>
                                      <p style={{ color: SUITE.navy }}>
                                        {pdf
                                          ? 'Comprobante indexado'
                                          : 'Sin índice PDF (ejecuta ingest --index-pdfs)'}
                                      </p>
                                      {pdf?.rel_path ? (
                                        <div className="mt-1 flex flex-wrap gap-2">
                                          <a
                                            className="text-[11px] font-semibold underline-offset-2 hover:underline"
                                            style={{
                                              color: SUITE.orangeDeep,
                                            }}
                                            href={`/api/comprobantes?open=${encodeURIComponent(pdf.rel_path)}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Abrir
                                          </a>
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                  {!isIngresos && (
                                    <div>
                                      <p className="font-semibold text-slate-500">
                                        Match / rubro
                                      </p>
                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span
                                          className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                          style={statusStyle(m.match_status)}
                                        >
                                          {statusLabel(m.match_status)}
                                        </span>
                                        {canEdit ? (
                                          <select
                                            className="max-w-[200px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium outline-none"
                                            value={
                                              m.matched_rubro
                                                ? `${m.matched_parent || ''}::${m.matched_rubro}`
                                                : ''
                                            }
                                            disabled={busy}
                                            onChange={(e) =>
                                              saveRubro(m, e.target.value)
                                            }
                                          >
                                            <option value="">
                                              — Sin rubro —
                                            </option>
                                            {RUBRO_OPTIONS.map((r) => {
                                              const val = `${r.parent || ''}::${r.rubro}`;
                                              return (
                                                <option key={val} value={val}>
                                                  {r.parent
                                                    ? `${r.rubro} (${r.parent})`
                                                    : r.rubro}
                                                </option>
                                              );
                                            })}
                                          </select>
                                        ) : (
                                          <span>
                                            {m.matched_rubro || '—'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {!isIngresos && (
                                    <div className="sm:col-span-2 lg:col-span-3">
                                      <p className="font-semibold text-slate-500">
                                        Observaciones
                                      </p>
                                      {canEdit ? (
                                        <input
                                          className="mt-1 w-full max-w-xl rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none"
                                          placeholder="Nota…"
                                          value={
                                            draftObs[m.id] ?? m.observaciones
                                          }
                                          disabled={busy}
                                          onChange={(e) =>
                                            setDraftObs((prev) => ({
                                              ...prev,
                                              [m.id]: e.target.value,
                                            }))
                                          }
                                          onBlur={() => {
                                            const v = draftObs[m.id];
                                            if (
                                              v !== undefined &&
                                              v !== m.observaciones
                                            ) {
                                              saveObs(m);
                                            }
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveObs(m);
                                          }}
                                        />
                                      ) : (
                                        <p className="mt-1 text-slate-600">
                                          {m.observaciones || '—'}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  {isIngresos && (
                                    <div>
                                      <p className="font-semibold text-slate-500">
                                        Tipo
                                      </p>
                                      <p style={{ color: SUITE.navy }}>
                                        {m.source_file ===
                                        SOURCE_PRESUPUESTO_INGRESO
                                          ? m.ingresoTipo === 'ventas'
                                            ? 'Ventas (depósito real · presupuesto Excel)'
                                            : m.ingresoTipo === 'entre_cuentas'
                                              ? 'Entre cuentas (transferencia MIFEL↔BBVA)'
                                              : m.ingresoTipo === 'otro'
                                                ? 'Otros ingresos (presupuesto Excel)'
                                                : 'Ingreso semanal (presupuesto Excel)'
                                          : m.isEfectivo
                                            ? m.ingresoTipo === 'ventas'
                                              ? 'Ventas efectivo (caja · flujo)'
                                              : m.ingresoTipo === 'otro'
                                                ? 'Otros ingresos (flujo efectivo)'
                                                : 'Ingreso efectivo (flujo)'
                                            : 'Abono bancario (estado de cuenta)'}
                                      </p>
                                    </div>
                                  )}
                                  {isIngresos &&
                                    m.source_file ===
                                      SOURCE_PRESUPUESTO_INGRESO && (
                                      <div>
                                        <p className="font-semibold text-slate-500">
                                          Semana presupuesto
                                        </p>
                                        <p style={{ color: SUITE.navy }}>
                                          {m.week != null
                                            ? `SEM ${m.week} · ${MESES[(browseMonth || 1) - 1]} ${browseYear}`
                                            : '—'}
                                        </p>
                                      </div>
                                    )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                className="inline-flex h-10 items-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                style={{ boxShadow: SUITE.shadow }}
                onClick={() => setShowAll(true)}
              >
                Mostrar más ({movements.length - PAGE_SIZE} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
