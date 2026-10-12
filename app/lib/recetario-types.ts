export type RecetaArea = 'cocina' | 'barra';

export type Insumo = {
  id: string;
  area: RecetaArea;
  name: string;
  nameKey: string;
  category: string;
  supplier: string;
  costingUnit: string;
  costingPrice: number;
  priceSource: 'master' | 'factura';
  priceAsOf: string | null;
  facturaEmisor: string | null;
};

export type RecipeLine = {
  name: string;
  qty: number;
  unit: string;
  insumoId: string | null;
  subrecipeId: string | null;
};

export type Recipe = {
  id: string;
  area: RecetaArea;
  code: string;
  name: string;
  nameKey: string;
  kind: 'platillo' | 'subreceta' | 'coctel';
  status: 'vigente' | 'interno' | 'archivado';
  category: string;
  yieldQty: number;
  yieldUnit: string;
  orderFactor: number;
  method: string;
  lines: RecipeLine[];
};

export type Ficha = {
  nombre: string;
  version: string;
  descripcion: string;
  categoria: string;
  observaciones: string;
  tipoCocina: string;
  tiempoCiclo: string;
  alergenos: string;
  presentacion: string;
  equipo: string;
  acompanamientos: string;
  procesos: string;
  historia: string;
};

export type Portion = {
  insumoId: string | null;
  qty: number | null;
  unit: string | null;
  label: string | null;
};

export type MenuItem = {
  sku: string;
  area: RecetaArea;
  name: string;
  nameKey: string;
  category: string;
  sellPrice: number;
  recipeId: string | null;
  portion: Portion | null;
  ficha: Ficha;
};

export type RecetarioSnapshot = {
  importedAt: string;
  sourceNote: string;
  insumos: Insumo[];
  recipes: Recipe[];
  menu: MenuItem[];
};

export type CostLine = {
  name: string;
  qty: number;
  unit: string;
  lineCost: number | null;
  detail: string;
  priceSource: 'master' | 'factura' | null;
};

export type ItemCost = {
  cost: number | null;
  complete: boolean;
  missing: string[];
  lines: CostLine[];
  /** Cantidad de insumo (en su unidad de costeo) por una venta. */
  explosion: { insumoId: string; qty: number }[];
};
