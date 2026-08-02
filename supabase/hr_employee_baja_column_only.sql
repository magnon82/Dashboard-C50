-- Minimal patch: add fecha_baja if missing + set Gmail-confirmed dates.
-- Prefer full supabase/hr_employee_baja.sql (also refreshes plantilla view).
-- Supabase → SQL Editor → Run.

alter table public.hr_employees
  add column if not exists fecha_baja date;

comment on column public.hr_employees.fecha_baja is
  'Último día laborado / fecha de baja.';

create index if not exists hr_employees_fecha_baja_idx
  on public.hr_employees (fecha_baja)
  where fecha_baja is not null;

-- Gallardo: correo Sergio «Baja IMSS Luis Fernando Gallardo» 2026-07-21
update public.hr_employees
set
  status = 'baja',
  force_exclude = true,
  force_include = false,
  fecha_baja = date '2026-07-20',
  notes = case
    when notes ~* 'duplicado_fusionado' then notes
    else 'Archivado: dejó de laborar 2026-07-20. Fuente: correo Sergio «Baja IMSS Luis Fernando Gallardo» (2026-07-21).'
  end,
  updated_at = now()
where id in (
  '1d92b07b-d160-42c4-aa51-06f2aae7549c',
  'bdf8c083-c669-4a0e-bb96-a568bf83444c'
)
or (
  lower(full_name) ~* 'gallardo'
  and lower(full_name) ~* 'luis'
  and lower(full_name) ~* 'fernando'
);

-- Soltero: correo Luis Fernando «SOLICITUD DE BAJA…» 2026-04-27 · FECHA DE BAJA 26/04/2026
update public.hr_employees
set
  status = 'baja',
  force_exclude = true,
  force_include = false,
  fecha_baja = date '2026-04-26',
  notes = case
    when notes ~* 'duplicado_fusionado' then notes
    else 'Archivado: dejó de laborar 2026-04-26. Fuente: correo «SOLICITUD DE BAJA JUAN PABLO SOLTERO» (2026-04-27).'
  end,
  updated_at = now()
where id in (
  'a98fa17a-70db-4100-8428-3be6652e7acc',
  '55d5bff2-6682-4ef5-8591-1711628e95c4'
)
or (
  lower(full_name) ~* 'soltero'
  and (lower(full_name) ~* 'juan' or lower(full_name) ~* 'pablo')
);
