"""
Importa la hoja Encuestas → Storage de Supabase (calidad-encuestas/encuestas.json).

Solo agrega filas cuyo source_hash aún no está en el archivo. No reescribe historial.
Pensado para GitHub Actions a las 4:00 AM CDMX (sync-calidad.yml).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from google_auth import sheets_service

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

SPREADSHEET_ID = "1p8jWAw_eqeHgxtw03K7lgH-WThHVJ1FHENiEK6-m2gM"
TAB = "Encuestas"
BUCKET = "calidad-encuestas"
OBJECT = "encuestas.json"
HASH_SEP = "\x1f"
FECHA_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$")


def _client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
        )
    return create_client(url, key)


def _cell(row: list, index: int) -> str:
    if index >= len(row) or row[index] is None:
        return ""
    return str(row[index]).strip()


def _rating(row: list, index: int) -> str | None:
    value = _cell(row, index).upper()
    return value or None


def _text(row: list, index: int) -> str | None:
    value = _cell(row, index)
    return value or None


def parse_fecha(raw: str) -> str | None:
    match = FECHA_RE.match(raw.strip())
    if not match:
        return None
    day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if year < 100:
        year += 2000 if year < 70 else 1900
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def row_hash(cells: list[str]) -> str:
    payload = HASH_SEP.join(cells).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_sheet_rows() -> list[dict]:
    svc = sheets_service()
    res = (
        svc.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{TAB}'!A2:M",
            valueRenderOption="FORMATTED_VALUE",
        )
        .execute()
    )
    raw_rows = res.get("values") or []
    seen: set[str] = set()
    out: list[dict] = []
    for raw in raw_rows:
        cells = [_cell(raw, i) for i in range(13)]
        if not any(cells):
            continue
        if cells[0].lower().startswith("folio"):
            continue
        digest = row_hash(cells)
        if digest in seen:
            continue
        seen.add(digest)
        out.append(
            {
                "source_hash": digest,
                "folio": _text(raw, 0),
                "ticket": _text(raw, 1),
                "fecha": parse_fecha(cells[2]) if cells[2] else None,
                "mesero": _text(raw, 3),
                "mesa": _text(raw, 4),
                "servicio": _rating(raw, 5),
                "alimentos": _rating(raw, 6),
                "bebidas": _rating(raw, 7),
                "limpieza": _rating(raw, 8),
                "precio": _rating(raw, 9),
                "canal": _text(raw, 10),
                "otro": _text(raw, 11),
                "comentario": _text(raw, 12),
            }
        )
    return out


def load_existing(sb) -> tuple[list[dict], set[str]]:
    try:
        blob = sb.storage.from_(BUCKET).download(OBJECT)
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        if "not found" in message or "404" in message:
            return [], set()
        raise
    raw = blob.decode("utf-8") if isinstance(blob, (bytes, bytearray)) else bytes(blob).decode("utf-8")
    payload = json.loads(raw or "{}")
    rows = list(payload.get("rows") or [])
    hashes = {str(row.get("source_hash")) for row in rows if row.get("source_hash")}
    return rows, hashes


def save_file(sb, rows: list[dict], *, rows_read: int, rows_inserted: int) -> None:
    payload = {
        "syncedAt": datetime.now(timezone.utc).isoformat(),
        "rowsRead": rows_read,
        "rowsInserted": rows_inserted,
        "rows": rows,
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sb.storage.from_(BUCKET).upload(
        OBJECT,
        data,
        file_options={"content-type": "application/json", "upsert": "true"},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync encuestas de Calidad")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Leyendo '{TAB}' …")
    rows = load_sheet_rows()
    print(f"Filas distintas en la hoja: {len(rows)}")

    if args.dry_run:
        servicio = Counter(row["servicio"] for row in rows if row["servicio"])
        fechas = [row["fecha"] for row in rows if row["fecha"]]
        print("[dry-run] no se escribe en Supabase")
        print("servicio", dict(servicio))
        if fechas:
            print(f"fechas {min(fechas)} → {max(fechas)}")
        return

    sb = _client()
    existing, known = load_existing(sb)
    fresh = [row for row in rows if row["source_hash"] not in known]
    print(f"Ya importadas: {len(known)}. Nuevas: {len(fresh)}")
    merged = existing + fresh
    save_file(sb, merged, rows_read=len(rows), rows_inserted=len(fresh))
    print(f"{len(fresh)} filas nuevas de {len(rows)} en la hoja. Guardadas: {len(merged)}")


if __name__ == "__main__":
    main()
