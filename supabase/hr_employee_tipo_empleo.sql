-- =============================================================================
-- RR.HH. — Tipo de empleo (interno / externo) + documentación de alta
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- - tipo_empleo: 'interno' | 'externo' (default interno)
-- - requiere_documentacion: boolean (default true; externos → false)
-- - Backfill: notes con flag `externo` + Alexis Zúñiga / Diego Olvera
-- =============================================================================

alter table public.hr_employees
  add column if not exists tipo_empleo text;

alter table public.hr_employees
  add column if not exists requiere_documentacion boolean;

-- Defaults / constraints (idempotente)
update public.hr_employees
set tipo_empleo = 'interno'
where tipo_empleo is null;

update public.hr_employees
set requiere_documentacion = true
where requiere_documentacion is null;

alter table public.hr_employees
  alter column tipo_empleo set default 'interno';

alter table public.hr_employees
  alter column requiere_documentacion set default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_employees_tipo_empleo_check'
  ) then
    alter table public.hr_employees
      add constraint hr_employees_tipo_empleo_check
      check (tipo_empleo in ('interno', 'externo'));
  end if;
end $$;

comment on column public.hr_employees.tipo_empleo is
  'interno = plantilla ordinaria; externo = colaborador externo (p. ej. inventarios / remoto).';

comment on column public.hr_employees.requiere_documentacion is
  'Si false, no alerta por docs de alta faltantes (típico en externos).';

-- Backfill externos conocidos / flag en notes
update public.hr_employees e
set
  tipo_empleo = 'externo',
  requiere_documentacion = false,
  notes = case
    when e.notes is null or btrim(e.notes) = '' then 'externo.'
    when lower(e.notes) like '%externo%' then e.notes
    else 'externo; ' || e.notes
  end
where
  coalesce(e.tipo_empleo, 'interno') is distinct from 'externo'
  and (
    lower(coalesce(e.notes, '')) like '%externo%'
    or (
      lower(
        translate(
          e.full_name,
          'ÁÉÍÓÚÜÑáéíóúüñ',
          'AEIOUUNaeiouun'
        )
      ) ~ '(^|[^a-z])diego([^a-z]|$).*olvera|olvera.*diego'
    )
    or (
      lower(
        translate(
          e.full_name,
          'ÁÉÍÓÚÜÑáéíóúüñ',
          'AEIOUUNaeiouun'
        )
      ) ~ 'alexis'
      and lower(
        translate(
          e.full_name,
          'ÁÉÍÓÚÜÑáéíóúüñ',
          'AEIOUUNaeiouun'
        )
      ) ~ 'zuniga|alvarez'
    )
  );

-- Quienes ya son externos: forzar sin documentación requerida
update public.hr_employees
set requiere_documentacion = false
where tipo_empleo = 'externo'
  and coalesce(requiere_documentacion, true) = true;

create index if not exists hr_employees_tipo_empleo_idx
  on public.hr_employees (tipo_empleo);

create index if not exists hr_employees_requiere_docs_idx
  on public.hr_employees (requiere_documentacion)
  where requiere_documentacion = false;
