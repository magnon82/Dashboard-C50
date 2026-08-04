"""Extract alimentos from docs/eventos-menus/c50-esp.txt → alimentos-c50-items.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "eventos-menus" / "c50-esp.txt"
OUT = ROOT / "docs" / "eventos-menus" / "alimentos-c50-items.json"

SKIP = {
    "ENTRADAS",
    "SOPAS Y PASTAS",
    "ENSALADAS",
    "FUERTES",
    "POSTRES",
    "MOLES DE CARRANZA",
    "LOS CORTES DE CARRANZA GUARNICIONES",
    "QUESO FUNDIDO",
    "VINOS",
    "CAFÉ",
    "COCTELERÍA",
}

FIX_NAMES = {
    "Y HONGOS": "RAVIOLES DE REQUESÓN Y HONGOS",
    "DE TEPACHE": "BUÑUELOS CON HELADO DE TEPACHE",
    "NATURAL": "ENSALADA NATURAL",
}


def nice_name(raw: str) -> str:
    raw = FIX_NAMES.get(raw.upper(), raw)
    raw = re.sub(r"\s+", " ", raw).strip(" .")
    small = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "EN", "AL", "A", "CON"}
    parts: list[str] = []
    for i, w in enumerate(raw.split()):
        up = w.upper()
        if i > 0 and up in small:
            parts.append(up.lower())
        else:
            parts.append(up.capitalize() if len(up) > 2 else up.lower())
    return " ".join(parts)


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    cut = text.split("--- PAGE 3 ---")[0]
    lines = [ln.rstrip() for ln in cut.splitlines()]
    section_headers = {
        "ENTRADAS",
        "SOPAS Y PASTAS",
        "ENSALADAS",
        "FUERTES",
        "POSTRES",
        "MOLES DE CARRANZA",
        "LOS CORTES DE CARRANZA GUARNICIONES",
        "QUESO FUNDIDO",
    }
    joined: list[str] = []
    buf = ""
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            if buf:
                joined.append(buf)
                buf = ""
            continue
        up = stripped.upper()
        if up in section_headers or (
            "GUARNICIONES" in up and "$" not in stripped
        ):
            if buf:
                joined.append(buf)
                buf = ""
            joined.append(stripped)
            continue
        if re.search(r"\$\s*\d", ln):
            joined.append((buf + " " + ln).strip() if buf else ln)
            buf = ""
        elif (
            re.match(r"^[A-ZÁÉÍÓÚÑÜ0-9]", ln)
            and len(stripped) > 3
            and not stripped[0].islower()
            and "$" not in stripped
            # continuation of dish name (all-caps-ish), not prose description
            and sum(1 for c in stripped if c.isupper() or c.isdigit())
            >= max(3, len(stripped) // 3)
        ):
            buf = (buf + " " + ln).strip() if buf else ln
        else:
            buf = ""

    pat = re.compile(r"^(.*?)\s*\.\s*\$\s*(\d+(?:\.\d+)?)\s*$")
    section = "entrada"
    rows: list[dict] = []
    for raw in joined:
        u = raw.upper()
        if "FUERTES" in u and "$" not in raw:
            section = "fuerte"
            continue
        if u.strip().startswith("POSTRES") or u.strip() == "MOLES DE CARRANZA":
            section = "postre"
            continue
        if "GUARNICIONES" in u and "$" not in raw:
            section = "guarnicion"
            continue
        if u.strip() in (
            "ENTRADAS",
            "SOPAS Y PASTAS",
            "ENSALADAS",
            "QUESO FUNDIDO",
        ):
            section = "entrada"
            continue
        m = pat.match(raw.strip())
        if not m:
            continue
        name = " ".join(m.group(1).split())
        name = re.sub(r"\s*\(([VG/]+)\)\s*", " ", name)
        name = re.sub(r"\s+", " ", name).strip(" .")
        if name.upper() in SKIP or len(name) < 3:
            continue
        rows.append(
            {
                "name": nice_name(name),
                "unit_price": float(m.group(2)),
                "section": section,
            }
        )

    out: list[dict] = []
    for i, it in enumerate(rows, 1):
        sku = f"C50-A{i:03d}"
        out.append(
            {
                "id": f"local-{sku}",
                "sku": sku,
                "name": it["name"],
                "description": f"Menú C50 Esp · {it['section']}",
                "unit": "persona",
                "unit_price": it["unit_price"],
                "min_pax": None,
                "is_vegetarian": False,
                "active": True,
                "sort_order": 10 + i,
                "price_source": "pdf_menu_c50_esp",
                "price_verified": True,
            }
        )

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} items to {OUT}")


if __name__ == "__main__":
    main()
