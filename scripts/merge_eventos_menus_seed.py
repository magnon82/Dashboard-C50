"""Merge PDF-aligned menu updates into supabase/seed_event_menus.json."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "supabase" / "seed_event_menus.json"
BEBIDAS = ROOT / "docs" / "eventos-menus" / "bebidas-c50-items.json"


def main() -> None:
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    bebidas_items = json.loads(BEBIDAS.read_text(encoding="utf-8"))

    seed["source"] = (
        "I:\\Mi unidad\\Eventos\\Menús\\Menús eventos vigentes "
        "+ I:\\Mi unidad\\Menú C50\\Menú C50 Esp.pdf (solo bebidas)"
    )
    seed["generated_from"] = (
        "PDFs definitivos (pypdf) 2025: Menú 3 tiempos, Barra libre eventos, "
        "Menú desayunos; bebidas add-on desde Menú C50 Esp (sin alimentos)."
    )
    seed["notes"] = [
        "Única fuente de alimentos/barra: carpeta Menús eventos vigentes.",
        "Bebidas a la carta = solo bebidas de Menú C50 Esp.pdf (alimentos C50 ignorados).",
        "Fallback local cuando public.event_menus no existe aún.",
        "Menú 3 tiempos: un ítem con choice_groups (plato_fuerte requerido; entrada/postre opcionales).",
        "Barra libre solo con alimentos (requiere_food). Pack desayunos ≥50 = $30000.",
        "Servicio 15% salvo paquetes parejas (incluye servicio en PDF).",
        "No incluir Menús eventos viejos / canapés / taquizas / botanas pre-bodas.",
    ]

    by_code = {m["code"]: m for m in seed["menus"]}

    # --- 3 tiempos: PDF vigente (7 fuertes; 2 postres; sin extras C50/OS) ---
    m3 = by_code["menu_3_tiempos_2025"]
    m3["notes"] = (
        "Fuente definitiva: I:\\Mi unidad\\Eventos\\Menús\\Menús eventos vigentes\\"
        "Menú 3 tiempos 2025.pdf — solo 7 fuertes del PDF (sin extras OS/carta C50)."
    )
    for it in m3.get("items") or []:
        if it.get("sku") != "3T-MENU":
            continue
        for g in it.get("choice_groups") or []:
            if g.get("id") == "postre":
                g["options"] = [
                    {"id": "POS-MOUSSE", "label": "Mousse de 3 chocolates"},
                    {
                        "id": "POS-CHEESE-ELOTE",
                        "label": "Cheesecake pan de elote",
                    },
                ]
            if g.get("id") == "plato_fuerte":
                # Canonical order / set from seed file — do not append extras.
                ids = {o.get("id") for o in (g.get("options") or [])}
                allowed = {
                    "3T-FET",
                    "3T-RAV",
                    "3T-PECH",
                    "3T-CHA",
                    "3T-ATUN",
                    "3T-SIR",
                    "3T-RIB",
                }
                if ids - allowed:
                    g["options"] = [
                        o
                        for o in (g.get("options") or [])
                        if o.get("id") in allowed
                    ]

    # --- Desayunos: richer descriptions from PDF ---
    des = by_code["desayunos_2025"]
    des["min_pax"] = 50  # oficial: solo ≥50 pax (ocultar en cotizador si menos)
    des["description"] = (
        "Desayunos por persona (PDF 2025). Mínimo 50 personas. "
        "Pack ≥50 pax = $30,000 (regla comercial)."
    )
    des["notes"] = (
        "Fuente definitiva: I:\\Mi unidad\\Eventos\\Menús\\Menús eventos vigentes\\"
        "Menú desayunos 2025.pdf. Pack $30k ≥50 pax = regla comercial locked. "
        "TODO: CON HUEVO $550 / CON CHILAQUILES $550 aparecen en pág. 3 sin menú "
        "explícito; se mantienen como variantes Menú 5 hasta confirmación operativa."
    )
    des_items = {
        "DES-1": {
            "name": "Menú 1 — Huevos (variedad)",
            "description": (
                "Con chorizo, tocino, a la mexicana, queso panela, jamón, "
                "divorciados, rancheros o en salsa pasilla (fritos)"
            ),
            "unit_price": 250,
            "min_pax": 50,
        },
        "DES-2": {
            "name": "Menú 2 — Enchiladas / enfrijoladas",
            "description": (
                "Enchiladas verdes/rojas con pollo, suizas con pollo, "
                "adobo de 4 chiles; o enfrijoladas"
            ),
            "unit_price": 320,
            "min_pax": 50,
        },
        "DES-3": {
            "name": "Menú 3 — Chilaquiles",
            "description": (
                "Verdes o rojos con pollo o huevo; adobo de 4 chiles con pollo o huevo"
            ),
            "unit_price": 280,
            "min_pax": 50,
        },
        "DES-4": {
            "name": "Menú 4 — Emparedado de salmón curado",
            "description": None,
            "unit_price": 350,
            "min_pax": 50,
        },
        "DES-5": {
            "name": "Menú 5 — Costilla de res + chilaquiles",
            "description": "Con chilaquiles verdes o rojos",
            "unit_price": 320,
            "min_pax": 50,
        },
        "DES-5B": {
            "name": "Menú 5 — Costilla con huevo",
            "description": (
                "TODO PDF: «CON HUEVO $550» en pág. 3 (ubicación ambigua respecto a Menú 5/6)"
            ),
            "unit_price": 550,
            "min_pax": 50,
            "price_verified": False,
        },
        "DES-5C": {
            "name": "Menú 5 — Costilla con chilaquiles (pack)",
            "description": (
                "TODO PDF: «CON CHILAQUILES $550» en pág. 3 (ubicación ambigua; "
                "distinto del Menú 5 a $320)"
            ),
            "unit_price": 550,
            "min_pax": 50,
            "price_verified": False,
        },
        "DES-6": {
            "name": "Menú 6 — Cecina de res + chilaquiles",
            "description": "Con chilaquiles verdes o rojos",
            "unit_price": 320,
            "min_pax": 50,
        },
    }
    for it in des.get("items") or []:
        patch = des_items.get(it.get("sku") or "")
        if not patch:
            continue
        it["name"] = patch["name"]
        it["description"] = patch["description"]
        it["unit_price"] = patch["unit_price"]
        it["min_pax"] = patch["min_pax"]
        it["price_source"] = "pdf_desayunos_2025"
        it["price_verified"] = patch.get("price_verified", True)

    pack = by_code["desayunos_pack_50"]
    pack["notes"] = (
        "Regla comercial locked: desayunos ≥50 pax = $30,000. "
        "Alineado a Menú desayunos 2025.pdf (mín. regular 50)."
    )

    # --- Barra libre ---
    bar = by_code["barra_libre_2025"]
    bar["description"] = (
        "Solo con comida (menú 3 tiempos u otro menú de alimentos). "
        "Precio por persona / 3 h. Nacional, internacional y refrescos "
        "(refrescos aplica con cualquier menú de 3 tiempos)."
    )
    bar["notes"] = (
        "Fuente definitiva: I:\\Mi unidad\\Eventos\\Menús\\Menús eventos vigentes\\"
        "Barra libre eventos 2025.pdf. Precios con I.V.A.; no incluyen propina. "
        "Consumo por pieza → catálogo Bebidas (Menú C50 Esp)."
    )
    for it in bar.get("items") or []:
        if it.get("sku") == "BAR-REF":
            it["description"] = (
                "Aplica con cualquier menú de 3 tiempos · 3 h · refrescos, limonada, "
                "naranjada, café americano y té · descorche destilados/vino "
                "(sin cerveza) · hora extra $90"
            )

    # --- Bebidas from C50 ---
    beb = by_code["bebidas_a_la_carta"]
    beb["name"] = "Bebidas (Menú C50)"
    beb["description"] = (
        "Consumo por pieza / botella según Menú C50 Esp.pdf (solo bebidas; "
        "sin alimentos de la carta). Edita precio unitario si aplica."
    )
    beb["notes"] = (
        "Fuente: I:\\Mi unidad\\Menú C50\\Menú C50 Esp.pdf — secciones VINOS, "
        "CAFÉ, COCTELERÍA, DESTILADOS, CERVEZAS, SIN ALCOHOL. Alimentos ignorados. "
        "Vinos: mapeo copeo/botella por orden de layout PDF."
    )
    beb["items"] = bebidas_items

    SEED.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {SEED}")
    print(f"Bebidas items: {len(bebidas_items)}")


if __name__ == "__main__":
    main()
