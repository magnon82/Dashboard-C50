"""
Sincroniza desde Gmail → Supabase (solo ventana reciente):
  1) Infocaja Fin de Día (ventas diarias)
  2) CORTE CARRANZA (cancelaciones y descuentos)

Por defecto solo descarga los últimos 3 meses (~90 días).
Los días obtenidos se hacen upsert en Supabase como datos definitivos
(reemplazan el día si ya existía). El histórico previo en BD no se toca.

Uso típico:
  python sync_gmail_diario.py
  python sync_gmail_diario.py --newer-than 90
  python sync_gmail_diario.py --after 2026/05/01

Requiere ingestor/credentials.json + token.json (OAuth Gmail).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent

# ~3 meses calendario
DEFAULT_NEWER_THAN_DAYS = 90


def run(script: str, extra: list[str]) -> int:
    cmd = [sys.executable, str(BASE / script), *extra]
    print(f"\n>>> {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(BASE))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync Gmail Infocaja + CORTE → Supabase (solo últimos N días / after)"
    )
    parser.add_argument(
        "--after",
        default=None,
        help="Gmail after:YYYY/MM/DD (si se omite, usa --newer-than)",
    )
    parser.add_argument(
        "--newer-than",
        type=int,
        default=DEFAULT_NEWER_THAN_DAYS,
        help=f"Solo últimos N días (default {DEFAULT_NEWER_THAN_DAYS} ≈ 3 meses)",
    )
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

    print(
        "Modo: solo ventana reciente -> upsert definitivo en Supabase. "
        "No se re-descarga el historico completo."
    )

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
