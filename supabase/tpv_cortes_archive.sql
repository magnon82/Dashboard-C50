-- =============================================================================
-- Cortes TPV · archivo a Google Drive (plan Free: sacar fotos hot antiguas de Storage)
-- =============================================================================
-- Ejecutar una vez en Supabase → SQL Editor.
-- Las filas de metadata permanecen: Master sigue consultando historial;
-- image_url pasa a drive_web_view_link cuando archive_status = 'drive'.
-- =============================================================================

alter table public.tpv_corte_uploads
  add column if not exists archive_status text not null default 'hot'
    check (archive_status in ('hot', 'drive'));

alter table public.tpv_corte_uploads
  add column if not exists drive_file_id text;

alter table public.tpv_corte_uploads
  add column if not exists drive_web_view_link text;

alter table public.tpv_corte_uploads
  add column if not exists archived_at timestamptz;

comment on column public.tpv_corte_uploads.archive_status is
  'hot = binario en Storage tpv-cortes; drive = archivado en Drive admin@ (Storage vacío).';
comment on column public.tpv_corte_uploads.drive_file_id is
  'ID del archivo en Google Drive tras archivar.';
comment on column public.tpv_corte_uploads.drive_web_view_link is
  'Enlace webViewLink para Abrir en Drive desde Master.';
comment on column public.tpv_corte_uploads.archived_at is
  'Momento en que se movió el binario a Drive y se borró de Storage.';

create index if not exists tpv_corte_uploads_archive_status_idx
  on public.tpv_corte_uploads (archive_status);

create index if not exists tpv_corte_uploads_corte_date_archive_idx
  on public.tpv_corte_uploads (corte_date, archive_status);

-- Permitir foto archivada sin storage_path (binario ya en Drive).
alter table public.tpv_corte_uploads
  drop constraint if exists tpv_corte_photo_needs_path;

alter table public.tpv_corte_uploads
  add constraint tpv_corte_photo_needs_path check (
    (entry_kind = 'unused' and storage_path is null and photo_kind is null)
    or (
      entry_kind = 'photo'
      and photo_kind in ('venta', 'propina')
      and (
        storage_path is not null
        or coalesce(archive_status, 'hot') = 'drive'
      )
    )
  );
