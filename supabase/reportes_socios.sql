-- =============================================================================
-- Reportes Socios — contenido editable desde Master Panel
-- =============================================================================
-- Cómo aplicar (local / Supabase Dashboard):
--   1. Abre Supabase → SQL Editor → New query
--   2. Pega ESTE archivo completo y Run (una sola vez; re-run seguro)
--   3. Verifica: Table Editor → reportes_socios_content (1 fila id='default')
--   4. Local: npm run dev → /admin (editar) → /reportes-socios (ver)
--
-- Auth del suite: cookie HMAC + SUPABASE_SERVICE_ROLE_KEY (igual que Eventos / TPV).
-- RLS ON sin policies anon → solo service_role vía API Next.
-- =============================================================================

create table if not exists public.reportes_socios_content (
  id text primary key default 'default'
    check (id = 'default'),
  -- Estructura JSON (seed abajo):
  -- {
  --   "resumen": { "intro": "", "kpis": [{ "label","value","hint" }, ...] },
  --   "indicadores": { "body": "", "items": [{ "label","value","note" }, ...] },
  --   "detalle": { "body": "", "rows": [{ "periodo","concepto","monto","nota" }, ...] },
  --   "notas": { "body": "", "items": [{ "title","body","url" }, ...] }
  -- }
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.reportes_socios_content enable row level security;

comment on table public.reportes_socios_content is
  'Contenido CMS de Reportes Socios (Resumen, Indicadores, Detalle, Notas). Singleton id=default. Editado desde Master Panel.';

-- Seed: fila única con estructura vacía (placeholders listos para rellenar en /admin)
insert into public.reportes_socios_content (id, content, updated_by)
values (
  'default',
  '{
    "resumen": {
      "intro": "",
      "kpis": [
        { "label": "Resumen del periodo", "value": "", "hint": "" },
        { "label": "Comparativo", "value": "", "hint": "" },
        { "label": "Distribución", "value": "", "hint": "" }
      ]
    },
    "indicadores": {
      "body": "",
      "items": []
    },
    "detalle": {
      "body": "",
      "rows": []
    },
    "notas": {
      "body": "",
      "items": []
    }
  }'::jsonb,
  'seed'
)
on conflict (id) do nothing;
