-- =============================================================================
-- RR.HH. — Sueldo diario del rol / área secundaria (dual)
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql (+ hr_employee_sueldo.sql si aplica).
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- `sueldo_diario` = rol / posición principal.
-- `sueldo_diario_secundario` = segundo rol cuando hay puestos_secundarios,
-- dual_limpieza_mesero, o ≥2 áreas.
-- =============================================================================

alter table public.hr_employees
  add column if not exists sueldo_diario_secundario numeric(12, 2);

comment on column public.hr_employees.sueldo_diario_secundario is
  'Sueldo diario del rol o área secundaria (ficha dual). Nómina puede usarlo más adelante.';
