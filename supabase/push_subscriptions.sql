-- =============================================================================
-- Web Push · suscripciones por usuario Suite (Fase 5)
-- =============================================================================
-- Aplicar en Supabase SQL Editor (Dashbord Financiero C50).
-- =============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_uidx unique (endpoint)
);

create index if not exists push_subscriptions_username_idx
  on public.push_subscriptions (lower(username));

alter table public.push_subscriptions enable row level security;

comment on table public.push_subscriptions is
  'Endpoints Web Push por username Suite. Envío vía service role + web-push.';
