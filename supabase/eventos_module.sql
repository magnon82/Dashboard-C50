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
  -- title = título kanban; por defecto se copia de celebration («¿Qué celebran?»)
  title text not null,
  contact_name text,
  phone text,
  email text,
  company text,
  celebration text,
  stage text not null default 'nuevo'
    check (stage in (
      'nuevo', 'contactado', 'cotizado', 'negociacion', 'ganado', 'perdido'
    )),
  event_date date,
  pax integer,
  -- Presupuesto por persona (MXN)
  estimated_amount numeric(12, 2),
  owner_username text,
  -- Notas / requisiciones del cliente
  notes text,
  hold_until timestamptz,
  hold_extended_by text,
  -- Checklist del manual (captura, bienvenida, alta_cliente, cotizacion, seg_d3, seg_d5, hold, cierre)
  follow_up_done text[] not null default '{}',
  -- Próxima acción; difiere alertas de cadencia hasta esa fecha
  next_follow_up_at timestamptz,
  -- Origen: manual (UI), sheets (Seguimiento eventos), import, cotizador
  source text not null default 'manual'
    check (source in ('manual', 'sheets', 'import', 'cotizador')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_leads_stage_idx on public.event_leads (stage);
create index if not exists event_leads_owner_idx on public.event_leads (owner_username);
create index if not exists event_leads_event_date_idx on public.event_leads (event_date);

alter table public.event_leads enable row level security;

comment on table public.event_leads is
  'Pipeline comercial de eventos. Hold: 72 h hábiles; sin hold si faltan <15 días al evento. Checklist/alertas: follow_up_done + next_follow_up_at (manual de seguimiento).';

comment on column public.event_leads.follow_up_done is
  'Ids del checklist del Manual de seguimiento (captura, bienvenida, alta_cliente, cotizacion, seg_d3, seg_d5, hold, cierre). cotizacion = generar en Cotizador + enviar PDF.';

comment on column public.event_leads.next_follow_up_at is
  'Próxima acción de seguimiento; si es futura, difiere alertas de cadencia (no holds).';

-- ---------------------------------------------------------------------------
-- Catálogo de menús
-- ---------------------------------------------------------------------------
create table if not exists public.event_menus (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null
    check (category in (
      'tres_tiempos', 'carta', 'desayunos', 'parejas', 'barra_libre', 'paquete', 'extra'
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
  -- Grupos de elección (plato fuerte, entrada, postre…). Ver seed Menú 3 tiempos.
  choice_groups jsonb,
  created_at timestamptz not null default now()
);

-- Bases ya creadas sin choice_groups
alter table public.event_menu_items
  add column if not exists choice_groups jsonb;

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
    check (status in ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'perdida')),
  event_date date,
  pax integer not null default 10,
  celebration text,
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
  public_token text,
  accepted_at timestamptz,
  payment_method text,
  client_accept_note text,
  payment_link_url text,
  perdida_note text,
  perdida_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_quotes
  add column if not exists celebration text;

alter table public.event_quotes
  add column if not exists public_token text;

alter table public.event_quotes
  add column if not exists accepted_at timestamptz;

alter table public.event_quotes
  add column if not exists payment_method text;

alter table public.event_quotes
  add column if not exists client_accept_note text;

alter table public.event_quotes
  add column if not exists payment_link_url text;

alter table public.event_quotes
  add column if not exists perdida_note text;

alter table public.event_quotes
  add column if not exists perdida_at timestamptz;

-- Status check ampliado (idempotente si la tabla ya existía).
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public'
      and t.relname = 'event_quotes'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* 'status'
      and pg_get_constraintdef(c.oid) !~* 'payment_method'
  loop
    execute format('alter table public.event_quotes drop constraint %I', r.conname);
  end loop;
  alter table public.event_quotes
    drop constraint if exists event_quotes_status_check;
  alter table public.event_quotes
    add constraint event_quotes_status_check
    check (
      status in (
        'borrador',
        'enviada',
        'aceptada',
        'rechazada',
        'vencida',
        'perdida'
      )
    );
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_quotes_payment_method_check'
  ) then
    alter table public.event_quotes
      add constraint event_quotes_payment_method_check
      check (
        payment_method is null
        or payment_method in (
          'efectivo_restaurante',
          'tarjeta_terminal',
          'tarjeta_link',
          'transferencia_bbva'
        )
      );
  end if;
end $$;

create unique index if not exists event_quotes_public_token_uidx
  on public.event_quotes (public_token)
  where public_token is not null;

create table if not exists public.event_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.event_quotes (id) on delete cascade,
  menu_item_id uuid references public.event_menu_items (id) on delete set null,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null,
  line_total numeric(12, 2) not null,
  sort_order integer not null default 0,
  -- Elecciones: { "plato_fuerte": "Pechuga en moles…", "entrada": "…", "postre": "…" }
  options jsonb not null default '{}'::jsonb
);

