-- =============================================================================
-- Nómina: marcas Lun–Dom por línea (como columnas I–O del Excel)
-- =============================================================================
-- Ejecutar en Supabase SQL Editor si ya tienes hr_payroll_lines.
-- Instalaciones nuevas: ya viene en supabase/hr_module.sql.
--
-- dias_semana jsonb = [L, M, X, J, V, S, D]
--   0 = falta · >0 = trabajado (Dom 1.25 prima) · −1 = descanso semanal pagado
-- dias_trabajados = suma de pesos (descanso cuenta 1). Jornada 48h: 6+1 → Σ=7.
-- =============================================================================

alter table public.hr_payroll_lines
  add column if not exists dias_semana jsonb;

comment on column public.hr_payroll_lines.dias_semana is
  'Marcas Lun–Dom [7]: 0 falta, >0 trabajado (Dom 1.25), −1 descanso pagado; suma → dias_trabajados.';
