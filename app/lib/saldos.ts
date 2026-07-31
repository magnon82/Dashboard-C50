import { parseIsoDate, type FinancialRecord } from '@/app/lib/ventas-semana';

export interface SaldosAlDiaData {
  efectivo: number | null;
  efectivoFecha: string | null;
  mifel: number;
  bbva: number;
  bancos: number;
  totalDisponible: number;
  cxpTotal: number | null;
  cxpProgramado: number | null;
  cxpSaldo: number | null;
}

function moneyAmount(v: unknown): number {
  return Number(v || 0);
}

export function buildSaldosAlDia(records: FinancialRecord[]): SaldosAlDiaData {
  const currentYear = new Date().getFullYear();

  const saldosEfectivo = records
    .filter((r) => r.source_file === 'flujo_efectivo_saldo' && r.category === 'Saldo Efectivo')
    .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
    .filter((r) => r.parsed && r.parsed.y <= currentYear + 1);

  const delAnio = saldosEfectivo.filter((r) => r.parsed!.y === currentYear);
  const poolEfectivo = delAnio.length > 0 ? delAnio : saldosEfectivo;
  const saldoEfectivoHoy = poolEfectivo.length
    ? poolEfectivo.reduce((best, cur) => (cur.parsed!.key > best.parsed!.key ? cur : best))
    : null;

  const saldosBancos = records
    .filter((r) => r.source_file === 'presupuesto_saldos')
    .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
    .filter((r) => r.parsed)
    .sort((a, b) => (a.parsed!.key < b.parsed!.key ? -1 : 1));

  let mifel = 0;
  let bbva = 0;
  if (saldosBancos.length) {
    const ultimaFecha = saldosBancos[saldosBancos.length - 1].parsed!;
    const delMes = saldosBancos.filter(
      (r) => r.parsed!.y === ultimaFecha.y && r.parsed!.m === ultimaFecha.m
    );
    mifel = moneyAmount(delMes.find((r) => r.category === 'Saldo Mifel')?.amount);
    bbva = moneyAmount(delMes.find((r) => r.category === 'Saldo BBVA')?.amount);
  }

  const bancos = mifel + bbva;
  const efectivo = saldoEfectivoHoy ? moneyAmount(saldoEfectivoHoy.amount) : null;

  const totales = records.filter(
    (r) => r.source_file === 'cxp_por_pagar' && r.category === 'Cuentas Por Pagar'
  );
  const prog = records.filter(
    (r) => r.source_file === 'cxp_por_pagar' && r.category === 'CXP Pagos Programados'
  );
  const prov = records.filter(
    (r) => r.source_file === 'cxp_por_pagar' && r.category === 'CXP Proveedores'
  );
  const serv = records.filter(
    (r) => r.source_file === 'cxp_por_pagar' && r.category === 'CXP Servicios'
  );

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

  return {
    efectivo,
    efectivoFecha: saldoEfectivoHoy?.date ?? null,
    mifel,
    bbva,
    bancos,
    totalDisponible: (efectivo ?? 0) + bancos,
    cxpTotal,
    cxpProgramado,
    cxpSaldo,
  };
}
