-- =============================================================================
-- Recetarios de cocina y barra
-- =============================================================================
-- Copia operativa local. El menú, las recetas y las fichas se importan una vez
-- (scripts/import_recetario.py) y el dashboard no vuelve a leer Drive.
-- Lo único que se actualiza después es el costo del insumo, con el precio de
-- la factura (scripts/update_recetario_costos_facturas.py).
--
-- Cómo aplicar: Supabase → SQL Editor → pegar este archivo → Run (re-run seguro).
-- Auth del suite: cookie HMAC + service role. RLS sin policies para anon.
-- =============================================================================

create table if not exists public.recipe_suppliers (
  id text primary key,
  name text not null,
  name_key text not null unique,
  category text,
  razon_social text,
  rfc text,
  credito text,
  periodo text
);

create table if not exists public.recipe_insumos (
  id text primary key,
  area text not null check (area in ('cocina', 'barra')),
  name text not null,
  name_key text not null,
  category text,
  supplier_name text,
  costing_unit text,
  costing_price numeric(14, 4),
  price_source text not null default 'master'
    check (price_source in ('master', 'factura')),
  price_as_of date,
  factura_emisor text,
  active boolean not null default true,
  unique (area, name_key)
);

create index if not exists recipe_insumos_name_idx
  on public.recipe_insumos (name_key);

create table if not exists public.recipe_insumo_offers (
  insumo_id text not null references public.recipe_insumos (id) on delete cascade,
  rank int not null check (rank in (1, 2, 3)),
  supplier_name text,
  costing_unit text,
  costing_price numeric(14, 4),
  primary key (insumo_id, rank)
);

create table if not exists public.recipes (
  id text primary key,
  area text not null check (area in ('cocina', 'barra')),
  code text not null,
  name text not null,
  name_key text not null,
  kind text not null check (kind in ('platillo', 'subreceta', 'coctel')),
  status text not null check (status in ('vigente', 'interno', 'archivado')),
  category text,
  yield_qty numeric(14, 4),
  yield_unit text,
  order_factor numeric(14, 4) not null default 1,
  method text,
  unique (area, code)
);

create table if not exists public.recipe_lines (
  id text primary key,
  recipe_id text not null references public.recipes (id) on delete cascade,
  sort_order int not null,
  ingredient_name text not null,
  qty numeric(14, 4) not null,
  unit text,
  insumo_id text references public.recipe_insumos (id),
  subrecipe_id text references public.recipes (id)
);

create index if not exists recipe_lines_recipe_idx
  on public.recipe_lines (recipe_id, sort_order);

create table if not exists public.recipe_menu_items (
  sku text primary key,
  area text not null check (area in ('cocina', 'barra')),
  name text not null,
  category text,
  sell_price numeric(12, 2) not null,
  recipe_id text references public.recipes (id),
  portion_insumo_id text references public.recipe_insumos (id),
  portion_qty numeric(14, 4),
  portion_unit text,
  portion_label text
);

create table if not exists public.recipe_fichas (
  sku text primary key,
  version text,
  descripcion text,
  categoria text,
  observaciones text,
  tipo_cocina text,
  tiempo_ciclo text,
  alergenos text,
  presentacion text,
  equipo text,
  acompanamientos text,
  procesos text,
  historia text,
  updated_at timestamptz not null default now()
);

-- Explosión lista para inventario. Esta entrega no escribe movimientos:
-- la compra sumaría qty y la venta la restaría según la receta.
create table if not exists public.recipe_stock_moves (
  id uuid primary key default gen_random_uuid(),
  insumo_id text not null references public.recipe_insumos (id),
  direction text not null check (direction in ('compra', 'venta')),
  qty numeric(14, 4) not null,
  unit text,
  ref text,
  created_at timestamptz not null default now()
);

alter table public.recipe_suppliers enable row level security;
alter table public.recipe_insumos enable row level security;
alter table public.recipe_insumo_offers enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.recipe_menu_items enable row level security;
alter table public.recipe_fichas enable row level security;
alter table public.recipe_stock_moves enable row level security;

comment on table public.recipe_insumos is
  'Catálogo de insumos importado una vez del master. costing_price se actualiza con facturas, no releyendo Drive.';
comment on table public.recipe_stock_moves is
  'Reservado. Venta de un platillo inserta salidas por la receta explotada; compra de insumo inserta entradas. Sin UI en esta entrega.';