alter table public.event_quote_lines
  add column if not exists options jsonb not null default '{}'::jsonb;

create index if not exists event_quotes_status_idx on public.event_quotes (status);
create index if not exists event_quote_lines_quote_idx on public.event_quote_lines (quote_id);

create unique index if not exists event_quotes_quote_number_uidx
  on public.event_quotes (quote_number)
  where quote_number is not null;

alter table public.event_quotes enable row level security;
alter table public.event_quote_lines enable row level security;

comment on table public.event_quotes is
  'Cotizaciones: total = subtotal + (servicio 15% si apply_servicio).';
comment on column public.event_quotes.quote_number is
  'Folio de cotización para el cliente (COT-YYYY-###). Independiente de event_service_orders.os_number.';

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
  lead_id uuid references public.event_leads (id) on delete set null,
  client_id uuid references public.event_clients (id) on delete set null,
  os_number text,
  status text not null default 'borrador'
    check (status in ('borrador', 'emitida', 'en_curso', 'cerrada')),
  event_date date,
  pax integer,
  celebration text,
  client_name text,
  contact_name text,
  notes text,
  subtotal numeric(12, 2) not null default 0,
  servicio_pct numeric(5, 4) not null default 0.15,
  servicio_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  apply_servicio boolean not null default true,
  owner_username text,
  -- Snapshot líneas / extras para vista imprimible (no depende de quote_lines)
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bases ya creadas como stub → columnas densas + índices
alter table public.event_service_orders
  add column if not exists lead_id uuid references public.event_leads (id) on delete set null;
alter table public.event_service_orders
  add column if not exists client_id uuid references public.event_clients (id) on delete set null;
alter table public.event_service_orders
  add column if not exists event_date date;
alter table public.event_service_orders
  add column if not exists pax integer;
alter table public.event_service_orders
  add column if not exists celebration text;
alter table public.event_service_orders
  add column if not exists client_name text;
alter table public.event_service_orders
  add column if not exists contact_name text;
alter table public.event_service_orders
  add column if not exists notes text;
alter table public.event_service_orders
  add column if not exists subtotal numeric(12, 2) not null default 0;
alter table public.event_service_orders
  add column if not exists servicio_pct numeric(5, 4) not null default 0.15;
alter table public.event_service_orders
  add column if not exists servicio_amount numeric(12, 2) not null default 0;
alter table public.event_service_orders
  add column if not exists total numeric(12, 2) not null default 0;
alter table public.event_service_orders
  add column if not exists apply_servicio boolean not null default true;
alter table public.event_service_orders
  add column if not exists owner_username text;

create unique index if not exists event_service_orders_quote_uidx
  on public.event_service_orders (quote_id)
  where quote_id is not null;

create index if not exists event_service_orders_event_date_idx
  on public.event_service_orders (event_date desc nulls last);

