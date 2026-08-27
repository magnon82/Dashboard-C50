-- =============================================================================
-- Asistencia biométrica (Fase 4) — reportes xlsx + checadas vs horario
-- =============================================================================
-- Aplicar en Supabase SQL Editor (proyecto Dashbord Financiero C50).
-- Requiere hr_employees (supabase/hr_module.sql).
-- =============================================================================

do $$
begin
  if to_regclass('public.hr_employees') is null then
    raise exception
      'Falta public.hr_employees. Ejecuta primero supabase/hr_module.sql.';
  end if;
end $$;

create table if not exists public.hr_attendance_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  week_number int,
  source_filename text,
  uploaded_by text,
  status text not null default 'importado'
    check (status in ('importado', 'revisado', 'cerrado')),
  punch_count int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_attendance_reports_week_idx
  on public.hr_attendance_reports (week_start desc);

create table if not exists public.hr_attendance_punches (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.hr_attendance_reports (id)
    on delete cascade,
  employee_id uuid references public.hr_employees (id) on delete set null,
  employee_name_raw text not null,
  punch_date date not null,
  punch_time time not null,
  -- in | out | unknown (heurística del xlsx)
  punch_kind text not null default 'unknown'
    check (punch_kind in ('in', 'out', 'unknown')),
  created_at timestamptz not null default now()
);

create index if not exists hr_attendance_punches_report_idx
  on public.hr_attendance_punches (report_id);
create index if not exists hr_attendance_punches_emp_date_idx
  on public.hr_attendance_punches (employee_id, punch_date);

alter table public.hr_attendance_reports enable row level security;
alter table public.hr_attendance_punches enable row level security;

comment on table public.hr_attendance_reports is
  'Importaciones semanales del reloj checador (xlsx). Cotejo vs hr_schedule_shifts.';
comment on table public.hr_attendance_punches is
  'Checadas individuales parseadas del xlsx de asistencia.';
