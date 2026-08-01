-- Patch: checklist + próxima fecha de seguimiento en event_leads
-- Ejecutar en Supabase → SQL Editor si la tabla ya existía.
-- El seed completo ya incluye estas columnas en supabase/eventos_module.sql.

alter table public.event_leads
  add column if not exists follow_up_done text[] not null default '{}';

alter table public.event_leads
  add column if not exists next_follow_up_at timestamptz;

comment on column public.event_leads.follow_up_done is
  'Ids del checklist del Manual de seguimiento (captura, bienvenida, alta_cliente, cotizacion, seg_d3, seg_d5, hold, cierre). cotizacion = generar en Cotizador + enviar PDF.';

comment on column public.event_leads.next_follow_up_at is
  'Próxima acción de seguimiento. Si es futura, difiere alertas de cadencia (no holds).';
