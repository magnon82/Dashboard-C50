-- Encuestas de satisfacción (Calidad).
-- Ejecutar una vez en Supabase → SQL Editor.
-- El folio de la hoja no es único: la clave es source_hash de la fila completa.
-- El sync diario solo inserta hashes nuevos (no actualiza filas ya importadas).

create table if not exists public.calidad_encuestas (
  source_hash text primary key,
  folio text,
  ticket text,
  fecha date,
  mesero text,
  mesa text,
  servicio text,
  alimentos text,
  bebidas text,
  limpieza text,
  precio text,
  canal text,
  otro text,
  comentario text,
  imported_at timestamptz not null default now()
);

create index if not exists calidad_encuestas_fecha_idx
  on public.calidad_encuestas (fecha);

create index if not exists calidad_encuestas_mesero_idx
  on public.calidad_encuestas (mesero);

comment on table public.calidad_encuestas is
  'Respuestas de la hoja Encuestas. Una fila por source_hash; no se reimportan.';

create table if not exists public.calidad_sync_state (
  content_type text primary key,
  label text not null,
  last_synced_at timestamptz,
  rows_read integer,
  rows_inserted integer,
  last_status text not null default 'never',
  last_message text,
  updated_at timestamptz not null default now()
);

comment on table public.calidad_sync_state is
  'Última ejecución de sync_calidad_encuestas (GitHub Actions o local).';

alter table public.calidad_encuestas enable row level security;
alter table public.calidad_sync_state enable row level security;

revoke all on table public.calidad_encuestas from public;
revoke all on table public.calidad_sync_state from public;
grant select, insert, update, delete on table public.calidad_encuestas to service_role;
grant select, insert, update, delete on table public.calidad_sync_state to service_role;

-- Alcance de un filtro de periodo + mesero.
-- Sin fechas: todo el histórico, incluidas filas sin fecha.
-- Con periodo: solo filas con fecha dentro del rango.
create or replace function public.calidad_row_in_scope(
  p_fecha date,
  p_row_mesero text,
  p_from date,
  p_to date,
  p_mesero text
) returns boolean
language sql
immutable
as $$
  select (
    (p_from is null and p_to is null)
    or (
      p_fecha is not null
      and (p_from is null or p_fecha >= p_from)
      and (p_to is null or p_fecha <= p_to)
    )
  )
  and (p_mesero is null or p_row_mesero = p_mesero);
$$;

