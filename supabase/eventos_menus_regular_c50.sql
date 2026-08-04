-- Patch: Menú regular (carta C50 alimentos) en cotizador Eventos.
-- Ejecutar en Supabase → SQL Editor.

-- Ampliar check de category
do $$
begin
  alter table public.event_menus
    drop constraint if exists event_menus_category_check;
exception
  when undefined_object then null;
end $$;

alter table public.event_menus
  add constraint event_menus_category_check
  check (category in (
    'tres_tiempos', 'carta', 'desayunos', 'parejas', 'barra_libre', 'paquete', 'extra'
  ));

insert into public.event_menus (
  code, name, category, description, min_pax, requires_food,
  includes_servicio, sort_order, notes
)
values (
  'menu_regular_c50',
  'Menú regular (C50)',
  'carta',
  'Carta de alimentos del restaurante (Menú C50 Esp). Precio por platillo / persona. Grupos desde 10 personas.',
  10,
  false,
  false,
  15,
  'Fuente: I:\Mi unidad\Menú C50\Menú C50 Esp.pdf — entradas, fuertes, postres y guarniciones. Soft-load también desde seed JSON.'
)
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  min_pax = excluded.min_pax,
  sort_order = excluded.sort_order,
  notes = excluded.notes,
  active = true;

comment on column public.event_menus.category is
  'tres_tiempos | carta (menú regular C50) | desayunos | parejas | barra_libre | paquete | extra (bebidas C50)';
