-- =============================================================================
-- Nómina: marcas Lun–Dom por línea (como columnas I–O del Excel)
-- =============================================================================
-- Ejecutar en Supabase SQL Editor si ya tienes hr_payroll_lines.
-- Instalaciones nuevas: ya viene en supabase/hr_module.sql.
--
-- dias_semana jsonb = [L, M, X, J, V, S, D] con pesos numéricos (0/1/1.25…)
-- dias_trabajados = suma de esos pesos (también se guarda en la columna numérica).
-- =============================================================================

alter table public.hr_payroll_lines
  add column if not exists dias_semana jsonb;

comment on column public.hr_payroll_lines.dias_semana is
  'Marcas Lun–Dom [7] desde Excel I–O; suma → dias_trabajados.';
