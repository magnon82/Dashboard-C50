-- =============================================================================
-- RR.HH. — Sueldo diario en ficha de empleado
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql (si la DB se creó sin la columna).
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- Usado por perfil RH (tab Datos) y PATCH /api/hr/employees.
-- =============================================================================

alter table public.hr_employees
  add column if not exists sueldo_diario numeric(12, 2);

comment on column public.hr_employees.sueldo_diario is
  'Sueldo diario vigente en ficha. Las líneas de nómina guardan su propio snapshot.';
