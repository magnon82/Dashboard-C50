-- =============================================================================
-- Perfil empleado: documentos de alta, foto, médico (reembolsos + justificantes)
-- =============================================================================
-- IDEMPOTENTE. Supabase → SQL Editor → pegar TODO este archivo → Run.
--
-- Crea:
--   · columnas perfil en hr_employees (fecha_baja, phone, foto, nss, curp, emergencia)
--   · public.hr_employee_documents  (checklist INE/acta/CURP/domicilio/CV…)
--   · public.hr_medical_reimbursements
--   · public.hr_medical_justifications
--   · storage bucket privado hr-employee-docs
--
-- Si falla a mitad, vuelve a correr: es seguro re-ejecutar.
-- Verificación de documentos en la API: solo Master/admin (DASHBOARD_USER).
-- =============================================================================

-- 1) Columnas en hr_employees (evita "fecha_baja does not exist")
alter table public.hr_employees
  add column if not exists fecha_baja date;

alter table public.hr_employees
  add column if not exists phone text;

alter table public.hr_employees
  add column if not exists photo_storage_path text;

alter table public.hr_employees
  add column if not exists nss text;

alter table public.hr_employees
  add column if not exists curp text;

alter table public.hr_employees
  add column if not exists emergency_contact text;

alter table public.hr_employees
  add column if not exists emergency_phone text;

-- 2) Checklist documental (núcleo del tab Documentos)
create table if not exists public.hr_employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  doc_type text not null,
  title text not null,
  storage_path text,
  mime_type text,
  byte_size integer,
  required boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'verified', 'rejected')),
  notes text,
  uploaded_by text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_employee_documents_employee_idx
  on public.hr_employee_documents (employee_id);

create index if not exists hr_employee_documents_status_idx
  on public.hr_employee_documents (status);

create unique index if not exists hr_employee_documents_emp_type_uidx
  on public.hr_employee_documents (employee_id, doc_type);

alter table public.hr_employee_documents enable row level security;

-- 3) Reembolsos médicos (FK a nómina solo si existe la tabla)
create table if not exists public.hr_medical_reimbursements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  amount numeric(12, 2) not null default 0,
  expense_date date,
  description text,
  storage_path text,
  mime_type text,
  status text not null default 'solicitado'
    check (status in ('solicitado', 'aprobado', 'pagado', 'rechazado')),
  payroll_period_id uuid,
  notes text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_medical_reimbursements_emp_idx
  on public.hr_medical_reimbursements (employee_id);

alter table public.hr_medical_reimbursements enable row level security;

-- 4) Justificantes médicos
create table if not exists public.hr_medical_justifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  absence_date date not null,
  absence_end_date date,
  description text,
  storage_path text,
  mime_type text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aceptado', 'rechazado')),
  payroll_period_id uuid,
  pays_absence boolean not null default true,
  notes text,
  created_by text not null,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_medical_justifications_emp_idx
  on public.hr_medical_justifications (employee_id);

create index if not exists hr_medical_justifications_date_idx
  on public.hr_medical_justifications (absence_date);

alter table public.hr_medical_justifications enable row level security;

-- FK opcionales a nómina (no aborta si hr_payroll_periods aún no existe)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'hr_payroll_periods'
  ) then
    if not exists (
      select 1 from pg_constraint
      where conname = 'hr_medical_reimbursements_payroll_period_id_fkey'
    ) then
      alter table public.hr_medical_reimbursements
        add constraint hr_medical_reimbursements_payroll_period_id_fkey
        foreign key (payroll_period_id)
        references public.hr_payroll_periods (id)
        on delete set null;
    end if;
    if not exists (
      select 1 from pg_constraint
      where conname = 'hr_medical_justifications_payroll_period_id_fkey'
    ) then
      alter table public.hr_medical_justifications
        add constraint hr_medical_justifications_payroll_period_id_fkey
        foreign key (payroll_period_id)
        references public.hr_payroll_periods (id)
        on delete set null;
    end if;
  end if;
end $$;

-- 5) Bucket Storage (privado, máx 10 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-employee-docs',
  'hr-employee-docs',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.hr_employee_documents is
  'Checklist documental de alta/perfil; vista in-app vía Suite. Paquete Documentos.pdf se parte en storage_path distinto por doc_type (hr-docs-pack-split).';
comment on table public.hr_medical_justifications is
  'Justificante médico ligado a falta y opcionalmente a periodo de nómina.';

-- Verificación rápida (opcional): debe devolver true / true
-- select
--   to_regclass('public.hr_employee_documents') is not null as docs_ok,
--   exists(select 1 from storage.buckets where id = 'hr-employee-docs') as bucket_ok;
