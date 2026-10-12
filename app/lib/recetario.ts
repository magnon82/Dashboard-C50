/**
 * Recetario de cocina y barra.
 * Lee la copia local (data/recetario/snapshot.json). No consulta Drive.
 * Si en Supabase hay precios con price_source = factura, esos pisan al master.
 */

import snapshotJson from '@/data/recetario/snapshot.json';
import { costMenuItem, createCostCache } from '@/app/lib/recetario-cost';
import type {
  Ficha,
  Insumo,
  MenuItem,
  RecetaArea,
  RecetarioSnapshot,
  Recipe,
} from '@/app/lib/recetario-types';
import { getServiceSupabase } from '@/app/lib/users';

const snapshot = snapshotJson as RecetarioSnapshot;

export type MenuStatus = 'enlazada' | 'parcial' | 'sin_costo' | 'sin_receta' | 'sin_insumo';

export type MenuRowView = {
  sku: string;
  name: string;
  category: string;
  sellPrice: number;
  cost: number | null;
  costPct: number | null;
  status: MenuStatus;
  missing: string[];
  portionLabel: string | null;
  lines: {
    name: string;
    qty: number;
    unit: string;
    lineCost: number | null;
    detail: string;
    priceSource: 'master' | 'factura' | null;
  }[];
  ficha: Ficha;
};

export type ConsumoLinea = {
  insumo: string;
  unidad: string;
  qty: number;
  costo: number | null;
};

export type RecetarioView = {
  area: RecetaArea;
  importedAt: string;
  sourceNote: string;
  categories: string[];
  items: MenuRowView[];
  consumo: {
    mes: string | null;
    meses: string[];
    aviso: string | null;
    lineas: ConsumoLinea[];
    sinEmpate: string[];
    sinCosto: string[];
  };
};

