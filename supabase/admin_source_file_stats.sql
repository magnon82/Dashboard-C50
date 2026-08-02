-- Agregación barata de source_file en financial_records.
-- Ejecutar una vez en Supabase → SQL Editor.
-- Usado por GET /api/admin/data-inventory vía rpc('admin_source_file_stats').

create or replace function public.admin_source_file_stats()
returns table (
  source_file text,
  row_count bigint,
  last_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(fr.source_file), ''), '(vacío)') as source_file,
    count(*)::bigint as row_count,
    max(fr.date)::date as last_date
  from public.financial_records fr
  group by 1
  order by 1;
$$;

revoke all on function public.admin_source_file_stats() from public;
grant execute on function public.admin_source_file_stats() to service_role;

comment on function public.admin_source_file_stats() is
  'DISTINCT source_file con conteo y última fecha. Solo service_role.';
