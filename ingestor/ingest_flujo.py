"""
Legacy wrapper: la ingesta línea a línea del flujo de efectivo vive en
ingest_saldos_flujo.py → source_file=flujo_efectivo_mov (junto con saldo y semanas).

Usa:
  python ingest_saldos_flujo.py --year 2026
  python ingest_saldos_flujo.py              # todos los años
"""

from __future__ import annotations

import argparse
import sys

from ingest_saldos_flujo import main as saldos_main


def main() -> None:
    # Reenvía a ingest_saldos_flujo (incluye saldo + semana + movimientos).
    # Mantiene --year / --file / --dry-run compatibles.
    parser = argparse.ArgumentParser(
        description="[wrapper] Ingesta flujo de efectivo → flujo_efectivo_mov (+ saldo/semana)"
    )
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--file", type=str, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args, _unknown = parser.parse_known_args()

    argv = [sys.argv[0]]
    if args.year is not None:
        argv += ["--year", str(args.year)]
    if args.file:
        argv += ["--file", args.file]
    if args.dry_run:
        argv.append("--dry-run")
    sys.argv = argv
    saldos_main()


if __name__ == "__main__":
    main()
