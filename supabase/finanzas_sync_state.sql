-- Heartbeat de sync Finanzas (Saldos al día, etc.) para Master /admin.
-- Ejecutar una vez en Supabase → SQL Editor.

create table if not exists public.finanzas_sync_state (
  content_type text primary key,
  label text not null,
  last_synced_at timestamptz,
  last_source text,
  last_status text not null default 'never',
  last_message text,
  updated_at timestamptz not null default now()
);

alter table public.finanzas_sync_state enable row level security;

comment on table public.finanzas_sync_state is
  'Última ejecución de sync-saldos / ingest flujo+CXP (GitHub Actions o local).';

revoke all on table public.finanzas_sync_state from public;
grant select, insert, update, delete on table public.finanzas_sync_state to service_role;
