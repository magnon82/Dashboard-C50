-- Notas operativas por día/colaborador en horarios (+ alertas en /rrhh y /staff/horario).
-- Ejecutar en Supabase SQL Editor si aún no existen las tablas.

create table if not exists public.hr_schedule_cell_notes (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.hr_schedule_weeks (id) on delete cascade,
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  shift_date date not null,
  dual_track text not null default '' check (dual_track in ('', 'limpieza', 'servicio')),
  note text not null check (char_length(trim(note)) > 0),
  created_by text,
  updated_at timestamptz not null default now(),
  unique (week_id, employee_id, shift_date, dual_track)
);

create index if not exists hr_schedule_cell_notes_week_idx
  on public.hr_schedule_cell_notes (week_id, updated_at desc);

alter table public.hr_schedule_cell_notes enable row level security;

comment on table public.hr_schedule_cell_notes is
  'Nota visible en Horarios por celda (p. ej. excepción en DESCANSO). Independiente de hr_schedule_shifts.notes (flags sistema).';

create table if not exists public.hr_schedule_note_reads (
  username text not null,
  panel text not null check (panel in ('rrhh', 'staff')),
  week_id uuid not null references public.hr_schedule_weeks (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (username, panel, week_id)
);

alter table public.hr_schedule_note_reads enable row level security;

comment on table public.hr_schedule_note_reads is
  'Marca cuándo un usuario vio las alertas de notas de una semana en RRHH o Staff.';

revoke all on table public.hr_schedule_cell_notes from public;
revoke all on table public.hr_schedule_note_reads from public;
grant select, insert, update, delete on table public.hr_schedule_cell_notes to service_role;
grant select, insert, update, delete on table public.hr_schedule_note_reads to service_role;
