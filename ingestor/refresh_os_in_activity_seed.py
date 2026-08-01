"""
Actualiza solo las filas os_pdf del seed existente (conserva anticipos/seguimiento).

Uso:
  python ingestor/refresh_os_in_activity_seed.py
  python ingestor/refresh_os_in_activity_seed.py --os-dir "I:\\Mi unidad\\Eventos\\Ordenes de servicio"
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_event_client_activity import (  # noqa: E402
    DEFAULT_OS,
    OUT_PATH,
    backfill_os_event_dates,
    load_seed,
    scan_os_folder,
    aggregate,
)


def timeline_from_os_events(os_events: list[dict]) -> list[dict]:
    rows = []
    for ev in os_events:
        rows.append(
            {
                "date": ev["activity_date"],
                "event_date": ev.get("event_date"),
                "source": "os_pdf",
                "label": ev.get("display_name"),
                "detail": ev.get("detail"),
                "folio": ev.get("folio"),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--os-dir", type=Path, default=DEFAULT_OS)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument(
        "--full-reaggregate",
        action="store_true",
        help="Re-agrega OS + eventos no-OS del seed actual vía aggregate()",
    )
    args = parser.parse_args()

    print(f"Escaneando OS: {args.os_dir}")
    os_events = scan_os_folder(args.os_dir)
    if not os_events:
        raise SystemExit("Sin archivos OS — aborto (no se sobrescribe seed)")

    # Reconstruir eventos no-OS desde seed actual + OS fresco
    existing = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else {"clients": []}
    non_os: list[dict] = []
    for c in existing.get("clients") or []:
        company = c.get("company_name")
        for t in c.get("timeline") or []:
            if t.get("source") == "os_pdf":
                continue
            non_os.append(
                {
                    "client_key": c.get("client_key") or "",
                    "display_name": t.get("label") or company,
                    "company_hint": company,
                    "contact_hint": c.get("contact_name"),
                    "email": c.get("email"),
                    "phone": c.get("phone"),
                    "activity_date": t.get("date") or t.get("event_date") or "1970-01-01",
                    "event_date": t.get("event_date"),
                    "source": t.get("source") or "unknown",
                    "detail": t.get("detail"),
                    "folio": t.get("folio"),
                }
            )

    events = list(os_events) + non_os
    backfill_os_event_dates(events)

    seed = load_seed()
    payload = aggregate(events, seed)
    # Preserve prior generated note if useful
    payload["generated_at"] = datetime.now().isoformat(timespec="seconds")
    payload["sources_note"] = existing.get("sources_note") or payload.get("sources_note")
    if isinstance(payload.get("sources_note"), dict):
        note = payload["sources_note"]
        readable = list(note.get("readable") or [])
        tag = "Ordenes de servicio PDF refresh (local Drive)"
        if tag not in readable:
            readable.append(tag)
        note["readable"] = readable

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Verify OS dates
    os_rows = []
    for c in payload["clients"]:
        for t in c.get("timeline") or []:
            if t.get("source") == "os_pdf":
                os_rows.append(t)
    dated = [t for t in os_rows if t.get("event_date")]
    dated.sort(key=lambda t: t["event_date"], reverse=True)
    from collections import Counter

    by_year = Counter((t.get("detail") or "")[:4] for t in os_rows)
    dated_year = Counter((t["event_date"] or "")[:4] for t in dated)
    print(f"OK -> {args.out}")
    print(f"  os_pdf={len(os_rows)} con event_date={len(dated)}")
    print(f"  por carpeta: {dict(sorted(by_year.items()))}")
    print(f"  event_date por año: {dict(sorted(dated_year.items()))}")
    print("  TOP 5 event_date:")
    for t in dated[:5]:
        print(f"    {t['event_date']} | {(t.get('label') or '')[:40]} | {t.get('detail')}")


if __name__ == "__main__":
    main()
