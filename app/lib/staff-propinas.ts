/** Tasas de repartición de propinas (% sobre venta). Fuente: hoja operativa C50. */

export type TipRoleId =
  | 'gerente'
  | 'capitan'
  | 'cocina'
  | 'meseros'
  | 'garrotero'
  | 'barra';

export type TipPeriodMode = 'hoy' | 'semana' | 'rango';

export interface TipRoleRate {
  id: TipRoleId;
  label: string;
  /** % sobre venta WI / C50 (fracción 0–1) */
  wi: number;
  /** % sobre venta Eventos (fracción 0–1) */
  eventos: number;
  note?: string;
}

/** WI 10% total · Eventos 12.5% total (cocina unificada 2.3% / 3%). */
export const TIP_ROLES: TipRoleRate[] = [
  { id: 'gerente', label: 'Gerente', wi: 0.01, eventos: 0.01 },
  { id: 'capitan', label: 'Capitán', wi: 0.007, eventos: 0.01 },
  {
    id: 'cocina',
    label: 'Cocina',
    wi: 0.023,
    eventos: 0.03,
    note: 'Pool cocina completo (WI 2.3% · Eventos 3%) ÷ personas',
  },
  { id: 'meseros', label: 'Meseros', wi: 0.04, eventos: 0.055 },
  { id: 'garrotero', label: 'Garrotero / runner', wi: 0.01, eventos: 0.01 },
  { id: 'barra', label: 'Barra', wi: 0.01, eventos: 0.01 },
];

export const TIP_TOTAL_WI = 0.1;
export const TIP_TOTAL_EVENTOS = 0.125;

export type TipHeadcount = Record<TipRoleId, number>;

/** Defaults operativos: Gerente 1 · Capitán 1 (editable). */
export const DEFAULT_HEADCOUNT: TipHeadcount = {
  gerente: 1,
  capitan: 1,
  cocina: 0,
  meseros: 0,
  garrotero: 0,
  barra: 0,
};

/** @deprecated Prefer DEFAULT_HEADCOUNT */
export const EMPTY_HEADCOUNT: TipHeadcount = { ...DEFAULT_HEADCOUNT };

/**
 * Normaliza headcount guardado.
 * Si existe `cocina`, se respeta; si no, cocina = chef + cocina_staff (legacy).
 */
export function normalizeTipHeadcount(
  raw: Partial<Record<string, unknown>> | null | undefined
): TipHeadcount {
  const base = { ...DEFAULT_HEADCOUNT };
  if (!raw || typeof raw !== 'object') return base;

  const asCount = (v: unknown): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  };

  for (const role of TIP_ROLES) {
    if (role.id === 'cocina') continue;
    const n = asCount(raw[role.id]);
    if (n != null) base[role.id] = n;
  }

  const cocinaDirect = asCount(raw.cocina);
  if (cocinaDirect != null) {
    base.cocina = cocinaDirect;
  } else {
    const legacyChef = asCount(raw.chef) ?? 0;
    const legacyStaff = asCount(raw.cocina_staff) ?? 0;
    base.cocina = legacyChef + legacyStaff;
  }

  return base;
}

export interface TipRoleResult {
  id: TipRoleId;
  label: string;
  rateWi: number;
  rateEventos: number;
  poolWi: number;
  poolEventos: number;
  poolTotal: number;
  headcount: number;
  perPerson: number | null;
  note?: string;
}