create index if not exists event_service_orders_lead_idx
  on public.event_service_orders (lead_id);

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
  'Órdenes de servicio digitales (desde cotización aceptada). Coexiste con PDFs en Drive (Ordenes de servicio). payload = snapshot de líneas.';
comment on table public.event_payments is
  'Stub pagos / anticipos de eventos.';

-- ---------------------------------------------------------------------------
-- Seed catálogo — Menús eventos vigentes + bebidas C50 Esp
-- I:\Mi unidad\Eventos\Menús\Menús eventos vigentes
-- Bebidas add-on: I:\Mi unidad\Menú C50\Menú C50 Esp.pdf (solo bebidas; ver eventos_menus_bebidas_c50.sql)
-- (no usar Menús eventos viejos / NUEVOS PRECIOS / alimentos de carta C50)
-- ---------------------------------------------------------------------------
insert into public.event_menus (code, name, category, description, min_pax, requires_food, includes_servicio, sort_order, notes)
values
  (
    'menu_3_tiempos_2025',
    'Menú 3 tiempos 2025',
    'tres_tiempos',
    'Entrada + plato fuerte (a elegir) + postre. Precio por persona según el fuerte. Grupos desde 10 personas.',
    10,
    false,
    false,
    10,
    'Fuente definitiva: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Menú 3 tiempos 2025.pdf — solo 7 fuertes del PDF (sin extras OS/carta C50).'
  ),
  (
    'menu_regular_c50',
    'Menú regular (C50)',
    'carta',
    'Carta de alimentos del restaurante (Menú C50 Esp). Precio por platillo / persona. Grupos desde 10 personas.',
    10,
    false,
    false,
    15,
    'Fuente: I:\Mi unidad\Menú C50\Menú C50 Esp.pdf — entradas, fuertes, postres y guarniciones. Ítems vía seed JSON / soft-load API.'
  ),
  (
    'desayunos_2025',
    'Menú desayunos 2025',
    'desayunos',
    'Desayunos por persona (PDF 2025). Mínimo 50 personas. Pack ≥50 pax = $30,000 (regla comercial).',
    50,
    false,
    false,
    20,
    'Fuente definitiva: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Menú desayunos 2025.pdf. Pack $30k ≥50 pax = regla comercial locked. TODO: CON HUEVO/CON CHILAQUILES $550 (pág. 3).'
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
    'Regla comercial locked: desayunos ≥50 pax = $30,000. Alineado a Menú desayunos 2025.pdf (vigentes).'
  ),
  (
    'parejas_es_2025',
    'Menú parejas ES',
    'parejas',
    'Cena romántica para 2. Precio por paquete (incluye 15% de servicio según PDF).',
    2,
    false,
    true,
    30,
    'Fuente: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Menú parejas ES.pdf'
  ),
  (
    'parejas_en_2025',
    'Menú parejas EN',
    'parejas',
    'Couples package (EN). Price per package (15% service included per PDF).',
    2,
    false,
    true,
    31,
    'Fuente: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Menú parejas EN.pdf'
  ),
  (
    'barra_libre_2025',
    'Barra libre eventos 2025',
    'barra_libre',
    'Solo con comida (menú 3 tiempos u otro menú de alimentos). Precio por persona / 3 h. Incluye nacional, internacional y refrescos.',
    10,
    true,
    false,
    40,
    'Fuente definitiva: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Barra libre eventos 2025.pdf. Precios con I.V.A.; no incluyen propina. Consumo por pieza → Bebidas (Menú C50).'
  ),
  (
    'bebidas_a_la_carta',
    'Bebidas (Menú C50)',
    'extra',
    'Consumo por pieza / botella según Menú C50 Esp.pdf (solo bebidas; sin alimentos de la carta). Edita precio unitario si aplica.',
    null,
    false,
    false,
    45,
    'Fuente: I:\Mi unidad\Menú C50\Menú C50 Esp.pdf — VINOS, CAFÉ, COCTELERÍA, DESTILADOS, CERVEZAS, SIN ALCOHOL. Alimentos ignorados. Patch completo: eventos_menus_bebidas_c50.sql.'
  )
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  min_pax = excluded.min_pax,
  requires_food = excluded.requires_food,
  includes_servicio = excluded.includes_servicio,
  sort_order = excluded.sort_order,
  notes = excluded.notes,
  active = true;

