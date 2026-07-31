import { parseIsoDate, toIsoLocal, type FinancialRecord } from '@/app/lib/ventas-semana';

export interface RubroRow {
  rubro: string;
  efectivo: number;
  mifel: number;
  bbva: number;
  presupuesto: number;
  real: number;
  pct: number | null;
  parent: string | null;
  isParent: boolean;
  sort: number;
}

export interface PresupuestoMeta {
  venta: number;
  efe: number;
  ba: number;
}

export interface SemanaBancos {
  week: number;
  inicial: number;
  ingresos: number;
  pagos_mifel: number;
  comisiones: number;
  pagos_bbva: number;
  /** Salidas de anticipos/inversiones (col N). Entradas van dentro de ingresos. */
  inversiones: number;
  suma_ingreso: number;
  suma_gasto: number;
  total: number;
}

/** Catálogo fijo: solo cocina/barra son padres colapsables; sin rubros duplicados. */
export const RUBRO_CATALOG: Array<{
  rubro: string;
  parent: string | null;
  isParent: boolean;
}> = [
  { rubro: 'INSUMOS DE COCINA', parent: null, isParent: true },
  { rubro: 'Frutas y Verduras', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'Proteinas', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'Abarrotes', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'Lacteos', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'Panes, tortillas, Postres', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'Agua', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'INSUMOS DE BARRA', parent: null, isParent: true },
  { rubro: 'Destilados y vinos', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Cervezas', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Abarrotes', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Café', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Refrescos, aguas y hielo', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Frutas y verduras', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'COMIDA PERSONAL', parent: null, isParent: false },
  { rubro: 'LIMPIEZA Y BAÑOS', parent: null, isParent: false },
  { rubro: 'PAPELERIA', parent: null, isParent: false },
  { rubro: 'MANTENIMIENTO', parent: null, isParent: false },
  { rubro: 'DISEÑO Y PUBLICIDAD', parent: null, isParent: false },
  { rubro: 'OTROS', parent: null, isParent: false },
  { rubro: 'EQUIPO', parent: null, isParent: false },
  { rubro: 'CRISTALERIA', parent: null, isParent: false },
  { rubro: 'AUDITORIAS', parent: null, isParent: false },
  { rubro: 'RENTA', parent: null, isParent: false },
  { rubro: 'AGUA', parent: null, isParent: false },
  { rubro: 'GAS', parent: null, isParent: false },
  { rubro: 'LUZ', parent: null, isParent: false },
  { rubro: 'TELEFONO', parent: null, isParent: false },
  { rubro: 'LAVANDERIA', parent: null, isParent: false },
  { rubro: 'ALARMA', parent: null, isParent: false },
  { rubro: 'MATERIAS PRIMAS', parent: null, isParent: false },
  { rubro: 'GASOLINA Y TAXIS', parent: null, isParent: false },
  { rubro: 'LICENCIAS Y AFILIACIONES', parent: null, isParent: false },
  { rubro: 'AUDIO / SPOTIFY', parent: null, isParent: false },
  { rubro: 'GAS CALENTADORES', parent: null, isParent: false },
  { rubro: 'CARBON', parent: null, isParent: false },
  { rubro: 'CONTADOR', parent: null, isParent: false },
  { rubro: 'COMISIONES BANCARIAS', parent: null, isParent: false },
  { rubro: 'FINIQUITOS Y RECLUTAMIENTO', parent: null, isParent: false },
  { rubro: 'NOMINA OPERATIVA Y BONOS', parent: null, isParent: false },
  { rubro: 'NOMINA ADMINISTRATIVA Y BONOS', parent: null, isParent: false },
  { rubro: 'IMSS', parent: null, isParent: false },
  { rubro: 'IMPUESTOS', parent: null, isParent: false },
];

function parseJson<T>(raw: string | object | null | undefined): T | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

/** Normaliza nombre para matching (acentos, mayúsculas, espacios). */
export function normRubroKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function catalogKey(rubro: string, parent: string | null): string {
  return `${parent || ''}::${normRubroKey(rubro)}`;
}

type Accum = {
  efectivo: number;
  mifel: number;
  bbva: number;
  presupuesto: number;
  real: number;
  pct: number | null;
};

function emptyAccum(): Accum {
  return { efectivo: 0, mifel: 0, bbva: 0, presupuesto: 0, real: 0, pct: null };
}

function addAccum(a: Accum, b: Partial<Accum>): Accum {
  return {
    efectivo: a.efectivo + Number(b.efectivo || 0),
    mifel: a.mifel + Number(b.mifel || 0),
    bbva: a.bbva + Number(b.bbva || 0),
    presupuesto: a.presupuesto + Number(b.presupuesto || 0),
    real: a.real + Number(b.real || 0),
    pct: b.pct != null ? Number(b.pct) : a.pct,
  };
}

/**
 * Arma la tabla de rubros en orden fijo, fusionando duplicados del Excel
 * (misma categoría repartida en columnas Efectivo/Mifel/BBVA).
 */
export function buildPresupuestoRubros(
  records: FinancialRecord[],
  year: number,
  month: number
): { rows: RubroRow[]; meta: PresupuestoMeta } {
  const byKey = new Map<string, Accum>();
  let meta: PresupuestoMeta = { venta: 0, efe: 0, ba: 0 };

  // Estado de sección al recorrer filas crudas por sort
  const raw: Array<{
    rubro: string;
    parent: string | null;
    isParent: boolean;
    sort: number;
    acc: Accum;
  }> = [];

  for (const r of records) {
    if (r.source_file !== 'presupuesto_rubro') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<
      RubroRow & { meta?: boolean; venta?: number; efe?: number; ba?: number }
    >(r.description);
    if (!data) continue;
    if (data.meta) {
      meta = {
        venta: Number(data.venta || 0),
        efe: Number(data.efe || 0),
        ba: Number(data.ba || 0),
      };
      continue;
    }
    raw.push({
      rubro: String(data.rubro || r.category || ''),
      parent: data.parent ?? null,
      isParent: Boolean(data.isParent),
      sort: Number(data.sort || 0),
      acc: {
        efectivo: Number(data.efectivo || 0),
        mifel: Number(data.mifel || 0),
        bbva: Number(data.bbva || 0),
        presupuesto: Number(data.presupuesto || 0),
        real: Number(data.real || 0),
        pct: data.pct == null ? null : Number(data.pct),
      },
    });
  }

  raw.sort((a, b) => a.sort - b.sort);

  // Inferir / respetar padre (no pisar parent ya marcado por ingest)
  let section: string | null = null;
  const cocinaKids = new Set([
    'FRUTAS Y VERDURAS',
    'PROTEINAS',
    'ABARROTES',
    'LACTEOS',
    'PANES TORTILLAS POSTRES',
    'AGUA',
  ]);
  const barraKids = new Set([
    'DESTILADOS Y VINOS',
    'CERVEZAS',
    'ABARROTES',
    'CAFE',
    'REFRESCOS AGUAS Y HIELO',
    'FRUTAS Y VERDURAS',
  ]);

  for (const row of raw) {
    const upper = normRubroKey(row.rubro);

    if (upper === 'INSUMOS DE COCINA') {
      section = 'INSUMOS DE COCINA';
      row.isParent = true;
      row.parent = null;
    } else if (upper === 'INSUMOS DE BARRA') {
      section = 'INSUMOS DE BARRA';
      row.isParent = true;
      row.parent = null;
    } else if (row.parent === 'INSUMOS DE COCINA') {
      row.isParent = false;
      section = 'INSUMOS DE COCINA';
    } else if (row.parent === 'INSUMOS DE BARRA') {
      row.isParent = false;
      section = 'INSUMOS DE BARRA';
    } else if (section === 'INSUMOS DE COCINA' && cocinaKids.has(upper)) {
      row.parent = 'INSUMOS DE COCINA';
      row.isParent = false;
    } else if (section === 'INSUMOS DE BARRA' && barraKids.has(upper)) {
      row.parent = 'INSUMOS DE BARRA';
      row.isParent = false;
    } else {
      section = null;
      row.parent = null;
      row.isParent = false;
    }

    const key = catalogKey(row.rubro, row.parent);
    byKey.set(key, addAccum(byKey.get(key) || emptyAccum(), row.acc));
  }

  // También mapear por nombre sin padre (fallback) para top-level
  const byNameOnly = new Map<string, Accum>();
  for (const [key, acc] of byKey) {
    const name = key.split('::')[1];
    byNameOnly.set(name, addAccum(byNameOnly.get(name) || emptyAccum(), acc));
  }

  const rows: RubroRow[] = RUBRO_CATALOG.map((entry, sort) => {
    const key = catalogKey(entry.rubro, entry.parent);
    let acc = byKey.get(key);

    if (!acc && entry.isParent) {
      acc = byNameOnly.get(normRubroKey(entry.rubro));
    }

    const a = acc || emptyAccum();
    let real = a.real;
    if (!real && (a.efectivo || a.mifel || a.bbva)) {
      real = a.efectivo + a.mifel + a.bbva;
    }

    return {
      rubro: entry.rubro,
      parent: entry.parent,
      isParent: entry.isParent,
      sort,
      efectivo: a.efectivo,
      mifel: a.mifel,
      bbva: a.bbva,
      presupuesto: a.presupuesto,
      real,
      pct: a.pct,
    };
  });

  // Recalcular real de padres como suma de hijos (evita desfase)
  for (const parentName of ['INSUMOS DE COCINA', 'INSUMOS DE BARRA']) {
    const parent = rows.find((r) => r.isParent && r.rubro === parentName);
    if (!parent) continue;
    const kids = rows.filter((r) => r.parent === parentName);
    const sumE = kids.reduce((s, k) => s + k.efectivo, 0);
    const sumM = kids.reduce((s, k) => s + k.mifel, 0);
    const sumB = kids.reduce((s, k) => s + k.bbva, 0);
    const sumR = kids.reduce((s, k) => s + k.real, 0);
    if (sumE || sumM || sumB) {
      parent.efectivo = sumE;
      parent.mifel = sumM;
      parent.bbva = sumB;
    }
    if (sumR) parent.real = sumR;
  }

  return { rows, meta };
}

function firstMondayOnOrAfter(year: number, month: number, day: number): Date {
  const d = new Date(year, month - 1, day, 12, 0, 0);
  const dow = d.getDay();
  const add = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  d.setDate(d.getDate() + add);
  return d;
}

function presupuestoWeekCloseTuesday(year: number, month: number, week: number): Date {
  const monday = firstMondayOnOrAfter(year, month, 1);
  monday.setDate(monday.getDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const tuesday = new Date(sunday);
  tuesday.setDate(tuesday.getDate() + 2);
  tuesday.setHours(23, 59, 59, 999);
  return tuesday;
}

/** Meses cerrados: todas las semanas. Mes actual: solo tras martes de cierre. */
function presupuestoWeekFullyElapsed(
  year: number,
  month: number,
  week: number,
  todayIso: string
): boolean {
  const today = parseIsoDate(todayIso);
  if (!today) return true;

  const selected = year * 12 + month;
  const current = today.y * 12 + today.m;
  if (selected < current) return true;
  if (selected > current) return false;

  const closeTue = presupuestoWeekCloseTuesday(year, month, week);
  const todayDate = new Date(today.y, today.m - 1, today.d, 12, 0, 0);
  return todayDate > closeTue;
}

export function buildResumenBancosSemanal(
  records: FinancialRecord[],
  year: number,
  month: number,
  todayIso?: string
): SemanaBancos[] {
  const today = todayIso || toIsoLocal(new Date());
  const weeks: SemanaBancos[] = [];
  for (const r of records) {
    if (r.source_file !== 'presupuesto_semana') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<SemanaBancos>(r.description);
    if (!data || data.week == null || Number(data.week) < 1) continue;
    if (!presupuestoWeekFullyElapsed(year, month, Number(data.week), today)) continue;
    const raw = data as SemanaBancos & {
      inversiones_entrada?: number;
      inversiones_salida?: number;
    };
    // Compat: payloads viejos con entrada/salida separadas
    const ingresosBase = Number(raw.ingresos || 0);
    const entradaExtra =
      raw.inversiones_entrada != null && raw.inversiones_salida != null
        ? Number(raw.inversiones_entrada)
        : 0;
    const inversiones =
      raw.inversiones_salida != null
        ? Number(raw.inversiones_salida)
        : Number(raw.inversiones || 0);
    weeks.push({
      week: Number(data.week),
      inicial: Number(data.inicial || 0),
      ingresos: ingresosBase + entradaExtra,
      pagos_mifel: Number(data.pagos_mifel || 0),
      comisiones: Number(data.comisiones || 0),
      pagos_bbva: Number(data.pagos_bbva || 0),
      inversiones,
      suma_ingreso: Number(data.suma_ingreso || 0),
      suma_gasto: Number(data.suma_gasto || 0),
      total: Number(data.total || 0),
    });
  }
  return weeks.sort((a, b) => a.week - b.week);
}

export function availablePresupuestoMonths(records: FinancialRecord[]): Array<{
  year: number;
  month: number;
}> {
  const set = new Set<string>();
  for (const r of records) {
    if (
      r.source_file !== 'presupuesto_rubro' &&
      r.source_file !== 'presupuesto_semana'
    ) {
      continue;
    }
    const p = parseIsoDate(r.date);
    if (!p) continue;
    set.add(`${p.y}-${p.m}`);
  }
  return Array.from(set)
    .map((k) => {
      const [y, m] = k.split('-').map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);
}