export interface TipCalcResult {
  ventasWi: number;
  ventasEventos: number;
  poolWiTotal: number;
  poolEventosTotal: number;
  poolGrandTotal: number;
  roles: TipRoleResult[];
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcTipPools(
  ventasWi: number,
  ventasEventos: number,
  headcount: TipHeadcount
): TipCalcResult {
  const wi = Math.max(0, Number(ventasWi) || 0);
  const ev = Math.max(0, Number(ventasEventos) || 0);

  const roles: TipRoleResult[] = TIP_ROLES.map((role) => {
    const poolWi = roundMoney(wi * role.wi);
    const poolEventos = roundMoney(ev * role.eventos);
    const poolTotal = roundMoney(poolWi + poolEventos);
    const n = Math.max(0, Math.floor(Number(headcount[role.id]) || 0));
    return {
      id: role.id,
      label: role.label,
      rateWi: role.wi,
      rateEventos: role.eventos,
      poolWi,
      poolEventos,
      poolTotal,
      headcount: n,
      perPerson: n > 0 ? roundMoney(poolTotal / n) : null,
      note: role.note,
    };
  });

  return {
    ventasWi: roundMoney(wi),
    ventasEventos: roundMoney(ev),
    poolWiTotal: roundMoney(roles.reduce((s, r) => s + r.poolWi, 0)),
    poolEventosTotal: roundMoney(roles.reduce((s, r) => s + r.poolEventos, 0)),
    poolGrandTotal: roundMoney(roles.reduce((s, r) => s + r.poolTotal, 0)),
    roles,
  };
}

/** Lunes (ISO) de la semana que contiene `iso` (YYYY-MM-DD), zona lógica UTC-noon. */
export function weekBoundsFromIso(iso: string): { from: string; to: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const mid = new Date(Date.UTC(y, m - 1, d, 12));
  const day = mid.getUTCDay(); // 0=dom … 6=sáb
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(mid);
  monday.setUTCDate(mid.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

export function formatIsoDateEs(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const STAFF_PROPINAS_LS_KEY = 'staff_propinas_calc_v3';

export interface StaffPropinasStored {
  headcount: TipHeadcount;
  /** Solo override manual del día en curso (CDMX). */
  manualHoy?: {
    date: string;
    ventasWi: string;
    ventasEventos: string;
  } | null;
}

export type TipSalesDaySource = 'corte' | 'sistema' | 'ninguno';

export interface TipSalesDay {
  date: string;
  ventasWi: number;
  ventasEventos: number;
  /** corte = staff_rpt; sistema = Infocaja − Eventos; ninguno = sin dato */
  source: TipSalesDaySource;
  label: string;
}

export interface TipSalesRangeResult {
  from: string;
  to: string;
  today: string;
  ventasWi: number;
  ventasEventos: number;
  daysWithData: number;
  dayCount: number;
  primarySource: TipSalesDaySource | 'mixto';
  sourceCounts: Record<TipSalesDaySource, number>;
  days: TipSalesDay[];
  rptError: string | null;
  financialError: string | null;
}

/** Lista YYYY-MM-DD inclusive (UTC-noon, sin DST). */
export function eachIsoDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return out;
  const cur = new Date(Date.UTC(fy, fm - 1, fd, 12));
  const end = new Date(Date.UTC(ty, tm - 1, td, 12));
  if (cur > end) return out;
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Resuelve WI / Eventos de un día.
 * Prioridad: cierre staff_rpt (corte) → Infocaja Venta Total + Eventos financieros.
 * WI sistema = max(0, Infocaja Venta Total − Eventos).
 */
export function resolveTipSalesDay(
  date: string,
  opts: {
    rpt: { wi: number; eventos: number } | null;
    infocajaVentaTotal: number | null;
    eventosFinancial: number | null;
  }
): TipSalesDay {
  if (opts.rpt) {
    return {
      date,
      ventasWi: roundMoney(Math.max(0, opts.rpt.wi)),
      ventasEventos: roundMoney(Math.max(0, opts.rpt.eventos)),
      source: 'corte',
      label: 'Corte del día',
    };
  }
  const hasInfo =
    opts.infocajaVentaTotal != null && Number.isFinite(opts.infocajaVentaTotal);
  const hasEv =
    opts.eventosFinancial != null && Number.isFinite(opts.eventosFinancial);
  if (hasInfo || hasEv) {
    const total = hasInfo ? Number(opts.infocajaVentaTotal) : 0;
    const ev = hasEv ? Number(opts.eventosFinancial) : 0;
    return {
      date,
      ventasWi: roundMoney(Math.max(0, total - ev)),
      ventasEventos: roundMoney(Math.max(0, ev)),
      source: 'sistema',
      label: hasInfo
        ? 'Infocaja + Eventos'
        : 'Eventos (sin Infocaja)',
    };
  }
  return {
    date,
    ventasWi: 0,
    ventasEventos: 0,
    source: 'ninguno',
    label: 'Sin dato',
  };
}

export function tipSalesSourceNote(
  primary: TipSalesDaySource | 'mixto',
  counts: Record<TipSalesDaySource, number>
): string {
  if (primary === 'corte') {
    return counts.corte === 1
      ? 'Desde sistema · Corte del día'
      : `Desde sistema · Corte (${counts.corte} días)`;
  }
  if (primary === 'sistema') {
    return counts.sistema === 1
      ? 'Desde sistema · Infocaja / Eventos'
      : `Desde sistema · Infocaja / Eventos (${counts.sistema} días)`;
  }
  if (primary === 'mixto') {
    return `Desde sistema · Corte ${counts.corte} · Infocaja ${counts.sistema}`;
  }
  return 'Sin ventas registradas en el periodo';
}
