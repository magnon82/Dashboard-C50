-- Módulo operativo Eventos (CRM + cotizador + stubs)
-- Ejecutar en Supabase → SQL Editor.
-- Auth del suite: cookie HMAC + service role (igual que dashboard_users / financial_records).
-- RLS habilitado SIN policies para anon/authenticated: solo service_role lee/escribe vía API.
-- NO tocar financial_records.source_file='eventos' (eso es analytics Ventas / ingest_eventos.py).

-- ---------------------------------------------------------------------------
-- Clientes CRM
-- ---------------------------------------------------------------------------
create table if not exists public.event_clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  notes text,
  source text not null default 'manual'
    check (source in ('manual', 'excel_seed', 'import', 'sheets')),
  owner_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_clients_company_idx
  on public.event_clients (lower(company_name));
create index if not exists event_clients_owner_idx
  on public.event_clients (owner_username);

alter table public.event_clients enable row level security;

comment on table public.event_clients is
  'CRM de clientes de eventos. Coexiste con lista Excel / Sheets; owner_username = vendedor.';

-- Campos opcionales de actividad histórica (OS / Anticipos / Seguimiento).
-- El MVP también enriquece vía supabase/seed_event_client_activity.json sin exigir estas columnas.
alter table public.event_clients
  add column if not exists last_activity_at date;
alter table public.event_clients
  add column if not exists last_activity_source text;
alter table public.event_clients
  add column if not exists activity_count integer not null default 0;

