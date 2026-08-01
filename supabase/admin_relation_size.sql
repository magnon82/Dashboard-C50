-- Tamaño real de una relación (tabla + índices + TOAST).
-- Ejecutar una vez en Supabase → SQL Editor.
-- Usado por GET /api/admin/storage-stats vía rpc('admin_relation_size').

create or replace function public.admin_relation_size(rel text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select pg_total_relation_size(('public.' || rel)::regclass);
$$;

revoke all on function public.admin_relation_size(text) from public;
grant execute on function public.admin_relation_size(text) to service_role;

comment on function public.admin_relation_size(text) is
  'Bytes totales (pg_total_relation_size) de una tabla en public. Solo service_role.';
