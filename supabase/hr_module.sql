-- =============================================================================
-- Módulo Recursos Humanos (RR.HH.) — Fase 0
-- =============================================================================
-- Cómo aplicar (local / Supabase Dashboard):
--   1. Abre Supabase → SQL Editor → New query
--   2. Pega ESTE archivo completo y Run (una sola vez; re-run seguro)
--   3. Verifica: Table Editor → hr_employees, hr_payroll_periods, hr_doc_links
--   4. Local: npm run dev → /rrhh (módulo activo; permiso `rrhh` en Admin)
--
-- Auth del suite: cookie HMAC + service role (igual que eventos / staff).
-- RLS habilitado SIN policies para anon/authenticated: solo service_role vía API.
--
-- Plantilla vigente = empleados en líneas del periodo más reciente con
-- status = 'pagado', más force_include, menos force_exclude.
-- Capacidades futuras (no en auth v1): rrhh.payroll (sueldos), rrhh.expedientes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Empleados
-- ---------------------------------------------------------------------------
create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  status text not null default 'activo'
    check (status in ('activo', 'baja', 'suspendido')),
  puesto text,
  area text,
  fecha_ingreso date,
  -- Cumpleaños Staff (patch hr_employee_nacimiento.sql si DB ya existía)
  fecha_nacimiento date,
  sueldo_diario numeric(12, 2),
  email text,
  phone text,
  emergency_contact text,
  emergency_phone text,
  drive_folder_path text,
  notes text,
  -- Username del suite (cookie) para enlazar Staff → ficha RH
  suite_username text,
  -- Overrides sobre plantilla vigente (última nómina pagada)
  force_include boolean not null default false,
  force_exclude boolean not null default false,
  -- Último día laborado cuando status = 'baja'
  fecha_baja date,
  source text not null default 'manual'
    check (source in ('manual', 'nomina_import', 'xlsx', 'sheets')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_employees_status_idx on public.hr_employees (status);
create index if not exists hr_employees_name_idx on public.hr_employees (lower(full_name));
create index if not exists hr_employees_area_idx on public.hr_employees (area);
create unique index if not exists hr_employees_suite_username_uidx
  on public.hr_employees (lower(suite_username))
  where suite_username is not null and length(trim(suite_username)) > 0;

alter table public.hr_employees enable row level security;

comment on table public.hr_employees is
  'Plantilla RR.HH. Sueldos solo vía API con capacidad RH. force_include/exclude ajustan plantilla vigente.';

comment on column public.hr_employees.force_include is
  'Alta anticipada: aparece en plantilla vigente aunque no esté en la última nómina pagada.';
comment on column public.hr_employees.force_exclude is
  'Exclusión: no aparece en plantilla vigente aunque cobre en la última pagada.';

comment on column public.hr_employees.fecha_baja is
  'Último día laborado / fecha de baja. Con status=baja queda fuera de plantilla.';

comment on column public.hr_employees.fecha_nacimiento is
  'Fecha de nacimiento (cumpleaños). Soft-fill desde BASE DATOS PERSONAL o captura RH.';

-- ---------------------------------------------------------------------------
-- Nómina
-- ---------------------------------------------------------------------------
create table if not exists public.hr_payroll_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'borrador'
    check (status in ('borrador', 'cerrado', 'pagado')),
  paid_at date,
  notes text,
  source_file text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists hr_payroll_periods_status_idx
  on public.hr_payroll_periods (status);
create index if not exists hr_payroll_periods_end_idx
  on public.hr_payroll_periods (period_end desc);

alter table public.hr_payroll_periods enable row level security;

comment on table public.hr_payroll_periods is
  'Periodos de nómina. Al marcar pagado se redefine la plantilla vigente.';

create table if not exists public.hr_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.hr_payroll_periods (id) on delete cascade,
  employee_id uuid not null references public.hr_employees (id) on delete restrict,
  sueldo_diario numeric(12, 2),
  dias_trabajados numeric(6, 2) not null default 0,
  -- Marcas Lun–Dom [7] (Excel I–O); suma → dias_trabajados
  dias_semana jsonb,
  horas_extra numeric(8, 2) not null default 0,
  bonos numeric(12, 2) not null default 0,
  retenciones numeric(12, 2) not null default 0,
  importe_pagado numeric(12, 2) not null default 0,
  vacaciones_tomadas numeric(6, 2),
  vacaciones_restantes numeric(6, 2),
  puesto_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  unique (period_id, employee_id)
);

-- Patch idempotente si la tabla ya existía sin la columna
alter table public.hr_payroll_lines
  add column if not exists dias_semana jsonb;

create index if not exists hr_payroll_lines_period_idx
  on public.hr_payroll_lines (period_id);
create index if not exists hr_payroll_lines_employee_idx
  on public.hr_payroll_lines (employee_id);

alter table public.hr_payroll_lines enable row level security;

comment on table public.hr_payroll_lines is
  'Líneas de nómina por empleado/periodo. Modelo heredado de Sheets/xlsx Nóminas.';

