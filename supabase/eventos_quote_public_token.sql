-- Patch: enlace público de cotización (token opaco, sin login).
-- Ejecutar en Supabase → SQL Editor si event_quotes ya existía.

alter table public.event_quotes
  add column if not exists public_token text;

create unique index if not exists event_quotes_public_token_uidx
  on public.event_quotes (public_token)
  where public_token is not null;

comment on column public.event_quotes.public_token is
  'Token opaco para /c/{token} (cotización pública, sin sesión).';
