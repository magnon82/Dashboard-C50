-- =============================================================================
-- Patch: 2 fotos por terminal (venta + propinas)
-- =============================================================================
-- Cómo aplicar (Supabase → SQL Editor → Run):
--   1. Ejecuta ESTE archivo si ya corriste tpv_cortes.sql antes.
--   2. Si empiezas de cero, puedes correr solo supabase/tpv_cortes.sql
--      (ya incluye el modelo de 2 fotos).
--
-- Regla: cada terminal T1–T3 del día necesita:
--   • Foto «venta» (ticket TOTALIZACIÓN) + monto cobrado, Y
--   • Foto «propina» (ticket REPORTE DE PROPINAS) + monto propina,
--   O una sola fila «No se utilizó» (ambas fotos no aplican).
--
-- Unique:
--   (corte_date, terminal_number, photo_kind) para fotos
--   (corte_date, terminal_number) para unused
-- =============================================================================

-- Columna de tipo de foto
alter table public.tpv_corte_uploads
  add column if not exists photo_kind text;

-- Filas legacy (1 foto/terminal) → se tratan como venta
update public.tpv_corte_uploads
set photo_kind = 'venta'
where entry_kind = 'photo'
  and (photo_kind is null or photo_kind = '');

update public.tpv_corte_uploads
set photo_kind = null
where entry_kind = 'unused';

-- Quitar unique viejo (1 fila por terminal/día)
drop index if exists public.tpv_corte_uploads_day_terminal_uidx;

-- Unique fotos: una venta y una propina por terminal/día
create unique index if not exists tpv_corte_uploads_day_terminal_kind_uidx
  on public.tpv_corte_uploads (corte_date, terminal_number, photo_kind)
  where entry_kind = 'photo' and photo_kind is not null;

-- Unique unused: una marca «no se usó» por terminal/día
create unique index if not exists tpv_corte_uploads_day_terminal_unused_uidx
  on public.tpv_corte_uploads (corte_date, terminal_number)
  where entry_kind = 'unused';

-- Constraints (drop + recreate por si ya existían parcialmente)
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

comment on column public.tpv_corte_uploads.photo_kind is
  'venta = TOTALIZACIÓN; propina = REPORTE DE PROPINAS; null si unused.';

comment on table public.tpv_corte_uploads is
  'Cortes TPV diarios (3 terminales × 2 fotos: venta+propina, o unused). Neto banco = cobrado + propinas.';
