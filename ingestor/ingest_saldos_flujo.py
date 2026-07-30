"""
Extrae saldos de efectivo (columna Saldo en Efectivo) del flujo de caja → Supabase.

Usa la última fila con fecha del archivo FLUJO EFECTIVO CARRANZA 50.xlsx.
"""

from __future__ import annotations

import argparse
import os
import re
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
from openpyxl import load_workbook
from supabase import create_client

load_dotenv()

SOURCE_FILE = "flujo_efectivo_saldo"
DEFAULT_PATH = Path(r"I:\Mi unidad\Administración\FLUJO EFECTIVO CARRANZA 50.xlsx")
COL_FECHA = 2
COL_CONCEPTO = 3
COL_SALDO = 9


def sheet_name_for_year(year: int) -> str:
    if year == 2024:
        return "FUJO DE EFECTIVO 2024"
    return f"FLUJO DE EFECTIVO {year}"


def as_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def years_in_workbook(path: Path) -> list[int]:
    wb = load_workbook(path, read_only=True, data_only=True)
    years: list[int] = []
    for name in wb.sheetnames:
        m = re.search(r"(20\d{2})", name)
        if m:
            years.append(int(m.group(1)))
    wb.close()
    return sorted(set(years))


def valid_date_for_sheet(fecha: date, sheet_year: int) -> bool:
    """Acepta fechas del año de la hoja o enero del año siguiente (corte anual)."""
    if fecha.year == sheet_year:
        return True
    if fecha.year == sheet_year + 1 and fecha.month == 1:
        return True
    return False


def extract_saldos(path: Path, year: int) -> list[dict]:
    wb = load_workbook(path, read_only=True, data_only=True)
    name = sheet_name_for_year(year)
    if name not in wb.sheetnames:
        wb.close()
        return []

    ws = wb[name]
    records: list[dict] = []
    for row in ws.iter_rows(min_row=3, max_col=COL_SALDO, values_only=True):
        cells = list(row) + [None] * COL_SALDO
        fecha = as_date(cells[COL_FECHA - 1])
        saldo = cells[COL_SALDO - 1]
        concepto = cells[COL_CONCEPTO - 1]
        if not fecha or saldo is None:
            continue
        if not valid_date_for_sheet(fecha, year):
            continue
        try:
            amount = float(saldo)
        except (TypeError, ValueError):
            continue
        records.append(
            {
                "date": fecha.isoformat(),
                "type": "income",
                "category": "Saldo Efectivo",
                "amount": amount,
                "description": f"FLUJO EFECTIVO CARRANZA 50 · {concepto or 'movimiento'}",
                "source_file": SOURCE_FILE,
            }
        )
    wb.close()
    return records


def extract_all(path: Path, years: list[int] | None) -> list[dict]:
    target = years or years_in_workbook(path)
    all_records: list[dict] = []
    for year in target:
        rows = extract_saldos(path, year)
        if rows:
            print(f"  {year}: {len(rows)} filas · último {rows[-1]['date']}")
        all_records.extend(rows)
    return all_records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=None, help="Un solo año (opcional)")
    parser.add_argument("--file", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.file.exists():
        raise SystemExit(f"No existe: {args.file}")

    years = [args.year] if args.year else None
    records = extract_all(args.file, years)
    latest = max(records, key=lambda r: r["date"]) if records else None
    print(f"TOTAL registros saldo: {len(records)}")
    if latest:
        print(f"Último día en archivo: {latest['date']} = ${latest['amount']:,.2f}")

    if args.dry_run:
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Faltan variables en .env")

    supabase = create_client(url, key)
    supabase.table("financial_records").delete().eq("source_file", SOURCE_FILE).execute()
    for i in range(0, len(records), 200):
        supabase.table("financial_records").insert(records[i : i + 200]).execute()
    print(f"Insertados: {len(records)}")


if __name__ == "__main__":
    main()