-- Ítem Menú 3 tiempos con choice_groups (plato fuerte a elegir = precio)
-- Desactiva SKUs sueltos antiguos (3T-FET, …) si existían como ítems planos.
update public.event_menu_items i
set active = false
from public.event_menus m
where i.menu_id = m.id
  and m.code = 'menu_3_tiempos_2025'
  and i.sku is distinct from '3T-MENU'
  and i.sku like '3T-%';

insert into public.event_menu_items (
  menu_id, sku, name, description, unit, unit_price, min_pax,
  is_vegetarian, sort_order, price_source, price_verified, choice_groups
)
select
  m.id,
  '3T-MENU',
  'Menú 3 tiempos',
  'Incluye entrada, plato fuerte y postre. Elige el fuerte para fijar el precio por persona.',
  'persona',
  480.00,
  10,
  false,
  10,
  'pdf_3_tiempos_2025',
  true,
  '[]'::jsonb
from public.event_menus m
where m.code = 'menu_3_tiempos_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = '3T-MENU'
  );

-- Actualiza choice_groups del ítem canónico (idempotente)
update public.event_menu_items i
set
  name = 'Menú 3 tiempos',
  description = 'Incluye entrada, plato fuerte y postre. Elige el fuerte para fijar el precio por persona.',
  unit_price = 480.00,
  min_pax = 10,
  active = true,
  price_source = 'pdf_3_tiempos_2025',
  price_verified = true,
  choice_groups = $cg$[
    {
      "id": "plato_fuerte",
      "label": "Plato fuerte",
      "required": true,
      "affects_price": true,
      "options": [
        {"id":"3T-FET","label":"Fetuccini cherry","unit_price":480,"is_vegetarian":true,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-RAV","label":"Ravioles de requesón y espinaca (130 g)","unit_price":560,"is_vegetarian":true,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-PECH","label":"Pechuga en moles (250 g)","unit_price":580,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-CHA","label":"Chamorro al pastor (½ pz)","unit_price":580,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-ATUN","label":"Atún en ponzu","unit_price":560,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-SIR","label":"Sirloin a las brasas (300 g)","unit_price":850,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-RIB","label":"Rib eye (300 g)","unit_price":850,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"}
      ]
    },
    {
      "id": "entrada",
      "label": "Entrada",
      "required": false,
      "affects_price": false,
      "options": [
        {"id":"ENT-QUES","label":"Quesadillas Coyoacán (2 pz)"},
        {"id":"ENT-COLI","label":"Coliflor rostizada"},
        {"id":"ENT-JUGO","label":"Jugo de carne"},
        {"id":"ENT-SOPA","label":"Sopa de hongos al carbón"},
        {"id":"ENT-CESAR","label":"Ensalada César al carbón"},
        {"id":"ENT-TOM","label":"Ensalada de tomates cherry"}
      ]
    },
    {
      "id": "postre",
      "label": "Postre",
      "required": false,
      "affects_price": false,
      "options": [
        {"id":"POS-MOUSSE","label":"Mousse de 3 chocolates"},
        {"id":"POS-CHEESE-ELOTE","label":"Cheesecake pan de elote"}
      ]
    }
  ]$cg$::jsonb
from public.event_menus m
where i.menu_id = m.id
  and m.code = 'menu_3_tiempos_2025'
  and i.sku = '3T-MENU';

update public.event_menus
set
  description = 'Entrada + plato fuerte (a elegir) + postre. Precio por persona según el fuerte. Grupos desde 10 personas.',
  notes = 'Fuente definitiva: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Menú 3 tiempos 2025.pdf — solo 7 fuertes del PDF (sin extras OS/carta C50).'
where code = 'menu_3_tiempos_2025';

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

-- Desayunos: descripciones / flags alineados a Menú desayunos 2025.pdf
update public.event_menu_items i
set
  name = v.name,
  description = v.descr,
  unit_price = v.price,
  price_source = 'pdf_desayunos_2025',
  price_verified = v.verified,
  active = true
from public.event_menus m
cross join (values
  ('DES-1', 'Menú 1 — Huevos (variedad)',
   'Con chorizo, tocino, a la mexicana, queso panela, jamón, divorciados, rancheros o en salsa pasilla (fritos)',
   250.00, true),
  ('DES-2', 'Menú 2 — Enchiladas / enfrijoladas',
   'Enchiladas verdes/rojas con pollo, suizas con pollo, adobo de 4 chiles; o enfrijoladas',
   320.00, true),
  ('DES-3', 'Menú 3 — Chilaquiles',
   'Verdes o rojos con pollo o huevo; adobo de 4 chiles con pollo o huevo',
   280.00, true),
  ('DES-4', 'Menú 4 — Emparedado de salmón curado', null, 350.00, true),
  ('DES-5', 'Menú 5 — Costilla de res + chilaquiles',
   'Con chilaquiles verdes o rojos', 320.00, true),
  ('DES-5B', 'Menú 5 — Costilla con huevo',
   'TODO PDF: «CON HUEVO $550» en pág. 3 (ubicación ambigua respecto a Menú 5/6)',
   550.00, false),
  ('DES-5C', 'Menú 5 — Costilla con chilaquiles (pack)',
   'TODO PDF: «CON CHILAQUILES $550» en pág. 3 (ubicación ambigua; distinto del Menú 5 a $320)',
   550.00, false),
  ('DES-6', 'Menú 6 — Cecina de res + chilaquiles',
   'Con chilaquiles verdes o rojos', 320.00, true)
) as v(sku, name, descr, price, verified)
where i.menu_id = m.id
  and m.code = 'desayunos_2025'
  and i.sku = v.sku;

update public.event_menus
set
  min_pax = 50,
  description = 'Desayunos por persona (PDF 2025). Mínimo 50 personas. Pack ≥50 pax = $30,000 (regla comercial).',
  notes = 'Fuente definitiva: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Menú desayunos 2025.pdf. Pack $30k ≥50 pax = regla comercial locked. TODO: CON HUEVO/CON CHILAQUILES $550 (pág. 3) — variantes Menú 5 hasta confirmación.'
where code = 'desayunos_2025';

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

-- Barra libre (nacional / internacional / refrescos — PDF vigentes)
insert into public.event_menu_items (menu_id, sku, name, description, unit, unit_price, sort_order, price_source, price_verified)
select m.id, v.sku, v.name, v.descr, v.unit, v.price, v.ord, 'pdf_barra_libre_2025', true
from public.event_menus m
cross join (values
  ('BAR-NAC', 'Barra libre nacional', '3 horas · hora extra $185 · Bacardí, Cuervo especial, Smirnoff, Etiqueta Roja, cerveza nacional, café, té', 'persona', 600.00, 10),
  ('BAR-NAC-XH', 'Barra nacional — hora extra', 'Hora adicional sobre barra libre nacional', 'hora', 185.00, 11),
  ('BAR-INT', 'Barra libre internacional', '3 horas · hora extra $300 · Matusalem Platino, Don Julio Blanco, Absolut Azul, Etiqueta Negra, Tanqueray, cerveza nacional, café, té', 'persona', 950.00, 20),
  ('BAR-INT-XH', 'Barra internacional — hora extra', 'Hora adicional sobre barra libre internacional', 'hora', 300.00, 21),
  ('BAR-REF', 'Barra libre de refrescos', 'Aplica con cualquier menú de 3 tiempos · 3 h · refrescos, limonada, naranjada, café americano y té · descorche destilados/vino (sin cerveza) · hora extra $90', 'persona', 290.00, 30),
  ('BAR-REF-XH', 'Barra refrescos — hora extra', 'Hora adicional sobre barra libre de refrescos', 'hora', 90.00, 31)
) as v(sku, name, descr, unit, price, ord)
where m.code = 'barra_libre_2025'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );

