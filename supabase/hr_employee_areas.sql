-- =============================================================================
-- RR.HH. — Áreas múltiples en ficha de empleado
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- `area` (text) sigue existiendo: se sincroniza como "Piso, Cocina" (legado /
-- display). `areas` = arreglo canónico para filtros y ficha multi-select.
-- =============================================================================

alter table public.hr_employees
  add column if not exists areas text[] not null default '{}';

comment on column public.hr_employees.areas is
  'Áreas de equipo (Piso, Cocina, Barra, Administrativo…). Complementa area text legado.';

create index if not exists hr_employees_areas_gin
  on public.hr_employees using gin (areas);

-- Backfill desde area delimitado / simple (solo filas aún vacías).
update public.hr_employees
set areas = array(
  select trim(both from x)
  from unnest(string_to_array(replace(replace(area, ';', ','), '|', ','), ',')) as x
  where trim(both from x) <> ''
)
where coalesce(cardinality(areas), 0) = 0
  and area is not null
  and trim(area) <> '';
