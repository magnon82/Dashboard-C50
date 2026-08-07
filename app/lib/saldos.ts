import { parseIsoDate, type FinancialRecord } from '@/app/lib/ventas-semana';

/** Saldos Mifel/BBVA desde Excel (ingestor presupuesto). */
export const SOURCE_SALDOS_PRESUPUESTO = 'presupuesto_saldos';
/** Override manual desde /admin (gana sobre presupuesto_saldos). */
export const SOURCE_SALDOS_BANCOS_MANUAL = 'saldos_bancos_manual';

export const CAT_SALDO_MIFEL = 'Saldo Mifel';
export const CAT_SALDO_BBVA = 'Saldo BBVA';

/** Hoy civil America/Mexico_City (YYYY-MM-DD). Saldos no se conocen a futuro. */
export function todayCdmxIso(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export interface SaldosAlDiaData {
  efectivo: number | null;
  efectivoFecha: string | null;
  /** Max created_at among flujo_efectivo_saldo rows (ISO). */
  efectivoSyncedAt: string | null;
  /** True when saldo date is before yesterday CDMX (archivo sin días recientes). */
  efectivoStale: boolean;
  mifel: number;
  bbva: number;
  bancos: number;
  bancosFecha: string | null;
  bancosFuente: 'manual' | 'presupuesto' | null;
  totalDisponible: number;
  cxpTotal: number | null;
  cxpProgramado: number | null;
  cxpSaldo: number | null;
  /** Max created_at among cxp_por_pagar rows (ISO). */
  cxpSyncedAt: string | null;
}

/** Round to centavos — avoids float noise like 107378800.36999999. */
export function moneyCents(v: unknown): number {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function moneyAmount(v: unknown): number {
  return moneyCents(v);
}

/** TOTAL disponible = efectivo (0 si null) + bancos. Same inputs as the cards. */
export function totalEfectivoMasBancos(
  efectivo: number | null | undefined,
  bancos: number
): number {
  return moneyCents((efectivo ?? 0) + moneyCents(bancos));
}

function pickBancosFromSource(
  records: FinancialRecord[],
  source: string,
  byDay: boolean
): { mifel: number; bbva: number; fecha: string } | null {
  const rows = records
    .filter((r) => r.source_file === source)
    .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
    .filter((r) => r.parsed)
    .sort((a, b) => (a.parsed!.key < b.parsed!.key ? -1 : 1));

  if (!rows.length) return null;

  const ultima = rows[rows.length - 1].parsed!;
  const pool = byDay
    ? rows.filter((r) => r.parsed!.key === ultima.key)
    : rows.filter((r) => r.parsed!.y === ultima.y && r.parsed!.m === ultima.m);

  return {
    mifel: moneyAmount(pool.find((r) => r.category === CAT_SALDO_MIFEL)?.amount),
    bbva: moneyAmount(pool.find((r) => r.category === CAT_SALDO_BBVA)?.amount),
    fecha: `${ultima.y}-${String(ultima.m).padStart(2, '0')}-${String(ultima.d).padStart(2, '0')}`,
  };
}

export function buildSaldosAlDia(records: FinancialRecord[]): SaldosAlDiaData {
  const currentYear = new Date().getFullYear();

  const saldosEfectivo = records
    .filter((r) => r.source_file === 'flujo_efectivo_saldo' && r.category === 'Saldo Efectivo')
    .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
    .filter((r) => r.parsed && r.parsed.y <= currentYear + 1);

  const delAnio = saldosEfectivo.filter((r) => r.parsed!.y === currentYear);
  const poolEfectivo = delAnio.length > 0 ? delAnio : saldosEfectivo;
  // Same calendar day: prefer later row (end-of-day running balance). Ingest
  // now stores one saldo per day; >= still wins if older duplicates remain.
  const saldoEfectivoHoy = poolEfectivo.length
    ? poolEfectivo.reduce((best, cur) =>
        cur.parsed!.key >= best.parsed!.key ? cur : best
      )
    : null;

  // Fecha de tarjeta = último gasto en FLUJO (movimientos), no la fila de saldo.
  const gastosFlujo = records
    .filter((r) => r.source_file === 'flujo_efectivo_mov' && r.type === 'expense')
    .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
    .filter((r) => r.parsed && r.parsed.y <= currentYear + 1);
  const gastosAnio = gastosFlujo.filter((r) => r.parsed!.y === currentYear);
  const poolGastos = gastosAnio.length > 0 ? gastosAnio : gastosFlujo;
  const ultimoGasto = poolGastos.length
    ? poolGastos.reduce((best, cur) =>
        cur.parsed!.key >= best.parsed!.key ? cur : best
      )
    : null;

  let efectivoSyncedAt: string | null = null;
  for (const r of [...saldosEfectivo, ...gastosFlujo]) {
    const at = r.created_at;
    if (!at) continue;
    if (!efectivoSyncedAt || at > efectivoSyncedAt) efectivoSyncedAt = at;
  }

  // Fecha mostrada: último gasto; fallback al día del saldo si no hay movs.
  const efectivoFecha =
    ultimoGasto?.date ?? saldoEfectivoHoy?.date ?? null;

  const todayIso = todayCdmxIso();
  const pickedIso = efectivoFecha ? efectivoFecha.slice(0, 10) : null;
  const efectivoStale = Boolean(pickedIso && pickedIso < todayIso);

  // Manual override wins over Excel presupuesto_saldos
  const bancosManual = pickBancosFromSource(records, SOURCE_SALDOS_BANCOS_MANUAL, true);
  const bancosPresupuesto = pickBancosFromSource(records, SOURCE_SALDOS_PRESUPUESTO, false);
  const bancosPick = bancosManual ?? bancosPresupuesto;

  const mifel = bancosPick?.mifel ?? 0;
  const bbva = bancosPick?.bbva ?? 0;
  const bancos = moneyCents(mifel + bbva);
  const efectivo = saldoEfectivoHoy ? moneyAmount(saldoEfectivoHoy.amount) : null;

  const cxpRows = records.filter((r) => r.source_file === 'cxp_por_pagar');
  const totales = cxpRows.filter((r) => r.category === 'Cuentas Por Pagar');
  const prog = cxpRows.filter((r) => r.category === 'CXP Pagos Programados');
  const prov = cxpRows.filter((r) => r.category === 'CXP Proveedores');
  const serv = cxpRows.filter((r) => r.category === 'CXP Servicios');

  const latest = (rows: FinancialRecord[]) =>
    rows.length ? rows.reduce((best, cur) => (cur.date > best.date ? cur : best)) : null;

  const totalRow = latest(totales);
  const progRow = latest(prog);
  const provRow = latest(prov);
  const servRow = latest(serv);

  const cxpTotal = totalRow ? moneyAmount(totalRow.amount) : null;
  const programado = progRow
    ? moneyAmount(progRow.amount)
    : (provRow ? moneyAmount(provRow.amount) : 0) + (servRow ? moneyAmount(servRow.amount) : 0);
  const cxpProgramado = totalRow || progRow || provRow || servRow ? programado : null;
  const cxpSaldo = cxpTotal != null ? Math.max(0, cxpTotal - programado) : null;

  let cxpSyncedAt: string | null = null;
  for (const r of cxpRows) {
    const at = r.created_at;
    if (!at) continue;
    if (!cxpSyncedAt || at > cxpSyncedAt) cxpSyncedAt = at;
  }

  return {
    efectivo,
    efectivoFecha,
    efectivoSyncedAt,
    efectivoStale,
    mifel,
    bbva,
    bancos,
    bancosFecha: bancosPick?.fecha ?? null,
    bancosFuente: bancosManual ? 'manual' : bancosPresupuesto ? 'presupuesto' : null,
    totalDisponible: totalEfectivoMasBancos(efectivo, bancos),
    cxpTotal,
    cxpProgramado,
    cxpSaldo,
    cxpSyncedAt,
  };
}
