-- =============================================================================
-- URGENTE producción — Corte del día Staff (fotos TPV + cierre RPT)
-- =============================================================================
-- Aplicar HOY en Supabase → SQL Editor → New query → pegar TODO → Run
-- Idempotente (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). Re-run seguro.
--
-- Corrige:
--   1) Falta tabla staff_rpt_diario
--   2) Falta columna photo_kind en tpv_corte_uploads (+ índices 2 fotos/terminal)
--   3) Bucket storage tpv-cortes (si no existe)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) staff_rpt_diario (cierre WI / Eventos / tómbola + snapshot TPV)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_rpt_diario (
  id uuid primary key default gen_random_uuid(),
  rpt_date date not null,
  wi_amount numeric(12, 2) not null default 0,
  eventos_amount numeric(12, 2) not null default 0,
  propinas numeric(12, 2) not null default 0,
  efectivo_tombola numeric(12, 2) not null default 0,
  efectivo_contado numeric(12, 2),
  efectivo_infocaja numeric(12, 2),
  bancos_neto_tpv numeric(12, 2),
  bancos_cobrado_tpv numeric(12, 2),
  bancos_propina_tpv numeric(12, 2),
  tpv_accounted smallint not null default 0
    check (tpv_accounted between 0 and 3),
  tpv_complete boolean not null default false,
  notes text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_rpt_diario_date_uidx
  on public.staff_rpt_diario (rpt_date);

create index if not exists staff_rpt_diario_date_desc_idx
  on public.staff_rpt_diario (rpt_date desc);

create index if not exists staff_rpt_diario_created_by_idx
  on public.staff_rpt_diario (created_by);

alter table public.staff_rpt_diario enable row level security;

alter table public.staff_rpt_diario
  add column if not exists efectivo_contado numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists efectivo_infocaja numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists bancos_neto_tpv numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists bancos_cobrado_tpv numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists bancos_propina_tpv numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists tpv_accounted smallint;
alter table public.staff_rpt_diario
  add column if not exists tpv_complete boolean;
alter table public.staff_rpt_diario
  add column if not exists bancos_manual numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists edit_history jsonb not null default '[]'::jsonb;

comment on table public.staff_rpt_diario is
  'Cierre RPT del Corte del día Staff. Bancos/propinas = snapshot TPV (foto).';
comment on column public.staff_rpt_diario.edit_history is
  'Historial de ediciones admin: [{edited_at, edited_by, previous: {...}}].';

-- ---------------------------------------------------------------------------
-- B) tpv_corte_uploads + photo_kind (2 fotos: venta + propina)
-- ---------------------------------------------------------------------------
create table if not exists public.tpv_corte_uploads (
  id uuid primary key default gen_random_uuid(),
  corte_date date not null,
  terminal_number smallint not null
    check (terminal_number between 1 and 3),
  entry_kind text not null default 'photo'
    check (entry_kind in ('photo', 'unused')),
  photo_kind text,
  terminal_label text,
  uploader_username text not null,
  storage_path text,
  mime_type text,
  byte_size integer,
  width_px integer,
  height_px integer,
  sharpness_score numeric(10, 2),
  total_cobrado numeric(12, 2),
  propina numeric(12, 2),
  neto_banco numeric(12, 2),
  ocr_text text,
  ocr_status text not null default 'skipped'
    check (ocr_status in ('skipped', 'pending', 'done', 'failed')),
  status text not null default 'pending'
    check (status in ('pending', 'parsed', 'verified', 'rejected', 'unused')),
  notes text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tpv_corte_uploads
  add column if not exists terminal_number smallint;
alter table public.tpv_corte_uploads
  add column if not exists entry_kind text;
alter table public.tpv_corte_uploads
  add column if not exists photo_kind text;
alter table public.tpv_corte_uploads
  add column if not exists sharpness_score numeric(10, 2);

-- Legacy 1-foto → venta
update public.tpv_corte_uploads
set photo_kind = 'venta'
where entry_kind = 'photo'
  and (photo_kind is null or photo_kind = '');

update public.tpv_corte_uploads
set photo_kind = null
where entry_kind = 'unused';

drop index if exists public.tpv_corte_uploads_day_terminal_uidx;

create unique index if not exists tpv_corte_uploads_day_terminal_kind_uidx
  on public.tpv_corte_uploads (corte_date, terminal_number, photo_kind)
  where entry_kind = 'photo' and photo_kind is not null;

create unique index if not exists tpv_corte_uploads_day_terminal_unused_uidx
  on public.tpv_corte_uploads (corte_date, terminal_number)
  where entry_kind = 'unused';

create index if not exists tpv_corte_uploads_date_idx
  on public.tpv_corte_uploads (corte_date desc);
create index if not exists tpv_corte_uploads_status_idx
  on public.tpv_corte_uploads (status);
create index if not exists tpv_corte_uploads_uploader_idx
  on public.tpv_corte_uploads (uploader_username);

alter table public.tpv_corte_uploads
  drop constraint if exists tpv_corte_photo_kind_check;
alter table public.tpv_corte_uploads
  add constraint tpv_corte_photo_kind_check check (
    (entry_kind = 'unused' and photo_kind is null)
    or (entry_kind = 'photo' and photo_kind in ('venta', 'propina'))
  );

alter table public.tpv_corte_uploads
  drop constraint if exists tpv_corte_photo_needs_path;
alter table public.tpv_corte_uploads
  add constraint tpv_corte_photo_needs_path check (
    (entry_kind = 'unused' and storage_path is null and photo_kind is null)
    or (entry_kind = 'photo' and storage_path is not null
        and photo_kind in ('venta', 'propina'))
  );

alter table public.tpv_corte_uploads enable row level security;

comment on column public.tpv_corte_uploads.photo_kind is
  'venta = TOTALIZACIÓN; propina = REPORTE DE PROPINAS; null si unused.';

-- ---------------------------------------------------------------------------
-- C) Storage bucket privado tpv-cortes
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tpv-cortes',
  'tpv-cortes',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Verificación rápida (debe devolver filas):
--   select 'staff_rpt_diario' as t, count(*) from information_schema.tables
--     where table_schema='public' and table_name='staff_rpt_diario'
--   union all
--   select 'photo_kind', count(*) from information_schema.columns
--     where table_schema='public' and table_name='tpv_corte_uploads' and column_name='photo_kind';
