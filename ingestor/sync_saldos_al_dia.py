"""
Sincroniza fuentes de "Saldos al día" → Supabase:
  1) Saldo efectivo (FLUJO EFECTIVO CARRANZA 50.xlsx)
  2) Cuentas por pagar (Google Sheet CXP)

Pensado para Actions cada hora (sync-saldos.yml · :07 CDMX) o Programador local.
Bancos (Mifel/BBVA) salen del presupuesto mensual y no se refrescan aquí.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

BASE = Path(__file__).resolve().parent


def run(script: str, extra: list[str] | None = None) -> int:
    cmd = [sys.executable, str(BASE / script), *(extra or [])]
    print(f"\n>>> {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(BASE))


def _client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
        )
    return create_client(url, key)


def write_heartbeat(*, dry_run: bool = False) -> None:
    now = datetime.now(timezone.utc).isoformat()
    source = "github_actions" if os.environ.get("CI") else "local"
    row = {
        "content_type": "saldos",
        "label": "Saldos al día (flujo + CXP)",
        "last_synced_at": now,
        "last_source": source,
        "last_status": "ok",
        "last_message": "sync_saldos_al_dia completo",
        "updated_at": now,
    }
    if dry_run:
        print(f"  [dry-run] heartbeat finanzas_sync_state: {row}")
        return
    try:
        _client().table("finanzas_sync_state").upsert(
            row, on_conflict="content_type"
        ).execute()
        print(f"  heartbeat finanzas_sync_state @ {now}")
    except Exception as e:  # noqa: BLE001
        print(f"  !! heartbeat finanzas_sync_state: {e}")
        print("     ¿Ejecutaste supabase/finanzas_sync_state.sql en Supabase?")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Saldos al día (efectivo + CXP)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-efectivo", action="store_true")
    parser.add_argument("--skip-cxp", action="store_true")
    parser.add_argument("--year", type=int, default=None, help="Solo un año de flujo")
    args = parser.parse_args()

    common: list[str] = []
    if args.dry_run:
        common.append("--dry-run")

    codes: list[int] = []
    if not args.skip_efectivo:
        extra = list(common)
        if args.year:
            extra += ["--year", str(args.year)]
        codes.append(run("ingest_saldos_flujo.py", extra))
    if not args.skip_cxp:
        codes.append(run("ingest_cxp_por_pagar.py", common))

    failed = [c for c in codes if c != 0]
    if failed:
        raise SystemExit(f"Fallaron {len(failed)} paso(s)")

    write_heartbeat(dry_run=args.dry_run)
    print("\nSync Saldos al dia completo.")


if __name__ == "__main__":
    main()
