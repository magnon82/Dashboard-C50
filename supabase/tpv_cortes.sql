-- =============================================================================
-- Cortes TPV — one-shot setup (tabla + bucket + 2 fotos/terminal)
-- =============================================================================
-- Cómo aplicar (local / Supabase Dashboard):
--   1. Abre Supabase → SQL Editor → New query
--   2. Pega ESTE archivo completo y Run (una sola vez; re-run seguro)
--   3. Verifica: Table Editor → tpv_corte_uploads
--               Storage → bucket privado "tpv-cortes"
--   4. Local: npm run dev → /ventas/corte-tpv o /staff/corte
--
-- Si la tabla YA existía con 1 foto/terminal, corre además (o en su lugar
-- el patch): supabase/tpv_cortes_two_photos.sql
--
-- Auth del suite: cookie HMAC + SUPABASE_SERVICE_ROLE_KEY (igual que Eventos).
-- RLS ON sin policies anon → solo service_role vía API Next.
--
-- Regla diaria: Terminales 1, 2 y 3 deben quedar contabilizadas.
-- Por terminal:
--   1) Foto venta (TOTALIZACIÓN) + foto propinas (REPORTE DE PROPINAS), o
--   2) Marcado «No se utilizó» (ambas fotos no aplican).
-- Neto banco = cobrado (venta) + propinas (reporte).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Metadata de uploads / no-uso
-- ---------------------------------------------------------------------------
create table if not exists public.tpv_corte_uploads (
  id uuid primary key default gen_random_uuid(),
  corte_date date not null,
  -- Terminal física 1 | 2 | 3 (hay 3 TPV en salón)
  terminal_number smallint not null
    check (terminal_number between 1 and 3),
  -- photo = foto del corte; unused = «No se utilizó la terminal N»
  entry_kind text not null default 'photo'
    check (entry_kind in ('photo', 'unused')),
  -- venta = TOTALIZACIÓN; propina = REPORTE DE PROPINAS; null si unused
  photo_kind text,
  terminal_label text,
  uploader_username text not null,
  -- Solo obligatorio si entry_kind = photo
  storage_path text,
  mime_type text,
  byte_size integer,
  width_px integer,
  height_px integer,
  sharpness_score numeric(10, 2),
  -- Montos: OCR al subir (venta=cobrado post-reconcile; propina=tip)
  -- ticket_total TOTALIZACIÓN vive en ocr_text (meta) / neto_banco hasta reconciliar
  -- cobrado → fila photo_kind=venta; propina → fila photo_kind=propina
  -- Con ambas fotos: cobrado = ticket_total − propina; neto = cobrado + propina
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
  updated_at timestamptz not null default now(),
  constraint tpv_corte_photo_kind_check check (
    (entry_kind = 'unused' and photo_kind is null)
    or (entry_kind = 'photo' and photo_kind in ('venta', 'propina'))
  ),
  constraint tpv_corte_photo_needs_path check (
    (entry_kind = 'unused' and storage_path is null and photo_kind is null)
    or (entry_kind = 'photo' and storage_path is not null
        and photo_kind in ('venta', 'propina'))
  )
);

-- Si la tabla ya existía sin columnas nuevas (re-run seguro):
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

-- Unique viejo (1 fila/terminal) → reemplazar por kind
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

alter table public.tpv_corte_uploads enable row level security;

comment on table public.tpv_corte_uploads is
  'Cortes TPV diarios (3 terminales × 2 fotos: venta+propina, o unused). Neto banco = cobrado + propinas.';
comment on column public.tpv_corte_uploads.photo_kind is
  'venta = TOTALIZACIÓN; propina = REPORTE DE PROPINAS; null si unused.';

-- ---------------------------------------------------------------------------
-- Storage bucket (privado; firmado vía service role)
-- Alternativa UI: Storage → New bucket → id "tpv-cortes", Private,
--   size limit 8 MB, MIME: jpeg/png/webp/heic/heif
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

-- Sin policies públicas de Storage: el backend usa SUPABASE_SERVICE_ROLE_KEY.
-- (No crear policies anon/authenticated para este bucket.)
