"""
Ingestor CXP (Google Sheet) → financial_records.

Sheet: C X P PROVEEDORES CLUSTER 2026
Pestañas: CXP PROVEEDORES, CXP SERVICIOS (Aportaciones se omite)

Registra pagos reales (PAGADO / CANTIDAD PAGADA) como expense source_file=cxp.

En pestañas con columna «RETORNOS DE EFECTIVO» (razón social), el campo
útil para etiquetar/agrupar es CONCEPTO (NÓMINA, QUINCENAS, LUZ…);
la razón social queda como detalle secundario.

También guarda saldos resumen MIFEL/BBVA/Efectivo del encabezado (source_file=cxp_saldos).
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from google_auth import drive_service, sheets_service

load_dotenv()

SOURCE_FILE = "cxp"
SOURCE_SALDOS = "cxp_saldos"
DEFAULT_NAME = "C X P PROVEEDORES CLUSTER 2026"
SHEET_ID_DEFAULT = "1f_-UFjM3fElr2cJPs2LSooW-7mJY9d2umOs5HuZPkgU"

MONTH_ES = {
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
}

HEADER_MARKERS = ("fecha", "concepto", "cantidad por pagar", "cantidad pagada")


def find_spreadsheet_id(name_query: str) -> str:
    drive = drive_service()
    q = (
        f"name contains '{name_query.replace(chr(39), '')}' "
        "and mimeType='application/vnd.google-apps.spreadsheet' "
        "and trashed=false"
    )
    result = (
        drive.files()
        .list(q=q, spaces="drive", fields="files(id, name)", pageSize=10)
        .execute()
    )
    files = result.get("files", [])
    if not files:
        raise SystemExit(f"No se encontro Sheet: {name_query}")
    for f in files:
        print(f"  - {f['name']} id={f['id']}")
        if f["name"].strip().upper() == name_query.strip().upper():
            return f["id"]
    return files[0]["id"]


def parse_money_mx(value) -> float | None:
    """Parsea $1.234,56 o 1234.56 → float."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return abs(float(value)) if float(value) != 0 else None
    s = str(value).strip()
    if not s or s in ("-", "#REF!", "#DIV/0!"):
        return None
    s = s.replace("$", "").replace(" ", "").replace("\xa0", "")
    # Formato EU/MX: 1.234,56
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        amount = float(s)
    except ValueError:
        return None
    if amount == 0:
        return None
    return abs(amount)


def parse_date_mx(value) -> date | None:
    """Parsea 06-ene-26, 21-ene-2026, etc."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip().lower().replace(" ", "")
    m = re.match(r"^(\d{1,2})[-/]([a-z]{3})[-/](\d{2,4})$", s)
    if m:
        day = int(m.group(1))
        mon = MONTH_ES.get(m.group(2))
        year = int(m.group(3))
        if year < 100:
            year += 2000
        if not mon:
            return None
        try:
            return date(year, mon, day)
        except ValueError:
            return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue
    return None


def is_header_row(row: list) -> bool:
    joined = " ".join(str(c).strip().lower() for c in row if c)
    has_money_hdr = any(
        m in joined
        for m in ("cantidad", "pagar", "pagada", "pagado", "total", "saldo")
    )
    return all(marker in joined for marker in ("fecha", "concepto")) and has_money_hdr


def parse_semana(value) -> int | None:
    """Lee SEMANA O MES (entero 1–53 típico)."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        n = int(value)
        return n if 1 <= n <= 53 else None
    s = str(value).strip().replace(",", ".")
    try:
        n = int(float(s))
    except ValueError:
        return None
    return n if 1 <= n <= 53 else None


def looks_like_data_row(row: list) -> bool:
    if not row:
        return False
    fecha = parse_date_mx(row[0] if len(row) > 0 else None)
    if not fecha:
        return False
    # Debe tener monto en col 8 (pagada) o 7 (por pagar)
    paid = parse_money_mx(row[7] if len(row) > 7 else None)
    due = parse_money_mx(row[6] if len(row) > 6 else None)
    return paid is not None or due is not None


def extract_summary_saldos(values: list[list], year: int) -> list[dict]:
    """Lee saldos MIFEL/BBVA/Efectivo del bloque superior de CXP PROVEEDORES."""
    records: list[dict] = []
    # Buscar en primeras 5 filas pares label/valor en cols M/N (13/14)
    for row in values[:5]:
        cells = list(row) + [""] * 20
        for i in range(len(cells) - 1):
            label = str(cells[i] or "").strip().upper()
            amount = parse_money_mx(cells[i + 1])
            if amount is None:
                continue
            if label in ("MIFEL", "BBVA", "EFECTIVO"):
                records.append(
                    {
                        "date": date(year, 12, 31).isoformat(),  # ancla año; dashboard usa ultimo valor
                        "type": "income",
                        "category": f"Saldo {label.title()}",
                        "amount": amount,
                        "description": f"Resumen CXP · {label}",
                        "source_file": SOURCE_SALDOS,
                    }
                )
    # Dedup by category (last wins)
    by_cat: dict[str, dict] = {}
    for r in records:
        by_cat[r["category"]] = r
    return list(by_cat.values())


