-- =============================================================================
-- Órdenes de servicio PDF (legado Drive) → BMS: tabla + Storage
-- =============================================================================
-- IDEMPOTENTE. Supabase → SQL Editor → pegar TODO → Run.
--
-- Propósito ERP:
--   · Indexar/clasificar PDFs de «Órdenes de servicio» (folio, año, fecha, cliente)
--   · Guardar el binario en Storage (bucket privado eventos-os-docs)
--   · Consultar/Descargar en producción desde BMS, no streamear Drive en cada clic
--
-- Ingest: File Stream (PC admin) o Drive API (EVENTOS_OS_DRIVE_FOLDER_ID) vía
--   POST /api/eventos/os { action: 'sync_pdfs' } / Actualizar en UI.
-- Digital OS sigue en event_service_orders (sin PDF adjunto aquí).
-- =============================================================================

create table if not exists public.event_os_documents (
  id uuid primary key default gen_random_uuid(),
  -- Clave canónica = rel_path normalizado (año/archivo.pdf bajo Ordenes de servicio)
  rel_path text not null,
  filename text not null,
  folio text,
  year integer,
  event_date date,
  label text,
  matched_client_name text,
  client_id uuid references public.event_clients (id) on delete set null,
  storage_path text,
  mime_type text,
  byte_size integer,
  checksum_sha256 text,
  source text not null default 'activity_seed'
    check (source in ('scan', 'activity_seed', 'drive', 'manual')),
  drive_file_id text,
  status text not null default 'index_only'
    check (status in ('index_only', 'uploaded', 'missing')),
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique en rel_path (canónica) — PostgREST upsert onConflict: 'rel_path'
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_os_documents_rel_path_key'
  ) then
    alter table public.event_os_documents
      add constraint event_os_documents_rel_path_key unique (rel_path);
  end if;
exception
  when duplicate_object then null;
  when duplicate_table then null;
end $$;

create index if not exists event_os_documents_event_date_idx
  on public.event_os_documents (event_date desc nulls last);

create index if not exists event_os_documents_folio_year_idx
  on public.event_os_documents (year, folio);

create index if not exists event_os_documents_status_idx
  on public.event_os_documents (status);

create index if not exists event_os_documents_storage_idx
  on public.event_os_documents (storage_path)
  where storage_path is not null;

alter table public.event_os_documents enable row level security;

comment on table public.event_os_documents is
  'PDFs de órdenes de servicio homogenizados en BMS (metadata + Storage). Drive/File Stream solo ingest.';

-- Bucket privado (PDF hasta 25 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'eventos-os-docs',
  'eventos-os-docs',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
