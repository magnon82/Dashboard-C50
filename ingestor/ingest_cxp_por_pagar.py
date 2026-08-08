"""
Suma Cuentas por Pagar desde Google Sheet CXP:
  - Total = suma SALDO A LA FECHA (col I) en PROVEEDORES + SERVICIOS
  - Pagos programados = misma columna en filas con fondo amarillo
    (incluye amarillas con FECHA vacía; omite subtotales blancos sin fecha)
  - Saldo x pagar = Total - Programados (dashboard)

source_file=cxp_por_pagar
"""

from __future__ import annotations

import argparse
import os
import re
from datetime import date

from dotenv import load_dotenv
from supabase import create_client

from google_auth import sheets_service
from ingest_cxp import DEFAULT_NAME, SHEET_ID_DEFAULT, find_spreadsheet_id, parse_money_mx

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env.local"))

SOURCE_FILE = "cxp_por_pagar"
ALLOWED_TABS = ("proveedor", "servicio")
COL_SALDO = 8  # I = SALDO A LA FECHA
DATE_RE = re.compile(r"^\d{1,2}[-/][A-Za-zÁÉÍÓÚáéíóú]{3,}[-/]\d{2,4}$", re.I)


def is_yellow_bg(bg: dict | None) -> bool:
    if not bg:
        return False
    r = float(bg.get("red", 0) or 0)
    g = float(bg.get("green", 0) or 0)
    b = float(bg.get("blue", 0) or 0)
    return r >= 0.85 and g >= 0.70 and b <= 0.60


def tab_allowed(title: str) -> bool:
    t = title.lower()
    if "aportacion" in t:
        return False
    return any(k in t for k in ALLOWED_TABS)


def tab_kind(title: str) -> str:
    t = title.lower()
    if "servicio" in t:
        return "servicios"
    return "proveedores"


def cell_number(cell: dict) -> float | None:
    ev = cell.get("effectiveValue") or {}
    if "numberValue" in ev:
        return float(ev["numberValue"])
    return parse_money_mx(cell.get("formattedValue"))


def has_valid_date(cell: dict) -> bool:
    """Acepta serial Excel, texto fecha, o NA."""
    ev = cell.get("effectiveValue") or {}
    if "numberValue" in ev:
        n = float(ev["numberValue"])
        # seriales aprox. 2010–2035
        return 40000 <= n <= 60000
    fv = str(cell.get("formattedValue") or "").strip()
    if not fv:
        return False
    fu = fv.upper()
    if fu.startswith("FECHA") or "CUENTAS POR PAGAR" in fu:
        return False
    if fu in ("NA", "N/A", "N.A.", "-"):
        return True
    return bool(DATE_RE.match(fv.replace(" ", "")))


def row_is_yellow(values: list[dict]) -> bool:
    for cell in values[:13]:
        bg = (cell.get("effectiveFormat") or {}).get("backgroundColor")
        if is_yellow_bg(bg):
            return True
    return False


def cell_text(values: list[dict], idx: int) -> str:
    if len(values) <= idx:
        return ""
    return str((values[idx].get("formattedValue") or "")).strip()


def should_count_row(values: list[dict], saldo: float, yellow: bool) -> bool:
    """
    Cuenta filas con SALDO > 0 si:
      - tienen fecha válida en A, o
      - están en amarillo (programadas) aunque A esté vacío
        (continúan un bloque / celda de fecha vacía en la API).
    No cuenta subtotales blancos sin fecha (evita doble conteo).
    """
    if saldo <= 0:
        return False
    if has_valid_date(values[0]):
        return True
    if not yellow:
        return False
    # Amarillo sin fecha: exige proveedor para no tomar encabezados
    return bool(cell_text(values, 2))


