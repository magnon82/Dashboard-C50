'use client';

import { useEffect, useMemo, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import { VentasResumenCard } from '@/app/components/VentasResumenCard';
import { ChequePromedioMensualCard } from '@/app/components/ChequePromedioMensualCard';
import { PromedioVentaSemanalPorMesCard } from '@/app/components/PromedioVentaSemanalPorMesCard';
import { VentasPorMesCard } from '@/app/components/VentasPorMesCard';
import { SemanaEnCursoTable } from '@/app/components/SemanaEnCursoTable';
import { DetalleSemanalCard } from '@/app/components/DetalleSemanalCard';
import { BalanceMensualSociosCard } from '@/app/components/BalanceMensualSociosCard';
import { InfocajaSyncBanner } from '@/app/components/InfocajaSyncBanner';
import { SociosCorteResumenCard } from '@/app/components/SociosCorteResumenCard';
import { getTheme } from '@/app/lib/themes';
import {
  buildWeekToDateSales,
  parseIsoDate,
  todayMexicoIso,
  weekOptionsYearInCourse,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';
import { useStaffRptEventos } from '@/app/lib/use-staff-rpt-eventos';

const theme = getTheme('suite');

/** Años alineados con el comparativo de Ventas (Acumulado + Infocaja). */
const COMPARE_YEAR_MIN = 2021;
const COMPARE_YEAR_MAX = 2026;
const COMPARE_YEARS = Array.from(
  { length: COMPARE_YEAR_MAX - COMPARE_YEAR_MIN + 1 },
  (_, i) => COMPARE_YEAR_MAX - i
);

/**
 * Fuentes Balance Socios = Resumen semanal de movimientos:
 * presupuesto_semana + flujo_efectivo_semana.
 */
const BALANCE_SOURCES = [
  'presupuesto_semana',
  'flujo_efectivo_semana',
].join(',');

export default function ReportesSociosPage() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [balanceRecords, setBalanceRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState<number | null>(null);
  /** Semana a consultar en card «semana en curso» (solo año en curso). */
  const [consultaSemana, setConsultaSemana] = useState<number | null>(null);

  const staffRptEventos = useStaffRptEventos();

  useEffect(() => {
    setConsultaSemana(null);
  }, [year]);

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
        setDataError(e instanceof Error ? e.message : 'Error de red al cargar datos');
        setRecords([]);
      } finally {
        setLoading(false);
      }
    }
    fetchRecords();
  }, []);

  useEffect(() => {
    async function fetchBalance() {
      setBalanceError(null);
      try {
        const res = await fetch(
          `/api/financial-records?sources=${BALANCE_SOURCES}`,
          { cache: 'no-store' }
        );
        const json = await res.json();
        if (!res.ok) {
          setBalanceError(json.error || 'No se pudo cargar el balance');
          setBalanceRecords([]);
          return;
        }
        setBalanceRecords(json.records || []);
      } catch (e) {
        setBalanceError(
          e instanceof Error ? e.message : 'Error de red al cargar balance'
        );
        setBalanceRecords([]);
      } finally {
        setBalanceLoading(false);
      }
    }
    fetchBalance();
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<number>(COMPARE_YEARS);
    records.forEach((r) => {
      const p = parseIsoDate(r.date);
      if (p && p.y >= COMPARE_YEAR_MIN && p.y <= COMPARE_YEAR_MAX) years.add(p.y);
      const m = r.description?.match(/^(\d{4})\s+Semana/);
      if (m) {
        const y = Number(m[1]);
        if (y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX) years.add(y);
      }
    });
    return Array.from(years)
      .filter((y) => y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX)
      .sort((a, b) => b - a);
  }, [records]);

  const weeklyDataYears = useMemo(() => {
    const fromData = new Set<number>(COMPARE_YEARS);
    records.forEach((r) => {
      if (r.source_file === 'ventas_semana') {
        const m = r.description?.match(/^(\d{4})\s+Semana/);
        if (m) {
          const y = Number(m[1]);
          if (y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX) fromData.add(y);
        }
      }
    });
    return Array.from(fromData)
      .filter((y) => y >= COMPARE_YEAR_MIN && y <= COMPARE_YEAR_MAX)
      .sort((a, b) => b - a);
  }, [records]);

  const weekToDate = useMemo(() => {
    const currentYear = parseIsoDate(todayMexicoIso())?.y ?? new Date().getFullYear();
    return buildWeekToDateSales(records, undefined, {
      year,
      week: year === currentYear ? (consultaSemana ?? undefined) : undefined,
    });
  }, [records, year, consultaSemana]);

  const semanaEnCursoOptions = useMemo(() => weekOptionsYearInCourse(), []);

  const currentYearMx =
    parseIsoDate(todayMexicoIso())?.y ?? new Date().getFullYear();
  const showSemanaSelect = year === currentYearMx;

  const hoy = new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <SuiteShell title="Reportes Socios">
      <SociosCorteResumenCard />
      <InfocajaSyncBanner />
      {dataError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">No se cargaron los datos de ventas</p>
          <p className="mt-1">{dataError}</p>
        </div>
      )}
      {loading && (
        <p className="mb-6 text-center" style={{ color: theme.muted }}>
          Cargando ventas…
        </p>
      )}

      <VentasResumenCard
        className="mb-6"
        title="Ventas"
        subtitle={`Actualizado al ${hoy}`}
        records={records}
        year={year}
        month={month}
        onYearChange={setYear}
        onMonthChange={setMonth}
        availableYears={availableYears}
        weeklyDataYears={weeklyDataYears}
        eventosFallbackByDate={staffRptEventos}
        showPaymentMix={false}
        filtersBelowBreakdown
      />

      <SemanaEnCursoTable
        weekToDate={weekToDate}
        showDescCanc={false}
        eventosFallbackByDate={staffRptEventos}
        weekOptions={showSemanaSelect ? semanaEnCursoOptions : undefined}
        selectedWeek={
          showSemanaSelect
            ? (consultaSemana ?? weekToDate.weekNumber)
            : undefined
        }
        onWeekChange={
          showSemanaSelect
            ? (w) => {
                const current = semanaEnCursoOptions[0]?.week;
                setConsultaSemana(current != null && w === current ? null : w);
              }
            : undefined
        }
      />

      <ChequePromedioMensualCard records={records} years={COMPARE_YEARS} />

      <PromedioVentaSemanalPorMesCard
        records={records}
        years={COMPARE_YEARS}
        weeklyDataYears={weeklyDataYears}
        eventosFallbackByDate={staffRptEventos}
        loading={loading}
      />

      <VentasPorMesCard
        records={records}
        years={COMPARE_YEARS}
        weeklyDataYears={weeklyDataYears}
        eventosFallbackByDate={staffRptEventos}
        loading={loading}
      />

      {balanceError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">No se cargó el balance</p>
          <p className="mt-1">{balanceError}</p>
        </div>
      )}

      <BalanceMensualSociosCard
        records={balanceRecords}
        loading={balanceLoading}
      />

      <DetalleSemanalCard
        records={records}
        years={COMPARE_YEARS}
        weeklyDataYears={weeklyDataYears}
        eventosFallbackByDate={staffRptEventos}
      />
    </SuiteShell>
  );
}
