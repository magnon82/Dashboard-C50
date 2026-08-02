-- Patch: Menú 3 tiempos = solo PDF vigente (7 fuertes; postres unificados).
-- Ejecutar en Supabase → SQL Editor si event_menus ya existía con choice_groups
-- viejos (extras OS / carta C50). Idempotente.
-- Fuente: Menús eventos vigentes\Menú 3 tiempos 2025.pdf
-- Ver docs/eventos-menus/menu-3-tiempos.txt

-- Desactiva SKUs sueltos antiguos bajo el menú 3 tiempos
update public.event_menu_items i
set active = false
from public.event_menus m
where i.menu_id = m.id
  and m.code = 'menu_3_tiempos_2025'
  and i.sku is distinct from '3T-MENU'
  and (i.sku like '3T-%' or i.sku is null);

update public.event_menu_items i
set
  name = 'Menú 3 tiempos',
  description = 'Incluye entrada, plato fuerte y postre. Elige el fuerte para fijar el precio por persona.',
  unit_price = 480.00,
  min_pax = 10,
  active = true,
  price_source = 'pdf_3_tiempos_2025',
  price_verified = true,
  choice_groups = $cg$[
    {
      "id": "plato_fuerte",
      "label": "Plato fuerte",
      "required": true,
      "affects_price": true,
      "options": [
        {"id":"3T-FET","label":"Fetuccini cherry","unit_price":480,"is_vegetarian":true,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-RAV","label":"Ravioles de requesón y espinaca (130 g)","unit_price":560,"is_vegetarian":true,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-PECH","label":"Pechuga en moles (250 g)","unit_price":580,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-CHA","label":"Chamorro al pastor (½ pz)","unit_price":580,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-ATUN","label":"Atún en ponzu","unit_price":560,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-SIR","label":"Sirloin a las brasas (300 g)","unit_price":850,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"},
        {"id":"3T-RIB","label":"Rib eye (300 g)","unit_price":850,"is_vegetarian":false,"price_verified":true,"price_source":"pdf_3_tiempos_2025"}
      ]
    },
    {
      "id": "entrada",
      "label": "Entrada",
      "required": false,
      "affects_price": false,
      "options": [
        {"id":"ENT-QUES","label":"Quesadillas Coyoacán (2 pz)"},
        {"id":"ENT-COLI","label":"Coliflor rostizada"},
        {"id":"ENT-JUGO","label":"Jugo de carne"},
        {"id":"ENT-SOPA","label":"Sopa de hongos al carbón"},
        {"id":"ENT-CESAR","label":"Ensalada César al carbón"},
        {"id":"ENT-TOM","label":"Ensalada de tomates cherry"}
      ]
    },
    {
      "id": "postre",
      "label": "Postre",
      "required": false,
      "affects_price": false,
      "options": [
        {"id":"POS-MOUSSE","label":"Mousse de 3 chocolates"},
        {"id":"POS-CHEESE-ELOTE","label":"Cheesecake pan de elote"}
      ]
    }
  ]$cg$::jsonb
from public.event_menus m
where i.menu_id = m.id
  and m.code = 'menu_3_tiempos_2025'
  and i.sku = '3T-MENU';