create or replace function public.calidad_canal_grupo(canal text, otro text)
returns text
language plpgsql
immutable
as $$
declare
  c text := upper(translate(btrim(coalesce(canal, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  o text := upper(translate(btrim(coalesce(otro, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  blob text;
begin
  if c = '' and o = '' then
    return null;
  end if;
  if c like '%RECOMEND%' then
    return 'Recomendación';
  end if;
  if c like '%DE PASO%' then
    return 'De paso';
  end if;
  if c like '%VISIT%' then
    return 'Ya nos visitó';
  end if;
  if c like '%REDES%' or c like '%INSTAGRAM%' or c like '%TIK%' or c like '%FACE%' or c = 'FB' then
    return 'Redes';
  end if;
  blob := c || ' ' || o;
  if blob like '%GOOGLE%' or blob like '%MAPS%' then
    return 'Google / Maps';
  end if;
  return 'Otro';
end;
$$;

create or replace function public.calidad_tono(
  p_servicio text,
  p_alimentos text,
  p_bebidas text,
  p_limpieza text,
  p_comentario text
) returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(p_comentario, '')), '') is null then null
    when p_servicio is null and p_alimentos is null and p_bebidas is null and p_limpieza is null then 'sin'
    when p_servicio = 'MALO' or p_alimentos = 'MALO' or p_bebidas = 'MALO' or p_limpieza = 'MALO' then 'malo'
    when p_servicio = 'REGULAR' or p_alimentos = 'REGULAR' or p_bebidas = 'REGULAR' or p_limpieza = 'REGULAR' then 'regular'
    else 'positivo'
  end;
$$;

create or replace function public.calidad_resumen(
  p_from date default null,
  p_to date default null,
  p_mesero text default null,
  p_grain text default 'month'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mesero text := nullif(btrim(coalesce(p_mesero, '')), '');
  v_grain text := case when p_grain = 'day' then 'day' else 'month' end;
  dims text[] := array['servicio', 'alimentos', 'bebidas', 'limpieza'];
  dim text;
  conteo jsonb;
  serie jsonb;
  preguntas jsonb := '{}'::jsonb;
  v_encuestas bigint;
  v_precios jsonb;
  v_canales jsonb;
  v_meseros jsonb;
  v_min date;
  v_max date;
  v_anios jsonb;
  v_sync jsonb;
begin
  select count(*) into v_encuestas
  from public.calidad_encuestas e
  where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, v_mesero);

  foreach dim in array dims loop
    execute format(
      $q$
        select jsonb_build_object(
          'excelente', count(*) filter (where %1$s = 'EXCELENTE'),
          'bueno', count(*) filter (where %1$s = 'BUENO'),
          'regular', count(*) filter (where %1$s = 'REGULAR'),
          'malo', count(*) filter (where %1$s = 'MALO')
        )
        from public.calidad_encuestas e
        where public.calidad_row_in_scope(e.fecha, e.mesero, $1, $2, $3)
      $q$,
      dim
    )
    into conteo
    using p_from, p_to, v_mesero;

    execute format(
      $q$
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'label', bucket,
            'excelente', excelente,
            'bueno', bueno,
            'regular', regular,
            'malo', malo
          )
          order by bucket
        ), '[]'::jsonb)
        from (
          select
            case
              when $4 = 'day' then to_char(e.fecha, 'YYYY-MM-DD')
              else to_char(e.fecha, 'YYYY-MM')
            end as bucket,
            count(*) filter (where %1$s = 'EXCELENTE') as excelente,
            count(*) filter (where %1$s = 'BUENO') as bueno,
            count(*) filter (where %1$s = 'REGULAR') as regular,
            count(*) filter (where %1$s = 'MALO') as malo
          from public.calidad_encuestas e
          where e.fecha is not null
            and %1$s in ('EXCELENTE', 'BUENO', 'REGULAR', 'MALO')
            and public.calidad_row_in_scope(e.fecha, e.mesero, $1, $2, $3)
          group by 1
        ) s
      $q$,
      dim
    )
    into serie
    using p_from, p_to, v_mesero, v_grain;

    preguntas := preguntas || jsonb_build_object(
      dim,
      conteo || jsonb_build_object('serie', serie)
    );
  end loop;

  select jsonb_build_object(
    'justo', count(*) filter (where e.precio = 'JUSTO'),
    'caro', count(*) filter (where e.precio = 'CARO'),
    'barato', count(*) filter (where e.precio = 'BARATO')
  )
  into v_precios
  from public.calidad_encuestas e
  where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, v_mesero);

  select coalesce(jsonb_agg(jsonb_build_object('label', g, 'n', n) order by n desc), '[]'::jsonb)
  into v_canales
  from (
    select public.calidad_canal_grupo(e.canal, e.otro) as g, count(*) as n
    from public.calidad_encuestas e
    where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, v_mesero)
    group by 1
  ) c
  where g is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'nombre', nombre,
    'encuestas', encuestas,
    'servicioExcelente', servicio_excelente,
    'servicioRespondidas', servicio_respondidas
  ) order by encuestas desc, nombre), '[]'::jsonb)
  into v_meseros
  from (
    select
      coalesce(nullif(btrim(e.mesero), ''), 'Sin mesero') as nombre,
      count(*) as encuestas,
      count(*) filter (where e.servicio = 'EXCELENTE') as servicio_excelente,
      count(*) filter (where e.servicio in ('EXCELENTE', 'BUENO', 'REGULAR', 'MALO')) as servicio_respondidas
    from public.calidad_encuestas e
    where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, null)
    group by 1
  ) m;

  select min(e.fecha), max(e.fecha) into v_min, v_max
  from public.calidad_encuestas e
  where e.fecha is not null;

  select coalesce(jsonb_agg(anio order by anio desc), '[]'::jsonb)
  into v_anios
  from (
    select extract(year from e.fecha)::int as anio
    from public.calidad_encuestas e
    where e.fecha is not null
    group by 1
    having count(*) >= 20
  ) y;

  select jsonb_build_object(
    'lastSyncedAt', s.last_synced_at,
    'rowsRead', s.rows_read,
    'rowsInserted', s.rows_inserted,
    'lastStatus', s.last_status,
    'lastMessage', s.last_message
  )
  into v_sync
  from public.calidad_sync_state s
  where s.content_type = 'encuestas';

  return jsonb_build_object(
    'encuestas', v_encuestas,
    'preguntas', preguntas,
    'precios', v_precios,
    'canales', v_canales,
    'meseros', v_meseros,
    'rango', jsonb_build_object('min', v_min, 'max', v_max),
    'anios', v_anios,
    'grain', v_grain,
    'sync', coalesce(v_sync, jsonb_build_object('lastStatus', 'never'))
  );