def normalize_factura_ref(value) -> str | None:
    """Normaliza NO. DE FACTURA (Sheets float 791.0 → '791', multi 'a / b')."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        n = float(value)
        if n != n:  # NaN
            return None
        if n == int(n):
            return str(int(n))
        return str(value).strip() or None
    s = str(value).strip()
    if not s or s in ("-", "—", "#REF!", "#DIV/0!"):
        return None
    # "791.0" from Sheets JSON / CSV exports
    if re.fullmatch(r"\d+\.0+", s):
        return str(int(float(s)))
    return s


def extract_payments(values: list[list], sheet_title: str) -> list[dict]:
    """Solo columnas A–M (índices 0–12). Ignora bloque de notas/resumen (N+)."""
    records: list[dict] = []
    for row in values:
        # Truncar a columnas A–M
        cells = list(row[:13]) + [""] * 13
        if is_header_row(cells):
            continue
        if not looks_like_data_row(cells):
            continue

        fecha_doc = parse_date_mx(cells[0])
        fecha_pago = parse_date_mx(cells[10]) if len(cells) > 10 else None
        fecha = fecha_pago or fecha_doc
        if not fecha:
            continue

        # Col C = razón social / «RETORNOS DE EFECTIVO» (encabezado de servicio).
        # Col D = CONCEPTO (etiqueta principal: NÓMINA, QUINCENAS, LUZ…).
        razon_social = str(cells[2] or "").strip()
        concepto = str(cells[3] or "").strip()
        semana = parse_semana(cells[4] if len(cells) > 4 else None)
        iva = parse_money_mx(cells[5] if len(cells) > 5 else None)
        forma = str(cells[9] or "").strip()
        factura = normalize_factura_ref(cells[1] if len(cells) > 1 else None)

        pagada = parse_money_mx(cells[7])
        if pagada is None:
            continue  # solo movimientos pagados

        if not concepto and not razon_social:
            continue

        label = concepto or razon_social
        bank_hint = "Transferencia"
        forma_u = forma.upper()
        if "MIFEL" in forma_u:
            bank_hint = "Mifel"
        elif "BBVA" in forma_u:
            bank_hint = "BBVA"
        elif "EFECTIVO" in forma_u:
            bank_hint = "Efectivo"
        elif "TRANSFERENCIA" in forma_u:
            bank_hint = "Transferencia"

        # Concepto primero; razón social solo como detalle.
        payload = {
            "canal": "CXP",
            "fecha": fecha.isoformat(),
            "concepto": concepto or None,
            "descripcion": label,
            "razon_social": razon_social or None,
            "factura": factura or None,
            "forma_pago": forma or None,
            "bank_hint": bank_hint,
            "iva": iva,
            "week": semana,
            "week_annual": semana,
            "sheet": sheet_title,
            "cargo": pagada,
            "abono": None,
        }

        records.append(
            {
                "date": fecha.isoformat(),
                "type": "expense",
                "category": f"CXP: {label}"[:120],
                "amount": pagada,
                "description": json.dumps(payload, ensure_ascii=False),
                "source_file": SOURCE_FILE,
            }
        )
    return records


def extract_all(spreadsheet_id: str, year: int) -> list[dict]:
    service = sheets_service()
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
    print(f"Pestanas: {titles}")

    payments: list[dict] = []

    for title in titles:
        if "aportacion" in title.lower():
            print(f"  {title}: omitida")
            continue
        result = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=f"'{title}'!A:M")
            .execute()
        )
        values = result.get("values", [])
        rows = extract_payments(values, title)
        print(f"  {title}: {len(rows)} pagos (cols A-M)")
        payments.extend(rows)

    return payments


def chunked(items: list[dict], size: int = 200):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingesta CXP → Supabase")
    parser.add_argument("--sheet-id", default=os.environ.get("CXP_SHEET_ID") or SHEET_ID_DEFAULT)
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--find", action="store_true", help="Buscar Sheet por nombre")
    args = parser.parse_args()

    sheet_id = args.sheet_id
    if args.find or not sheet_id:
        print(f"Buscando: {args.name}")
        sheet_id = find_spreadsheet_id(args.name)
    print(f"spreadsheet_id={sheet_id}")

    payments = extract_all(sheet_id, args.year)
    total = sum(r["amount"] for r in payments)
    print(f"TOTAL pagos CXP: {len(payments)} = ${total:,.2f}")
    if payments:
        print("Ejemplo:", payments[0])

    if args.dry_run:
        print("Dry-run: no se escribio nada.")
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env")

    supabase = create_client(url, key)
    supabase.table("financial_records").delete().eq("source_file", SOURCE_FILE).execute()
    # Limpiar saldos viejos del bloque de notas (ya no se usan)
    supabase.table("financial_records").delete().eq("source_file", SOURCE_SALDOS).execute()

    inserted = 0
    for batch in chunked(payments):
        result = supabase.table("financial_records").insert(batch).execute()
        inserted += len(result.data or [])
    print(f"Insertados: {inserted}")
    print("Listo. Recarga http://localhost:3000")
    print(f"Tip: CXP_SHEET_ID={sheet_id}")


if __name__ == "__main__":
    main()
