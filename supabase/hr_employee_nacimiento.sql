-- =============================================================================
-- RR.HH. — Fecha de nacimiento (cumpleaños Staff)
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- Soft-fill opcional desde «BASE DATOS PERSONAL C50.xlsx» (columna
-- «Fecha de Nacimiento») vía enrichEmployeesFromBaseDatos / ?fill_nacimiento=1.
-- =============================================================================

alter table public.hr_employees
  add column if not exists fecha_nacimiento date;

comment on column public.hr_employees.fecha_nacimiento is
  'Fecha de nacimiento (cumpleaños). Soft-fill desde BASE DATOS PERSONAL o captura RH.';

create index if not exists hr_employees_fecha_nacimiento_md_idx
  on public.hr_employees (
    (extract(month from fecha_nacimiento)),
    (extract(day from fecha_nacimiento))
  )
  where fecha_nacimiento is not null;
