-- =============================================================================
-- Patch: seed hr_doc_links — Documentación vigente + categoría manuales
-- =============================================================================
-- Usar si ya corriste hr_module.sql y solo quieres añadir/actualizar la biblioteca.
-- Idempotente (insert where not exists por category+title).
-- Paths = nombres exactos en disco (carpeta Drive aún: Documentación vigente 2023)
-- (incl. «Reglamento C50 NO  FUMAR.docx» con doble espacio).
-- =============================================================================

-- Ampliar check de category si la tabla ya existía sin 'manuales'
do $$
begin
  alter table public.hr_doc_links drop constraint if exists hr_doc_links_category_check;
  alter table public.hr_doc_links
    add constraint hr_doc_links_category_check
    check (category in (
      'cultura', 'perfiles', 'examenes', 'expedientes',
      'politicas', 'manuales', 'nominas', 'horarios', 'otro'
    ));
exception
  when undefined_table then
    raise notice 'hr_doc_links no existe: ejecuta primero supabase/hr_module.sql';
  when others then
    raise notice 'No se pudo ajustar hr_doc_links_category_check: %', SQLERRM;
end $$;

insert into public.hr_doc_links (category, title, description, local_path, sort_order)
select v.category, v.title, v.description, v.local_path, v.sort_order
from (values
  (
    'cultura',
    'Cultura organizacional',
    'Materiales de cultura y valores C50',
    'I:\Mi unidad\RH\Cultura Organizacional',
    10
  ),
  (
    'cultura',
    'Misión, Visión y Valores',
    'Documento vigente de cultura organizacional',
    'I:\Mi unidad\RH\Documentación vigente 2023\Misión, Visión y Valores.docx',
    12
  ),
  (
    'perfiles',
    'Perfiles por posición',
    'Perfiles, KPI y protocolos por puesto',
    'I:\Mi unidad\RH\Perfiles por posición',
    20
  ),
  (
    'examenes',
    'Exámenes de piso',
    'Exámenes y evaluaciones de piso',
    'I:\Mi unidad\RH\Exámenes piso',
    30
  ),
  (
    'manuales',
    'Manual de contratación y baja de personal',
    'Proceso de alta y baja de colaboradores',
    'I:\Mi unidad\RH\Documentación vigente 2023\Manual de contratación y baja de personal.docx',
    45
  ),
  (
    'manuales',
    'Manual para postular vacantes',
    'Guía para publicar y postular vacantes',
    'I:\Mi unidad\RH\Documentación vigente 2023\Manual para postular vacantes.docx',
    46
  ),
  (
    'politicas',
    'Documentación vigente',
    'Carpeta: políticas, reglamentos, formatos y antigüedad',
    'I:\Mi unidad\RH\Documentación vigente 2023',
    50
  ),
  (
    'politicas',
    'Política de vacaciones',
    'Anticipación, tope de días y reglas de goce',
    'I:\Mi unidad\RH\Documentación vigente 2023\Política de vacaciones.docx',
    51
  ),
  (
    'politicas',
    'Política de puntualidad y asistencia',
    'Asistencia, retardos y faltas',
    'I:\Mi unidad\RH\Documentación vigente 2023\Política de puntualidad y asistencia.docx',
    52
  ),
  (
    'politicas',
    'Reglamento Interior de Trabajo',
    'RIT vigente C50',
    'I:\Mi unidad\RH\Documentación vigente 2023\Reglamento Interior de Trabajo.docx',
    53
  ),
  (
    'politicas',
    'Reglamento C50 No fumar',
    'Espacios libres de humo (archivo: «NO  FUMAR», doble espacio)',
    'I:\Mi unidad\RH\Documentación vigente 2023\Reglamento C50 NO  FUMAR.docx',
    54
  )
) as v(category, title, description, local_path, sort_order)
where not exists (
  select 1 from public.hr_doc_links d
  where d.category = v.category and d.title = v.title
);

-- Renombrar título de UI (path Drive sin cambios) si ya existía el seed viejo
update public.hr_doc_links
set title = 'Documentación vigente',
    description = 'Carpeta: políticas, reglamentos, formatos y antigüedad',
    sort_order = 50
where category = 'politicas'
  and title in ('Documentación vigente 2023', 'Documentación');

-- Ocultar carpetas con pestaña propia (Expedientes / Horarios / Nómina)
update public.hr_doc_links
set active = false
where title in (
  'Expedientes personal C50',
  'Horarios históricos',
  'Nóminas (Drive)'
)
or category in ('expedientes', 'horarios', 'nominas');
