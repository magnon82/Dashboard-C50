-- =============================================================================
-- RR.HH. — Acumulación de vacaciones LFT (reforma 2023) + alertas de aniversario
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- Derecho = días del año de antigüedad cumplido (aniversario).
-- Catch-up en GET /api/hr/leave-balances (no requiere job diario).
-- =============================================================================

-- Estado de última acumulación por colaborador (años cumplidos ya otorgados).
create table if not exists public.hr_leave_accrual_state (
  employee_id uuid primary key
    references public.hr_employees (id) on delete cascade,
  last_accrued_years integer not null default 0
    check (last_accrued_years >= 0),
  last_accrual_date date,
  updated_at timestamptz not null default now()
);

alter table public.hr_leave_accrual_state enable row level security;

comment on table public.hr_leave_accrual_state is
  'Último aniversario (años cumplidos) ya acumulado por LFT. Evita doble otorgamiento.';

-- Alertas de renovación de derecho (aniversario).
create table if not exists public.hr_leave_renewal_alerts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.hr_employees (id) on delete cascade,
  anniversary_date date not null,
  completed_years integer not null
    check (completed_years >= 1),
  previous_entitlement numeric(6, 2) not null default 0,
  new_entitlement numeric(6, 2) not null,
  days_added numeric(6, 2) not null,
  previous_remaining numeric(6, 2),
  new_remaining numeric(6, 2),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (employee_id, completed_years)
);

create index if not exists hr_leave_renewal_alerts_created_idx
  on public.hr_leave_renewal_alerts (created_at desc);

create index if not exists hr_leave_renewal_alerts_open_idx
  on public.hr_leave_renewal_alerts (employee_id)
  where acknowledged_at is null;

alter table public.hr_leave_renewal_alerts enable row level security;

comment on table public.hr_leave_renewal_alerts is
  'Alerta RH: renovación de vacaciones al cumplir aniversario (derecho previo → nuevo + días añadidos).';

-- source 'policy' ya está en hr_leave_balances (hr_module.sql).
