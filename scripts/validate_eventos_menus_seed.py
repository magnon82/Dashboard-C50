"""Quick validation of seed_event_menus.json after PDF merge."""
from __future__ import annotations

import json
from pathlib import Path

SEED = Path(__file__).resolve().parents[1] / "supabase" / "seed_event_menus.json"


def main() -> None:
    d = json.loads(SEED.read_text(encoding="utf-8"))
    for m in d["menus"]:
        n = len(m.get("items") or [])
        print(f"{m['code']:28} items={n:3d}  {m['name']}")
    beb = next(m for m in d["menus"] if m["code"] == "bebidas_a_la_carta")
    gav = next(i for i in beb["items"] if i["sku"] == "BEB-GAV")
    print("BEB-GAV", gav["unit_price"], "verified=", gav["price_verified"])
    des = next(m for m in d["menus"] if m["code"] == "desayunos_2025")
    for i in des["items"]:
        if i["sku"] in ("DES-5B", "DES-5C"):
            print(i["sku"], i["unit_price"], "verified=", i["price_verified"])
    m3 = next(m for m in d["menus"] if m["code"] == "menu_3_tiempos_2025")
    groups = {g["id"]: g for g in m3["items"][0]["choice_groups"]}
    fortes = groups["plato_fuerte"]["options"]
    entradas = groups["entrada"]["options"]
    postres = groups["postre"]["options"]
    print("3T fuertes:", [(o["label"], o["unit_price"]) for o in fortes])
    print("3T entradas:", [o["label"] for o in entradas])
    print("3T postres:", [o["label"] for o in postres])
    assert len(fortes) == 7, f"expected 7 fuertes, got {len(fortes)}"
    assert len(entradas) == 6, f"expected 6 entradas, got {len(entradas)}"
    assert len(postres) == 2, f"expected 2 postres, got {len(postres)}"
    banned = (
        "pulpo",
        "costillar",
        "hamburguesa",
        "chemita",
        "huachinango",
        "huitlacoche",
        "salmón",
        "salmon",
        "mole de olla",
    )
    for o in fortes:
        low = o["label"].lower()
        for b in banned:
            assert b not in low, f"banned fuerte in seed: {o['label']}"


if __name__ == "__main__":
    main()