-- ---------------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------------
create table if not exists public.hr_schedule_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  status text not null default 'propuesta'
    check (status in ('propuesta', 'borrador', 'publicado')),
  notes text,
  created_by text,
  published_by text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (week_end >= week_start),
  unique (week_start)
);

create index if not exists hr_schedule_weeks_status_idx
  on public.hr_schedule_weeks (status);
create index if not exists hr_schedule_weeks_start_idx
  on public.hr_schedule_weeks (week_start desc);

alter table public.hr_schedule_weeks enable row level security;

comment on table public.hr_schedule_weeks is
  'Semana de horarios. Solo status=publicado es visible en /staff (Mi horario).';

create table if not exists public.hr_schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.hr_schedule_weeks (id) on delete cascade,
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  shift_date date not null,
  start_time time,
  end_time time,
  area text,
  role_label text,
  origin text not null default 'manual'
    check (origin in ('auto', 'manual')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists hr_schedule_shifts_week_idx
  on public.hr_schedule_shifts (week_id);
create index if not exists hr_schedule_shifts_employee_idx
  on public.hr_schedule_shifts (employee_id);
create index if not exists hr_schedule_shifts_date_idx
  on public.hr_schedule_shifts (shift_date);

alter table public.hr_schedule_shifts enable row level security;

comment on table public.hr_schedule_shifts is
  'Turnos por día/empleado. origin=auto = propuesta generada; manual = ajuste RH.';

-- ---------------------------------------------------------------------------
-- Disponibilidad
-- ---------------------------------------------------------------------------
create table if not exists public.hr_availability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  -- 0=domingo … 6=sábado (ISO-ish; UI documentará)
  weekday smallint check (weekday between 0 and 6),
  date_from date,
  date_to date,
  kind text not null default 'preferencia'
    check (kind in ('preferencia', 'off', 'bloqueo', 'permiso')),
  start_time time,
  end_time time,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_availability_employee_idx
  on public.hr_availability (employee_id);
create index if not exists hr_availability_dates_idx
  on public.hr_availability (date_from, date_to);

alter table public.hr_availability enable row level security;

comment on table public.hr_availability is
  'Preferencias/offs/bloqueos por empleado. Alimenta generador de propuesta (Fase 1).';

-- ---------------------------------------------------------------------------
-- Vacaciones
-- ---------------------------------------------------------------------------
create table if not exists public.hr_leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees (id) on delete cascade,
  year integer not null,
  days_entitled numeric(6, 2) not null default 0,
  days_taken numeric(6, 2) not null default 0,
  days_remaining numeric(6, 2) not null default 0,
  source text not null default 'manual'
    check (source in ('manual', 'nomina_import', 'policy')),
  updated_at timestamptz not null default now(),
  unique (employee_id, year)
);

create index if not exists hr_leave_balances_employee_idx
  on public.hr_leave_balances (employee_id);

alter table public.hr_leave_balances enable row level security;

comment on table public.hr_leave_balances is
  'Saldo de vacaciones por empleado/año. Se sincroniza al pagar nómina / aprobar solicitudes.';

create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  -- Nullable si aún no hay vínculo suite → hr_employees (nombre va en payload)
  employee_id uuid references public.hr_employees (id) on delete set null,
  date_from date not null,
  date_to date not null,
  days numeric(6, 2) not null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  requested_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  -- Campos del formato Word C50 (CURP, pago, reingreso, etc.)
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists hr_leave_requests_employee_idx
  on public.hr_leave_requests (employee_id);
create index if not exists hr_leave_requests_status_idx
  on public.hr_leave_requests (status);
create index if not exists hr_leave_requests_requested_by_idx
  on public.hr_leave_requests (lower(requested_by));
create index if not exists hr_leave_requests_created_idx
  on public.hr_leave_requests (created_at desc);

alter table public.hr_leave_requests enable row level security;

comment on table public.hr_leave_requests is
  'Solicitudes de vacaciones. Staff crea en /staff/vacaciones; RH lista/aprueba en /rrhh.';
comment on column public.hr_leave_requests.payload is
  'Campos del formato C50: fecha_solicitud, solicitada_a, nombre_empleado, curp, puesto, ultimo_dia_laborado, fecha_reingreso, pago_vacaciones, observaciones, form_version.';

-- ---------------------------------------------------------------------------
-- Biblioteca / enlaces Drive
-- ---------------------------------------------------------------------------
create table if not exists public.hr_doc_links (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in (
      'cultura', 'perfiles', 'examenes', 'expedientes',
      'politicas', 'manuales', 'nominas', 'horarios', 'otro'
    )),
  title text not null,
  description text,
  local_path text,
  drive_url text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Si la tabla ya existía sin 'manuales', ampliar el check (idempotente).
do $$
begin
  alter table public.hr_doc_links drop constraint if exists hr_doc_links_category_check;
  alter table public.hr_doc_links
    add constraint hr_doc_links_category_check
    check (category in (
      'cultura', 'perfiles', 'examenes', 'expedientes',
      'politicas', 'manuales', 'nominas', 'horarios', 'otro'
    ));
