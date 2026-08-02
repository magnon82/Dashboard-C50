-- =============================================================================
-- RR.HH. — Resguardo de equipo / herramientas / uniforme / llaves (formato C50)
-- =============================================================================
-- Fuente: I:\Mi unidad\RH\Documentación vigente 2023\Formato de resguardo_C50.xlsx
-- Aplica DESPUÉS de hr_module.sql (Fase 0).
-- Supabase → SQL Editor → pegar y Run (re-run seguro).
--
-- Staff crea en /staff/resguardo; RH lista en /rrhh (Tablero / Expedientes).
-- =============================================================================

-- Vínculo opcional: usuario del suite → ficha RH (también en hr_leave_request_form.sql)
alter table public.hr_employees
  add column if not exists suite_username text;

create unique index if not exists hr_employees_suite_username_uidx
  on public.hr_employees (lower(suite_username))
  where suite_username is not null and length(trim(suite_username)) > 0;

comment on column public.hr_employees.suite_username is
  'Username del suite (cookie session) para enlazar Staff → ficha RH.';

-- ---------------------------------------------------------------------------
-- Solicitudes / cartas de resguardo
-- ---------------------------------------------------------------------------
create table if not exists public.hr_resguardo_requests (
  id uuid primary key default gen_random_uuid(),
  folio text,
  employee_id uuid references public.hr_employees (id) on delete set null,
  -- equipo | herramientas | uniforme | llaves
  kind text not null default 'equipo'
    check (kind in ('equipo', 'herramientas', 'uniforme', 'llaves')),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'entregado', 'devuelto', 'cancelado')),
  -- Datos del responsable + fechas + firmas + cláusulas (flexible)
  payload jsonb not null default '{}'::jsonb,
  -- Líneas de ítems: [{cantidad, concepto, marca, modelo, numero_serie, precio}]
  items jsonb not null default '[]'::jsonb,
  requested_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_resguardo_requests_status_idx
  on public.hr_resguardo_requests (status);
create index if not exists hr_resguardo_requests_employee_idx
  on public.hr_resguardo_requests (employee_id);
create index if not exists hr_resguardo_requests_requested_by_idx
  on public.hr_resguardo_requests (lower(requested_by));
create index if not exists hr_resguardo_requests_created_idx
  on public.hr_resguardo_requests (created_at desc);
create index if not exists hr_resguardo_requests_kind_idx
  on public.hr_resguardo_requests (kind);

alter table public.hr_resguardo_requests enable row level security;

comment on table public.hr_resguardo_requests is
  'Cartas de resguardo C50 (equipo/herramientas/uniforme/llaves). Staff en /staff/resguardo; RH lee en /rrhh.';

comment on column public.hr_resguardo_requests.payload is
  'Campos del xlsx: lugar_fecha, nombre, rfc, puesto, email, telefono, domicilio, fecha_asignacion, fecha_resguardo, receptor_nombre, receptor_puesto, emisor_nombre, emisor_puesto, acepta_condiciones, form_version.';

comment on column public.hr_resguardo_requests.items is
  'Líneas: cantidad, concepto, marca, modelo, numero_serie, precio (plantilla Equipo / Para editar / Llaves).';