def sum_tab_with_colors(service, spreadsheet_id: str, title: str) -> tuple[float, float]:
    result = (
        service.spreadsheets()
        .get(
            spreadsheetId=spreadsheet_id,
            ranges=[f"'{title}'!A1:M8000"],
            includeGridData=True,
            fields=(
                "sheets(data(rowData(values("
                "formattedValue,effectiveValue,effectiveFormat/backgroundColor"
                "))))"
            ),
        )
        .execute()
    )
    sheets = result.get("sheets") or []
    if not sheets:
        return 0.0, 0.0
    row_data = (sheets[0].get("data") or [{}])[0].get("rowData") or []

    total = 0.0
    programados = 0.0
    for row in row_data:
        values = row.get("values") or []
        if len(values) <= COL_SALDO:
            continue

        saldo = cell_number(values[COL_SALDO]) or 0.0
        yellow = row_is_yellow(values)
        if not should_count_row(values, saldo, yellow):
            continue

        total += saldo
        if yellow:
            programados += saldo

    return total, programados


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingesta CXP (SALDO A LA FECHA) + programados amarillo"
    )
    parser.add_argument("--sheet-id", default=os.environ.get("CXP_SHEET_ID") or SHEET_ID_DEFAULT)
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--find", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sheet_id = args.sheet_id
    if args.find or not sheet_id:
        print(f"Buscando: {args.name}")
        sheet_id = find_spreadsheet_id(args.name)
    print(f"spreadsheet_id={sheet_id}")

    service = sheets_service()
    meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
    print(f"Pestanas: {titles}")

    by_tab: dict[str, float] = {}
    by_kind: dict[str, float] = {"proveedores": 0.0, "servicios": 0.0}
    total = 0.0
    programados = 0.0

    for title in titles:
        if not tab_allowed(title):
            print(f"  {title}: omitida")
            continue
        tab_total, tab_prog = sum_tab_with_colors(service, sheet_id, title)
        kind = tab_kind(title)
        by_tab[title] = tab_total
        by_kind[kind] += tab_total
        total += tab_total
        programados += tab_prog
        print(
            f"  {title}: SALDO A LA FECHA=${tab_total:,.2f} "
            f"programados(amarillo)=${tab_prog:,.2f}"
        )

    saldo = max(0.0, total - programados)
    print(
        f"TOTAL CXP=${total:,.2f} | Programados=${programados:,.2f} | "
        f"Saldo x pagar=${saldo:,.2f}"
    )
    print(
        f"  Proveedores=${by_kind['proveedores']:,.2f} · "
        f"Servicios=${by_kind['servicios']:,.2f}"
    )

    if args.dry_run:
        print("Dry-run: no se escribio nada.")
        return

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        raise SystemExit("Faltan credenciales Supabase en .env / .env.local")

    hoy = date.today().isoformat()
    desc = " · ".join(f"{k}=${v:,.2f}" for k, v in by_tab.items()) or "CXP"
    records = [
        {
            "date": hoy,
            "type": "expense",
            "category": "Cuentas Por Pagar",
            "amount": total,
            "description": f"SALDO A LA FECHA · {desc}",
            "source_file": SOURCE_FILE,
        },
        {
            "date": hoy,
            "type": "expense",
            "category": "CXP Proveedores",
            "amount": by_kind["proveedores"],
            "description": "Suma SALDO A LA FECHA · PROVEEDORES",
            "source_file": SOURCE_FILE,
        },
        {
            "date": hoy,
            "type": "expense",
            "category": "CXP Servicios",
            "amount": by_kind["servicios"],
            "description": "Suma SALDO A LA FECHA · SERVICIOS",
            "source_file": SOURCE_FILE,
        },
        {
            "date": hoy,
            "type": "expense",
            "category": "CXP Pagos Programados",
            "amount": programados,
            "description": "Filas amarillas · SALDO A LA FECHA",
            "source_file": SOURCE_FILE,
        },
    ]

    supabase = create_client(url, key)
    supabase.table("financial_records").delete().eq("source_file", SOURCE_FILE).execute()
    result = supabase.table("financial_records").insert(records).execute()
    print(f"Insertados: {len(result.data or [])} ({hoy})")
    print("Listo. Recarga http://localhost:3000")


if __name__ == "__main__":
    main()
