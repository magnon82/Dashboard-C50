-- =============================================================================
-- staff_rpt_diario.edit_history — auditoría al editar cortes cerrados (Master)
-- =============================================================================
-- Aplicar en Supabase → SQL Editor (idempotente).
-- Cada PATCH admin guarda un snapshot de valores previos en este JSONB.
-- =============================================================================

alter table public.staff_rpt_diario
  add column if not exists edit_history jsonb not null default '[]'::jsonb;

comment on column public.staff_rpt_diario.edit_history is
  'Historial de ediciones admin: [{edited_at, edited_by, previous: {...}}] (más reciente al final).';
