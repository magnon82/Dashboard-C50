-- =============================================================================
-- Staff RPT — Eventos desglosados (OS + venta extra), como pestaña Global
-- =============================================================================
-- Pegar en Supabase → SQL Editor (re-run seguro).
-- eventos_amount sigue siendo el total (OS + extra) para propinas / WI-Eventos.
-- =============================================================================

alter table public.staff_rpt_diario
  add column if not exists eventos_os_amount numeric(12, 2) not null default 0;

alter table public.staff_rpt_diario
  add column if not exists eventos_extra_amount numeric(12, 2) not null default 0;

comment on column public.staff_rpt_diario.eventos_os_amount is
  'Monto confirmado de orden(es) de servicio del día (columna VENTA en Global).';

comment on column public.staff_rpt_diario.eventos_extra_amount is
  'Venta extra del evento del día (columna VENTA EXTRA en Global).';

comment on column public.staff_rpt_diario.eventos_amount is
  'Total eventos del día = eventos_os_amount + eventos_extra_amount.';
