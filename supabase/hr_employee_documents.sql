-- =============================================================================
-- Stub: documentos de alta de empleado (futuro)
-- =============================================================================
-- Visión Suite: el alta operativa sube cada documento requerido a Storage/DB
-- (INE, contrato, alta IMSS, etc.) en lugar de solo crear la fila en plantilla.
-- Este SQL prepara la tabla; la UI de carga aún no está cableada.
-- Idempotente. Ejecutar en Supabase cuando se implemente el flujo.
-- =============================================================================

create table if not exists public.hr_employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  -- Checklist de contratación (ampliar vía app, no hardcodear en DB)
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

-- Bucket privado sugerido (crear al cablear upload):
-- insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- values (
--   'hr-employee-docs', 'hr-employee-docs', false, 10485760,
--   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
-- )
-- on conflict (id) do nothing;

comment on table public.hr_employee_documents is
  'TODO(Suite): checklist de documentos por alta; upload vía /rrhh → Plantilla.';
