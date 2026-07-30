"""
Sincroniza desde Gmail → Supabase:
  1) Infocaja Fin de Día (ventas diarias)
  2) CORTE CARRANZA (cancelaciones y descuentos)

Uso típico (diario):
  python sync_gmail_diario.py --newer-than 7

Requiere ingestor/credentials.json + token.json (OAuth Gmail).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent


def run(script: str, extra: list[str]) -> int:
    cmd = [sys.executable, str(BASE / script), *extra]
    print(f"\n>>> {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(BASE))


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Gmail Infocaja + CORTE → Supabase")
    parser.add_argument("--after", default=None)
    parser.add_argument("--newer-than", type=int, default=7)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-infocaja", action="store_true")
    parser.add_argument("--skip-corte", action="store_true")
    args = parser.parse_args()

    common: list[str] = []
    if args.after:
        common += ["--after", args.after]
    else:
        common += ["--newer-than", str(args.newer_than)]
    if args.dry_run:
        common.append("--dry-run")

    codes = []
    if not args.skip_infocaja:
        codes.append(run("ingest_infocaja_gmail.py", common))
    if not args.skip_corte:
        codes.append(run("ingest_corte_gmail.py", common))

    failed = [c for c in codes if c != 0]
    if failed:
        raise SystemExit(f"Fallaron {len(failed)} paso(s)")
    print("\nSync Gmail completo.")


if __name__ == "__main__":
    main()