end;
$$;

create or replace function public.calidad_comentarios(
  p_from date default null,
  p_to date default null,
  p_mesero text default null,
  p_tono text default 'malo',
  p_limit integer default 120
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mesero text := nullif(btrim(coalesce(p_mesero, '')), '');
  v_tono text := case
    when p_tono in ('malo', 'regular', 'positivo', 'sin') then p_tono
    else 'malo'
  end;
  v_limit integer := least(greatest(coalesce(p_limit, 120), 1), 300);
  v_counts jsonb;
  v_total bigint;
  v_items jsonb;
begin
  select jsonb_build_object(
    'malo', count(*) filter (where tono = 'malo'),
    'regular', count(*) filter (where tono = 'regular'),
    'positivo', count(*) filter (where tono = 'positivo'),
    'sin', count(*) filter (where tono = 'sin')
  )
  into v_counts
  from (
    select public.calidad_tono(e.servicio, e.alimentos, e.bebidas, e.limpieza, e.comentario) as tono
    from public.calidad_encuestas e
    where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, v_mesero)
      and nullif(btrim(coalesce(e.comentario, '')), '') is not null
  ) t;

  select count(*) into v_total
  from public.calidad_encuestas e
  where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, v_mesero)
    and public.calidad_tono(e.servicio, e.alimentos, e.bebidas, e.limpieza, e.comentario) = v_tono;

  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
  into v_items
  from (
    select
      jsonb_build_object(
        'fecha', e.fecha,
        'mesero', e.mesero,
        'mesa', e.mesa,
        'ticket', e.ticket,
        'servicio', e.servicio,
        'alimentos', e.alimentos,
        'bebidas', e.bebidas,
        'limpieza', e.limpieza,
        'comentario', btrim(e.comentario)
      ) as item,
      row_number() over (order by e.fecha desc nulls last, e.source_hash) as ord
    from public.calidad_encuestas e
    where public.calidad_row_in_scope(e.fecha, e.mesero, p_from, p_to, v_mesero)
      and public.calidad_tono(e.servicio, e.alimentos, e.bebidas, e.limpieza, e.comentario) = v_tono
    order by e.fecha desc nulls last, e.source_hash
    limit v_limit
  ) s;

  return jsonb_build_object(
    'counts', v_counts,
    'tono', v_tono,
    'total', v_total,
    'items', v_items
  );
end;
$$;

revoke all on function public.calidad_row_in_scope(date, text, date, date, text) from public, anon, authenticated;
revoke all on function public.calidad_canal_grupo(text, text) from public, anon, authenticated;
revoke all on function public.calidad_tono(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.calidad_resumen(date, date, text, text) from public, anon, authenticated;
revoke all on function public.calidad_comentarios(date, date, text, text, integer) from public, anon, authenticated;

grant execute on function public.calidad_resumen(date, date, text, text) to service_role;
grant execute on function public.calidad_comentarios(date, date, text, text, integer) to service_role;
