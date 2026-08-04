-- =============================================================================
-- RR.HH. — Aceptación de resguardo por el colaborador (Staff)
-- =============================================================================
-- Aplica DESPUÉS de hr_resguardo.sql. Re-run seguro.
-- El empleado acepta la carta desde /staff/resguardo; RH la ve aceptada en perfil.
-- =============================================================================

alter table public.hr_resguardo_requests
  add column if not exists accepted_at timestamptz;

alter table public.hr_resguardo_requests
  add column if not exists accepted_by text;

create index if not exists hr_resguardo_requests_accepted_idx
  on public.hr_resguardo_requests (accepted_at)
  where accepted_at is not null;

comment on column public.hr_resguardo_requests.accepted_at is
  'Momento en que el colaborador aceptó el resguardo desde Staff (suite_username).';

comment on column public.hr_resguardo_requests.accepted_by is
  'Username Suite que aceptó (debe coincidir con hr_employees.suite_username).';