function norm(value: string): string {
  return value
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function maps(insumos: Insumo[]) {
  return {
    recipes: new Map<string, Recipe>(snapshot.recipes.map((r) => [r.id, r])),
    insumos: new Map<string, Insumo>(insumos.map((i) => [i.id, i])),
  };
}

async function overlayStored(insumos: Insumo[], fichas: Map<string, Ficha>) {
  try {
    const sb = getServiceSupabase();
    const [priceRes, fichaRes] = await Promise.all([
      sb
        .from('recipe_insumos')
        .select('id, costing_price, price_source, price_as_of, factura_emisor'),
      sb.from('recipe_fichas').select('*'),
    ]);
    let next = insumos;
    if (!priceRes.error && priceRes.data?.length) {
      const byId = new Map(priceRes.data.map((row) => [String(row.id), row]));
      next = insumos.map((insumo) => {
        const row = byId.get(insumo.id);
        if (!row || row.price_source !== 'factura' || row.costing_price == null) return insumo;
        return {
          ...insumo,
          costingPrice: Number(row.costing_price),
          priceSource: 'factura' as const,
          priceAsOf: row.price_as_of ? String(row.price_as_of) : null,
          facturaEmisor: row.factura_emisor ? String(row.factura_emisor) : null,
        };
      });
    }
    if (!fichaRes.error && fichaRes.data?.length) {
      for (const row of fichaRes.data) {
        const sku = String(row.sku || '');
        const current = fichas.get(sku);
        if (!current) continue;
        fichas.set(sku, {
          ...current,
          version: row.version || current.version,
          descripcion: row.descripcion || current.descripcion,
          categoria: row.categoria || current.categoria,
          observaciones: row.observaciones || current.observaciones,
          tipoCocina: row.tipo_cocina || current.tipoCocina,
          tiempoCiclo: row.tiempo_ciclo || current.tiempoCiclo,
          alergenos: row.alergenos || current.alergenos,
          presentacion: row.presentacion || current.presentacion,
          equipo: row.equipo || current.equipo,
          acompanamientos: row.acompanamientos || current.acompanamientos,
          procesos: row.procesos || current.procesos,
          historia: row.historia || current.historia,
        });
      }
    }
    return next;
  } catch {
    return insumos;
  }
}

function statusOf(item: MenuItem, complete: boolean, cost: number | null): MenuStatus {
  if (item.recipeId || item.portion?.insumoId) {
    if (complete && cost != null) return 'enlazada';
    if (cost != null) return 'parcial';
    return 'sin_costo';
  }
  if (item.portion) return 'sin_insumo';
  return 'sin_receta';
}

type VentaRow = { producto: string; unidades: number };

async function ventasDelMes(area: RecetaArea, mes: string | null) {
  const linea = area === 'cocina' ? 'alimentos' : 'bebidas';
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('financial_records')
      .select('description')
      .eq('source_file', 'costos_venta');
    if (error || !data) {
      return { mes: null, meses: [] as string[], aviso: 'No se pudo leer el costo por venta.', rows: [] as VentaRow[] };
    }
    const snaps = data
      .map((row) => {
        try {
          return JSON.parse(String((row as { description?: string }).description || '')) as {
            mes?: string;
            linea?: string;
            productos?: { producto?: string; unidades?: number }[];
          };
        } catch {
          return null;
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row?.mes && row.linea === linea));
    const meses = [...new Set(snaps.map((s) => String(s.mes)))];
    const chosen = mes && meses.includes(mes) ? mes : meses[meses.length - 1] || null;
    const snap = snaps.find((s) => s.mes === chosen);
    const rows = (snap?.productos || [])
      .map((p) => ({ producto: String(p.producto || ''), unidades: Number(p.unidades) || 0 }))
      .filter((p) => p.producto && p.unidades > 0);
    return {
      mes: chosen,
      meses,
      aviso: chosen ? null : 'El costo por venta todavía no está importado.',
      rows,
    };
  } catch {
    return {
      mes: null,
      meses: [] as string[],
      aviso: 'El consumo teórico usa las unidades ya guardadas del costo por venta.',
      rows: [] as VentaRow[],
    };
  }
}

function matchItem(producto: string, items: MenuItem[]): MenuItem | null {
  const key = norm(producto);
  const exact = items.find((item) => item.nameKey === key);
  if (exact) return exact;
  const words = key.split(' ').filter((w) => w.length > 3);
  if (!words.length) return null;
  const hits = items.filter((item) => words.every((w) => item.nameKey.split(' ').includes(w)));
  return hits.length === 1 ? hits[0] : null;
}

export async function loadRecetario(area: RecetaArea, mes: string | null): Promise<RecetarioView> {
  const fichas = new Map(snapshot.menu.map((item) => [item.sku, { ...item.ficha }]));
  const insumos = await overlayStored(snapshot.insumos, fichas);
  const { recipes, insumos: insumoMap } = maps(insumos);
  const cache = createCostCache();
  const menu = snapshot.menu.filter((item) => item.area === area);
  const items: MenuRowView[] = menu.map((item) => {
    const costed = costMenuItem({ ...item, ficha: fichas.get(item.sku) || item.ficha }, recipes, insumoMap, cache);
    const cost = costed.cost;
    const costPct =
      costed.complete && cost != null && item.sellPrice > 0 ? (cost / item.sellPrice) * 100 : null;
    return {
      sku: item.sku,
      name: item.name,
      category: item.category,
      sellPrice: item.sellPrice,
      cost,
      costPct,
      status: statusOf(item, costed.complete, cost),
      missing: costed.missing.slice(0, 8),
      portionLabel: item.portion?.label || null,
      lines: costed.lines,
      ficha: fichas.get(item.sku) || item.ficha,
    };
  });

  const ventas = await ventasDelMes(area, mes);
  const totals = new Map<string, number>();
  const sinEmpate: string[] = [];
  const sinCosto: string[] = [];
  const bySku = new Map(menu.map((item) => [item.sku, item]));
  for (const venta of ventas.rows) {
    const item = matchItem(venta.producto, menu);
    if (!item) {
      sinEmpate.push(venta.producto);
      continue;
    }
    const view = items.find((row) => row.sku === item.sku);
    if (!view || view.status !== 'enlazada') {
      sinCosto.push(venta.producto);
      continue;
    }
    const costed = costMenuItem(bySku.get(item.sku) || item, recipes, insumoMap, cache);
    for (const bit of costed.explosion) {
      totals.set(bit.insumoId, (totals.get(bit.insumoId) || 0) + bit.qty * venta.unidades);
    }
  }
  const lineas = [...totals.entries()]
    .map(([id, qty]) => {
      const insumo = insumoMap.get(id);
      return {
        insumo: insumo?.name || id,
        unidad: insumo?.costingUnit || '',
        qty,
        costo: insumo ? qty * insumo.costingPrice : null,
      };
    })
    .sort((a, b) => (b.costo || 0) - (a.costo || 0));

  const categories = [...new Set(items.map((item) => item.category))];
  return {
    area,
    importedAt: snapshot.importedAt,
    sourceNote: snapshot.sourceNote,
    categories,
    items,
    consumo: {
      mes: ventas.mes,
      meses: ventas.meses,
      aviso: ventas.aviso,
      lineas,
      sinEmpate: [...new Set(sinEmpate)].slice(0, 40),
      sinCosto: [...new Set(sinCosto)].slice(0, 40),
    },
  };
}

export async function saveFicha(sku: string, patch: Partial<Ficha>): Promise<{ ok: true } | { ok: false; error: string }> {
  const item = snapshot.menu.find((row) => row.sku === sku);
  if (!item) return { ok: false, error: 'Ese platillo no está en el menú vigente.' };
  try {
    const sb = getServiceSupabase();
    const row = {
      sku,
      version: patch.version ?? item.ficha.version,
      descripcion: patch.descripcion ?? item.ficha.descripcion,
      categoria: patch.categoria ?? item.ficha.categoria,
      observaciones: patch.observaciones ?? item.ficha.observaciones,
      tipo_cocina: patch.tipoCocina ?? item.ficha.tipoCocina,
      tiempo_ciclo: patch.tiempoCiclo ?? item.ficha.tiempoCiclo,
      alergenos: patch.alergenos ?? item.ficha.alergenos,
      presentacion: patch.presentacion ?? item.ficha.presentacion,
      equipo: patch.equipo ?? item.ficha.equipo,
      acompanamientos: patch.acompanamientos ?? item.ficha.acompanamientos,
      procesos: patch.procesos ?? item.ficha.procesos,
      historia: patch.historia ?? item.ficha.historia,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('recipe_fichas').upsert(row, { onConflict: 'sku' });
    if (error) {
      return {
        ok: false,
        error: 'No se pudo guardar la ficha. Ejecuta supabase/recetario.sql en Supabase.',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'No se pudo guardar la ficha. Ejecuta supabase/recetario.sql en Supabase.',
    };
  }
}
