"""Generate SQL upsert for bebidas C50 into supabase/eventos_menus_bebidas_c50.sql."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ITEMS = ROOT / "docs" / "eventos-menus" / "bebidas-c50-items.json"
OUT = ROOT / "supabase" / "eventos_menus_bebidas_c50.sql"


def esc(s: str | None) -> str:
    if s is None:
        return "null"
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    skus = [it["sku"] for it in items]
    sku_list = ", ".join(esc(s) for s in skus)

    lines: list[str] = []
    lines.append("-- Bebidas add-on desde Menú C50 Esp.pdf (solo bebidas; sin alimentos).")
    lines.append("-- Generado por scripts/gen_eventos_bebidas_sql.py — re-ejecutar tras regenerar JSON.")
    lines.append("-- Fuente: I:\\Mi unidad\\Menú C50\\Menú C50 Esp.pdf")
    lines.append("")
    lines.append("update public.event_menus")
    lines.append("set")
    lines.append("  name = 'Bebidas (Menú C50)',")
    lines.append(
        "  description = 'Consumo por pieza / botella según Menú C50 Esp.pdf "
        "(solo bebidas; sin alimentos de la carta). Edita precio unitario si aplica.',"
    )
    lines.append(
        "  notes = 'Fuente: I:\\Mi unidad\\Menú C50\\Menú C50 Esp.pdf — "
        "VINOS, CAFÉ, COCTELERÍA, DESTILADOS, CERVEZAS, SIN ALCOHOL. Alimentos ignorados.',"
    )
    lines.append("  active = true,")
    lines.append("  sort_order = 45")
    lines.append("where code = 'bebidas_a_la_carta';")
    lines.append("")
    lines.append("-- Desactiva SKUs viejos (OS frecuentes) que ya no están en C50 Esp")
    lines.append("update public.event_menu_items i")
    lines.append("set active = false")
    lines.append("from public.event_menus m")
    lines.append("where i.menu_id = m.id")
    lines.append("  and m.code = 'bebidas_a_la_carta'")
    lines.append(f"  and not (i.sku = any (array[{sku_list}]::text[]));")
    lines.append("")

    # values rows in batches
    values_rows = []
    for it in items:
        desc = esc(it.get("description"))
        verified = "true" if it.get("price_verified") else "false"
        values_rows.append(
            f"  ({esc(it['sku'])}, {esc(it['name'])}, {desc}, {it['unit_price']:.2f}, "
            f"{int(it['sort_order'])}, {esc(it.get('price_source') or 'pdf_menu_c50_esp')}, {verified})"
        )

    lines.append(
        "insert into public.event_menu_items (\n"
        "  menu_id, sku, name, description, unit, unit_price,\n"
        "  is_vegetarian, sort_order, price_source, price_verified\n"
        ")\n"
        "select m.id, v.sku, v.name, v.descr, 'unidad', v.price, true, v.ord, v.src, v.verified\n"
        "from public.event_menus m\n"
        "cross join (values"
    )
    lines.append(",\n".join(values_rows))
    lines.append(
        ") as v(sku, name, descr, price, ord, src, verified)\n"
        "where m.code = 'bebidas_a_la_carta'\n"
        "  and not exists (\n"
        "    select 1 from public.event_menu_items i\n"
        "    where i.menu_id = m.id and i.sku = v.sku\n"
        "  );"
    )
    lines.append("")
    lines.append("-- Actualiza precios/nombres si ya existían")
    lines.append("update public.event_menu_items i")
    lines.append("set")
    lines.append("  name = v.name,")
    lines.append("  description = v.descr,")
    lines.append("  unit = 'unidad',")
    lines.append("  unit_price = v.price,")
    lines.append("  sort_order = v.ord,")
    lines.append("  price_source = v.src,")
    lines.append("  price_verified = v.verified,")
    lines.append("  active = true,")
    lines.append("  is_vegetarian = true")
    lines.append("from public.event_menus m")
    lines.append("cross join (values")
    lines.append(",\n".join(values_rows))
    lines.append(
        ") as v(sku, name, descr, price, ord, src, verified)\n"
        "where i.menu_id = m.id\n"
        "  and m.code = 'bebidas_a_la_carta'\n"
        "  and i.sku = v.sku;"
    )
    lines.append("")
    lines.append("-- Mantener código legado menu_c50_bebidas inactivo (catálogo unificado en bebidas_a_la_carta)")
    lines.append("update public.event_menus")
    lines.append("set active = false,")
    lines.append(
        "  notes = 'Inactivo: bebidas C50 viven en code=bebidas_a_la_carta (Menú C50 Esp).'"
    )
    lines.append("where code = 'menu_c50_bebidas';")
    lines.append("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(items)} items)")


if __name__ == "__main__":
    main()
