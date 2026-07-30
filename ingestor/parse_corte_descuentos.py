"""
Parser del adjunto 'Cancelaciones y Descuentos*.xls' del correo CORTE CARRANZA.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import xlrd

SOURCE_FILE = "corte_caja"

MESES_ES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}

SUBJECT_DATE_RE = re.compile(
    r"(?:Recibidos\s+)?CORTE\s+CARRANZA.*?"
    r"(\d{1,2})\s+(?:DE\s+)?([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{4})",
    re.IGNORECASE,
)


def parse_date_from_subject(subject: str) -> str | None:
    m = SUBJECT_DATE_RE.search(subject or "")
    if not m:
        return None
    day = int(m.group(1))
    mes_name = m.group(2).lower().replace("á", "a").replace("é", "e").replace("í", "i")
    mes_name = mes_name.replace("ó", "o").replace("ú", "u")
    month = MESES_ES.get(mes_name)
    year = int(m.group(3))
    if not month:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _cell_str(sh, r: int, c: int) -> str:
    if c >= sh.ncols:
        return ""
    v = sh.cell_value(r, c)
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip() if v is not None else ""


def _cell_num(sh, r: int, c: int) -> float | None:
    if c >= sh.ncols:
        return None
    v = sh.cell_value(r, c)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _is_product_row(sh, r: int) -> bool:
    """Fila de producto: cantidad numérica en col 0 y producto en col 1."""
    qty = _cell_num(sh, r, 0)
    prod = _cell_str(sh, r, 1)
    return qty is not None and qty > 0 and bool(prod)


def _format_hora(wb, sh, r: int, c: int) -> str | None:
    cell = sh.cell(r, c)
    if cell.ctype == xlrd.XL_CELL_DATE:
        try:
            t = xlrd.xldate_as_tuple(cell.value, wb.datemode)
            return f"{t[3]:02d}:{t[4]:02d}"
        except Exception:
            return None
    if isinstance(cell.value, float) and 0 < cell.value < 1:
        try:
            t = xlrd.xldate_as_tuple(cell.value, wb.datemode)
            return f"{t[3]:02d}:{t[4]:02d}"
        except Exception:
            return None
    s = _cell_str(sh, r, c)
    return s or None


def parse_cancelaciones(wb, sh) -> list[dict]:
    items: list[dict] = []
    in_section = False
    pending_headers: list[str] = []

    for r in range(sh.nrows):
        c0 = _cell_str(sh, r, 0)
        c0_upper = c0.upper()

        if c0_upper == "CANCELACIONES":
            in_section = True
            pending_headers = []
            continue
        if c0_upper in ("DESCUENTOS", "DEVOLUCIONES"):
            in_section = False
            continue
        if not in_section:
            if c0_upper == "CANTIDAD":
                in_section = True
            continue
        if c0_upper == "CANTIDAD":
            continue

        if _is_product_row(sh, r):
            qty = _cell_num(sh, r, 0) or 0
            producto = re.sub(r"\s+", " ", _cell_str(sh, r, 1)).strip()
            precio = _cell_num(sh, r, 2) or 0
            monto = _cell_num(sh, r, 3) or 0
            grupo = pending_headers[0] if pending_headers else ""
            motivo = " / ".join(pending_headers[1:]) if len(pending_headers) > 1 else ""
            items.append(
                {
                    "kind": "cancelacion",
                    "grupo": grupo,
                    "motivo": motivo,
                    "cantidad": qty,
                    "producto": producto,
                    "precio": precio,
                    "monto": monto,
                    "mesero": _cell_str(sh, r, 4),
                    "autorizo": _cell_str(sh, r, 5),
                    "hora": _format_hora(wb, sh, r, 6),
                    "caja": _cell_str(sh, r, 7),
                    "mesa": _cell_str(sh, r, 8),
                    "comanda": _cell_str(sh, r, 9),
                }
            )
            pending_headers = []
            continue

        # Encabezados de grupo / motivo (texto en col0, sin producto)
        if c0 and not _cell_str(sh, r, 1):
            pending_headers.append(c0)

    return items


def parse_descuentos(wb, sh) -> list[dict]:
    items: list[dict] = []
    in_section = False
    persona = ""

    for r in range(sh.nrows):
        c0 = _cell_str(sh, r, 0)
        c0_upper = c0.upper()

        if c0_upper == "DESCUENTOS" or (
            "DESCUENTO" in c0_upper and "MONTO" in (_cell_str(sh, r, 1).upper())
        ):
            if c0_upper == "DESCUENTOS":
                in_section = True
            elif "DESCUENTO" in c0_upper and "MONTO" in _cell_str(sh, r, 1).upper():
                in_section = True
            continue
        if c0_upper in ("CANCELACIONES", "DEVOLUCIONES"):
            in_section = False
            continue
        if not in_section:
            continue
        if c0_upper in ("DESCUENTO", "CANTIDAD") or "DESCUENTO" == c0_upper:
            continue

        monto = _cell_num(sh, r, 1)
        mesero = _cell_str(sh, r, 2)

        # Persona / agrupador: texto + conteo, sin mesero
        if c0 and monto is not None and not mesero and monto <= 20 and not _cell_str(sh, r, 3):
            # podría ser conteo de persona
            if not c0.replace(".", "", 1).isdigit():
                persona = c0
            continue

        # Línea de descuento real
        if c0 and monto is not None and monto > 0 and mesero:
            items.append(
                {
                    "kind": "descuento",
                    "persona": persona,
                    "motivo": c0,
                    "monto": monto,
                    "mesero": mesero,
                    "autorizo": _cell_str(sh, r, 3),
                    "hora": _format_hora(wb, sh, r, 4),
                    "caja": _cell_str(sh, r, 5),
                    "mesa": _cell_str(sh, r, 6),
                    "cheque": _cell_str(sh, r, 7),
                }
            )

    return items


def find_data_sheet(wb, *needles: str):
    """Prefiere hojas de datos (no 'Document map') que contengan los encabezados."""
    needles_u = [n.upper() for n in needles]
    candidates = []
    for name in wb.sheet_names():
        if name.lower().startswith("document"):
            continue
        sh = wb.sheet_by_name(name)
        hits = 0
        for r in range(min(sh.nrows, 25)):
            row_text = " | ".join(_cell_str(sh, r, c).upper() for c in range(min(sh.ncols, 10)))
            for n in needles_u:
                if n in row_text:
                    hits += 1
        if hits:
            candidates.append((hits, name, sh))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][2]


def parse_cancelaciones_descuentos_xls(path: Path) -> dict:
    wb = xlrd.open_workbook(str(path))
    cancel_sh = find_data_sheet(wb, "CANCELACIONES", "Cantidad", "Producto")
    desc_sh = find_data_sheet(wb, "DESCUENTOS", "Monto Descuento", "Descuento")

    cancelaciones = parse_cancelaciones(wb, cancel_sh) if cancel_sh else []
    descuentos = parse_descuentos(wb, desc_sh) if desc_sh else []

    return {
        "cancelaciones": cancelaciones,
        "descuentos": descuentos,
        "total_cancelaciones": sum(i["monto"] for i in cancelaciones),
        "total_descuentos": sum(i["monto"] for i in descuentos),
    }


def to_records(fecha: str, parsed: dict) -> list[dict]:
    records: list[dict] = []
    for item in parsed["cancelaciones"]:
        records.append(
            {
                "date": fecha,
                "type": "expense",
                "category": "Corte Cancelacion",
                "amount": float(item["monto"]),
                "description": json.dumps(item, ensure_ascii=False),
                "source_file": SOURCE_FILE,
            }
        )
    for item in parsed["descuentos"]:
        records.append(
            {
                "date": fecha,
                "type": "expense",
                "category": "Corte Descuento",
                "amount": float(item["monto"]),
                "description": json.dumps(item, ensure_ascii=False),
                "source_file": SOURCE_FILE,
            }
        )
    return records


def upsert_day(supabase, fecha: str, records: list[dict]) -> int:
    supabase.table("financial_records").delete().eq("source_file", SOURCE_FILE).eq(
        "date", fecha
    ).execute()
    if not records:
        return 0
    result = supabase.table("financial_records").insert(records).execute()
    return len(result.data or [])


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Prueba local del parser de cancelaciones/descuentos")
    parser.add_argument(
        "--xls",
        type=Path,
        default=Path(r"C:\Users\magno\Downloads\Cancelaciones y Descuentos10.xls"),
    )
    parser.add_argument("--date", default="2026-07-24")
    args = parser.parse_args()

    parsed = parse_cancelaciones_descuentos_xls(args.xls)
    print(json.dumps(parsed, ensure_ascii=False, indent=2))
    print(f"Registros: {len(to_records(args.date, parsed))}")


if __name__ == "__main__":
    main()
