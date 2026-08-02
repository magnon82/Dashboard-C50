-- =============================================================================
-- RR.HH. — índices hot-path (/rrhh Plantilla, Horarios, Nómina, Vacaciones)
-- =============================================================================
-- Aplica en Supabase → SQL Editor (idempotente). Complementa hr_module.sql.
-- No cambia datos ni RLS; solo acelera filtros frecuentes.
-- =============================================================================

-- Nómina: filtro por año (period_start) + última conciliada (status + end)
create index if not exists hr_payroll_periods_start_idx
  on public.hr_payroll_periods (period_start);

create index if not exists hr_payroll_periods_status_end_idx
  on public.hr_payroll_periods (status, period_end desc);

-- Líneas: lookups por periodo (ya hay period_id; refuerzo compuesto)
create index if not exists hr_payroll_lines_period_employee_idx
  on public.hr_payroll_lines (period_id, employee_id);

-- Horarios: listados por status+semana y semanas completadas (week_end < hoy)
create index if not exists hr_schedule_weeks_status_start_idx
  on public.hr_schedule_weeks (status, week_start desc);

create index if not exists hr_schedule_weeks_end_idx
  on public.hr_schedule_weeks (week_end);

-- Turnos reales (plantilla / conteos): week con Ent/Sal no nulos
create index if not exists hr_schedule_shifts_week_real_idx
  on public.hr_schedule_shifts (week_id)
  where start_time is not null and end_time is not null;

-- Plantilla: activos elegibles
create index if not exists hr_employees_status_exclude_idx
  on public.hr_employees (status, force_exclude);

create index if not exists hr_employees_fecha_baja_idx
  on public.hr_employees (fecha_baja)
  where fecha_baja is not null;

-- Vacaciones: saldos bajos por año + rangos de solicitud
create index if not exists hr_leave_balances_year_remaining_idx
  on public.hr_leave_balances (year, days_remaining);

create index if not exists hr_leave_requests_dates_idx
  on public.hr_leave_requests (date_from, date_to);

create index if not exists hr_leave_requests_status_created_idx
  on public.hr_leave_requests (status, created_at desc);