-- Actualiza descripciones de barra si ya existían
update public.event_menu_items i
set
  description = v.descr,
  unit_price = v.price,
  price_source = 'pdf_barra_libre_2025',
  price_verified = true,
  active = true
from public.event_menus m
cross join (values
  ('BAR-NAC', '3 horas · hora extra $185 · Bacardí, Cuervo especial, Smirnoff, Etiqueta Roja, cerveza nacional, café, té', 600.00),
  ('BAR-NAC-XH', 'Hora adicional sobre barra libre nacional', 185.00),
  ('BAR-INT', '3 horas · hora extra $300 · Matusalem Platino, Don Julio Blanco, Absolut Azul, Etiqueta Negra, Tanqueray, cerveza nacional, café, té', 950.00),
  ('BAR-INT-XH', 'Hora adicional sobre barra libre internacional', 300.00),
  ('BAR-REF', 'Aplica con cualquier menú de 3 tiempos · 3 h · refrescos, limonada, naranjada, café americano y té · descorche destilados/vino (sin cerveza) · hora extra $90', 290.00),
  ('BAR-REF-XH', 'Hora adicional sobre barra libre de refrescos', 90.00)
) as v(sku, descr, price)
where i.menu_id = m.id
  and m.code = 'barra_libre_2025'
  and i.sku = v.sku;

