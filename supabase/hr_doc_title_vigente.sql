-- Patch: renombrar título UI «Documentación vigente 2023» → «Documentación vigente»
-- (el path en disco/Drive puede seguir incluyendo 2023; solo afecta el título mostrado)
-- Idempotente. También lo aplica GET /api/hr/docs en runtime.

update public.hr_doc_links
set title = 'Documentación vigente',
    description = coalesce(
      nullif(trim(description), ''),
      'Carpeta: políticas, reglamentos, formatos y antigüedad'
    ),
    sort_order = coalesce(sort_order, 50)
where category = 'politicas'
  and title in ('Documentación vigente 2023', 'Documentación');
