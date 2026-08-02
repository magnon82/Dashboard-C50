-- =============================================================================
-- RR.HH. — Posiciones múltiples (puesto principal + secundarios)
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- `puesto` sigue siendo la posición administrativa / principal (plantilla).
-- `puestos_secundarios` = roles adicionales sin duplicar fila (p. ej. Limpieza).
-- Ejemplo Román: puesto = 'Meserx Encargadx', puestos_secundarios = '{Limpieza}'.
-- =============================================================================

alter table public.hr_employees
  add column if not exists puestos_secundarios text[] not null default '{}';

comment on column public.hr_employees.puestos_secundarios is
  'Roles adicionales al puesto principal (catálogo RR.HH.). No duplica fila en plantilla.';

create index if not exists hr_employees_puestos_secundarios_gin
  on public.hr_employees using gin (puestos_secundarios);
