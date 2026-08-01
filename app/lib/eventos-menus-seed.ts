/**
 * Catálogo local de menús Eventos (fallback si Supabase aún no tiene tablas).
 * Fuente: supabase/seed_event_menus.json (= seed de eventos_module.sql),
 * derivado solo de I:\Mi unidad\Eventos\Menús\Menús eventos vigentes.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import {
  sanitizeEventMenuTextFields,
  type EventMenu,
  type EventMenuItem,
  type MenuChoiceGroup,
} from '@/app/lib/eventos';

type SeedFile = {
  menus?: Array<
    Omit<EventMenu, 'items'> & {
      items?: Array<
        Omit<EventMenuItem, 'menu_id'> & {
          menu_id?: string;
          choice_groups?: MenuChoiceGroup[] | null;
        }
      >;
    }
  >;
};

let cached: EventMenu[] | null = null;

function normalizeChoiceGroups(
  raw: MenuChoiceGroup[] | null | undefined
): MenuChoiceGroup[] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((g) => ({
    id: String(g.id),
    label: String(g.label || g.id),
    required: Boolean(g.required),
    affects_price: Boolean(g.affects_price),
    options: (g.options || []).map((o) => ({
      id: String(o.id),
      label: String(o.label),
      unit_price:
        o.unit_price == null || o.unit_price === undefined
          ? null
          : Number(o.unit_price),
      is_vegetarian: Boolean(o.is_vegetarian),
      price_verified:
        o.price_verified === undefined ? true : Boolean(o.price_verified),
      price_source: o.price_source ?? null,
    })),
  }));
}

/** Lee el JSON como UTF-8 (omite BOM si existe). */
async function readSeedJsonUtf8(file: string): Promise<string> {
  const buf = await readFile(file);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

export async function loadEventMenusSeed(): Promise<EventMenu[]> {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'supabase', 'seed_event_menus.json');
  const raw = await readSeedJsonUtf8(file);
  const parsed = JSON.parse(raw) as SeedFile;
  const menus = (parsed.menus || [])
    .filter((m) => m.active !== false)
    .map((m) => {
      const items: EventMenuItem[] = (m.items || [])
        .filter((it) => it.active !== false)
        .map((it) => ({
          id: String(it.id),
          menu_id: String(m.id),
          sku: it.sku ?? null,
          name: it.name,
          description: it.description ?? null,
          unit: it.unit || 'persona',
          unit_price: Number(it.unit_price),
          min_pax: it.min_pax ?? null,
          is_vegetarian: Boolean(it.is_vegetarian),
          active: it.active !== false,
          sort_order: Number(it.sort_order || 0),
          price_source: it.price_source ?? null,
          price_verified: Boolean(it.price_verified),
          choice_groups: normalizeChoiceGroups(it.choice_groups),
        }))
        .sort((a, b) => a.sort_order - b.sort_order);
      return sanitizeEventMenuTextFields({
        id: String(m.id),
        code: m.code,
        name: m.name,
        category: m.category,
        description: m.description ?? null,
        min_pax: m.min_pax ?? null,
        requires_food: Boolean(m.requires_food),
        includes_servicio: Boolean(m.includes_servicio),
        active: m.active !== false,
        sort_order: Number(m.sort_order || 0),
        notes: m.notes ?? null,
        items,
      } satisfies EventMenu);
    })
    .sort((a, b) => a.sort_order - b.sort_order);
  cached = menus;
  return menus;
}

/** UUID v4-ish — seed local usa ids `local-…` que no son FK válidos. */
export function isPersistedMenuItemId(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}
