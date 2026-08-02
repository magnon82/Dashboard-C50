-- Cierra todos los leads abiertos del CRM de Eventos como perdidos.
-- Criterio Tablero (/api/eventos/summary): abierto = stage NOT IN ('ganado','perdido').
-- No elimina filas. Marca notes con closed_bulk_2026-08-01.
--
-- Uso (SQL Editor / psql / apply_supabase_sql):
--   ejecutar este archivo una vez.

begin;

-- Conteo previo (informativo; ver en cliente o con SELECT aparte)
-- select stage, count(*) from public.event_leads group by stage order by stage;

update public.event_leads
set
  stage = 'perdido',
  notes = case
    when notes is null or btrim(notes) = '' then '[closed_bulk_2026-08-01]'
    when position('closed_bulk_2026-08-01' in notes) > 0 then notes
    else notes || E'\n[closed_bulk_2026-08-01]'
  end,
  updated_at = now()
where stage is distinct from 'ganado'
  and stage is distinct from 'perdido';

-- Verificación sugerida:
-- select
--   count(*) filter (where stage not in ('ganado','perdido')) as leads_abiertos,
--   count(*) filter (where stage = 'perdido') as perdidos,
--   count(*) filter (where stage = 'ganado') as ganados
-- from public.event_leads;

commit;
