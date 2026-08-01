-- =============================================================================
-- Staff Corte del día — cierre unificado (TPV fotos + RPT)
-- =============================================================================
-- Cómo aplicar (local / Supabase Dashboard):
--   1. Abre Supabase → SQL Editor → New query
--   2. Pega ESTE archivo completo y Run (una sola vez; re-run seguro)
--   3. Verifica: Table Editor → staff_rpt_diario
--   4. También hace falta supabase/tpv_cortes.sql (fotos T1–T3)
--   5. Local: npm run dev → /staff/corte
--
-- Flujo único Staff «Corte del día»:
--   (A) Foto terminales 1–3 + montos leídos del ticket → tpv_corte_uploads
--   (B) WI, Eventos, efectivo/tómbola → staff_rpt_diario (bancos = snapshot TPV)
--   Un «Cerrar corte» por fecha. Sin líneas bancarias manuales ni cortesías.
-- Bancos desde fotos: hoy+ (CDMX); sin backfill histórico.
-- =============================================================================

create table if not exists public.staff_rpt_diario (
  id uuid primary key default gen_random_uuid(),
  rpt_date date not null,
  wi_amount numeric(12, 2) not null default 0,
  eventos_amount numeric(12, 2) not null default 0,
  -- Snapshot propinas = suma propina TPV del día (no tecleo aparte)
  propinas numeric(12, 2) not null default 0,
  efectivo_tombola numeric(12, 2) not null default 0,
  efectivo_contado numeric(12, 2),
  efectivo_infocaja numeric(12, 2),
  bancos_neto_tpv numeric(12, 2),
  bancos_cobrado_tpv numeric(12, 2),
  bancos_propina_tpv numeric(12, 2),
  tpv_accounted smallint not null default 0
    check (tpv_accounted between 0 and 3),
  tpv_complete boolean not null default false,
  notes text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists staff_rpt_diario_date_uidx
  on public.staff_rpt_diario (rpt_date);

create index if not exists staff_rpt_diario_date_desc_idx
  on public.staff_rpt_diario (rpt_date desc);

create index if not exists staff_rpt_diario_created_by_idx
  on public.staff_rpt_diario (created_by);

alter table public.staff_rpt_diario enable row level security;

comment on table public.staff_rpt_diario is
  'Cierre RPT del Corte del día Staff. Bancos/propinas = snapshot TPV (foto). Sin cortesías.';

alter table public.staff_rpt_diario
  add column if not exists efectivo_contado numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists efectivo_infocaja numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists bancos_neto_tpv numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists bancos_cobrado_tpv numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists bancos_propina_tpv numeric(12, 2);
alter table public.staff_rpt_diario
  add column if not exists tpv_accounted smallint;
alter table public.staff_rpt_diario
  add column if not exists tpv_complete boolean;
-- Columna legado de borrador; el UI/API no la usan
alter table public.staff_rpt_diario
  add column if not exists bancos_manual numeric(12, 2);
