-- Patch: OS digital (event_service_orders) — columnas densas + índices
-- Ejecutar en Supabase → SQL Editor si la tabla ya existía como stub.
-- El seed completo ya incluye estas columnas en supabase/eventos_module.sql.

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

comment on table public.event_service_orders is
  'Órdenes de servicio digitales (desde cotización aceptada). Coexiste con PDFs en Drive. payload = snapshot de líneas.';
