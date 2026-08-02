-- =============================================================================
-- Contratos laborales por empleado (vigente + historial)
-- =============================================================================
-- Idempotente. Supabase → SQL Editor → Run.
-- Depende de: public.hr_employees (hr_module.sql).
-- Archivos en bucket hr-employee-docs (hr_employee_documents.sql).
--
-- Un solo contrato con status = 'vigente' por empleado (índice parcial).
-- El resto queda en 'historico'. Import desde expediente: archivos Contrato*.
-- =============================================================================

create table if not exists public.hr_employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  title text not null default 'Contrato',
  status text not null default 'vigente'
    check (status in ('vigente', 'historico')),
  effective_from date,
  effective_to date,
  source_filename text,
  storage_path text,
  mime_type text,
  byte_size integer,
  notes text,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_employee_contracts_employee_idx
  on public.hr_employee_contracts (employee_id);

create index if not exists hr_employee_contracts_status_idx
  on public.hr_employee_contracts (employee_id, status);

-- Como máximo un vigente por colaborador
create unique index if not exists hr_employee_contracts_one_vigente_uidx
  on public.hr_employee_contracts (employee_id)
  where status = 'vigente';

-- Evitar reimportar el mismo archivo del expediente
create unique index if not exists hr_employee_contracts_emp_source_uidx
  on public.hr_employee_contracts (employee_id, source_filename)
  where source_filename is not null;

alter table public.hr_employee_contracts enable row level security;

comment on table public.hr_employee_contracts is
  'Contrato laboral vigente e historial; PDF/imagen en hr-employee-docs. Soft-pull desde expediente (Contrato*).';
