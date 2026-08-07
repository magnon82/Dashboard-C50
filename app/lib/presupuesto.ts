import {
  parseIsoDate,
  todayMexicoIso,
  toIsoLocal,
  type FinancialRecord,
} from '@/app/lib/ventas-semana';
import { sumFacturasGastoPorMes } from '@/app/lib/facturas';

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
  /** Ingresos de FLUJO EFECTIVO asignados por Concepto a esta SEM. */
  efectivo_ingresos: number;
  /** Egresos de FLUJO EFECTIVO asignados por Concepto a esta SEM. */
  efectivo_egresos: number;
  /** efectivo_ingresos − efectivo_egresos */
  efectivo_neto: number;
  /** Salidas de anticipos/inversiones (col N). Entradas van dentro de ingresos. */
  inversiones: number;
  suma_ingreso: number;
  suma_gasto: number;
  /** Roll-forward bancario: suma_ingreso − suma_gasto (sin efectivo). */
  total_bancos: number;
  /** total_bancos + efectivo_neto */
  total: number;
}

export const SOURCE_AJUSTE = 'presupuesto_ajuste';

/** Fuentes escritas por `ingest_presupuesto.py` (sin ajustes admin). */
export const PRESUPUESTO_INGEST_SOURCES = [
  'presupuesto_mensual',
  'presupuesto_saldos',
  'presupuesto_rubro',
  'presupuesto_semana',
  'presupuesto_sem_detalle',
  'presupuesto_ingreso',
] as const;

export type PresupuestoIngestSource =
  (typeof PRESUPUESTO_INGEST_SOURCES)[number];

const PRESUPUESTO_INGEST_SET = new Set<string>(PRESUPUESTO_INGEST_SOURCES);

export type PresupuestoSourceLastUpdate = {
  sourceFile: string;
  lastAt: string;
};

export type PresupuestoLastUpdateInfo = {
  /** Max `created_at` de ingest Excel (+ ajuste si includeAjuste). */
  lastAt: string | null;
  bySource: PresupuestoSourceLastUpdate[];
};

/**
 * Última carga de presupuesto en Supabase (`financial_records.created_at`).
 * Opcionalmente acota al mes de negocio (`date`) que se está viendo.
 */
export function buildPresupuestoLastUpdate(
  records: Array<{
    source_file?: string | null;
    created_at?: string | null;
    date?: string;
  }>,
  opts?: { year?: number; month?: number; includeAjuste?: boolean },
): PresupuestoLastUpdateInfo {
  const includeAjuste = opts?.includeAjuste !== false;
  const year = opts?.year;
  const month = opts?.month;
  const bySource = new Map<string, string>();

  for (const r of records) {
    const sf = String(r.source_file || '');
    if (!sf) continue;
    const isIngest = PRESUPUESTO_INGEST_SET.has(sf);
    const isAjuste = sf === SOURCE_AJUSTE;
    if (!isIngest && !(includeAjuste && isAjuste)) continue;

    const created = String(r.created_at || '').trim();
    if (!created) continue;

    if (year != null || month != null) {
      const p = parseIsoDate(String(r.date || ''));
      if (!p) continue;
      if (year != null && p.y !== year) continue;
      if (month != null && p.m !== month) continue;
    }

    const prev = bySource.get(sf);
    if (!prev || created > prev) bySource.set(sf, created);
  }

  const list: PresupuestoSourceLastUpdate[] = Array.from(bySource.entries())
    .map(([sourceFile, lastAt]) => ({ sourceFile, lastAt }))
    .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile, 'es'));

  let lastAt: string | null = null;
  for (const row of list) {
    if (!lastAt || row.lastAt > lastAt) lastAt = row.lastAt;
  }
  return { lastAt, bySource: list };
}

/** Padres colapsables en la UI (nombres de display). */
export const COLLAPSIBLE_PARENTS = [
  'Insumos de cocina',
  'Insumos de barra',
  'Servicios',
] as const;

export type CollapsibleParent = (typeof COLLAPSIBLE_PARENTS)[number];

/** Metadatos de rubros editables por el admin (ajustes mensuales). */
export type AdminEditableBudget = {
  rubro: string;
  /** Hijo de catálogo (p. ej. Servicios → Agua). */
  parent?: string | null;
  /** Monto fijo de fórmula cuando aplica. */
  defaultPresupuesto?: number;
  /** Tarifa semanal × N semanas SEM del mes (Lavandería / Carbón). */
  weeklyRate?: number;
  /** Fracción de venta del mes (Nómina = 0.25). */
  ventaPct?: number;
  note?: string;
};

/** Display name for merged Equipo + Cristalería. */
export const RUBRO_CRISTALERIA_Y_EQUIPO = 'Cristalería y Equipo';

/** Legacy Excel / ingest keys that roll into Cristalería y Equipo. */
const LEGACY_CRISTALERIA_EQUIPO_KEYS = new Set(['EQUIPO', 'CRISTALERIA']);

/**
 * Excel SEM / TOTAL suele partir Nómina en operativa vs administrativa.
 * El catálogo UI es un solo rubro «Nómina» (también pagos vía Administración Zen).
 */
