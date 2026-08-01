-- Patch: campos de contacto / celebración en event_leads
-- Ejecutar en Supabase → SQL Editor si la tabla ya existía (ADD COLUMN IF NOT EXISTS).
-- El seed completo ya incluye estas columnas en supabase/eventos_module.sql.

alter table public.event_leads
  add column if not exists contact_name text;

alter table public.event_leads
  add column if not exists phone text;

alter table public.event_leads
  add column if not exists email text;

alter table public.event_leads
  add column if not exists company text;

alter table public.event_leads
  add column if not exists celebration text;

comment on column public.event_leads.contact_name is
  'Nombre de contacto del lead (independiente de event_clients).';
comment on column public.event_leads.phone is
  'Teléfono de contacto.';
comment on column public.event_leads.email is
  'Correo de contacto.';
comment on column public.event_leads.company is
  'Empresa (si aplica).';
comment on column public.event_leads.celebration is
  'Qué celebran (boda, XV, corporativo, etc.). Suele ser el título del lead.';
comment on column public.event_leads.estimated_amount is
  'Presupuesto por persona (MXN).';
comment on column public.event_leads.notes is
  'Notas / requisiciones del cliente.';
