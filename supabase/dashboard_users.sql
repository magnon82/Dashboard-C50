-- Usuarios del suite de dashboards (ejecutar en Supabase → SQL Editor)
-- Solo el service role debe leer/escribir esta tabla (sin policies para anon).

create table if not exists public.dashboard_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text,
  password_hash text not null,
  role text not null check (role in ('admin', 'viewer')),
  modules text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_users_username_idx
  on public.dashboard_users (username);

alter table public.dashboard_users enable row level security;

comment on table public.dashboard_users is
  'Usuarios del centro de dashboards. Admin edita; viewers solo ven módulos asignados.';
