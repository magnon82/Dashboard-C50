"""
Importa la hoja Encuestas → Supabase (calidad_encuestas).

Solo inserta filas cuyo source_hash aún no existe. No actualiza historial.
Pensado para GitHub Actions a las 4:00 AM CDMX (sync-calidad.yml).

Requisito una vez: supabase/calidad_encuestas.sql
"""

from __future__ import annotations

import argparse
import hashlib
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
HASH_SEP = "\x1f"
BATCH = 400
PAGE = 1000
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


def existing_hashes(sb) -> set[str]:
    found: set[str] = set()
    start = 0
    while True:
        res = (
            sb.table("calidad_encuestas")
            .select("source_hash")
            .order("source_hash")
            .range(start, start + PAGE - 1)
            .execute()
        )
        rows = res.data or []
        for row in rows:
            found.add(row["source_hash"])
        if len(rows) < PAGE:
            break
        start += PAGE
    return found


def insert_new(sb, rows: list[dict]) -> int:
    inserted = 0
    for offset in range(0, len(rows), BATCH):
        chunk = rows[offset : offset + BATCH]
        sb.table("calidad_encuestas").insert(chunk).execute()
        inserted += len(chunk)
        print(f"  insertadas {inserted}/{len(rows)}")
    return inserted


def write_state(sb, *, status: str, rows_read: int, rows_inserted: int, message: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    sb.table("calidad_sync_state").upsert(
        {
            "content_type": "encuestas",
            "label": "Encuestas de satisfacción",
            "last_synced_at": now,
            "rows_read": rows_read,
            "rows_inserted": rows_inserted,
            "last_status": status,
            "last_message": message[:500],
            "updated_at": now,
        },
        on_conflict="content_type",
    ).execute()


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
    try:
        known = existing_hashes(sb)
    except Exception as exc:  # noqa: BLE001
        print(f"No se pudo leer calidad_encuestas: {exc}")
        print("Ejecuta supabase/calidad_encuestas.sql en el SQL Editor de Supabase.")
        raise SystemExit(1) from exc

    fresh = [row for row in rows if row["source_hash"] not in known]
    print(f"Ya importadas: {len(known)}. Nuevas: {len(fresh)}")
    inserted = insert_new(sb, fresh) if fresh else 0
    message = f"{inserted} filas nuevas de {len(rows)} en la hoja"
    write_state(sb, status="ok", rows_read=len(rows), rows_inserted=inserted, message=message)
    print(message)


if __name__ == "__main__":
    main()
