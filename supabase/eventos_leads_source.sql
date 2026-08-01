-- Patch: origen del lead (manual / sheets / import / cotizador)
-- Ejecutar en Supabase → SQL Editor si la tabla ya existía.

alter table public.event_leads
  add column if not exists source text not null default 'manual';

-- Ampliar check si ya existía sin constraint nombrada: recrear de forma segura.
do $$
begin
  alter table public.event_leads
    drop constraint if exists event_leads_source_check;
exception
  when undefined_object then null;
end $$;

alter table public.event_leads
  add constraint event_leads_source_check
  check (source in ('manual', 'sheets', 'import', 'cotizador'));

comment on column public.event_leads.source is
  'Origen del lead: manual (UI), sheets (Seguimiento), import, cotizador.';
