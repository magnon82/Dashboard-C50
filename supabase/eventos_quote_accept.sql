-- Patch: aceptación online de cotización + método de pago (cliente en /c/{token}).
-- Ejecutar en Supabase → SQL Editor si event_quotes ya existía.

alter table public.event_quotes
  add column if not exists accepted_at timestamptz;

alter table public.event_quotes
  add column if not exists payment_method text;

alter table public.event_quotes
  add column if not exists client_accept_note text;

alter table public.event_quotes
  add column if not exists payment_link_url text;

-- Restringir valores conocidos (permite NULL hasta que el cliente acepte).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_quotes_payment_method_check'
  ) then
    alter table public.event_quotes
      add constraint event_quotes_payment_method_check
      check (
        payment_method is null
        or payment_method in (
          'efectivo_restaurante',
          'tarjeta_terminal',
          'tarjeta_link',
          'transferencia_bbva'
        )
      );
  end if;
end $$;

comment on column public.event_quotes.accepted_at is
  'Momento en que el cliente aceptó la cotización vía /c/{token}.';
comment on column public.event_quotes.payment_method is
  'Método de pago elegido al aceptar: efectivo_restaurante | tarjeta_terminal | tarjeta_link | transferencia_bbva.';
comment on column public.event_quotes.client_accept_note is
  'Nota opcional del cliente al aceptar.';
comment on column public.event_quotes.payment_link_url is
  'URL de link de pago (staff pega después si eligió tarjeta_link). Visible al cliente cuando exista.';
