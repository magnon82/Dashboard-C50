-- =============================================================================
-- RR.HH. — Cadencia de periodos de nómina (semanal | quincenal)
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql.
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- Semanal: operativo (SEM / martes) — alimenta plantilla vigente.
-- Quincenal: administrativos / socios (sueldo_quincenal / admin).
-- =============================================================================

alter table public.hr_payroll_periods
  add column if not exists cadence text not null default 'semanal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hr_payroll_periods_cadence_check'
  ) then
    alter table public.hr_payroll_periods
      add constraint hr_payroll_periods_cadence_check
      check (cadence in ('semanal', 'quincenal'));
  end if;
end $$;

comment on column public.hr_payroll_periods.cadence is
  'semanal = nómina operativa (plantilla); quincenal = pago admin/socios.';

create index if not exists hr_payroll_periods_cadence_end_idx
  on public.hr_payroll_periods (cadence, period_end desc);

-- Un periodo quincenal por (año-mes-mitad): period_start único dentro de cadence
create unique index if not exists hr_payroll_periods_quincena_start_uidx
  on public.hr_payroll_periods (cadence, period_start)
  where cadence = 'quincenal';

-- Vista plantilla: solo nómina semanal (no quincenas admin)
create or replace view public.hr_plantilla_vigente as
with ranked as (
  select
    id,
    label,
    period_start,
    period_end,
    paid_at,
    status,
    row_number() over (
      order by
        case status
          when 'pagado' then 0
          when 'cerrado' then 1
          else 2
        end,
        coalesce(paid_at, period_end) desc,
        period_end desc
    ) as rn
  from public.hr_payroll_periods
  where status in ('pagado', 'cerrado')
    and coalesce(cadence, 'semanal') <> 'quincenal'
),
latest_period as (
  select id, label, period_start, period_end, paid_at
  from ranked
  where rn = 1
),
from_payroll as (
  select distinct l.employee_id
  from public.hr_payroll_lines l
  inner join latest_period p on p.id = l.period_id
)
select
  e.*,
  lp.id as payroll_period_id,
  lp.label as payroll_period_label,
  lp.period_start as payroll_period_start,
  lp.period_end as payroll_period_end,
  lp.paid_at as payroll_paid_at,
  case
    when e.force_include and not exists (
      select 1 from from_payroll fp where fp.employee_id = e.id
    ) then 'force_include'
    when exists (
      select 1 from from_payroll fp where fp.employee_id = e.id
    ) then 'nomina_pagada'
    else 'otro'
  end as plantilla_origen
from public.hr_employees e
left join latest_period lp on true
where e.force_exclude = false
  and e.status is distinct from 'baja'
  and (
    e.force_include = true
    or exists (select 1 from from_payroll fp where fp.employee_id = e.id)
  );

comment on view public.hr_plantilla_vigente is
  'Plantilla operativa = última nómina semanal (pagado/cerrado) + force_include − force_exclude − baja. Excluye cadence=quincenal.';
