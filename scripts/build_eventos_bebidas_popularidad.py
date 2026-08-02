"""
Analiza Órdenes de servicio (PDF Drive) y agrega frecuencia de bebidas
contra el catálogo del cotizador (barra libre + Bebidas Menú C50).

Salida: supabase/seed_event_bebidas_popularidad.json

Uso:
  python scripts/build_eventos_bebidas_popularidad.py
  python scripts/build_eventos_bebidas_popularidad.py --os-dir "I:\\Mi unidad\\Eventos\\Ordenes de servicio"
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OS = Path(r"I:\Mi unidad\Eventos\Ordenes de servicio")
MENUS_PATH = ROOT / "supabase" / "seed_event_menus.json"
OUT_PATH = ROOT / "supabase" / "seed_event_bebidas_popularidad.json"

# Barra libre: patrones exclusivos (orden importa: internacional antes que nacional).
BARRA_PATTERNS: list[tuple[str, list[re.Pattern[str]]]] = [
    (
        "BAR-INT",
        [
            re.compile(r"barra\s*libre\s*internacional", re.I),
            re.compile(r"barra\s+internacional(?!\s*[—\-–]?\s*hora)", re.I),
        ],
    ),
    (
        "BAR-NAC",
        [
            re.compile(r"barra\s*libre\s*nacional", re.I),
            re.compile(r"barra\s+nacional(?!\s*[—\-–]?\s*hora)", re.I),
        ],
    ),
    (
        "BAR-REF",
        [
            re.compile(r"barra\s*libre\s*(de\s+)?refrescos", re.I),
            re.compile(r"barra\s*(de\s+)?refrescos", re.I),
            re.compile(
                r"descorche.{0,120}refrescos.{0,80}(limonad|naranjad|cafe|caf)",
                re.I | re.S,
            ),
            re.compile(
                r"descorche\s*p/?\s*p(ersona)?.{0,40}(refresco|limonad)",
                re.I | re.S,
            ),
        ],
    ),
]

# Alias OS → SKU catálogo (además del nombre del ítem).
EXTRA_ALIASES: dict[str, list[str]] = {
    "BEB-MAR": [
        "margarita limon",
        "margarita limón",
        "margarita mango",
        "margarita tamarindo",
        "margarita clasica",
        "margarita clásica",
    ],
    "BEB-MOJ": ["mojito clasico", "mojito clásico", "mojito"],
    "BEB-MEZ": ["mezcalita"],
    "BEB-GAV": ["paloma", "gavilan", "gavilán"],
    "BEB-CERV": [
        "cervezas nacionales",
        "cerveza nacional",
        "cervezas de bienvenida",
    ],
    "BEB-CERV-TEC-L": ["tecate light", "cerveza tecate light"],
    "BEB-CERV-BOH-C": [
        "bohemia clara",
        "bohemia cristal",
        "cerveza bohemia clara",
        "cerveza bohemia",
    ],
    "BEB-CERV-XX-L": ["xx lager", "cerveza xx lager"],
    "BEB-CERV-XX-A": ["xx ambar", "xx ámbar", "cerveza xx ambar"],
    "BEB-AMER": ["cafe americano", "café americano"],
    "BEB-AGUA-DIA": [
        "aguas de sabor",
        "aguas de sabores",
        "agua de sabores",
        "aguas de bienvenida",
    ],
    "BEB-LIM": ["limonada"],
    "BEB-NAR": ["naranjada"],
    "BEB-PINA": ["pina colada", "piña colada"],
    "BEB-TE": [" cafe y te", "café y té", "cafe americano y te"],
}


def strip_accents(s: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def norm(s: str) -> str:
    s = strip_accents(s or "").lower()
    s = s.replace("—", "-").replace("–", "-")
    s = re.sub(r"[^\w\s/+.-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def base_drink_name(name: str) -> str:
    n = re.sub(r"\s*\((copeo|botella|copa|jarra)\)\s*$", "", name, flags=re.I)
    return n.strip()


def load_catalog() -> tuple[dict[str, dict], dict[str, dict]]:
    data = json.loads(MENUS_PATH.read_text(encoding="utf-8"))
    barra: dict[str, dict] = {}
    carta: dict[str, dict] = {}
    for m in data.get("menus") or []:
        code = m.get("code")
        for it in m.get("items") or []:
            sku = str(it.get("sku") or "")
            if not sku:
                continue
            row = {
                "sku": sku,
                "name": it.get("name") or sku,
                "menu_code": code,
                "unit": it.get("unit"),
                "unit_price": it.get("unit_price"),
            }
            if code == "barra_libre_2025":
                # Solo paquetes principales (no hora extra) en ranking amigable.
                if sku.endswith("-XH"):
                    continue
                barra[sku] = row
            elif code == "bebidas_a_la_carta":
                if sku == "BEB-CARTA":
                    continue
                carta[sku] = row
    return barra, carta


# Ítems que vienen “de regalo” en barra de refrescos / descorche — no contar
# como pedido a la carta si el mismo PDF ya matcheó BAR-REF.
BAR_REF_BUNDLE_SKUS = frozenset(
    {"BEB-LIM", "BEB-NAR", "BEB-AMER", "BEB-TE", "BEB-COCA", "BEB-SPR"}
)

# Marcas listadas en el PDF de barra nacional (no son pedidos a la carta).
BAR_NAC_BUNDLE_SKUS = frozenset(
    {
        "RON-BAC-C",
        "RON-BAC-B",
        "TEQ-CUE-C",
        "TEQ-CUE-B",
        "VOD-SMI-C",
        "VOD-SMI-B",
        "WHI-JW-R-C",
        "WHI-JW-R-B",
        "BEB-CERV",
        "BEB-AMER",
        "BEB-TE",
    }
)

BAR_INT_BUNDLE_SKUS = frozenset(
    {
        "RON-MAT-P-C",
        "RON-MAT-P-B",
        "TEQ-DJ-B-C",
        "TEQ-DJ-B-B",
        "VOD-ABS-C",
        "VOD-ABS-B",
        "WHI-JW-N-C",
        "WHI-JW-N-B",
        "GIN-TAN-C",
        "GIN-TAN-B",
        "BEB-CERV",
        "BEB-AMER",
        "BEB-TE",
    }
)

# Nombres ≤3 letras: solo alias largos (evita "te" suelto en texto legal).
SHORT_NAME_SKU_ALIAS_ONLY = frozenset({"BEB-TE"})


def build_carta_matchers(
    carta: dict[str, dict],
) -> list[tuple[str, re.Pattern[str], str]]:
    """Lista (sku, regex, label) ordenada por longitud de patrón desc."""
    buckets: dict[str, list[str]] = defaultdict(list)
    for sku, row in carta.items():
        name = base_drink_name(str(row["name"]))
        n = norm(name)
        if len(n) < 3:
            continue
        if sku in SHORT_NAME_SKU_ALIAS_ONLY and len(n) <= 3:
            pass  # solo EXTRA_ALIASES
        else:
            buckets[sku].append(n)
            buckets[sku].append(n.replace(" / ", " "))
    for sku, aliases in EXTRA_ALIASES.items():
        if sku not in carta and not sku.startswith("BAR-"):
            continue
        for a in aliases:
            an = norm(a)
            if len(an) < 4:
                continue
            buckets[sku].append(an)

    matchers: list[tuple[str, re.Pattern[str], str]] = []
    for sku, variants in buckets.items():
        uniq = sorted({v for v in variants if v}, key=len, reverse=True)
        for v in uniq:
            if len(v) <= 3:
                pat = re.compile(rf"(?<!\w){re.escape(v)}(?!\w)", re.I)
            else:
                pat = re.compile(re.escape(v), re.I)
            matchers.append((sku, pat, v))
    matchers.sort(key=lambda x: len(x[2]), reverse=True)
    return matchers


def extract_pdf_text(path: Path) -> str:
    try:
        reader = PdfReader(str(path))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception:
        return ""


def match_file(
    text: str,
    carta_matchers: list[tuple[str, re.Pattern[str], str]],
) -> tuple[set[str], set[str]]:
    """Devuelve (skus_barra, skus_carta) hallados en el texto (1× por archivo)."""
    if len(text.strip()) < 40:
        return set(), set()
    raw = text
    ntext = norm(text)

    barra_hits: set[str] = set()
    for sku, pats in BARRA_PATTERNS:
        for pat in pats:
            if pat.search(raw) or pat.search(ntext):
                barra_hits.add(sku)
                break

    carta_hits: set[str] = set()
    # Marcar spans ya usados para reducir doble conteo de substrings.
    used_spans: list[tuple[int, int]] = []
    for sku, pat, _label in carta_matchers:
        # No sumar cerveza nacional genérica si ya hay barra nacional
        if "BAR-REF" in barra_hits and sku in BAR_REF_BUNDLE_SKUS:
            continue
        if "BAR-NAC" in barra_hits and sku in BAR_NAC_BUNDLE_SKUS:
            continue
        if "BAR-INT" in barra_hits and sku in BAR_INT_BUNDLE_SKUS:
            continue
        for m in pat.finditer(ntext):
            span = m.span()
            if any(span[0] < b and span[1] > a for a, b in used_spans):
                continue
            carta_hits.add(sku)
            used_spans.append(span)
            break

    return barra_hits, carta_hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--os-dir", type=Path, default=DEFAULT_OS)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args()

    barra_cat, carta_cat = load_catalog()
    carta_matchers = build_carta_matchers(carta_cat)

    pdfs = sorted(args.os_dir.rglob("*.pdf")) if args.os_dir.exists() else []
    counts: dict[str, int] = defaultdict(int)
    examples: dict[str, list[str]] = defaultdict(list)
    files_with_any = 0
    files_empty = 0
    files_scanned = 0

    for pdf in pdfs:
        files_scanned += 1
        text = extract_pdf_text(pdf)
        if len(text.strip()) < 40:
            files_empty += 1
            continue
        bhits, chits = match_file(text, carta_matchers)
        all_hits = bhits | chits
        if not all_hits:
            continue
        files_with_any += 1
        rel = str(pdf.relative_to(args.os_dir)).replace("\\", "/")
        for sku in all_hits:
            counts[sku] += 1
            if len(examples[sku]) < 3:
                examples[sku].append(rel)

    def pack(sku: str, menu_code: str, cat: dict[str, dict]) -> dict:
        meta = cat.get(sku) or {"name": sku, "sku": sku}
        return {
            "sku": sku,
            "name": meta.get("name") or sku,
            "menu_code": menu_code,
            "os_count": int(counts.get(sku, 0)),
            "examples": examples.get(sku, []),
        }

    barra_ranked = sorted(
        [pack(s, "barra_libre_2025", barra_cat) for s in barra_cat],
        key=lambda r: (-r["os_count"], r["name"]),
    )
    carta_ranked = sorted(
        [pack(s, "bebidas_a_la_carta", carta_cat) for s in carta_cat if counts.get(s)],
        key=lambda r: (-r["os_count"], r["name"]),
    )
    # Incluir top carta aunque count 0? No — solo pedidas. Completar top UI en runtime.

    top = sorted(
        [
            *(r for r in barra_ranked if r["os_count"] > 0),
            *carta_ranked,
        ],
        key=lambda r: (-r["os_count"], r["name"]),
    )[:40]

    by_sku = {sku: int(n) for sku, n in counts.items() if n > 0}

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "os_dir": str(args.os_dir),
            "menus": str(MENUS_PATH.relative_to(ROOT)).replace("\\", "/"),
            "note": "Conteo = nº de OS PDF distintas donde aparece la bebida/paquete (no unidades).",
        },
        "stats": {
            "pdfs_scanned": files_scanned,
            "pdfs_with_text": files_scanned - files_empty,
            "pdfs_empty_or_scan": files_empty,
            "pdfs_with_drink_match": files_with_any,
            "skus_matched": len(by_sku),
        },
        "by_sku": by_sku,
        "barra": barra_ranked,
        "carta_top": carta_ranked[:60],
        "top": top,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Wrote", args.out)
    print("stats", out["stats"])
    print("TOP 15:")
    for row in top[:15]:
        print(f"  {row['os_count']:4d}  {row['sku']:16s}  {row['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
