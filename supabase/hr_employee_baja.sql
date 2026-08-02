-- =============================================================================
-- RR.HH. — Baja / archivo de empleados (fecha_baja + plantilla)
-- =============================================================================
-- Aplica DESPUÉS de hr_module.sql (y hr_plantilla_transcurrida.sql si usas la vista).
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- - fecha_baja: último día laborado / fecha de baja
-- - Plantilla vigente excluye status = 'baja' y force_exclude
-- - Upserts de archivo:
--     GALLARDO ÁVILA LUIS FERNANDO (gerente, baja 2026-07-20)
--     SOLTERO ALEGRIA JUAN PABLO (barra, baja 2026-04-26 · solicitud de baja por correo)
-- =============================================================================

alter table public.hr_employees
  add column if not exists fecha_baja date;

comment on column public.hr_employees.fecha_baja is
  'Último día laborado / fecha de baja. Con status=baja (y force_exclude) queda fuera de plantilla vigente.';

create index if not exists hr_employees_fecha_baja_idx
  on public.hr_employees (fecha_baja)
  where fecha_baja is not null;

-- Vista plantilla: última nómina transcurrida + force_include − force_exclude − bajas
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
  'Plantilla operativa = última nómina transcurrida (pagado→cerrado) + force_include − force_exclude − status baja.';

-- Archivo puntual: Luis Fernando Gallardo Ávila (gerente; dejó de laborar 2026-07-20)
-- Matching por nombre normalizado (sin acentos, tokens ordenados).
with target as (
  select unnest(array[
    'avila fernando gallardo luis',
    'fernando gallardo luis'
  ]) as key
),
matched as (
  select e.id
  from public.hr_employees e
  where (
    select string_agg(tok, ' ' order by tok)
    from unnest(
      regexp_split_to_array(
        lower(
          regexp_replace(
            translate(
              e.full_name,
              'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
              'AAAAEEEEIIIIOOOOUUUUnaaaaeeeeiiiioooouuuun'
            ),
            '[^a-z0-9\s]',
            ' ',
            'g'
          )
        ),
        '\s+'
      )
    ) as tok
    where tok <> ''
  ) in (select key from target)
     or (
       lower(e.full_name) ~* 'gallardo'
       and (
         (lower(e.full_name) ~* 'avila' and (lower(e.full_name) ~* 'luis' or lower(e.full_name) ~* 'fernando'))
         or (lower(e.full_name) ~* 'luis' and lower(e.full_name) ~* 'fernando')
       )
     )
)
update public.hr_employees e
set
  status = 'baja',
  force_exclude = true,
  force_include = false,
  fecha_baja = date '2026-07-20',
  notes = case
    when e.notes ~* 'duplicado_fusionado' then e.notes
    else 'Archivado: dejó de laborar 2026-07-20. Fuente: correo Sergio «Baja IMSS Luis Fernando Gallardo» (2026-07-21).'
  end,
  updated_at = now()
from matched m
where e.id = m.id;

-- Si no había fila, insertar archivado
insert into public.hr_employees (
  full_name,
  status,
  puesto,
  force_exclude,
  force_include,
  fecha_baja,
  notes,
  source
)
select
  'GALLARDO ÁVILA LUIS FERNANDO',
  'baja',
  'Gerente',
  true,
  false,
  date '2026-07-20',
  'Archivado: dejó de laborar 2026-07-20. Fuente: correo Sergio «Baja IMSS Luis Fernando Gallardo» (2026-07-21).',
  'manual'
where not exists (
  select 1
  from public.hr_employees e
  where (
    lower(e.full_name) ~* 'gallardo'
    and lower(e.full_name) ~* 'avila'
    and (lower(e.full_name) ~* 'luis' or lower(e.full_name) ~* 'fernando')
  )
  or (
    select string_agg(tok, ' ' order by tok)
    from unnest(
      regexp_split_to_array(
        lower(
          regexp_replace(
            translate(
              e.full_name,
              'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
              'AAAAEEEEIIIIOOOOUUUUnaaaaeeeeiiiioooouuuun'
            ),
            '[^a-z0-9\s]',
            ' ',
            'g'
          )
        ),
        '\s+'
      )
    ) as tok
    where tok <> ''
  ) in ('avila fernando gallardo luis', 'fernando gallardo luis')
);

-- Archivo puntual: Soltero Alegría Juan Pablo (barra; FECHA DE BAJA 26/04/2026 vía correo)
with target_soltero as (
  select unnest(array[
    'alegria juan pablo soltero',
    'juan pablo soltero',
    'pablo soltero'
  ]) as key
),
matched_soltero as (
  select e.id
  from public.hr_employees e
  where (
    select string_agg(tok, ' ' order by tok)
    from unnest(
      regexp_split_to_array(
        lower(
          regexp_replace(
            translate(
              e.full_name,
              'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
              'AAAAEEEEIIIIOOOOUUUUnaaaaeeeeiiiioooouuuun'
            ),
            '[^a-z0-9\s]',
            ' ',
            'g'
          )
        ),
        '\s+'
      )
    ) as tok
    where tok <> ''
  ) in (select key from target_soltero)
     or (
       lower(e.full_name) ~* 'soltero'
       and (lower(e.full_name) ~* 'juan' or lower(e.full_name) ~* 'pablo')
     )
)
update public.hr_employees e
set
  status = 'baja',
  force_exclude = true,
  force_include = false,
  fecha_baja = date '2026-04-26',
  notes = case
    when e.notes ~* 'duplicado_fusionado' then e.notes
    else 'Archivado: dejó de laborar 2026-04-26. Fuente: correo «SOLICITUD DE BAJA JUAN PABLO SOLTERO» (2026-04-27).'
  end,
  updated_at = now()
from matched_soltero m
where e.id = m.id;

insert into public.hr_employees (
  full_name,
  status,
  puesto,
  force_exclude,
  force_include,
  fecha_baja,
  notes,
  source
)
select
  'SOLTERO ALEGRIA JUAN PABLO',
  'baja',
  'BARRA',
  true,
  false,
  date '2026-04-26',
  'Archivado: dejó de laborar 2026-04-26. Fuente: correo «SOLICITUD DE BAJA JUAN PABLO SOLTERO» (2026-04-27).',
  'manual'
where not exists (
  select 1
  from public.hr_employees e
  where (
    lower(e.full_name) ~* 'soltero'
    and (lower(e.full_name) ~* 'juan' or lower(e.full_name) ~* 'pablo')
  )
  or (
    select string_agg(tok, ' ' order by tok)
    from unnest(
      regexp_split_to_array(
        lower(
          regexp_replace(
            translate(
              e.full_name,
              'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
              'AAAAEEEEIIIIOOOOUUUUnaaaaeeeeiiiioooouuuun'
            ),
            '[^a-z0-9\s]',
            ' ',
            'g'
          )
        ),
        '\s+'
      )
    ) as tok
    where tok <> ''
  ) in ('alegria juan pablo soltero', 'juan pablo soltero', 'pablo soltero')
);