const NOMINA_ALIAS_KEYS = new Set([
  'NOMINA OPERATIVA Y BONOS',
  'NOMINA ADMINISTRATIVA Y BONOS',
  'NOMINA',
]);

/**
 * Rubros cuyo presupuesto el admin puede editar por mes.
 * Incluye fijos de fórmula, semanales, % venta y top-level / servicios del Excel.
 */
export const ADMIN_EDITABLE_BUDGETS: AdminEditableBudget[] = [
  // Fijos / % venta (orden ~ catálogo)
  { rubro: 'Renta', defaultPresupuesto: 44330 },
  { rubro: RUBRO_CRISTALERIA_Y_EQUIPO, defaultPresupuesto: 5500 },
  { rubro: 'Licencias y afiliaciones', defaultPresupuesto: 3500 },
  { rubro: 'Finiquitos y reclutamiento', defaultPresupuesto: 0 },
  {
    rubro: 'Nómina',
    ventaPct: 0.25,
    note: '25% de la venta del mes (override opcional)',
  },
  { rubro: 'IMSS', defaultPresupuesto: 16765.12 },
  { rubro: 'Impuestos', defaultPresupuesto: 6000 },
  // Semanales (hijos de catálogo)
  {
    rubro: 'Lavandería',
    parent: 'Servicios',
    weeklyRate: 2400,
    note: '$2,400 × N semanas SEM',
  },
  {
    rubro: 'Carbón',
    parent: 'Insumos de cocina',
    weeklyRate: 1500,
    note: '$1,500 × N semanas SEM',
  },
  // Servicios hijos
  { rubro: 'Agua', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  { rubro: 'Gas', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  { rubro: 'Luz', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  { rubro: 'Teléfono', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  { rubro: 'Contador', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  {
    rubro: 'Diseño y publicidad',
    parent: 'Servicios',
    note: 'Presupuesto Excel · Servicios',
  },
  { rubro: 'Alarma', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  { rubro: 'Auditorías', parent: 'Servicios', note: 'Presupuesto Excel · Servicios' },
  {
    rubro: 'Gas calentadores',
    parent: 'Servicios',
    note: 'Presupuesto Excel · Servicios',
  },
  {
    rubro: 'Materias primas',
    parent: 'Servicios',
    note: 'Presupuesto Excel · Servicios',
  },
  // Otros (Excel) — orden ~ catálogo
  { rubro: 'Comida personal' },
  { rubro: 'Mantenimiento' },
  { rubro: 'Papelería' },
  { rubro: 'Limpieza y baños' },
  { rubro: 'Gasolina y taxis' },
  { rubro: 'Otros' },
  { rubro: 'Comisiones bancarias' },
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
  { rubro: 'Insumos de cocina', parent: null, isParent: true },
  { rubro: 'Frutas y verduras', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Proteínas', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Abarrotes', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Lácteos', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Panes, tortillas, postres', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Agua', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Carbón', parent: 'Insumos de cocina', isParent: false },
  { rubro: 'Insumos de barra', parent: null, isParent: true },
  { rubro: 'Destilados y vinos', parent: 'Insumos de barra', isParent: false },
  { rubro: 'Cervezas', parent: 'Insumos de barra', isParent: false },
  { rubro: 'Abarrotes', parent: 'Insumos de barra', isParent: false },
  { rubro: 'Café', parent: 'Insumos de barra', isParent: false },
  { rubro: 'Refrescos, aguas y hielo', parent: 'Insumos de barra', isParent: false },
  { rubro: 'Frutas y verduras', parent: 'Insumos de barra', isParent: false },
  { rubro: 'Servicios', parent: null, isParent: true },
  { rubro: 'Lavandería', parent: 'Servicios', isParent: false },
  { rubro: 'Agua', parent: 'Servicios', isParent: false },
  { rubro: 'Gas', parent: 'Servicios', isParent: false },
  { rubro: 'Luz', parent: 'Servicios', isParent: false },
  { rubro: 'Teléfono', parent: 'Servicios', isParent: false },
  { rubro: 'Contador', parent: 'Servicios', isParent: false },
  { rubro: 'Diseño y publicidad', parent: 'Servicios', isParent: false },
  { rubro: 'Alarma', parent: 'Servicios', isParent: false },
  { rubro: 'Auditorías', parent: 'Servicios', isParent: false },
  { rubro: 'Gas calentadores', parent: 'Servicios', isParent: false },
  { rubro: 'Materias primas', parent: 'Servicios', isParent: false },
  { rubro: 'Comida personal', parent: null, isParent: false },
  { rubro: 'Renta', parent: null, isParent: false },
  { rubro: 'Mantenimiento', parent: null, isParent: false },
  { rubro: RUBRO_CRISTALERIA_Y_EQUIPO, parent: null, isParent: false },
  { rubro: 'Papelería', parent: null, isParent: false },
  { rubro: 'Limpieza y baños', parent: null, isParent: false },
  { rubro: 'Gasolina y taxis', parent: null, isParent: false },
  { rubro: 'Otros', parent: null, isParent: false },
  { rubro: 'Licencias y afiliaciones', parent: null, isParent: false },
  { rubro: 'Comisiones bancarias', parent: null, isParent: false },
  { rubro: 'Finiquitos y reclutamiento', parent: null, isParent: false },
  { rubro: 'Nómina', parent: null, isParent: false },
  { rubro: 'IMSS', parent: null, isParent: false },
  { rubro: 'Impuestos', parent: null, isParent: false },
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

/** Clave de catálogo tras aliases Excel (Nómina partida, Cristalería legacy). */
export function canonicalRubroKey(name: string): string {
  const key = normRubroKey(name);
  if (NOMINA_ALIAS_KEYS.has(key)) return 'NOMINA';
  if (LEGACY_CRISTALERIA_EQUIPO_KEYS.has(key) || key === 'CRISTALERIA Y EQUIPO') {
    return 'CRISTALERIA Y EQUIPO';
  }
  return key;
}

function catalogKey(rubro: string, parent: string | null): string {
  const p = parent ? normRubroKey(parent) : '';
  return `${p}::${normRubroKey(rubro)}`;
}

function sameParent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return normRubroKey(a) === normRubroKey(b);
}

function isParentKey(name: string | null | undefined, key: string): boolean {
  return Boolean(name && normRubroKey(name) === key);
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
    (r) => normRubroKey(r.rubro) === key && sameParent(r.parent, parent)
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
  if (key === 'CRISTALERIA Y EQUIPO' || LEGACY_CRISTALERIA_EQUIPO_KEYS.has(key)) {
    return 5500;
  }
  if (key === 'IMSS') return 16765.12;
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

  setPresu('Renta', 44330);
  setPresu(RUBRO_CRISTALERIA_Y_EQUIPO, 5500);
  setPresu('IMSS', 16765.12);
  setPresu('Impuestos', 6000);
  setPresu('Licencias y afiliaciones', 3500);
  setPresu('Lavandería', 2400 * n, 'Servicios');
  setPresu('Carbón', 1500 * n, 'Insumos de cocina');
  setPresu('Finiquitos y reclutamiento', 0);

  const nomina = findRow(rows, 'Nómina');
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
    const parent = rows.find(
      (r) => r.isParent && normRubroKey(r.rubro) === normRubroKey(parentName)
    );
    if (!parent) continue;
    const kids = rows.filter((r) => sameParent(r.parent, parent.rubro));
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
    // Servicios: presupuesto = suma de hijos.
    // Cocina/barra: Excel suele vivir en el padre; sumar presupuestos de hijos
    // (p. ej. Carbón) sin reemplazar la base del padre.
    if (isParentKey(parentName, 'SERVICIOS')) {
      if (sumP) parent.presupuesto = sumP;
    } else {
      const base =
        parentBasePresu?.get(normRubroKey(parent.rubro)) ?? parent.presupuesto;
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
  const PARENT_COCINA = 'Insumos de cocina';
  const PARENT_BARRA = 'Insumos de barra';
  const PARENT_SERVICIOS = 'Servicios';

  for (const row of raw) {
    const upper = normRubroKey(row.rubro);

    if (upper === 'INSUMOS DE COCINA') {
      section = 'INSUMOS DE COCINA';
      row.isParent = true;
      row.parent = null;
      row.rubro = PARENT_COCINA;
    } else if (upper === 'INSUMOS DE BARRA') {
      section = 'INSUMOS DE BARRA';
      row.isParent = true;
      row.parent = null;
      row.rubro = PARENT_BARRA;
    } else if (upper === 'SERVICIOS') {
      section = 'SERVICIOS';
      row.isParent = true;
      row.parent = null;
      row.rubro = PARENT_SERVICIOS;
    } else if (isParentKey(row.parent, 'INSUMOS DE COCINA')) {
      row.isParent = false;
      row.parent = PARENT_COCINA;
      section = 'INSUMOS DE COCINA';
    } else if (isParentKey(row.parent, 'INSUMOS DE BARRA')) {
      row.isParent = false;
      row.parent = PARENT_BARRA;
      section = 'INSUMOS DE BARRA';
    } else if (isParentKey(row.parent, 'SERVICIOS')) {
      row.isParent = false;
      row.parent = PARENT_SERVICIOS;
      section = 'SERVICIOS';
    } else if (section === 'INSUMOS DE COCINA' && cocinaKids.has(upper)) {
      row.parent = PARENT_COCINA;
      row.isParent = false;
    } else if (section === 'INSUMOS DE BARRA' && barraKids.has(upper)) {
      row.parent = PARENT_BARRA;
      row.isParent = false;
    } else if (upper === 'CARBON') {
      // Excel suele emitir Carbón top-level → hijo de cocina
      row.parent = PARENT_COCINA;
      row.isParent = false;
      section = null;
    } else if (section === 'SERVICIOS' && serviciosKids.has(upper)) {
      row.parent = PARENT_SERVICIOS;
      row.isParent = false;
    } else if (serviciosKids.has(upper) && !row.parent) {
      // Top-level Agua/Gas/…/Lavandería/Contador/… → hijos de Servicios
      row.parent = PARENT_SERVICIOS;
      row.isParent = false;
      section = null;
    } else if (NOMINA_ALIAS_KEYS.has(upper)) {
      row.rubro = 'Nómina';
      row.parent = null;
      row.isParent = false;
      section = null;
    } else if (
      LEGACY_CRISTALERIA_EQUIPO_KEYS.has(upper) ||
      upper === 'CRISTALERIA Y EQUIPO'
    ) {
      // Equipo + Cristalería (legacy Excel) → un solo rubro
      row.rubro = RUBRO_CRISTALERIA_Y_EQUIPO;
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
      acc = byKey.get(catalogKey('Nómina', null));
    }
    if (!acc && normRubroKey(entry.rubro) === 'CRISTALERIA Y EQUIPO') {
      // Sum legacy EQUIPO + CRISTALERIA if still stored under old keys
      let merged = emptyAccum();
      let found = false;
      for (const alias of [
        RUBRO_CRISTALERIA_Y_EQUIPO,
        'EQUIPO',
        'CRISTALERIA',
      ]) {
        const a =
          byKey.get(catalogKey(alias, null)) || byNameOnly.get(normRubroKey(alias));
        if (a) {
          merged = addAccum(merged, a);
          found = true;
        }
      }
      if (found) acc = merged;
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
    if (r.isParent && !isParentKey(r.rubro, 'SERVICIOS')) {
      parentBasePresu.set(normRubroKey(r.rubro), r.presupuesto);
    }
  }

  // Servicios: sumar presupuestos Excel de los hijos (antes de overrides de top-level)
  rollupParents(rows, [...COLLAPSIBLE_PARENTS], parentBasePresu);

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
    const overrideKey = adminBudgetKey(rubroName, parent);
    // Legacy Equipo / Cristalería overrides → Cristalería y Equipo
    const rubroKey = normRubroKey(rubroName);
    if (!parent && LEGACY_CRISTALERIA_EQUIPO_KEYS.has(rubroKey)) {
      const mergedKey = adminBudgetKey(RUBRO_CRISTALERIA_Y_EQUIPO, null);
      const prev = adminOverrides.get(mergedKey);
      adminOverrides.set(
        mergedKey,
        prev != null ? prev + amount : amount
      );
    } else {
      adminOverrides.set(overrideKey, amount);
    }
  }

  applyBudgetOverrides(rows, meta, weekCount, adminOverrides);

  // Tras overrides, recalcular padres (Servicios suma; cocina/barra = base + hijos)
  rollupParents(rows, [...COLLAPSIBLE_PARENTS], parentBasePresu);

  return { rows, meta, weekCount };
}

export const SOURCE_SEM_DETALLE = 'presupuesto_sem_detalle';

export interface RubroDesgloseLine {
  canal: string;
  amount: number;
  /** Concepto libre del Excel SEM (cols C/F/I), si existe. */
  note: string | null;
  /** Descripción de movimiento bancario/flujo (fallback). */
  description?: string | null;
}

export interface RubroDesgloseWeek {
  week: number;
  total: number;
  lines: RubroDesgloseLine[];
}

export type RubroDesgloseSource = 'sem_detalle' | 'estados' | 'none';

export interface RubroDesglose {
  rubro: string;
  parent: string | null;
  isParent: boolean;
  real: number;
  weeks: RubroDesgloseWeek[];
  totalDetalle: number;
  source: RubroDesgloseSource;
  /** Aviso en español sobre límites de la fuente. */
  dataNote: string | null;
}

type SemDetallePayload = {
  week?: number;
  rubro?: string;
  parent?: string | null;
  canal?: string;
  amount?: number;
  note?: string | null;
};

/** Concepto visible en desglose cuando el Excel trae rubro alias (p. ej. Nómina partida). */
function semDetalleConceptLabel(
  lineRubro: string,
  note: string | null
): string | null {
  if (note) return note;
  const key = normRubroKey(lineRubro);
  if (key === 'NOMINA OPERATIVA Y BONOS') return 'Nómina operativa y bonos';
  if (key === 'NOMINA ADMINISTRATIVA Y BONOS') {
    return 'Nómina administrativa y bonos';
  }
  return null;
}

function matchesRubroTarget(
  lineRubro: string,
  lineParent: string | null | undefined,
  target: RubroRow,
  childNames?: Set<string>
): boolean {
  const lineKey = canonicalRubroKey(lineRubro);
  const rawLineKey = normRubroKey(lineRubro);
  if (target.isParent && childNames) {
    return childNames.has(rawLineKey) || childNames.has(lineKey);
  }
  if (lineKey !== canonicalRubroKey(target.rubro)) return false;
  if (target.parent && lineParent) {
    return sameParent(lineParent, target.parent);
  }
  // Detalle sin padre o rubro top-level: match por nombre
  if (target.parent && !lineParent) {
    // Ambiguous children (Agua): accept only if catalog parent matches expected
    return true;
  }
  return true;
}

function semOfMonthForIsoDate(
  iso: string,
  year: number,
  month: number
): number | null {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const monday1 = firstMondayOnOrAfter(year, month, 1);
  const day = new Date(p.y, p.m - 1, p.d, 12, 0, 0);
  const dow = day.getDay();
  const mon = new Date(day);
  mon.setDate(mon.getDate() - (dow === 0 ? 6 : dow - 1));
  const diffDays = Math.round(
    (mon.getTime() - monday1.getTime()) / 86400000
  );
  const idx = Math.floor(diffDays / 7) + 1;
  if (idx < 1 || idx > 6) return null;
  // Allow dates in adjacent month that fall in this month's SEM weeks
  return idx;
}

function groupDesgloseWeeks(
  lines: Array<RubroDesgloseLine & { week: number }>
): RubroDesgloseWeek[] {
  const byWeek = new Map<number, RubroDesgloseLine[]>();
  for (const line of lines) {
    const list = byWeek.get(line.week) || [];
    list.push({
      canal: line.canal,
      amount: line.amount,
      note: line.note,
      description: line.description,
    });
    byWeek.set(line.week, list);
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, weekLines]) => ({
      week,
      total: weekLines.reduce((s, l) => s + l.amount, 0),
      lines: weekLines.sort((a, b) => b.amount - a.amount),
    }));
}

/**
 * Desglose semanal del Real de un rubro.
 * Preferencia: notas/montos SEM del presupuesto (`presupuesto_sem_detalle`).
 * Fallback: movimientos de estado Mifel/BBVA / efectivo / CXP ya matcheados al rubro.
 */
export function buildRubroDesglose(
  records: FinancialRecord[],
  year: number,
  month: number,
  target: RubroRow
): RubroDesglose {
  const childNames =
    target.isParent
      ? new Set(
          RUBRO_CATALOG.filter(
            (e) => e.parent && sameParent(e.parent, target.rubro)
          ).map((e) => normRubroKey(e.rubro))
        )
      : undefined;

  const semLines: Array<RubroDesgloseLine & { week: number }> = [];
  for (const r of records) {
    if (r.source_file !== SOURCE_SEM_DETALLE) continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<SemDetallePayload>(r.description);
    if (!data || data.week == null) continue;
    const rubro = String(data.rubro || r.category || '');
    if (!matchesRubroTarget(rubro, data.parent, target, childNames)) continue;
    const amount = Number(data.amount ?? r.amount ?? 0);
    if (!amount && !data.note) continue;
    const rawNote = data.note ? String(data.note).trim() || null : null;
    semLines.push({
      week: Number(data.week),
      canal: String(data.canal || '—'),
      amount,
      note: semDetalleConceptLabel(rubro, rawNote),
    });
  }

  if (semLines.length > 0) {
    const weeks = groupDesgloseWeeks(semLines);
    const totalDetalle = weeks.reduce((s, w) => s + w.total, 0);
    const hasNotes = semLines.some((l) => l.note);
    return {
      rubro: target.rubro,
      parent: target.parent,
      isParent: target.isParent,
      real: target.real,
      weeks,
      totalDetalle,
      source: 'sem_detalle',
      dataNote: hasNotes
        ? 'Conceptos tomados de las notas de las hojas SEM del presupuesto Excel.'
        : 'Montos por semana desde hojas SEM del presupuesto. Sin notas de concepto en el Excel para este rubro.',
    };
  }

  // Fallback: movimientos bancarios / efectivo / CXP matcheados al rubro
  const estadoSources = new Set([
    'estado_mifel',
    'estado_bbva',
    'flujo_efectivo_mov',
    'cxp',
  ]);
  const fallbackLines: Array<RubroDesgloseLine & { week: number }> = [];
  for (const r of records) {
    if (!r.source_file || !estadoSources.has(r.source_file)) continue;
    const data = parseJson<{
      matched_rubro?: string | null;
      matched_parent?: string | null;
      descripcion?: string;
      concepto?: string;
      cargo?: number | null;
      egreso?: number | null;
      week?: number | null;
      bank?: string;
      canal?: string;
      fecha?: string;
    }>(r.description);
    if (!data?.matched_rubro) continue;
    if (
      !matchesRubroTarget(
        data.matched_rubro,
        data.matched_parent,
        target,
        childNames
      )
    ) {
      continue;
    }
    const amount = Math.abs(
      Number(data.cargo ?? data.egreso ?? r.amount ?? 0)
    );
    if (!amount) continue;
    const week =
      data.week != null && Number(data.week) >= 1
        ? Number(data.week)
        : semOfMonthForIsoDate(data.fecha || r.date, year, month);
    if (week == null) continue;
    // Filter to selected month when using fecha
    const dp = parseIsoDate(data.fecha || r.date);
    if (dp && (dp.y !== year || dp.m !== month)) {
      // week already scoped; allow if week maps into month
      if (data.week == null) continue;
    }
    const canal =
      data.canal ||
      data.bank ||
      (r.source_file === 'flujo_efectivo_mov'
        ? 'Efectivo'
        : r.source_file === 'cxp'
          ? 'CXP'
          : '—');
    fallbackLines.push({
      week,
      canal: String(canal),
      amount,
      note: null,
      description: String(data.descripcion || data.concepto || '').trim() || null,
    });
  }

  if (fallbackLines.length > 0) {
    const weeks = groupDesgloseWeeks(fallbackLines);
    const totalDetalle = weeks.reduce((s, w) => s + w.total, 0);
    return {
      rubro: target.rubro,
      parent: target.parent,
      isParent: target.isParent,
      real: target.real,
      weeks,
      totalDetalle,
      source: 'estados',
      dataNote:
        'Sin detalle SEM del presupuesto ingerido. Se muestran movimientos de bancos/efectivo/CXP ya asignados a este rubro (semana estimada por fecha). Los conceptos tipo «huerta» / «galacticos» viven en notas SEM del Excel — vuelve a ingerir el presupuesto.',
    };
  }

  return {
    rubro: target.rubro,
    parent: target.parent,
    isParent: target.isParent,
    real: target.real,
    weeks: [],
    totalDetalle: 0,
    source: 'none',
    dataNote:
      target.real > 0
        ? 'No hay desglose semanal disponible. El Real viene del TOTAL del Excel; hace falta ingerir `presupuesto_sem_detalle` (notas SEM) o movimientos matcheados al rubro.'
        : 'Sin gasto real ni desglose para este rubro en el mes.',
  };
}

/**
 * Set of catalog keys (`parent::rubro`) that have at least one SEM detalle
 * line in the month — used to hint clickable Real cells.
 */
export function rubrosWithSemDetalle(
  records: FinancialRecord[],
  year: number,
  month: number
): Set<string> {
  const keys = new Set<string>();
  for (const r of records) {
    if (r.source_file !== SOURCE_SEM_DETALLE) continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<SemDetallePayload>(r.description);
    if (!data?.rubro) continue;
    const rubroName = String(data.rubro);
    keys.add(catalogKey(rubroName, data.parent ?? null));
    // Also name-only for top-level matching
    keys.add(catalogKey(rubroName, null));
    // Aliases Excel (Nómina operativa/admin → Nómina)
    const canon = canonicalRubroKey(rubroName);
    if (canon === 'NOMINA') {
      keys.add(catalogKey('Nómina', null));
    } else if (canon === 'CRISTALERIA Y EQUIPO') {
      keys.add(catalogKey(RUBRO_CRISTALERIA_Y_EQUIPO, null));
    }
  }
  return keys;
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
export function presupuestoWeekFullyElapsed(
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

type EfectivoSemanaPayload = {
  week?: number;
  efectivo_ingresos?: number;
  efectivo_egresos?: number;
  efectivo_neto?: number;
};

export function buildResumenBancosSemanal(
  records: FinancialRecord[],
  year: number,
  month: number,
  todayIso?: string
): SemanaBancos[] {
  const today = todayIso || toIsoLocal(new Date());

  // Efectivo semanal (FLUJO EFECTIVO · semana desde Concepto)
  const efectivoByWeek = new Map<
    number,
    { ingresos: number; egresos: number; neto: number }
  >();
  for (const r of records) {
    if (r.source_file !== 'flujo_efectivo_semana') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<EfectivoSemanaPayload>(r.description);
    if (!data || data.week == null || Number(data.week) < 1) continue;
    const w = Number(data.week);
    const ingresos = Number(data.efectivo_ingresos || 0);
    const egresos = Number(data.efectivo_egresos || 0);
    const neto =
      data.efectivo_neto != null ? Number(data.efectivo_neto) : ingresos - egresos;
    const prev = efectivoByWeek.get(w) || { ingresos: 0, egresos: 0, neto: 0 };
    efectivoByWeek.set(w, {
      ingresos: prev.ingresos + ingresos,
      egresos: prev.egresos + egresos,
      neto: prev.neto + neto,
    });
  }

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
    const w = Number(data.week);
    const efe = efectivoByWeek.get(w);
    // Preferir fuente flujo_efectivo_semana; si no hay, usar campos embebidos (si existieran)
    const efectivo_ingresos = efe
      ? efe.ingresos
      : Number(raw.efectivo_ingresos || 0);
    const efectivo_egresos = efe
      ? efe.egresos
      : Number(raw.efectivo_egresos || 0);
    const efectivo_neto = efe
      ? efe.neto
      : raw.efectivo_neto != null
        ? Number(raw.efectivo_neto)
        : efectivo_ingresos - efectivo_egresos;
    const suma_ingreso = Number(data.suma_ingreso || 0);
    const suma_gasto = Number(data.suma_gasto || 0);
    const total_bancos =
      data.total != null
        ? Number(data.total)
        : suma_ingreso - suma_gasto;
    weeks.push({
      week: w,
      inicial: Number(data.inicial || 0),
      ingresos: ingresosBase + entradaExtra,
      pagos_mifel: Number(data.pagos_mifel || 0),
      comisiones: Number(data.comisiones || 0),
      pagos_bbva: Number(data.pagos_bbva || 0),
      efectivo_ingresos,
      efectivo_egresos,
      efectivo_neto,
      inversiones,
      suma_ingreso,
      suma_gasto,
      total_bancos,
      total: total_bancos + efectivo_neto,
    });
  }
  return weeks.sort((a, b) => a.week - b.week);
}

/** Reject ingest bugs (e.g. week→year misparse → 2029). */
function isPlausiblePresupuestoYear(year: number, now = new Date()): boolean {
  return (
    Number.isFinite(year) &&
    Number.isInteger(year) &&
    year >= 2020 &&
    year <= now.getFullYear() + 1
  );
}

function isPlausiblePresupuestoMonth(month: number): boolean {
  return (
    Number.isFinite(month) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  );
}

export function availablePresupuestoMonths(records: FinancialRecord[]): Array<{
  year: number;
  month: number;
}> {
  const set = new Set<string>();
  const now = new Date();
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
    if (!isPlausiblePresupuestoYear(p.y, now) || !isPlausiblePresupuestoMonth(p.m)) {
      continue;
    }
    set.add(`${p.y}-${p.m}`);
  }
  return Array.from(set)
    .map((k) => {
      const [y, m] = k.split('-').map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

/**
 * Meses con al menos una semana de bancos ya transcurrida (cierre martes).
 * Agosto sin SEM 1 lista no entra → el default cae en julio.
 */
export function availableSemanasBancosMonths(
  records: FinancialRecord[],
  todayIso?: string
): Array<{ year: number; month: number }> {
  const today = todayIso || toIsoLocal(new Date());
  const now = new Date();
  const set = new Set<string>();

  for (const r of records) {
    if (r.source_file !== 'presupuesto_semana') continue;
    const p = parseIsoDate(r.date);
    if (!p) continue;
    if (!isPlausiblePresupuestoYear(p.y, now) || !isPlausiblePresupuestoMonth(p.m)) {
      continue;
    }
    const data = parseJson<{ week?: number }>(r.description);
    if (!data || data.week == null || Number(data.week) < 1) continue;
    if (!presupuestoWeekFullyElapsed(p.y, p.m, Number(data.week), today)) continue;
    set.add(`${p.y}-${p.m}`);
  }

  return Array.from(set)
    .map((k) => {
      const [y, m] = k.split('-').map(Number);
      return { year: y, month: m };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

/** Último mes con semanas de bancos transcurridas (o null si no hay). */
export function latestMonthWithSemanasBancos(
  records: FinancialRecord[],
  todayIso?: string
): { year: number; month: number } | null {
  const months = availableSemanasBancosMonths(records, todayIso);
  return months[0] ?? null;
}

/**
 * Semanas SEM esperadas del mes: lunes desde el 1.er lunes del mes
 * hasta (sin incluir) el 1.er lunes del mes siguiente.
 * (Referencia / Finanzas; Balance Socios: fila al cerrar el mes, acumulado día 10.)
 */
export function expectedPresupuestoWeekCount(year: number, month: number): number {
  const monday1 = firstMondayOnOrAfter(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonday1 = firstMondayOnOrAfter(nextYear, nextMonth, 1);
  const diffDays = Math.round(
    (nextMonday1.getTime() - monday1.getTime()) / 86400000
  );
  return Math.max(0, Math.round(diffDays / 7));
}

/** Día del mes siguiente en que el mes M entra al acumulado del Balance Socios. */
export const BALANCE_MES_INCORPORA_DIA = 10;

/**
 * Fecha ISO (YYYY-MM-DD) del primer día del mes siguiente:
 * a partir de ahí el mes M ya cerró el calendario y puede listarse
 * en la tabla de Balance (aunque aún no sume al acumulado).
 * Ej.: julio 2026 → 2026-08-01.
 */
export function balanceMesCerradoDesdeIso(year: number, month: number): string {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

/**
 * Fecha ISO (YYYY-MM-DD) a partir de la cual el mes M ya puede entrar
 * al acumulado de Balance Socios: día 10 del mes siguiente.
 * Ej.: julio 2026 → 2026-08-10.
 */
export function balanceMesIncorporaDesdeIso(year: number, month: number): string {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(BALANCE_MES_INCORPORA_DIA).padStart(2, '0')}`;
}

/**
 * Mes M ya terminó en calendario (hoy CDMX >= día 1 del mes siguiente).
 * Usado para mostrar la fila en Balance; el acumulado sigue la regla del día 10.
 */
export function isBalanceMesCerradoPorCalendario(
  year: number,
  month: number,
  todayIso?: string
): boolean {
  const today = todayIso || todayMexicoIso();
  if (!parseIsoDate(today)) return false;
  return today >= balanceMesCerradoDesdeIso(year, month);
}

/**
 * Regla de negocio Balance Socios: el mes M se incorpora al acumulado
 * el día 10 del mes siguiente (hoy CDMX >= esa fecha).
 */
export function isBalanceMesIncorporablePorCalendario(
  year: number,
  month: number,
  todayIso?: string
): boolean {
  const today = todayIso || todayMexicoIso();
  if (!parseIsoDate(today)) return false;
  return today >= balanceMesIncorporaDesdeIso(year, month);
}

function hasPresupuestoSemanaMonth(
  records: FinancialRecord[],
  year: number,
  month: number
): boolean {
  for (const r of records) {
    if (r.source_file !== 'presupuesto_semana') continue;
    const p = parseIsoDate(r.date);
    if (!p || p.y !== year || p.m !== month) continue;
    const data = parseJson<{ week?: number }>(r.description);
    if (!data || data.week == null || Number(data.week) < 1) continue;
    return true;
  }
  return false;
}

/**
 * Mes listo para sumar al acumulado de Balance Socios:
 * 1) hoy (CDMX) es el día 10 del mes siguiente o después, y
 * 2) existe al menos un `presupuesto_semana` del mes.
 * No usa conteo frágil de SEM (Mar/Jun 2026 pedían 5 semanas y el Excel
 * suele traer 4 → exclusión falsa de meses ya cerrados).
 */
export function isPresupuestoMesActualizado(
  records: FinancialRecord[],
  year: number,
  month: number,
  todayIso?: string
): boolean {
  const today = todayIso || todayMexicoIso();
  if (!isBalanceMesIncorporablePorCalendario(year, month, today)) return false;
  return hasPresupuestoSemanaMonth(records, year, month);
}

/**
 * Mes visible en la tabla de Balance (fila):
 * mes ya cerrado en calendario + al menos un `presupuesto_semana`.
 * Puede aparecer antes del día 10; en ese caso no suma al acumulado.
 */
export function isPresupuestoMesVisibleEnBalance(
  records: FinancialRecord[],
  year: number,
  month: number,
  todayIso?: string
): boolean {
  const today = todayIso || todayMexicoIso();
  if (!isBalanceMesCerradoPorCalendario(year, month, today)) return false;
  return hasPresupuestoSemanaMonth(records, year, month);
}

/**
 * Totales mensuales de ingresos / gastos.
 * Ingresos y efectivo: `presupuesto_semana` + `flujo_efectivo_semana`.
 * Gastos bancarios: facturas CFDI I/E del mes si hay sync; si no, `suma_gasto`.
 * Nunca REP/pago (tipo P).
 */
export interface BalanceMensual {
  year: number;
  month: number;
  /** Bancos (ingresos) + efectivo ingresos */
  ingresos: number;
  /**
   * Gastos bancarios (facturas CFDI I/E si hay; si no suma_gasto) +
   * efectivo egresos.
   */
  gastos: number;
  /** ingresos − gastos */
  balance: number;
  /**
   * true si el mes ya entra al acumulado (día 10 del mes siguiente).
   * false = mes cerrado visible, pendiente de incorporar.
   */
  incorporado: boolean;
}

export type BuildBalanceMensualOptions = {
  /**
   * Si true (default en Socios), solo meses ya cerrados en calendario
   * (hoy >= día 1 del mes siguiente) con datos. Antes del día 10
   * aparecen con `incorporado: false` y no suman al acumulado.
   */
  onlyMesesActualizados?: boolean;
};

/**
 * Balance por mes:
 * - Visibilidad / ingresos / efectivo ← presupuesto (+ flujo efectivo).
 * - Gastos bancarios ← facturas CFDI (I/E) del mes cuando existen;
 *   si no hay facturas, roll-forward `suma_gasto` del presupuesto.
 * REP/pago (tipo P) no entran (filtro en `sumFacturasGastoPorMes`).
 */
export function buildBalanceMensualPorAno(
  records: FinancialRecord[],
  year: number,
  todayIso?: string,
  options: BuildBalanceMensualOptions = { onlyMesesActualizados: true }
): BalanceMensual[] {
  const onlyCerrados = options.onlyMesesActualizados !== false;
  const today = todayIso || todayMexicoIso();
  const out: BalanceMensual[] = [];
  for (let month = 1; month <= 12; month++) {
    if (
      onlyCerrados &&
      !isPresupuestoMesVisibleEnBalance(records, year, month, today)
    ) {
      continue;
    }
    if (!onlyCerrados && !hasPresupuestoSemanaMonth(records, year, month)) {
      continue;
    }
    const weeks = buildResumenBancosSemanal(records, year, month, today);
    if (weeks.length === 0) continue;
    let ingresos = 0;
    let sumaGastoPresupuesto = 0;
    let efectivoEgresos = 0;
    for (const w of weeks) {
      ingresos += Number(w.ingresos || 0) + Number(w.efectivo_ingresos || 0);
      sumaGastoPresupuesto += Number(w.suma_gasto || 0);
      efectivoEgresos += Number(w.efectivo_egresos || 0);
    }
    const facturas = sumFacturasGastoPorMes(records, year, month);
    const gastosBancos =
      facturas.count > 0 ? facturas.total : sumaGastoPresupuesto;
    const gastos = gastosBancos + efectivoEgresos;
    if (ingresos === 0 && gastos === 0) continue;
    out.push({
      year,
      month,
      ingresos,
      gastos,
      balance: ingresos - gastos,
      incorporado: isBalanceMesIncorporablePorCalendario(year, month, today),
    });
  }
  return out;
}

/**
 * Acumulado solo de meses ya incorporados (día 10+).
 * Filas con `incorporado: false` no aportan.
 */
export function sumBalanceMensual(rows: BalanceMensual[]): {
  ingresos: number;
  gastos: number;
  balance: number;
} {
  let ingresos = 0;
  let gastos = 0;
  for (const r of rows) {
    if (r.incorporado === false) continue;
    ingresos += r.ingresos;
    gastos += r.gastos;
  }
  return { ingresos, gastos, balance: ingresos - gastos };
}