create index if not exists event_clients_last_activity_idx
  on public.event_clients (last_activity_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Leads / pipeline
-- ---------------------------------------------------------------------------
create table if not exists public.event_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.event_clients (id) on delete set null,
  title text not null,
  stage text not null default 'nuevo'
    check (stage in (
      'nuevo', 'contactado', 'cotizado', 'negociacion', 'ganado', 'perdido'
    )),
  event_date date,
  pax integer,
  estimated_amount numeric(12, 2),
  owner_username text,
  notes text,
  hold_until timestamptz,
  hold_extended_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_leads_stage_idx on public.event_leads (stage);
create index if not exists event_leads_owner_idx on public.event_leads (owner_username);
create index if not exists event_leads_event_date_idx on public.event_leads (event_date);

alter table public.event_leads enable row level security;

comment on table public.event_leads is
  'Pipeline comercial de eventos. Hold: 72 h hábiles; sin hold si faltan <15 días al evento.';

-- ---------------------------------------------------------------------------
-- Catálogo de menús
-- ---------------------------------------------------------------------------
create table if not exists public.event_menus (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null
    check (category in (
      'tres_tiempos', 'desayunos', 'parejas', 'barra_libre', 'paquete', 'extra'
    )),
  description text,
  min_pax integer,
  requires_food boolean not null default false,
  includes_servicio boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.event_menus (id) on delete cascade,
  sku text,
  name text not null,
  description text,
  unit text not null default 'persona'
    check (unit in ('persona', 'paquete', 'hora', 'evento', 'unidad')),
  unit_price numeric(12, 2) not null,
  min_pax integer,
  is_vegetarian boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  price_source text,
  price_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists event_menu_items_menu_idx
  on public.event_menu_items (menu_id);

alter table public.event_menus enable row level security;
alter table public.event_menu_items enable row level security;

comment on table public.event_menus is
  'Catálogos comerciales (3 tiempos, desayunos, parejas, barra libre).';
comment on column public.event_menu_items.price_verified is
  'false = precio de seed/PDF pendiente de verificación operativa.';

-- ---------------------------------------------------------------------------
-- Cotizaciones
-- ---------------------------------------------------------------------------
create table if not exists public.event_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text,
  client_id uuid references public.event_clients (id) on delete set null,
  lead_id uuid references public.event_leads (id) on delete set null,
  status text not null default 'borrador'
    check (status in ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida')),
  event_date date,
  pax integer not null default 10,
  subtotal numeric(12, 2) not null default 0,
  servicio_pct numeric(5, 4) not null default 0.15,
  servicio_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  apply_servicio boolean not null default true,
  currency text not null default 'MXN',
  owner_username text,
  notes text,
  valid_until date,
  hold_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.event_quotes (id) on delete cascade,
  menu_item_id uuid references public.event_menu_items (id) on delete set null,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null,
  line_total numeric(12, 2) not null,
  sort_order integer not null default 0
);

create index if not exists event_quotes_status_idx on public.event_quotes (status);
create index if not exists event_quote_lines_quote_idx on public.event_quote_lines (quote_id);

alter table public.event_quotes enable row level security;
alter table public.event_quote_lines enable row level security;

comment on table public.event_quotes is
  'Cotizaciones: total = subtotal + (servicio 15% si apply_servicio).';

-- ---------------------------------------------------------------------------
-- Stubs Fase 2
-- ---------------------------------------------------------------------------
create table if not exists public.event_bookings (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.event_quotes (id) on delete set null,
  lead_id uuid references public.event_leads (id) on delete set null,
  client_id uuid references public.event_clients (id) on delete set null,
  event_date date not null,
  start_time time,
  end_time time,
  pax integer,
  status text not null default 'tentativo'
    check (status in ('tentativo', 'confirmado', 'cancelado', 'completado')),
  gcal_event_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_service_orders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.event_bookings (id) on delete set null,
  quote_id uuid references public.event_quotes (id) on delete set null,
  os_number text,
  status text not null default 'borrador'
    check (status in ('borrador', 'emitida', 'en_curso', 'cerrada')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.event_bookings (id) on delete set null,
  quote_id uuid references public.event_quotes (id) on delete set null,
  amount numeric(12, 2) not null,
  paid_at date,
  method text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'parcial', 'pagado', 'reembolsado')),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.event_bookings enable row level security;
alter table public.event_service_orders enable row level security;
alter table public.event_payments enable row level security;

comment on table public.event_bookings is
  'Stub reservas / calendario. Sync GCal compartido = Fase 2.';
comment on table public.event_service_orders is
  'Stub órdenes de servicio (OS).';
comment on table public.event_payments is
  'Stub pagos / anticipos de eventos.';

-- ---------------------------------------------------------------------------
-- Seed catálogo (precios desde PDFs vigentes / NUEVOS PRECIOS; verificar operativamente)
-- ---------------------------------------------------------------------------
insert into public.event_menus (code, name, category, description, min_pax, requires_food, includes_servicio, sort_order, notes)
values
  (
    'menu_3_tiempos_2025',
    'Menú 3 tiempos 2025',
    'tres_tiempos',
    'Entrada + fuerte + postre. Grupos desde 10 personas. Precio por persona.',
    10,
    false,
    false,
    10,
    'Fuente: Menú 3 tiempos 2025.pdf + NUEVOS PRECIOS EVENTO.xlsx (sugerido). TODO verificar lista completa de entradas/postres.'
  ),
  (
    'desayunos_2025',
    'Menú desayunos 2025',
    'desayunos',
    'Desayunos por persona. Pack ≥50 pax = $30,000. Mínimo menú regular 50 / buffet 30 (PDF).',
    30,
    false,
    false,
    20,
    'Fuente: Menú desayunos 2025.pdf. Pack $30k ≥50 pax = regla comercial locked.'
  ),
  (
    'desayunos_pack_50',
    'Pack desayunos (≥50 pax)',
    'paquete',
    'Paquete fijo $30,000 para desayunos con mínimo 50 personas.',
    50,
    false,
    false,
    21,
    'Regla comercial locked: desayunos ≥50 pax = $30,000.'
  ),
  (
    'parejas_es_2025',
    'Menú parejas ES',
    'parejas',
    'Cena romántica para 2. Precio por paquete (incluye 15% propina según PDF).',
    2,
    false,
    true,
    30,
    'Fuente: Menú parejas ES.pdf'
  ),
  (
    'parejas_en_2025',
    'Menú parejas EN',
    'parejas',
    'Couples package (EN). Price per package (15% tip included per PDF).',
    2,
    false,
    true,
    31,
    'Fuente: Menú parejas EN.pdf / Parejas packinglés FEB25.pdf'
  ),
  (
    'barra_libre_2025',
    'Barra libre eventos 2025',
    'barra_libre',
    'Solo con comida (menú 3 tiempos u otro menú de alimentos). Precio por persona / 3 h.',
    10,
    true,
    false,
    40,
    'Fuente: Barra libre eventos 2025.pdf. Regla: barra libre solo con alimentos.'
  )
on conflict (code) do nothing;

-- Ítems 3 tiempos (precios PDF oficiales donde existen; resto sugerido cost sheet — price_verified=false)
insert into public.event_menu_items (menu_id, sku, name, unit, unit_price, is_vegetarian, sort_order, price_source, price_verified)
select m.id, v.sku, v.name, 'persona', v.price, v.veg, v.ord, v.src, v.verified
from public.event_menus m
cross join (values
  ('3T-FET', 'Fetuccini cherry', 480.00, true, 10, 'pdf_3_tiempos_2025', true),
  ('3T-PECH', 'Pechuga en moles (250 g)', 580.00, false, 20, 'pdf_3_tiempos_2025', true),
  ('3T-RAV', 'Ravioles de requesón y espinaca (130 g)', 560.00, true, 30, 'pdf_3_tiempos_2025', true),
  ('3T-CHA', 'Chamorro al pastor (½ pz)', 580.00, false, 40, 'pdf_3_tiempos_2025', true),
  ('3T-SIR', 'Sirloin a las brasas (300 g)', 850.00, false, 50, 'pdf_3_tiempos_2025', true),
  ('3T-RIB', 'Rib eye (300 g)', 850.00, false, 60, 'pdf_3_tiempos_2025', true),
  ('3T-ATUN', 'Atún en ponzu', 560.00, false, 70, 'pdf_3_tiempos_2025', true),
  ('3T-PUL', 'Pulpo al grill', 750.00, false, 80, 'nuevos_precios_sugerido', false),
  ('3T-COST', 'Costillar', 630.00, false, 90, 'nuevos_precios_sugerido', false),
  ('3T-HAM', 'Hamburguesa azul', 590.00, false, 100, 'nuevos_precios_sugerido', false),
  ('3T-FIL', 'Filete y mole de olla', 700.00, false, 110, 'nuevos_precios_sugerido', false),
  ('3T-CHE', 'Nuestro chemita', 700.00, false, 120, 'nuevos_precios_sugerido', false),
  ('3T-HUA', 'Huachinango', 750.00, false, 130, 'nuevos_precios_sugerido', false),
  ('3T-LAS', 'Lasaña de huitlacoche', 690.00, true, 140, 'nuevos_precios_sugerido', false),
  ('3T-SAL', 'Salmón', 750.00, false, 150, 'nuevos_precios_sugerido', false)
) as v(sku, name, price, veg, ord, src, verified)
where m.code = 'menu_3_tiempos_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );

-- Desayunos por persona
insert into public.event_menu_items (menu_id, sku, name, unit, unit_price, min_pax, sort_order, price_source, price_verified)
select m.id, v.sku, v.name, 'persona', v.price, v.min_pax, v.ord, 'pdf_desayunos_2025', true
from public.event_menus m
cross join (values
  ('DES-1', 'Menú 1 — Huevos (variedad)', 250.00, 50, 10),
  ('DES-2', 'Menú 2 — Enchiladas / enfrijoladas', 320.00, 50, 20),
  ('DES-3', 'Menú 3 — Chilaquiles', 280.00, 50, 30),
  ('DES-4', 'Menú 4 — Emparedado de salmón curado', 350.00, 50, 40),
  ('DES-5', 'Menú 5 — Costilla de res + chilaquiles', 320.00, 50, 50),
  ('DES-5B', 'Menú 5 — Costilla con huevo', 550.00, 50, 51),
  ('DES-5C', 'Menú 5 — Costilla con chilaquiles (pack)', 550.00, 50, 52),
  ('DES-6', 'Menú 6 — Cecina de res + chilaquiles', 320.00, 50, 60)
) as v(sku, name, price, min_pax, ord)
where m.code = 'desayunos_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );

insert into public.event_menu_items (menu_id, sku, name, unit, unit_price, min_pax, sort_order, price_source, price_verified)
select m.id, 'DES-PACK50', 'Pack desayunos ≥50 personas', 'paquete', 30000.00, 50, 10,
       'regla_comercial_locked', true
from public.event_menus m
where m.code = 'desayunos_pack_50'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = 'DES-PACK50'
  );

-- Parejas ES
insert into public.event_menu_items (menu_id, sku, name, unit, unit_price, sort_order, price_source, price_verified)
select m.id, v.sku, v.name, 'paquete', v.price, v.ord, 'pdf_parejas_es', true
from public.event_menus m
cross join (values
  ('PAR-ES-SIR', 'Pareja ES — Sirloin', 2700.00, 10),
  ('PAR-ES-PECH', 'Pareja ES — Pechuga en moles', 2300.00, 20),
  ('PAR-ES-RAV', 'Pareja ES — Ravioles de requesón', 2300.00, 30),
  ('PAR-ES-FLO', 'Ramo de flores (extra)', 350.00, 40)
) as v(sku, name, price, ord)
where m.code = 'parejas_es_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );

-- Parejas EN
insert into public.event_menu_items (menu_id, sku, name, unit, unit_price, sort_order, price_source, price_verified)
select m.id, v.sku, v.name, 'paquete', v.price, v.ord, 'pdf_parejas_en', true
from public.event_menus m
cross join (values
  ('PAR-EN-SIR', 'Couples EN — Sirloin', 2450.00, 10),
  ('PAR-EN-PECH', 'Couples EN — Chicken in mole', 2150.00, 20),
  ('PAR-EN-RAV', 'Couples EN — Ricotta ravioli', 2150.00, 30),
  ('PAR-EN-FLO', 'Bouquet of flowers (extra)', 350.00, 40)
) as v(sku, name, price, ord)
where m.code = 'parejas_en_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );

-- Barra libre
insert into public.event_menu_items (menu_id, sku, name, description, unit, unit_price, sort_order, price_source, price_verified)
select m.id, v.sku, v.name, v.descr, v.unit, v.price, v.ord, 'pdf_barra_libre_2025', true
from public.event_menus m
cross join (values
  ('BAR-NAC', 'Barra libre nacional', '3 horas · hora extra $185', 'persona', 600.00, 10),
  ('BAR-NAC-XH', 'Barra nacional — hora extra', null, 'hora', 185.00, 11),
  ('BAR-INT', 'Barra libre internacional', '3 horas · hora extra $300', 'persona', 950.00, 20),
  ('BAR-INT-XH', 'Barra internacional — hora extra', null, 'hora', 300.00, 21),
  ('BAR-REF', 'Barra libre de refrescos', 'Solo con menú 3 tiempos · 3 h · extra $90', 'persona', 290.00, 30),
  ('BAR-REF-XH', 'Barra refrescos — hora extra', null, 'hora', 90.00, 31)
) as v(sku, name, descr, unit, price, ord)
where m.code = 'barra_libre_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );
