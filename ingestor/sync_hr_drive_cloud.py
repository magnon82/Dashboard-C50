"""
Soft-sync RR.HH. en la nube (GitHub Actions):
  - Cuenta inventario operativo en tablas hr_* (Supabase).
  - Upsert de hr_drive_sync_state para tipos clave (heartbeat diario).

No monta Google Drive File Stream. La detección de carpetas nuevas /
import xlsx sigue siendo opcional en PC admin o POST /api/hr/sync (sesión RH).

Uso:
  python sync_hr_drive_cloud.py
  python sync_hr_drive_cloud.py --dry-run

Secrets: NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

# Tipos alineados con app/lib/hr-drive-sync.ts (subset operativo).
CONTENT_DEFS: list[tuple[str, str, str]] = [
    # (content_type, label, table_or_special)
    ("nomina", "Nómina", "hr_payroll_periods"),
    ("horarios", "Horarios", "hr_schedule_weeks"),
    ("expedientes", "Expedientes (índice Altas/Bajas)", "hr_employees"),
    ("biblioteca", "Biblioteca RH (políticas, RIT, perfiles, exámenes)", "hr_doc_links"),
    ("base_datos_personal", "BASE DATOS PERSONAL C50.xlsx", "hr_employees"),
]


def _client():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "Faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
        )
    return create_client(url, key)


def _count(sb, table: str, content_type: str) -> tuple[int | None, str]:
    """Return (count, message)."""
    try:
        q = sb.table(table).select("id", count="exact")
        if content_type == "expedientes":
            # Índices con path Drive vinculados
            q = q.not_.is_("drive_folder_path", "null")
        elif content_type == "biblioteca":
            q = q.eq("active", True)
        res = q.execute()
        n = res.count if res.count is not None else len(res.data or [])
        return n, f"Cloud soft-sync: {n} filas en {table}"
    except Exception as e:  # noqa: BLE001
        return None, f"Error contando {table}: {e}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Soft-sync RH Drive state (cloud)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sb = _client()
    now = datetime.now(timezone.utc).isoformat()
    print(f"RH Drive soft-sync @ {now}")
    print(
        "Nota: sin File Stream. Full refresh de carpetas/xlsx = PC admin o /api/hr/sync."
    )

    failed = 0
    for content_type, label, table in CONTENT_DEFS:
        count, message = _count(sb, table, content_type)
        status = "ok" if count is not None else "error"
        if count is None:
            failed += 1
        print(f"  [{status}] {content_type}: {message}")
        if args.dry_run:
            continue
        row = {
            "content_type": content_type,
            "label": label,
            "last_synced_at": now,
            "last_source": "github_actions",
            "last_status": status,
            "last_message": message,
            "row_count": count,
            "updated_at": now,
        }
        try:
            sb.table("hr_drive_sync_state").upsert(
                row, on_conflict="content_type"
            ).execute()
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  !! upsert {content_type}: {e}")
            print(
                "     ¿Ejecutaste supabase/hr_drive_sync.sql en el proyecto?"
            )

    if failed:
        raise SystemExit(f"RH soft-sync: {failed} error(es)")
    print("\nRH Drive soft-sync completo.")


if __name__ == "__main__":
    main()