exception
  when others then null;
end $$;

create index if not exists hr_doc_links_category_idx
  on public.hr_doc_links (category);
create index if not exists hr_doc_links_active_idx
  on public.hr_doc_links (active);

alter table public.hr_doc_links enable row level security;

comment on table public.hr_doc_links is
  'Índice de biblioteca RH (carpetas + docs vigentes: políticas, manuales, cultura). Paths bajo I:\\Mi unidad\\RH.';

-- ---------------------------------------------------------------------------
-- Vista: plantilla vigente
-- ---------------------------------------------------------------------------
-- Empleados que aparecen en líneas del periodo pagado/cerrado más reciente
-- (preferencia pagado), más force_include, menos force_exclude.
-- Patch opcional (misma lógica): supabase/hr_plantilla_transcurrida.sql
-- Nota: altas sin nómina → force_include; bajas excepcionales → force_exclude
-- hasta la siguiente nómina pagada.
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
  and (
    e.force_include = true
    or exists (select 1 from from_payroll fp where fp.employee_id = e.id)
  );

comment on view public.hr_plantilla_vigente is
  'Plantilla operativa = última nómina transcurrida (pagado → cerrado) + force_include − force_exclude.';

-- ---------------------------------------------------------------------------
-- Seed: enlaces de biblioteca (paths locales conocidos)
-- Carpetas + docs vigentes (nombres exactos en Drive File Stream).
-- Patch solo-docs: supabase/hr_doc_links_seed.sql
-- ---------------------------------------------------------------------------
insert into public.hr_doc_links (category, title, description, local_path, sort_order)
select v.category, v.title, v.description, v.local_path, v.sort_order
from (values
  (
    'cultura',
    'Cultura organizacional',
    'Materiales de cultura y valores C50',
    'I:\Mi unidad\RH\Cultura Organizacional',
    10
  ),
  (
    'cultura',
    'Misión, Visión y Valores',
    'Documento vigente de cultura organizacional',
    'I:\Mi unidad\RH\Documentación vigente 2023\Misión, Visión y Valores.docx',
    12
  ),
  (
    'perfiles',
    'Perfiles por posición',
    'Perfiles, KPI y protocolos por puesto',
    'I:\Mi unidad\RH\Perfiles por posición',
    20
  ),
  (
    'examenes',
    'Exámenes de piso',
    'Exámenes y evaluaciones de piso',
    'I:\Mi unidad\RH\Exámenes piso',
    30
  ),
  (
    'manuales',
    'Manual de contratación y baja de personal',
    'Proceso de alta y baja de colaboradores',
    'I:\Mi unidad\RH\Documentación vigente 2023\Manual de contratación y baja de personal.docx',
    45
  ),
  (
    'manuales',
    'Manual para postular vacantes',
    'Guía para publicar y postular vacantes',
    'I:\Mi unidad\RH\Documentación vigente 2023\Manual para postular vacantes.docx',
    46
  ),
  (
    'politicas',
    'Documentación vigente',
    'Carpeta: políticas, reglamentos, formatos y antigüedad',
    'I:\Mi unidad\RH\Documentación vigente 2023',
    50
  ),
  (
    'politicas',
    'Política de vacaciones',
    'Anticipación, tope de días y reglas de goce',
    'I:\Mi unidad\RH\Documentación vigente 2023\Política de vacaciones.docx',
    51
  ),
  (
    'politicas',
    'Política de puntualidad y asistencia',
    'Asistencia, retardos y faltas',
    'I:\Mi unidad\RH\Documentación vigente 2023\Política de puntualidad y asistencia.docx',
    52
  ),
  (
    'politicas',
    'Reglamento Interior de Trabajo',
    'RIT vigente C50',
    'I:\Mi unidad\RH\Documentación vigente 2023\Reglamento Interior de Trabajo.docx',
    53
  ),
  (
    'politicas',
    'Reglamento C50 No fumar',
    'Espacios libres de humo (archivo: «NO  FUMAR», doble espacio)',
    'I:\Mi unidad\RH\Documentación vigente 2023\Reglamento C50 NO  FUMAR.docx',
    54
  )
) as v(category, title, description, local_path, sort_order)
where not exists (
  select 1 from public.hr_doc_links d
  where d.category = v.category and d.title = v.title
);

-- Renombrar título de UI (path Drive sin cambios) si ya existía el seed viejo
update public.hr_doc_links
set title = 'Documentación vigente',
    description = 'Carpeta: políticas, reglamentos, formatos y antigüedad',
    sort_order = 50
where category = 'politicas'
  and title in ('Documentación vigente 2023', 'Documentación');

-- Carpetas con pestaña propia (Expedientes / Horarios / Nómina) fuera de Biblioteca
update public.hr_doc_links
set active = false
where title in (
  'Expedientes personal C50',
  'Horarios históricos',
  'Nóminas (Drive)'
)
or category in ('expedientes', 'horarios', 'nominas');
