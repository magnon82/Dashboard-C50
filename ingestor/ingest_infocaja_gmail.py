"""
Ingestor Gmail → Supabase: correos Infocaja Fin de Día (CLUSTER CULINARIO).

Requisitos previos (una sola vez):
1. https://console.cloud.google.com → crear proyecto (ej. c50-dashboard)
2. APIs & Services → Enable APIs → activar "Gmail API"
3. APIs & Services → OAuth consent screen → External → app de prueba
   - Scopes: gmail.readonly
   - Test users: tu correo de Gmail
4. Credentials → Create Credentials → OAuth client ID → Desktop app
5. Descargar JSON y guardarlo como:
   mi-dashboard-financiero/ingestor/credentials.json

Primera ejecución abre el navegador para autorizar y crea token.json.
"""

from __future__ import annotations

import argparse
import base64
import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from google_auth import gmail_service
from parse_infocaja_eml import SOURCE_FILE, parse_infocaja_text, upsert_day

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

SUBJECT = "Infocaja Fín de Día de la Unidad CLUSTER CULINARIO"
# Variante sin tilde por si Gmail normaliza el asunto
SUBJECT_ALT = "Infocaja Fin de Día de la Unidad CLUSTER CULINARIO"


def autenticar_gmail():
    return gmail_service()


def extract_body(payload: dict) -> str:
    """Obtiene HTML o texto del mensaje Gmail (incluye multipart)."""

    def walk(part: dict) -> str:
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        data = body.get("data")
        if data and mime in ("text/html", "text/plain"):
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        for child in part.get("parts") or []:
            found = walk(child)
            if found:
                return found
        return ""

    return walk(payload)


def build_query(after: str | None, before: str | None, newer_than_days: int | None) -> str:
    parts = [f'(subject:"{SUBJECT}" OR subject:"{SUBJECT_ALT}")']
    if newer_than_days:
        parts.append(f"newer_than:{newer_than_days}d")
    if after:
        parts.append(f"after:{after}")
    if before:
        parts.append(f"before:{before}")
    return " ".join(parts)


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


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingesta Infocaja desde Gmail → Supabase")
    parser.add_argument(
        "--after",
        default="2026/01/01",
        help="Gmail after:YYYY/MM/DD (default 2026/01/01)",
    )
    parser.add_argument("--before", default=None, help="Gmail before:YYYY/MM/DD")
    parser.add_argument(
        "--newer-than",
        type=int,
        default=None,
        help="Alternativa: solo últimos N días (ej. 7)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="Máx. correos a procesar")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not args.dry_run and (not url or not key):
        raise SystemExit("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env")

    service = autenticar_gmail()
    query = build_query(args.after, args.before, args.newer_than)
    print(f"Query Gmail: {query}")

    message_ids = list_message_ids(service, query)
    if args.limit:
        message_ids = message_ids[: args.limit]

    print(f"Correos encontrados: {len(message_ids)}")
    if not message_ids:
        print("Nada que ingerir.")
        return

    supabase = None if args.dry_run else create_client(url, key)
    ok = 0
    errors = 0
    seen_dates: set[str] = set()

    for mid in message_ids:
        msj = (
            service.users()
            .messages()
            .get(userId="me", id=mid, format="full")
            .execute()
        )
        headers = {h["name"].lower(): h["value"] for h in msj.get("payload", {}).get("headers", [])}
        subject = headers.get("subject", "")
        body = extract_body(msj.get("payload", {}))
        if not body:
            print(f"SKIP {mid}: sin cuerpo")
            errors += 1
            continue
        try:
            parsed = parse_infocaja_text(body, subject=subject)
        except ValueError as exc:
            print(f"SKIP {mid}: {exc}")
            errors += 1
            continue

        # Evitar duplicar el mismo día si hay reenvíos
        if parsed["date"] in seen_dates:
            print(f"SKIP {parsed['date']}: ya procesado en esta corrida")
            continue
        seen_dates.add(parsed["date"])

        venta = parsed["fields"]["Venta Total"]
        print(f"OK {parsed['date']}: Venta Total=${venta:,.2f}")

        if args.dry_run:
            ok += 1
            continue

        n = upsert_day(supabase, parsed)
        print(f"  → {n} filas en Supabase ({SOURCE_FILE})")
        ok += 1

    print(f"\nResumen: ok={ok}, errores={errors}, días únicos={len(seen_dates)}")
    print(f"Hoy: {date.today().isoformat()} — recarga http://localhost:3000")


if __name__ == "__main__":
    main()
