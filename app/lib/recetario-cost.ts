import type {
  CostLine,
  Insumo,
  ItemCost,
  MenuItem,
  Recipe,
} from '@/app/lib/recetario-types';

function normUnit(unit: string): string {
  const n = unit
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z]/g, '');
  if (n === 'kg' || n === 'kilo' || n === 'kilos') return 'kg';
  if (n === 'g' || n === 'gr' || n === 'gramo' || n === 'gramos') return 'g';
  if (n === 'lt' || n === 'l' || n === 'litro' || n === 'litros' || n === 'ltr') return 'lt';
  if (n === 'ml' || n === 'millilitro' || n === 'mililitro') return 'ml';
  if (n === 'pz' || n === 'pza' || n === 'pieza' || n === 'piezas') return 'pz';
  return n;
}

/** Convierte una cantidad a la unidad de costeo. null si no hay equivalencia. */
export function qtyInUnit(qty: number, from: string, to: string): number | null {
  const a = normUnit(from);
  const b = normUnit(to);
  if (!a || !b || a === b) return qty;
  if (a === 'g' && b === 'kg') return qty / 1000;
  if (a === 'kg' && b === 'g') return qty * 1000;
  if (a === 'ml' && b === 'lt') return qty / 1000;
  if (a === 'lt' && b === 'ml') return qty * 1000;
  return null;
}

type Built = {
  batch: number | null;
  complete: boolean;
  missing: string[];
  lines: CostLine[];
  batchExplosion: { insumoId: string; qty: number }[];
};

function emptyBuilt(missing: string[]): Built {
  return { batch: null, complete: false, missing, lines: [], batchExplosion: [] };
}

function buildRecipe(
  recipe: Recipe,
  recipes: Map<string, Recipe>,
  insumos: Map<string, Insumo>,
  cache: Map<string, Built>,
  stack: Set<string>
): Built {
  const cached = cache.get(recipe.id);
  if (cached) return cached;
  if (stack.has(recipe.id)) return emptyBuilt([recipe.name]);
  stack.add(recipe.id);

  let complete = true;
  let batch = 0;
  const missing: string[] = [];
  const lines: CostLine[] = [];
  const explosion = new Map<string, number>();

  const addExplosion = (bits: { insumoId: string; qty: number }[], factor: number) => {
    for (const bit of bits) {
      explosion.set(bit.insumoId, (explosion.get(bit.insumoId) || 0) + bit.qty * factor);
    }
  };

  for (const line of recipe.lines) {
    if (line.subrecipeId) {
      const sub = recipes.get(line.subrecipeId);
      if (!sub) {
        complete = false;
        missing.push(line.name);
        lines.push({
          name: line.name,
          qty: line.qty,
          unit: line.unit,
          lineCost: null,
          detail: 'Subreceta no encontrada',
          priceSource: null,
        });
        continue;
      }
      const subBuilt = buildRecipe(sub, recipes, insumos, cache, stack);
      const yieldQty = sub.yieldQty > 0 ? sub.yieldQty : 1;
      const per = subBuilt.complete ? subBuilt.batch / yieldQty : null;
      const lineCost = per != null ? per * line.qty : null;
      if (!subBuilt.complete || lineCost == null) {
        complete = false;
        missing.push(...subBuilt.missing.map((m) => `${line.name}: ${m}`));
      } else {
        batch += lineCost;
        addExplosion(subBuilt.batchExplosion, line.qty / yieldQty);
      }
      lines.push({
        name: line.name,
        qty: line.qty,
        unit: line.unit,
        lineCost,
        detail: sub.name,
        priceSource: null,
      });
      continue;
    }

    const insumo = line.insumoId ? insumos.get(line.insumoId) : undefined;
    if (!insumo || insumo.costingPrice == null) {
      complete = false;
      missing.push(line.name);
      lines.push({
        name: line.name,
        qty: line.qty,
        unit: line.unit,
        lineCost: null,
        detail: 'Sin precio en el catálogo',
        priceSource: null,
      });
      continue;
    }
    const qty = qtyInUnit(line.qty, line.unit || insumo.costingUnit, insumo.costingUnit);
    if (qty == null) {
      complete = false;
      missing.push(line.name);
      lines.push({
        name: line.name,
        qty: line.qty,
        unit: line.unit,
        lineCost: null,
        detail: `Unidad ${line.unit || '—'} no convierte a ${insumo.costingUnit}`,
        priceSource: insumo.priceSource,
      });
      continue;
    }
    const lineCost = qty * insumo.costingPrice;
    batch += lineCost;
    explosion.set(insumo.id, (explosion.get(insumo.id) || 0) + qty);
    lines.push({
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      lineCost,
      detail: insumo.name,
      priceSource: insumo.priceSource,
    });
  }

  const built: Built = {
    batch,
    complete,
    missing,
    lines,
    batchExplosion: [...explosion.entries()].map(([insumoId, qty]) => ({ insumoId, qty })),
  };
  cache.set(recipe.id, built);
  stack.delete(recipe.id);
  return built;
}

function perOrder(recipe: Recipe, built: Built): ItemCost {
  const factor = recipe.orderFactor > 0 ? recipe.orderFactor : 1;
  const amount = built.batch / factor;
  const hasPartial = !built.complete && built.batch > 0;
  return {
    cost: built.complete || hasPartial ? amount : null,
    complete: built.complete,
    missing: built.missing,
    lines: built.lines,
    explosion: built.complete
      ? built.batchExplosion.map((bit) => ({
          insumoId: bit.insumoId,
          qty: bit.qty / factor,
        }))
      : [],
  };
}

export function createCostCache() {
  return new Map<string, Built>();
}

export function costMenuItem(
  item: MenuItem,
  recipes: Map<string, Recipe>,
  insumos: Map<string, Insumo>,
  cache: Map<string, Built>
): ItemCost {
  if (item.recipeId) {
    const recipe = recipes.get(item.recipeId);
    if (!recipe) {
      return { cost: null, complete: false, missing: [item.name], lines: [], explosion: [] };
    }
    return perOrder(recipe, buildRecipe(recipe, recipes, insumos, cache, new Set()));
  }

  const portion = item.portion;
  if (!portion?.insumoId || portion.qty == null) {
    return {
      cost: null,
      complete: false,
      missing: [],
      lines: [],
      explosion: [],
    };
  }
  const insumo = insumos.get(portion.insumoId);
  if (!insumo) {
    return { cost: null, complete: false, missing: [item.name], lines: [], explosion: [] };
  }
  const qty = qtyInUnit(portion.qty, portion.unit || insumo.costingUnit, insumo.costingUnit);
  if (qty == null) {
    return {
      cost: null,
      complete: false,
      missing: [item.name],
      lines: [],
      explosion: [],
    };
  }
  return {
    cost: qty * insumo.costingPrice,
    complete: true,
    missing: [],
    lines: [
      {
        name: insumo.name,
        qty: portion.qty,
        unit: portion.unit || insumo.costingUnit,
        lineCost: qty * insumo.costingPrice,
        detail: portion.label || insumo.name,
        priceSource: insumo.priceSource,
      },
    ],
    explosion: [{ insumoId: insumo.id, qty }],
  };
}
