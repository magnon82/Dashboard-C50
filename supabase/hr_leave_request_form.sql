-- =============================================================================
-- RR.HH. — Solicitud de vacaciones (formato digital C50)
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql si ya corriste Fase 0.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- Extiende hr_leave_requests con JSONB payload (campos del Word
-- FORMATO-SOLICITUD DE VACACIONES. C50.docx) y permite employee_id nulo
-- cuando aún no hay vínculo suite → hr_employees.
-- Añade suite_username en hr_employees para enlazar sesión Staff.
-- =============================================================================

-- Vínculo opcional: usuario del suite → ficha RH
alter table public.hr_employees
  add column if not exists suite_username text;

create unique index if not exists hr_employees_suite_username_uidx
  on public.hr_employees (lower(suite_username))
  where suite_username is not null and length(trim(suite_username)) > 0;

comment on column public.hr_employees.suite_username is
  'Username del suite (cookie session) para enlazar Staff → ficha RH.';

-- Solicitudes: payload del formulario + employee opcional
alter table public.hr_leave_requests
  alter column employee_id drop not null;

alter table public.hr_leave_requests
  add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists hr_leave_requests_requested_by_idx
  on public.hr_leave_requests (lower(requested_by));

create index if not exists hr_leave_requests_created_idx
  on public.hr_leave_requests (created_at desc);

comment on column public.hr_leave_requests.payload is
  'Campos del formato C50: fecha_solicitud, solicitada_a, nombre_empleado, curp, puesto, ultimo_dia_laborado, fecha_reingreso, pago_vacaciones, observaciones, form_version.';

comment on table public.hr_leave_requests is
  'Solicitudes de vacaciones. Staff crea en /staff/vacaciones; RH lista/aprueba en /rrhh.';
