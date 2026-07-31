"""
Ingestor Gmail → Supabase: correos CORTE CARRANZA (cancelaciones y descuentos).

Extrae el adjunto 'Cancelaciones y Descuentos*.xls', lo guarda en
ingestor/attachments/corte/YYYY-MM-DD/ y sube el detalle a Supabase.
"""

from __future__ import annotations

import argparse
import base64
import os
import re
from datetime import date
from email import policy
from email.parser import BytesParser
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from google_auth import gmail_service
from parse_corte_descuentos import (
    SOURCE_FILE,
    parse_cancelaciones_descuentos_xls,
    parse_date_from_subject,
    to_records,
    upsert_day,
)

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

BASE_DIR = Path(__file__).resolve().parent
ATTACH_ROOT = BASE_DIR / "attachments" / "corte"

SUBJECT = "CORTE CARRANZA"
ATTACH_NAME_RE = re.compile(r"cancelaciones\s*y\s*descuentos", re.I)


def list_message_ids(service, query: str) -> list[str]:
    ids: list[str] = []
    page_token = None
    while True:
        kwargs = {"userId": "me", "q": query, "maxResults": 100}
        if page_token:
            kwargs["pageToken"] = page_token
        result = service.users().messages().list(**kwargs).execute()
        ids.extend(m["id"] for m in result.get("messages", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return ids


def build_query(after: str | None, before: str | None, newer_than_days: int | None) -> str:
    # Asuntos: "CORTE CARRANZA ..." y "Recibidos CORTE CARRANZA ..."
    parts = ['(subject:"CORTE CARRANZA")', "has:attachment"]
    if newer_than_days:
        parts.append(f"newer_than:{newer_than_days}d")
    if after:
        parts.append(f"after:{after}")
    if before:
        parts.append(f"before:{before}")
    return " ".join(parts)


def iter_attachments(payload: dict):
    """Yield (filename, raw_bytes) for attachment parts."""

    def walk(part: dict):
        filename = part.get("filename") or ""
        body = part.get("body", {})
        if filename and (body.get("attachmentId") or body.get("data")):
            yield filename, body
        for child in part.get("parts") or []:
            yield from walk(child)

    yield from walk(payload)


def download_attachment(service, message_id: str, body: dict) -> bytes:
    if body.get("data"):
        return base64.urlsafe_b64decode(body["data"])
    att_id = body["attachmentId"]
    att = (
        service.users()
        .messages()
        .attachments()
        .get(userId="me", messageId=message_id, id=att_id)
        .execute()
    )
    return base64.urlsafe_b64decode(att["data"])


def save_attachment(fecha: str, filename: str, raw: bytes) -> Path:
    dest_dir = ATTACH_ROOT / fecha
    dest_dir.mkdir(parents=True, exist_ok=True)
    # Normaliza nombre
    safe = re.sub(r"[^\w.\- ]+", "_", filename).strip() or "Cancelaciones_y_Descuentos.xls"
    path = dest_dir / safe
    path.write_bytes(raw)
    return path


def parse_from_eml(eml_path: Path) -> tuple[str, dict, Path]:
    with eml_path.open("rb") as f:
        msg = BytesParser(policy=policy.default).parse(f)
    subject = msg["subject"] or ""
    fecha = parse_date_from_subject(subject)
    if not fecha:
        raise ValueError(f"No se pudo inferir fecha del asunto: {subject}")

    xls_bytes = None
    xls_name = "Cancelaciones y Descuentos.xls"
    for part in msg.walk():
        fn = part.get_filename() or ""
        if ATTACH_NAME_RE.search(fn):
            xls_bytes = part.get_payload(decode=True)
            xls_name = fn
            break
    if not xls_bytes:
        raise ValueError("No se encontró adjunto Cancelaciones y Descuentos")

    saved = save_attachment(fecha, xls_name, xls_bytes)
    parsed = parse_cancelaciones_descuentos_xls(saved)
    return fecha, parsed, saved


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingesta CORTE CARRANZA (cancelaciones/descuentos)")
    parser.add_argument(
        "--after",
        default=None,
        help="Gmail after:YYYY/MM/DD (omitir si usas --newer-than)",
    )
    parser.add_argument("--before", default=None)
    parser.add_argument(
        "--newer-than",
        type=int,
        default=None,
        help="Solo últimos N días (default 90 si no hay --after)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--eml",
        type=Path,
        default=None,
        help="Probar con un .eml local en lugar de Gmail",
    )
    args = parser.parse_args()

    if args.newer_than is None and not args.after and not args.eml:
        args.newer_than = 90

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY"
    ) or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

    if not args.dry_run and (not url or not key):
        raise SystemExit(
            "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (o equivalentes) en .env / .env.local"
        )

    supabase = None if args.dry_run else create_client(url, key)
    ok = 0
    errors = 0
    seen: set[str] = set()

    if args.eml:
        try:
            fecha, parsed, saved = parse_from_eml(args.eml)
        except Exception as exc:
            raise SystemExit(f"Error leyendo .eml: {exc}") from exc
        print(
            f"OK {fecha}: cancelaciones=${parsed['total_cancelaciones']:,.2f} "
            f"descuentos=${parsed['total_descuentos']:,.2f} -> {saved}"
        )
        records = to_records(fecha, parsed)
        if args.dry_run:
            print(f"Dry-run: {len(records)} registros")
            return
        n = upsert_day(supabase, fecha, records)
        print(f"  -> {n} filas en Supabase ({SOURCE_FILE}) [definitivo]")
        return

    service = gmail_service()
    after = None if args.newer_than else args.after
    query = build_query(after, args.before, args.newer_than)
    print(f"Query Gmail: {query}")
    message_ids = list_message_ids(service, query)
    if args.limit:
        message_ids = message_ids[: args.limit]
    print(f"Correos encontrados: {len(message_ids)}")

    for mid in message_ids:
        msj = (
            service.users()
            .messages()
            .get(userId="me", id=mid, format="full")
            .execute()
        )
        headers = {
            h["name"].lower(): h["value"] for h in msj.get("payload", {}).get("headers", [])
        }
        subject = headers.get("subject", "")
        fecha = parse_date_from_subject(subject)
        if not fecha:
            print(f"SKIP {mid}: sin fecha en asunto '{subject}'")
            errors += 1
            continue
        if fecha in seen:
            print(f"SKIP {fecha}: ya procesado en esta corrida")
            continue

        xls_raw = None
        xls_name = None
        for filename, body in iter_attachments(msj.get("payload", {})):
            if ATTACH_NAME_RE.search(filename):
                try:
                    xls_raw = download_attachment(service, mid, body)
                    xls_name = filename
                    break
                except Exception as exc:
                    print(f"SKIP {fecha}: error adjunto {filename}: {exc}")
                    errors += 1
                    xls_raw = None
                    break

        if not xls_raw or not xls_name:
            print(f"SKIP {fecha}: sin adjunto Cancelaciones y Descuentos")
            errors += 1
            continue

        saved = save_attachment(fecha, xls_name, xls_raw)
        try:
            parsed = parse_cancelaciones_descuentos_xls(saved)
        except Exception as exc:
            print(f"SKIP {fecha}: parse error: {exc}")
            errors += 1
            continue

        seen.add(fecha)
        print(
            f"OK {fecha}: canc=${parsed['total_cancelaciones']:,.2f} "
            f"desc=${parsed['total_descuentos']:,.2f} "
            f"({len(parsed['cancelaciones'])}+{len(parsed['descuentos'])} lineas) -> {saved.name}"
        )

        if args.dry_run:
            ok += 1
            continue

        records = to_records(fecha, parsed)
        n = upsert_day(supabase, fecha, records)
        print(f"  -> {n} filas ({SOURCE_FILE})")
        ok += 1

    print(f"\nResumen: ok={ok}, errores={errors}, dias={len(seen)}")
    print(f"Adjuntos en: {ATTACH_ROOT}")
    print(f"Hoy: {date.today().isoformat()} - recarga http://localhost:3000")


if __name__ == "__main__":
    main()
