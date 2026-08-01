"""
Parser compartido Infocaja Fin de Día (texto/.eml) → registros Supabase.
"""

from __future__ import annotations

import argparse
import os
import re
from email import policy
from email.parser import BytesParser
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SOURCE_FILE = "infocaja"
DEFAULT_EML = Path(
    r"c:\Users\magno\Downloads\Infocaja Fín de Día de la Unidad CLUSTER CULINARIO.eml"
)

DATE_RE = re.compile(r"Fin de D[ií]a del\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)

FIELD_PATTERNS = (
    ("Venta Total", re.compile(r"Venta\s*Total\s*:\s*\$?\s*([\d,]+\.\d{2})", re.I)),
    ("Venta Bruta", re.compile(r"Venta\s*Bruta\s*:\s*\$?\s*([\d,]+\.\d{2})", re.I)),
    ("Descuentos", re.compile(r"(?<!x )\bDescuentos\s*:\s*\$?\s*([\d,]+\.\d{2})", re.I)),
    # Formato habitual: monto | propina | total (3 cifras). Fallback: solo monto.
    (
        "Bancarias",
        re.compile(
            r"Bancarias\s*:\s*\$?\s*([\d,]+\.\d{2})"
            r"(?:\s+\$?\s*([\d,]+\.\d{2})\s+\$?\s*([\d,]+\.\d{2}))?",
            re.I,
        ),
    ),
    (
        "Efectivo",
        re.compile(
            r"Efectivo\s*:\s*\$?\s*([\d,]+\.\d{2})"
            r"(?:\s+\$?\s*([\d,]+\.\d{2})\s+\$?\s*([\d,]+\.\d{2}))?",
            re.I,
        ),
    ),
)


def strip_html(content: str) -> str:
    text = re.sub(r"<[^>]+>", " ", content)
    return re.sub(r"\s+", " ", text).strip()


def parse_money(raw: str) -> float:
    return float(raw.replace(",", ""))


def parse_infocaja_text(text: str, subject: str | None = None) -> dict:
    """Extrae fecha y montos desde el cuerpo plano/HTML de Infocaja."""
    clean = strip_html(text)
    date_m = DATE_RE.search(clean)
    if not date_m:
        raise ValueError("No se encontró la fecha (Fin de Día del DD/MM/YYYY)")

    d, m, y = date_m.group(1).split("/")
    iso_date = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"

    fields: dict[str, float] = {}
    for name, pattern in FIELD_PATTERNS:
        match = pattern.search(clean)
        if not match:
            continue
        if name in ("Bancarias", "Efectivo"):
            fields[name] = parse_money(match.group(1))
            tip_raw = match.group(2)
            if tip_raw is not None:
                tip = parse_money(tip_raw)
                if name == "Bancarias" and tip > 0:
                    fields["Propina"] = tip
        else:
            fields[name] = parse_money(match.group(1))

    if "Venta Total" not in fields:
        raise ValueError("No se encontró Venta Total")

    return {
        "date": iso_date,
        "subject": subject,
        "fields": fields,
        "text_preview": clean[:300],
    }


def parse_eml(path: Path) -> dict:
    with open(path, "rb") as f:
        msg = BytesParser(policy=policy.default).parse(f)
    body = msg.get_body(preferencelist=("plain", "html"))
    content = body.get_content() if body else ""
    return parse_infocaja_text(content, subject=msg["subject"])


def to_records(parsed: dict) -> list[dict]:
    fecha = parsed["date"]
    fields = parsed["fields"]
    records = [
        {
            "date": fecha,
            "type": "income",
            "category": "Venta Total",
            "amount": fields["Venta Total"],
            "description": f"Infocaja Fin de Día {fecha}",
            "source_file": SOURCE_FILE,
        }
    ]
    for key, category in (
        ("Efectivo", "Infocaja Efectivo"),
        ("Bancarias", "Infocaja Bancarias"),
        ("Descuentos", "Infocaja Descuentos"),
        ("Propina", "Infocaja Propina"),
    ):
        # Guardar mix de pago aunque sea 0 (distingue “día sin efectivo” de “sin dato”).
        # Descuentos/Propina solo si > 0 para no inflar filas vacías.
        if key not in fields:
            continue
        amount = fields[key]
        if key in ("Descuentos", "Propina") and amount <= 0:
            continue
        records.append(
            {
                "date": fecha,
                "type": "income" if key != "Descuentos" else "expense",
                "category": category,
                "amount": amount,
                "description": f"Infocaja detalle {fecha}",
                "source_file": SOURCE_FILE,
            }
        )
    return records


def upsert_day(supabase, parsed: dict) -> int:
    records = to_records(parsed)
    supabase.table("financial_records").delete().eq("source_file", SOURCE_FILE).eq(
        "date", parsed["date"]
    ).execute()
    result = supabase.table("financial_records").insert(records).execute()
    return len(result.data or [])


def main() -> None:
    parser = argparse.ArgumentParser(description="Parsea .eml Infocaja e inserta en Supabase")
    parser.add_argument("--eml", type=Path, default=DEFAULT_EML)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.eml.exists():
        raise SystemExit(f"No se encontró: {args.eml}")

    parsed = parse_eml(args.eml)
    records = to_records(parsed)
    print(f"Fecha: {parsed['date']}")
    print(f"Campos: {parsed['fields']}")
    print(f"Registros a insertar: {len(records)}")

    if args.dry_run:
        print("Dry-run:", records)
        return

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env")

    supabase = create_client(url, key)
    n = upsert_day(supabase, parsed)
    print(f"Insertados: {n}")
    print("Listo. Recarga http://localhost:3000")


if __name__ == "__main__":
    main()