update public.event_menus
set
  description = 'Solo con comida (menú 3 tiempos u otro menú de alimentos). Precio por persona / 3 h. Nacional, internacional y refrescos (refrescos aplica con cualquier menú de 3 tiempos).',
  notes = 'Fuente definitiva: I:\Mi unidad\Eventos\Menús\Menús eventos vigentes\Barra libre eventos 2025.pdf. Precios con I.V.A.; no incluyen propina. Consumo por pieza → Bebidas (Menú C50).'
where code = 'barra_libre_2025';

-- Bebidas: catálogo completo desde Menú C50 Esp (solo bebidas).
-- Ejecutar también supabase/eventos_menus_bebidas_c50.sql tras este seed
-- (inserta/actualiza ~180 ítems; desactiva SKUs OS viejos).
-- Stub mínimo aquí para que el menú exista exista si el patch aún no se corrió:
insert into public.event_menu_items (
  menu_id, sku, name, description, unit, unit_price, is_vegetarian, sort_order, price_source, price_verified
)
select m.id, v.sku, v.name, v.descr, 'unidad', v.price, true, v.ord, 'pdf_menu_c50_esp', v.verified
from public.event_menus m
cross join (values
  ('BEB-MEZ', 'Mezcalita', 'Limón, mango, tamarindo o fresa', 135.00, 12, true),
  ('BEB-MAR', 'Margarita', 'Limón, mango, tamarindo o fresa', 135.00, 11, true),
  ('BEB-GAV', 'Gavilán / Paloma', 'Centenario plata, Ancho Reyes, toronja, limón, chile pasilla, sal de gusano', 170.00, 24, true),
  ('BEB-CERV', 'Cerveza nacional', '355 ml · Bohemia / Tecate / XX (Menú C50 Esp)', 65.00, 40, true),
  ('BEB-CARTA', 'Bebida otra (consumo)', 'Línea genérica · captura cantidad y precio · detalle en notas', 0.00, 999, false)
) as v(sku, name, descr, price, ord, verified)
where m.code = 'bebidas_a_la_carta'
  and not exists (
    select 1 from public.event_menu_items i
    where i.menu_id = m.id and i.sku = v.sku
  );

