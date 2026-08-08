-- Patch: cerrar cotización como perdida (con nota).
-- Ejecutar en Supabase → SQL Editor si event_quotes ya existía.

alter table public.event_quotes
  add column if not exists perdida_note text;

alter table public.event_quotes
  add column if not exists perdida_at timestamptz;

-- Ampliar check de status (el inline de create table no tiene nombre estable).
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
end $$;

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

comment on column public.event_quotes.perdida_note is
  'Motivo al cerrar la cotización como perdida (staff).';
comment on column public.event_quotes.perdida_at is
  'Momento en que staff marcó la cotización como perdida.';
