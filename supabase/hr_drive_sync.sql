-- Estado de sincronización Drive RH → Supabase (metadatos / índices).
-- Los binarios (PDF/docx/xlsx) siguen en Drive; Suite opera con filas ya importadas.
-- Ejecutar en SQL Editor de Supabase si aún no existe la tabla.

create table if not exists public.hr_drive_sync_state (
  content_type text primary key,
  label text not null,
  last_synced_at timestamptz,
  last_source text,
  last_status text not null default 'never',
  last_message text,
  row_count integer,
  updated_at timestamptz not null default now()
);

alter table public.hr_drive_sync_state enable row level security;

comment on table public.hr_drive_sync_state is
  'Última sync por tipo de contenido RH/Eventos desde File Stream o Drive API. Frecuencia la define operación (no hardcodeada).';

comment on column public.hr_drive_sync_state.content_type is
  'nomina | horarios | expedientes | biblioteca | cultura | eventos_os | eventos_biblioteca | eventos_activity | base_datos_personal';

comment on column public.hr_drive_sync_state.last_source is
  'file_stream | drive_api | supabase | downloads | code | seed_json | manual';
