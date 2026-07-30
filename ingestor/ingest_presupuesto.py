"""
Ingestor: PRESUPUESTO MENSUAL (hoja TOTAL) → financial_records.

Lee gastos en efectivo, Mifel y BBVA por categoría (líneas hoja,
sin subtotales padre que duplican).
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from openpyxl import load_workbook
from supabase import create_client

load_dotenv()

SOURCE_FILE = "presupuesto_mensual"
SOURCE_SALDOS = "presupuesto_saldos"
DEFAULT_YEAR_FOLDER = Path(
    r"I:\.shortcut-targets-by-id\1-6eRRMYs_V7qHEjD8GHjQgwFC63ucMPk\PRESUPUESTOS 2026"
)
# Acceso vía Drive: I:\Mi unidad\Presupuestos\PRESUPUESTOS 2026.lnk → carpeta real

MONTHS = {
    "ENERO": 1,
    "FEBRERO": 2,
    "FEBRRERO": 2,  # typo frecuente en el archivo
    "MARZO": 3,
    "ABRIL": 4,
    "MAYO": 5,
    "JUNIO": 6,
    "JULIO": 7,
    "AGOSTO": 8,
    "SEPTIEMBRE": 9,
    "OCTUBRE": 10,
    "NOVIEMBRE": 11,
    "DICIEMBRE": 12,
}

# Subtotales que repiten la suma de sus hijos
PARENT_CATEGORIES = {"INSUMOS DE COCINA", "INSUMOS DE BARRA"}

# Encabezados / filas resumen al pie
SKIP_NAMES = {
    "GASTOS EN EFECTIVO",
    "GASTOS BANCO MIFEL",
    "GASTOS BANCO BBVA",
    "EFE",
    "BA",
    "VENTA",
}

# (col_nombre, col_monto, canal) — 0-based
STREAMS = (
    (0, 1, "Efectivo"),
    (3, 4, "Mifel"),
    (6, 7, "BBVA"),
)


def parse_month_year(filename: str) -> tuple[int, int] | None:
    upper = filename.upper()
    year_m = re.search(r"(20\d{2})", upper)
    if not year_m:
        return None
    year = int(year_m.group(1))
    for name, num in MONTHS.items():
        if name in upper:
            return year, num
    return None


def as_amount(value) -> float | None:
    if value is None or isinstance(value, str):
        return None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount == 0:
        return None
    return abs(amount)


# Columnas saldos bancarios en hoja TOTAL (1-based): L=12 MIFEL, O=15 ACTUAL
COL_MIFEL_ACTUAL = 14  # 0-based col O
COL_BBVA_LABEL = 14    # col O puede decir "BBVA"
COL_BBVA_ACTUAL = 14   # col O ACTUAL en fila tras encabezado BBVA


def extract_saldos_from_total(ws, year: int, month: int, month_label: str) -> list[dict]:
    """Lee saldo ACTUAL Mifel (fila 2) y BBVA (bloque ~fila 20+) de hoja TOTAL."""
    rows = list(ws.iter_rows(max_row=30, max_col=19, values_only=True))
    if len(rows) < 2:
        return []

    month_date = f"{year:04d}-{month:02d}-01"
    records: list[dict] = []

    # MIFEL ACTUAL — fila 2, columna O
    r2 = list(rows[1]) + [None] * 19
    mifel = as_amount(r2[COL_MIFEL_ACTUAL])
    if mifel is not None:
        records.append(
            {
                "date": month_date,
                "type": "income",
                "category": "Saldo Mifel",
                "amount": mifel,
                "description": f"{month_label} · MIFEL ACTUAL",
                "source_file": SOURCE_SALDOS,
            }
        )

    # BBVA ACTUAL — buscar fila con "BBVA" en col O, luego primera fila numérica
    bbva = None
    for i, row in enumerate(rows):
        cells = list(row) + [None] * 19
        label = str(cells[COL_BBVA_LABEL] or "").strip().upper()
        if label == "BBVA":
            for j in range(i + 1, min(i + 6, len(rows))):
                c2 = list(rows[j]) + [None] * 19
                val = as_amount(c2[COL_BBVA_ACTUAL])
                if val is not None:
                    bbva = val
                    break
            break

    if bbva is not None:
        records.append(
            {
                "date": month_date,
                "type": "income",
                "category": "Saldo BBVA",
                "amount": bbva,
                "description": f"{month_label} · BBVA ACTUAL",
                "source_file": SOURCE_SALDOS,
            }
        )

    return records


def extract_from_workbook(path: Path) -> tuple[list[dict], list[dict]]:
    parsed = parse_month_year(path.name)
    if not parsed:
        raise ValueError(f"No se pudo inferir mes/año de: {path.name}")
    year, month = parsed
    # Fecha representativa del mes (día 1)
    month_date = f"{year:04d}-{month:02d}-01"
    month_label = f"{path.stem.strip()}"

    wb = load_workbook(path, read_only=True, data_only=True)
    if "TOTAL" not in wb.sheetnames:
        wb.close()
        raise ValueError(f"Sin hoja TOTAL en {path.name}. Hojas: {wb.sheetnames}")

    ws = wb["TOTAL"]
    records: list[dict] = []
    saldos: list[dict] = []

    saldos = extract_saldos_from_total(ws, year, month, month_label)

    for i, row in enumerate(ws.iter_rows(max_row=60, max_col=8, values_only=True)):
        # Saltar fila 1 (totales de sección)
        if i == 0:
            continue
        cells = list(row) + [None] * 8
        for name_i, amt_i, canal in STREAMS:
            name = cells[name_i]
            amount = as_amount(cells[amt_i])
            if not name or amount is None:
                continue
            cat = str(name).strip()
            if not cat or cat.upper() in SKIP_NAMES or cat.upper() in PARENT_CATEGORIES:
                continue
            records.append(
                {
                    "date": month_date,
                    "type": "expense",
                    "category": f"{canal}: {cat}",
                    "amount": amount,
                    "description": f"{month_label} · {canal} · {cat}",
                    "source_file": SOURCE_FILE,
                }
            )

    wb.close()
    return records, saldos


def find_budget_files(folder: Path) -> list[Path]:
    return sorted(folder.glob("PRESUPUESTO*.xlsx"))


def chunked(items: list[dict], size: int = 200):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingesta presupuesto mensual → Supabase")
    parser.add_argument(
        "--folder",
        type=Path,
        default=DEFAULT_YEAR_FOLDER,
        help="Carpeta con PRESUPUESTO MENSUAL *.xlsx",
    )
    parser.add_argument(
        "--file",
        type=Path,
        default=None,
        help="Un solo archivo (opcional). Si no se pasa, procesa toda la carpeta.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    files = [args.file] if args.file else find_budget_files(args.folder)
    if not files:
        raise SystemExit(f"No hay archivos PRESUPUESTO*.xlsx en {args.folder}")

    all_records: list[dict] = []
    all_saldos: list[dict] = []
    for path in files:
        if not path.exists():
            print(f"SKIP (no existe): {path}")
            continue
        try:
            rows, saldos = extract_from_workbook(path)
        except Exception as exc:
            print(f"ERROR {path.name}: {exc}")
            continue
        total = sum(r["amount"] for r in rows)
        print(f"{path.name}: {len(rows)} gastos ${total:,.2f} | saldos: {saldos}")
        all_records.extend(rows)
        all_saldos.extend(saldos)

    print(f"TOTAL gastos: {len(all_records)} = ${sum(r['amount'] for r in all_records):,.2f}")
    print(f"TOTAL saldos: {len(all_saldos)} registros")

    if args.dry_run:
        print("Dry-run: no se escribió nada.")
        if all_records:
            print("Ejemplo:", all_records[0])
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env")

    supabase = create_client(url, key)
    supabase.table("financial_records").delete().eq("source_file", SOURCE_FILE).execute()
    supabase.table("financial_records").delete().eq("source_file", SOURCE_SALDOS).execute()
    print(f"Limpieza previa {SOURCE_FILE} + {SOURCE_SALDOS}: OK")

    inserted = 0
    for batch in chunked(all_records + all_saldos, 200):
        result = supabase.table("financial_records").insert(batch).execute()
        inserted += len(result.data or [])

    print(f"Insertados: {inserted}")
    print("Listo. Recarga http://localhost:3000")


if __name__ == "__main__":
    main()
