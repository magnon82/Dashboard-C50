"""
Actualiza solo el costo de los insumos con el precio unitario de las facturas CFDI.

No abre el recetario ni el master en Drive. Recorre los XML ya guardados
(FACTURAS_PATH o I:\\Mi unidad\\FACTURAS CFDI) y reescribe
data/recetario/snapshot.json.

Solo acepta conceptos cuya unidad SAT coincide con la unidad de costeo
(KGM→kg, LTR→lt, H87→pieza). Si hay varias facturas, gana la más reciente.

Uso:
  python scripts/update_recetario_costos_facturas.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data" / "recetario" / "snapshot.json"
DEFAULT_XML = Path(os.environ.get("FACTURAS_PATH") or r"I:\Mi unidad\FACTURAS CFDI")

UNIT_MAP = {
    "KGM": "kg",
    "GRM": "g",
    "LTR": "lt",
    "MLT": "ml",
    "H87": "pz",
    "EA": "pz",
}


def norm(value: object) -> str:
    s = str(value or "").replace("ñ", "n").replace("Ñ", "n")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def to_cost_unit(clave: str, costing: str, price: float) -> float | None:
    unit = UNIT_MAP.get(clave.upper())
    if not unit:
        return None
    target = norm(costing)
    if target in {"pza", "pieza", "piezas"}:
        target = "pz"
    if target in {"l", "litro", "litros"}:
        target = "lt"
    if unit == target:
        return price
    if unit == "g" and target == "kg":
        return price * 1000
    if unit == "kg" and target == "g":
        return price / 1000
    if unit == "ml" and target == "lt":
        return price * 1000
    if unit == "lt" and target == "ml":
        return price / 1000
    return None


def conceptos(path: Path):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return
    attrs = {local(k): v for k, v in root.attrib.items()}
    tipo = str(attrs.get("TipoDeComprobante") or "").upper()
    if tipo == "P":
        return
    fecha = str(attrs.get("Fecha") or "")[:10]
    emisor = ""
    for el in root.iter():
        if local(el.tag) == "Emisor":
            emisor = el.attrib.get("Nombre") or el.attrib.get("nombre") or ""
            break
    for el in root.iter():
        if local(el.tag) != "Concepto":
            continue
        desc = el.attrib.get("Descripcion") or el.attrib.get("descripcion") or ""
        clave = el.attrib.get("ClaveUnidad") or el.attrib.get("claveUnidad") or ""
        try:
            price = float(el.attrib.get("ValorUnitario") or el.attrib.get("valorUnitario") or "")
        except ValueError:
            continue
        if not desc or price <= 0:
            continue
        yield norm(desc), clave, price, fecha, emisor


def match_insumo(desc: str, insumos: list[dict]) -> dict | None:
    words = [w for w in desc.split() if len(w) > 3]
    if len(words) < 1:
        return None
    hits = []
    for ins in insumos:
        key = ins["nameKey"]
        key_words = [w for w in key.split() if len(w) > 3]
        if not key_words:
            continue
        if all(w in words or w in desc for w in key_words) or all(w in key for w in words[:4]):
            # El nombre del insumo está dentro del concepto, o al revés si el concepto es corto.
            if key in desc or desc in key:
                hits.append(ins)
    uniq = {h["id"]: h for h in hits}
    if len(uniq) == 1:
        return next(iter(uniq.values()))
    return None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    if not SNAPSHOT.exists():
        raise SystemExit("Falta data/recetario/snapshot.json. Corre primero import_recetario.py.")
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    if not DEFAULT_XML.exists():
        print(f"No hay XML en {DEFAULT_XML}. Los precios siguen en el master importado.")
        return
    latest: dict[str, tuple[str, float, str]] = {}
    files = 0
    for path in DEFAULT_XML.rglob("*.xml"):
        files += 1
        for desc, clave, price, fecha, emisor in conceptos(path) or []:
            ins = match_insumo(desc, data["insumos"])
            if not ins:
                continue
            converted = to_cost_unit(clave, ins.get("costingUnit") or "", price)
            if converted is None:
                continue
            prev = latest.get(ins["id"])
            if prev and prev[0] >= fecha:
                continue
            latest[ins["id"]] = (fecha, round(converted, 4), emisor)
    changed = 0
    for ins in data["insumos"]:
        hit = latest.get(ins["id"])
        if not hit:
            continue
        fecha, price, emisor = hit
        ins["costingPrice"] = price
        ins["priceSource"] = "factura"
        ins["priceAsOf"] = fecha
        ins["facturaEmisor"] = emisor
        changed += 1
    SNAPSHOT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"XML revisados: {files}. Insumos con precio de factura: {changed}.")


if __name__ == "__main__":
    main()