update public.event_menu_items i
set
  name = v.name,
  description = v.descr,
  unit = 'unidad',
  unit_price = v.price,
  price_source = 'pdf_menu_c50_esp',
  price_verified = v.verified,
  active = true
from public.event_menus m
cross join (values
  ('BEB-MEZ', 'Mezcalita', 'Limón, mango, tamarindo o fresa', 135.00, true),
  ('BEB-MAR', 'Margarita', 'Limón, mango, tamarindo o fresa', 135.00, true),
  ('BEB-GAV', 'Gavilán / Paloma', 'Centenario plata, Ancho Reyes, toronja, limón, chile pasilla, sal de gusano', 170.00, true),
  ('BEB-CERV', 'Cerveza nacional', '355 ml · Bohemia / Tecate / XX (Menú C50 Esp)', 65.00, true),
  ('BEB-CARTA', 'Bebida otra (consumo)', 'Línea genérica · captura cantidad y precio · detalle en notas', 0.00, false)
) as v(sku, name, descr, price, verified)
where i.menu_id = m.id
  and m.code = 'bebidas_a_la_carta'
  and i.sku = v.sku;

-- Retirar catálogo legado menu_c50_bebidas (unificado en bebidas_a_la_carta)
update public.event_menus
set
  active = false,
  notes = 'Inactivo: bebidas C50 viven en code=bebidas_a_la_carta (Menú C50 Esp).'
where code = 'menu_c50_bebidas';

update public.event_menu_items i
set active = false
from public.event_menus m
where i.menu_id = m.id
  and m.code = 'menu_c50_bebidas';

-- ---------------------------------------------------------------------------
-- Reparar mojibake / copy legado (si un import previo guardó UTF-8 como Latin-1).
-- Re-ejecutar este archivo si la UI aún muestra acentos rotos en nombres de menú.
-- ---------------------------------------------------------------------------
update public.event_menus
set
  name = replace(replace(name, U&'Men\00C3\00BA', 'Menú'), U&'\00E2\2030\00A5', '≥'),
  description = replace(
    replace(
      replace(
        replace(coalesce(description, ''), U&'Men\00C3\00BA', 'Menú'),
        U&'\00E2\2030\00A5',
        '≥'
      ),
      'propina según PDF',
      'servicio según PDF'
    ),
    'tip included per PDF',
    'service included per PDF'
  ),
  notes = replace(replace(coalesce(notes, ''), U&'Men\00C3\00BA', 'Menú'), U&'\00E2\2030\00A5', '≥')
where name like '%' || U&'\00C3' || '%'
   or name like '%' || U&'\00E2\2030' || '%'
   or coalesce(description, '') like '%propina%'
   or coalesce(description, '') like '%tip included%'
   or coalesce(description, '') like '%' || U&'\00C3' || '%'
   or coalesce(notes, '') like '%' || U&'\00C3' || '%';

update public.event_menus
set description = 'Cena romántica para 2. Precio por paquete (incluye 15% de servicio según PDF).'
where code = 'parejas_es_2025';

update public.event_menus
set description = 'Couples package (EN). Price per package (15% service included per PDF).'
where code = 'parejas_en_2025';

update public.event_menu_items
set
  name = replace(replace(name, U&'Men\00C3\00BA', 'Menú'), U&'\00E2\2030\00A5', '≥'),
  description = replace(
    replace(coalesce(description, ''), U&'Men\00C3\00BA', 'Menú'),
    U&'\00E2\2030\00A5',
    '≥'
  )
where name like '%' || U&'\00C3' || '%'
   or name like '%' || U&'\00E2\2030' || '%'
   or coalesce(description, '') like '%' || U&'\00C3' || '%';
