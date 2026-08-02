"""
Sincroniza fuentes de "Saldos al día" → Supabase:
  1) Saldo efectivo (FLUJO EFECTIVO CARRANZA 50.xlsx)
  2) Cuentas por pagar (Google Sheet CXP)

Pensado para Actions cada hora (sync-saldos.yml · :07 CDMX) o Programador local.
Bancos (Mifel/BBVA) salen del presupuesto mensual y no se refrescan aquí.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent


def run(script: str, extra: list[str] | None = None) -> int:
    cmd = [sys.executable, str(BASE / script), *(extra or [])]
    print(f"\n>>> {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(BASE))


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
    print("\nSync Saldos al dia completo.")


if __name__ == "__main__":
    main()
