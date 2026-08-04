-- Patch: folio de cotización (quote_number) único y documentado.
-- Ejecutar en Supabase → SQL Editor si event_quotes ya existía.
-- No afecta os_number (folio de orden de servicio).

alter table public.event_quotes
  add column if not exists quote_number text;

create unique index if not exists event_quotes_quote_number_uidx
  on public.event_quotes (quote_number)
  where quote_number is not null;

comment on column public.event_quotes.quote_number is
  'Folio de cotización para el cliente (COT-YYYY-###). Independiente de event_service_orders.os_number.';
