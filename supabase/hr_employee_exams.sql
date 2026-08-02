-- =============================================================================
-- Exámenes de empleado (toxicológico, médico, etc.): fecha + resultado
-- =============================================================================
-- Idempotente. Supabase → SQL Editor → Run.
-- Depende de: public.hr_employees (hr_module.sql).
-- Archivos opcionales en bucket hr-employee-docs (hr_employee_documents.sql).
-- =============================================================================

create table if not exists public.hr_employee_exams (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  exam_type text not null,
  test_date date not null,
  result text not null,
  notes text,
  storage_path text,
  mime_type text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_employee_exams_employee_idx
  on public.hr_employee_exams (employee_id);

create index if not exists hr_employee_exams_test_date_idx
  on public.hr_employee_exams (test_date desc);

alter table public.hr_employee_exams enable row level security;

comment on table public.hr_employee_exams is
  'Resultados de exámenes por empleado (fecha de prueba + resultado) en perfil RH.';
