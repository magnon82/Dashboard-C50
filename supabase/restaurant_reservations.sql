-- =============================================================================
-- Reservaciones mesa (Nivel 2) — solicitud web → WhatsApp + registro
-- =============================================================================
-- Flujo: /reservar → POST /api/reservas → fila aquí → abre wa.me al negocio.
-- No es calendario de mesas ni confirmación automática (eso sería Nivel 3).
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
-- =============================================================================

create table if not exists public.restaurant_reservations (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'confirmada', 'cancelada', 'no_show')),
  nombre text not null,
  personas int not null check (personas >= 1 and personas <= 40),
  telefono text not null,
  fecha date not null,
  hora time not null,
  motivo text,
  alergias text,
  notas text,
  brand text not null default 'Carranza 50',
  source text not null default 'web',
  wa_opened boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_reservations_fecha_idx
  on public.restaurant_reservations (fecha desc, hora);

create index if not exists restaurant_reservations_status_idx
  on public.restaurant_reservations (status);

create index if not exists restaurant_reservations_created_idx
  on public.restaurant_reservations (created_at desc);

comment on table public.restaurant_reservations is
  'Solicitudes de mesa desde /reservar (WhatsApp + registro). Confirmación humana.';

alter table public.restaurant_reservations enable row level security;

-- Sin policies para anon/authenticated: solo service role (API /api/reservas).
