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

export const SOURCE_AJUSTE = 'presupuesto_ajuste';

/** Padres colapsables en la UI. */
export const COLLAPSIBLE_PARENTS = [
  'INSUMOS DE COCINA',
  'INSUMOS DE BARRA',
  'SERVICIOS',
] as const;

export type CollapsibleParent = (typeof COLLAPSIBLE_PARENTS)[number];

/** Metadatos de rubros editables por el admin (ajustes mensuales). */
export type AdminEditableBudget = {
  rubro: string;
  /** Hijo de catálogo (p. ej. SERVICIOS → Agua). */
  parent?: string | null;
  /** Monto fijo de fórmula cuando aplica. */
  defaultPresupuesto?: number;
  /** Tarifa semanal × N semanas SEM del mes (Lavandería / Carbón). */
  weeklyRate?: number;
  /** Fracción de venta del mes (NÓMINA = 0.25). */
  ventaPct?: number;
  note?: string;
};

/**
 * Rubros cuyo presupuesto el admin puede editar por mes.
 * Incluye fijos de fórmula, semanales, % venta y top-level / servicios del Excel.
 */
export const ADMIN_EDITABLE_BUDGETS: AdminEditableBudget[] = [
  // Fijos / % venta (orden ~ catálogo)
  { rubro: 'RENTA', defaultPresupuesto: 44330 },
  { rubro: 'EQUIPO', defaultPresupuesto: 5000 },
  { rubro: 'CRISTALERIA', defaultPresupuesto: 500 },
  { rubro: 'LICENCIAS Y AFILIACIONES', defaultPresupuesto: 3500 },
  { rubro: 'FINIQUITOS Y RECLUTAMIENTO', defaultPresupuesto: 0 },
  {
    rubro: 'NÓMINA',
    ventaPct: 0.25,
    note: '25% de la venta del mes (override opcional)',
  },
  { rubro: 'IMSS', defaultPresupuesto: 16765.12 },
  { rubro: 'IMPUESTOS', defaultPresupuesto: 6000 },
  // Semanales (hijos de catálogo)
  {
    rubro: 'LAVANDERIA',
    parent: 'SERVICIOS',
    weeklyRate: 2400,
    note: '$2,400 × N semanas SEM',
  },
  {
    rubro: 'CARBON',
    parent: 'INSUMOS DE COCINA',
    weeklyRate: 1500,
    note: '$1,500 × N semanas SEM',
  },
  // SERVICIOS hijos
  { rubro: 'Agua', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  { rubro: 'Gas', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  { rubro: 'Luz', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  { rubro: 'Teléfono', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  { rubro: 'CONTADOR', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  {
    rubro: 'DISEÑO Y PUBLICIDAD',
    parent: 'SERVICIOS',
    note: 'Presupuesto Excel · SERVICIOS',
  },
  { rubro: 'Alarma', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  { rubro: 'AUDITORIAS', parent: 'SERVICIOS', note: 'Presupuesto Excel · SERVICIOS' },
  {
    rubro: 'GAS CALENTADORES',
    parent: 'SERVICIOS',
    note: 'Presupuesto Excel · SERVICIOS',
  },
  {
    rubro: 'MATERIAS PRIMAS',
    parent: 'SERVICIOS',
    note: 'Presupuesto Excel · SERVICIOS',
  },
  // Otros (Excel) — orden ~ catálogo
  { rubro: 'COMIDA PERSONAL' },
  { rubro: 'MANTENIMIENTO' },
  { rubro: 'PAPELERIA' },
  { rubro: 'LIMPIEZA Y BAÑOS' },
  { rubro: 'GASOLINA Y TAXIS' },
  { rubro: 'OTROS' },
  { rubro: 'COMISIONES BANCARIAS' },
];

/** Clave estable para matching admin (incluye padre si aplica). */
export function adminBudgetKey(rubro: string, parent?: string | null): string {
  const p = parent ? normRubroKey(parent) : '';
  return `${p}::${normRubroKey(rubro)}`;
}

export function isAdminEditableRubro(rubro: string, parent?: string | null): boolean {
  return Boolean(findAdminEditable(rubro, parent));
}

export function findAdminEditable(
  rubro: string,
  parent?: string | null
): AdminEditableBudget | undefined {
  const key = adminBudgetKey(rubro, parent);
  const exact = ADMIN_EDITABLE_BUDGETS.find(
    (b) => adminBudgetKey(b.rubro, b.parent ?? null) === key
  );
  if (exact) return exact;
  // Compat: overrides / lookups sin padre → match por nombre de rubro
  if (!parent) {
    return ADMIN_EDITABLE_BUDGETS.find(
      (b) => normRubroKey(b.rubro) === normRubroKey(rubro)
    );
  }
  return undefined;
}

/** Catálogo fijo: cocina / barra / servicios son padres colapsables. */
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
  { rubro: 'CARBON', parent: 'INSUMOS DE COCINA', isParent: false },
  { rubro: 'INSUMOS DE BARRA', parent: null, isParent: true },
  { rubro: 'Destilados y vinos', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Cervezas', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Abarrotes', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Café', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Refrescos, aguas y hielo', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'Frutas y verduras', parent: 'INSUMOS DE BARRA', isParent: false },
  { rubro: 'SERVICIOS', parent: null, isParent: true },
  { rubro: 'LAVANDERIA', parent: 'SERVICIOS', isParent: false },
  { rubro: 'Agua', parent: 'SERVICIOS', isParent: false },
  { rubro: 'Gas', parent: 'SERVICIOS', isParent: false },
  { rubro: 'Luz', parent: 'SERVICIOS', isParent: false },
  { rubro: 'Teléfono', parent: 'SERVICIOS', isParent: false },
  { rubro: 'CONTADOR', parent: 'SERVICIOS', isParent: false },
  { rubro: 'DISEÑO Y PUBLICIDAD', parent: 'SERVICIOS', isParent: false },
  { rubro: 'Alarma', parent: 'SERVICIOS', isParent: false },
  { rubro: 'AUDITORIAS', parent: 'SERVICIOS', isParent: false },
  { rubro: 'GAS CALENTADORES', parent: 'SERVICIOS', isParent: false },
  { rubro: 'MATERIAS PRIMAS', parent: 'SERVICIOS', isParent: false },
  { rubro: 'COMIDA PERSONAL', parent: null, isParent: false },
  { rubro: 'RENTA', parent: null, isParent: false },
  { rubro: 'MANTENIMIENTO', parent: null, isParent: false },
  { rubro: 'EQUIPO', parent: null, isParent: false },
  { rubro: 'CRISTALERIA', parent: null, isParent: false },
  { rubro: 'PAPELERIA', parent: null, isParent: false },
  { rubro: 'LIMPIEZA Y BAÑOS', parent: null, isParent: false },
  { rubro: 'GASOLINA Y TAXIS', parent: null, isParent: false },
  { rubro: 'OTROS', parent: null, isParent: false },
  { rubro: 'LICENCIAS Y AFILIACIONES', parent: null, isParent: false },
  { rubro: 'COMISIONES BANCARIAS', parent: null, isParent: false },
  { rubro: 'FINIQUITOS Y RECLUTAMIENTO', parent: null, isParent: false },
  { rubro: 'NÓMINA', parent: null, isParent: false },
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

/** Semanas del Excel (todas las SEM n ingeridas), no solo las “elapsed”. */
export function countPresupuestoWeeks(
  records: FinancialRecord[],
  year: number,
  month: number
): number {
  const weeks = new Set<number>();
  for (const r of records) {
    if (r.source_file !== 'presupuesto_semana') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<{ week?: number }>(r.description);
    if (!data || data.week == null || Number(data.week) < 1) continue;
    weeks.add(Number(data.week));
  }
  return weeks.size;
}

function findRow(rows: RubroRow[], rubro: string, parent: string | null = null): RubroRow | undefined {
  const key = normRubroKey(rubro);
  return rows.find(
    (r) => normRubroKey(r.rubro) === key && (r.parent || null) === parent
  );
}

/** Presupuesto por fórmula / default (sin override admin). */
export function formulaPresupuestoFor(
  rubro: string,
  meta: PresupuestoMeta,
  weekCount: number,
  excelPresupuesto = 0,
  parent?: string | null
): number {
  const entry = findAdminEditable(rubro, parent);
  const n = weekCount > 0 ? weekCount : 0;
  if (entry?.weeklyRate != null) return entry.weeklyRate * n;
  if (entry?.ventaPct != null) {
    return meta.venta > 0 ? meta.venta * entry.ventaPct : 0;
  }
  if (entry?.defaultPresupuesto != null) return entry.defaultPresupuesto;

  const key = normRubroKey(rubro);
  if (key === 'RENTA') return 44330;
  if (key === 'CRISTALERIA') return 500;
  if (key === 'IMSS') return 16765.12;
  if (key === 'EQUIPO') return 5000;
  if (key === 'IMPUESTOS') return 6000;
  if (key === 'LICENCIAS Y AFILIACIONES') return 3500;
  if (key === 'LAVANDERIA') return 2400 * n;
  if (key === 'CARBON') return 1500 * n;
  if (key === 'FINIQUITOS Y RECLUTAMIENTO') return 0;
  if (key === 'NOMINA') return meta.venta > 0 ? meta.venta * 0.25 : 0;
  return excelPresupuesto;
}

function applyBudgetOverrides(
  rows: RubroRow[],
  meta: PresupuestoMeta,
  weekCount: number,
  /** Clave = adminBudgetKey(rubro, parent) */
  adminOverrides: Map<string, number>
): void {
  const n = weekCount > 0 ? weekCount : 0;
  const setPresu = (rubro: string, value: number, parent: string | null = null) => {
    const row = findRow(rows, rubro, parent);
    if (row) row.presupuesto = value;
  };

  setPresu('RENTA', 44330);
  setPresu('CRISTALERIA', 500);
  setPresu('IMSS', 16765.12);
  setPresu('EQUIPO', 5000);
  setPresu('IMPUESTOS', 6000);
  setPresu('LICENCIAS Y AFILIACIONES', 3500);
  setPresu('LAVANDERIA', 2400 * n, 'SERVICIOS');
  setPresu('CARBON', 1500 * n, 'INSUMOS DE COCINA');
  setPresu('FINIQUITOS Y RECLUTAMIENTO', 0);

  const nomina = findRow(rows, 'NÓMINA');
  if (nomina) {
    nomina.presupuesto = meta.venta > 0 ? meta.venta * 0.25 : 0;
  }

  // Admin overrides win for that month (top-level o hijo de catálogo)
  for (const [overrideKey, amount] of adminOverrides) {
    const row = rows.find((r) => {
      if (r.isParent) return false;
      return adminBudgetKey(r.rubro, r.parent) === overrideKey;
    });
    if (row) {
      row.presupuesto = amount;
      continue;
    }
    // Compat: overrides viejos solo con rubro (sin padre) — incluye rubros movidos
    if (overrideKey.startsWith('::')) {
      const rubroOnly = overrideKey.slice(2);
      const match = rows.find(
        (r) => !r.isParent && normRubroKey(r.rubro) === rubroOnly
      );
      if (match) match.presupuesto = amount;
    }
  }
}

function rollupParents(
  rows: RubroRow[],
  parentNames: string[],
  /** Presupuesto Excel del padre antes de sumar hijos (cocina/barra). */
  parentBasePresu?: Map<string, number>
): void {
  for (const parentName of parentNames) {
    const parent = rows.find((r) => r.isParent && r.rubro === parentName);
    if (!parent) continue;
    const kids = rows.filter((r) => r.parent === parentName);
    const sumE = kids.reduce((s, k) => s + k.efectivo, 0);
    const sumM = kids.reduce((s, k) => s + k.mifel, 0);
    const sumB = kids.reduce((s, k) => s + k.bbva, 0);
    const sumR = kids.reduce((s, k) => s + k.real, 0);
    const sumP = kids.reduce((s, k) => s + k.presupuesto, 0);
    if (sumE || sumM || sumB) {
      parent.efectivo = sumE;
      parent.mifel = sumM;
      parent.bbva = sumB;
    }
    if (sumR) parent.real = sumR;
    // SERVICIOS: presupuesto = suma de hijos.
    // Cocina/barra: Excel suele vivir en el padre; sumar presupuestos de hijos
    // (p. ej. CARBON) sin reemplazar la base del padre.
    if (parentName === 'SERVICIOS') {
      if (sumP) parent.presupuesto = sumP;
    } else {
      const base = parentBasePresu?.get(parentName) ?? parent.presupuesto;
      parent.presupuesto = base + sumP;
    }
  }
}

/**
 * Arma la tabla de rubros en orden fijo, fusionando duplicados del Excel
 * (misma categoría repartida en columnas Efectivo/Mifel/BBVA).
 */
export function buildPresupuestoRubros(
  records: FinancialRecord[],
  year: number,
  month: number
): { rows: RubroRow[]; meta: PresupuestoMeta; weekCount: number } {
  const byKey = new Map<string, Accum>();
  let meta: PresupuestoMeta = { venta: 0, efe: 0, ba: 0 };

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

  let section: string | null = null;
  const cocinaKids = new Set([
    'FRUTAS Y VERDURAS',
    'PROTEINAS',
    'ABARROTES',
    'LACTEOS',
    'PANES TORTILLAS POSTRES',
    'AGUA',
    'CARBON',
  ]);
  const barraKids = new Set([
    'DESTILADOS Y VINOS',
    'CERVEZAS',
    'ABARROTES',
    'CAFE',
    'REFRESCOS AGUAS Y HIELO',
    'FRUTAS Y VERDURAS',
  ]);
  const serviciosKids = new Set([
    'LAVANDERIA',
    'AGUA',
    'GAS',
    'LUZ',
    'TELEFONO',
    'CONTADOR',
    'DISENO Y PUBLICIDAD',
    'ALARMA',
    'AUDITORIAS',
    'GAS CALENTADORES',
    'MATERIAS PRIMAS',
  ]);
  const nominaKeys = new Set([
    'NOMINA OPERATIVA Y BONOS',
    'NOMINA ADMINISTRATIVA Y BONOS',
    'NOMINA',
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
    } else if (upper === 'SERVICIOS') {
      section = 'SERVICIOS';
      row.isParent = true;
      row.parent = null;
    } else if (row.parent === 'INSUMOS DE COCINA') {
      row.isParent = false;
      section = 'INSUMOS DE COCINA';
    } else if (row.parent === 'INSUMOS DE BARRA') {
      row.isParent = false;
      section = 'INSUMOS DE BARRA';
    } else if (row.parent === 'SERVICIOS') {
      row.isParent = false;
      section = 'SERVICIOS';
    } else if (section === 'INSUMOS DE COCINA' && cocinaKids.has(upper)) {
      row.parent = 'INSUMOS DE COCINA';
      row.isParent = false;
    } else if (section === 'INSUMOS DE BARRA' && barraKids.has(upper)) {
      row.parent = 'INSUMOS DE BARRA';
      row.isParent = false;
    } else if (upper === 'CARBON') {
      // Excel suele emitir CARBON top-level → hijo de cocina
      row.parent = 'INSUMOS DE COCINA';
      row.isParent = false;
      section = null;
    } else if (section === 'SERVICIOS' && serviciosKids.has(upper)) {
      row.parent = 'SERVICIOS';
      row.isParent = false;
    } else if (serviciosKids.has(upper) && !row.parent) {
      // Top-level Agua/Gas/…/LAVANDERIA/CONTADOR/… → hijos de SERVICIOS
      row.parent = 'SERVICIOS';
      row.isParent = false;
      section = null;
    } else if (nominaKeys.has(upper)) {
      row.rubro = 'NÓMINA';
      row.parent = null;
      row.isParent = false;
      section = null;
    } else {
      section = null;
      row.parent = null;
      row.isParent = false;
    }

    const key = catalogKey(row.rubro, row.parent);
    byKey.set(key, addAccum(byKey.get(key) || emptyAccum(), row.acc));
  }

  const byNameOnly = new Map<string, Accum>();
  for (const [key, acc] of byKey) {
    const name = key.split('::')[1];
    byNameOnly.set(name, addAccum(byNameOnly.get(name) || emptyAccum(), acc));
  }

  const rows: RubroRow[] = RUBRO_CATALOG.map((entry, sort) => {
    const key = catalogKey(entry.rubro, entry.parent);
    let acc = byKey.get(key);

    if (!acc && entry.parent) {
      // Excel suele traer servicios / top-level sin parent
      acc = byKey.get(catalogKey(entry.rubro, null));
    }
    if (!acc && entry.isParent) {
      acc = byNameOnly.get(normRubroKey(entry.rubro));
    }
    if (!acc && normRubroKey(entry.rubro) === 'NOMINA') {
      acc = byKey.get(catalogKey('NÓMINA', null));
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

  // Base Excel del padre (cocina/barra) antes de sumar presupuestos de hijos
  const parentBasePresu = new Map<string, number>();
  for (const r of rows) {
    if (r.isParent && r.rubro !== 'SERVICIOS') {
      parentBasePresu.set(r.rubro, r.presupuesto);
    }
  }

  // SERVICIOS: sumar presupuestos Excel de los hijos (antes de overrides de top-level)
  rollupParents(
    rows,
    ['INSUMOS DE COCINA', 'INSUMOS DE BARRA', 'SERVICIOS'],
    parentBasePresu
  );

  const weekCount = countPresupuestoWeeks(records, year, month);

  const adminOverrides = new Map<string, number>();
  for (const r of records) {
    if (r.source_file !== SOURCE_AJUSTE) continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<{
      rubro?: string;
      presupuesto?: number;
      parent?: string | null;
    }>(r.description);
    const rubroName = data?.rubro || r.category || '';
    if (!normRubroKey(rubroName)) continue;
    const amount =
      data?.presupuesto != null ? Number(data.presupuesto) : Number(r.amount || 0);
    if (!Number.isFinite(amount)) continue;
    const parent = data?.parent ?? null;
    adminOverrides.set(adminBudgetKey(rubroName, parent), amount);
  }

  applyBudgetOverrides(rows, meta, weekCount, adminOverrides);

  // Tras overrides, recalcular padres (SERVICIOS suma; cocina/barra = base + hijos)
  rollupParents(
    rows,
    ['INSUMOS DE COCINA', 'INSUMOS DE BARRA', 'SERVICIOS'],
    parentBasePresu
  );

  return { rows, meta, weekCount };
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
      r.source_file !== 'presupuesto_semana' &&
      r.source_file !== SOURCE_AJUSTE
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
