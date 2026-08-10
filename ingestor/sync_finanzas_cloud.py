"""
Sync cloud de fuentes que antes eran solo manuales (Drive / Sheets):

  1) CxP histórico          → ingest_cxp.py          (Google Sheets)
  2) Presupuesto mensual    → Excel desde Drive      (TOTAL U:Z + SEM)
  3) Estados Mifel/BBVA     → Excel desde Drive      (best-effort)
  4) Acumulado ventas semana → ingest_ventas_semana.py (legacy ≤2025)

Pensado para Actions (sync-finanzas.yml). No toca:
  - saldos_bancos_manual / presupuesto_ajuste / dashboard_auth (solo Suite)
  - índices PDF masivos (siguen reindex en PC o botón admin)
  - ingest_eventos.py (legacy puntual)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from google_auth import (
    download_drive_file_by_id,
    download_drive_file_by_name,
    find_drive_files_by_name_contains,
)

BASE = Path(__file__).resolve().parent

MONTH_ES = {
    1: "ENERO",
    2: "FEBRERO",
    3: "MARZO",
    4: "ABRIL",
    5: "MAYO",
    6: "JUNIO",
    7: "JULIO",
    8: "AGOSTO",
    9: "SEPTIEMBRE",
    10: "OCTUBRE",
    11: "NOVIEMBRE",
    12: "DICIEMBRE",
}


def run(script: str, extra: list[str] | None = None) -> int:
    cmd = [sys.executable, str(BASE / script), *(extra or [])]
    print(f"\n>>> {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(BASE))


def months_to_refresh(today: date | None = None) -> list[tuple[int, int]]:
    """Mes actual + mes anterior (presupuesto suele editarse en el cierre)."""
    today = today or date.today()
    out = [(today.year, today.month)]
    if today.month == 1:
        out.append((today.year - 1, 12))
    else:
        out.append((today.year, today.month - 1))
    return out


def pick_presupuesto_file(year: int, month: int) -> dict | None:
    month_name = MONTH_ES[month]
    # Prefer exact-ish: PRESUPUESTO MENSUAL JULIO 2026
    candidates = find_drive_files_by_name_contains(
        "PRESUPUESTO MENSUAL", month_name, str(year), page_size=20
    )
    # Filtrar .xlsx reales (no Google Sheets shortcut)
    xlsx = [
        f
        for f in candidates
        if str(f.get("name") or "").lower().endswith(".xlsx")
        and "machote" not in str(f.get("name") or "").lower()
    ]
    if not xlsx:
        # fallback sin exigir .xlsx en query
        xlsx = [
            f
            for f in candidates
            if "PRESUPUESTO" in str(f.get("name") or "").upper()
        ]
    if not xlsx:
        return None

    def score(f: dict) -> tuple:
        name = str(f.get("name") or "")
        exact = 0 if re.search(
            rf"PRESUPUESTO\s+MENSUAL\s+{month_name}\s+{year}", name, re.I
        ) else 1
        return (exact, name)

    xlsx.sort(key=score)
    return xlsx[0]


def sync_presupuesto(dry_run: bool) -> int:
    codes: list[int] = []
    tmp = Path(tempfile.mkdtemp(prefix="prep-cloud-"))
    for year, month in months_to_refresh():
        meta = pick_presupuesto_file(year, month)
        if not meta:
            print(f"AVISO: no hay PRESUPUESTO {MONTH_ES[month]} {year} en Drive")
            continue
        name = str(meta["name"])
        dest = tmp / name
        print(f"Descargando presupuesto: {name} (id={meta['id']})")
        download_drive_file_by_id(meta["id"], dest)
        extra = ["--file", str(dest)]
        if dry_run:
            extra.append("--dry-run")
        codes.append(run("ingest_presupuesto.py", extra))
    if not codes:
        print("Presupuesto: nada que ingerir")
        return 0
    return 0 if all(c == 0 for c in codes) else 1


def pick_estado_file(bank: str, year: int) -> dict | None:
    # Nombres típicos: Estado de cuenta MIFEL 2026.xlsx
    needles = [
        ("Estado de cuenta", bank, str(year)),
        ("ESTADO DE CUENTA", bank, str(year)),
        (bank, "Estado", str(year)),
    ]
    for parts in needles:
        found = find_drive_files_by_name_contains(*parts, page_size=15)
        xlsx = [
            f
            for f in found
            if str(f.get("name") or "").lower().endswith((".xlsx", ".xls"))
        ]
        if xlsx:
            return xlsx[0]
    return None


def sync_estados_excel(dry_run: bool) -> int:
    year = date.today().year
    tmp = Path(tempfile.mkdtemp(prefix="estados-cloud-"))
    codes: list[int] = []
    for bank in ("MIFEL", "BBVA"):
        meta = pick_estado_file(bank, year)
        if not meta:
            print(f"AVISO: no hay Excel estado {bank} {year} en Drive (skip)")
            continue
        name = str(meta["name"])
        dest = tmp / name
        print(f"Descargando estado {bank}: {name}")
        download_drive_file_by_id(meta["id"], dest)
        extra = ["--file", str(dest), "--bank", bank.lower(), "--year", str(year)]
        if dry_run:
            extra.append("--dry-run")
        codes.append(run("ingest_estados_cuenta.py", extra))
    if not codes:
        print("Estados Excel: ninguno encontrado en Drive")
        return 0
    return 0 if all(c == 0 for c in codes) else 1


VENTAS_SEMANA_NAME = "Acumulado ventas x semana.xlsx"


def pick_ventas_semana_file() -> dict | None:
    """Nombre exacto preferido; fallback por contains."""
    try:
        # download path resolves id; here we only need meta for logging
        found = find_drive_files_by_name_contains(
            "Acumulado ventas", "semana", page_size=15
        )
    except Exception as e:
        print(f"AVISO: búsqueda ventas_semana falló: {e}")
        found = []
    xlsx = [
        f
        for f in found
        if str(f.get("name") or "").lower().endswith((".xlsx", ".xls"))
    ]
    if not xlsx:
        return None

    def score(f: dict) -> tuple:
        name = str(f.get("name") or "")
        exact = 0 if name.strip().lower() == VENTAS_SEMANA_NAME.lower() else 1
        return (exact, name)

    xlsx.sort(key=score)
    return xlsx[0]


def sync_ventas_semana(dry_run: bool) -> int:
    tmp = Path(tempfile.mkdtemp(prefix="ventas-semana-cloud-"))
    meta = pick_ventas_semana_file()
    dest = tmp / VENTAS_SEMANA_NAME
    if meta:
        name = str(meta["name"])
        dest = tmp / name
        print(f"Descargando ventas_semana: {name} (id={meta['id']})")
        download_drive_file_by_id(meta["id"], dest)
    else:
        print(
            f"AVISO: búsqueda contains vacía; intento nombre exacto {VENTAS_SEMANA_NAME}"
        )
        try:
            download_drive_file_by_name(VENTAS_SEMANA_NAME, dest)
        except FileNotFoundError as e:
            print(f"AVISO: {e} (skip ventas_semana)")
            return 0

    extra = ["--file", str(dest)]
    if dry_run:
        extra.append("--dry-run")
    return run("ingest_ventas_semana.py", extra)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync finanzas Drive/Sheets → Supabase")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-cxp", action="store_true")
    parser.add_argument("--skip-presupuesto", action="store_true")
    parser.add_argument("--skip-estados", action="store_true")
    parser.add_argument("--skip-ventas-semana", action="store_true")
    args = parser.parse_args()

    codes: list[int] = []

    if not args.skip_cxp:
        extra = ["--dry-run"] if args.dry_run else []
        codes.append(run("ingest_cxp.py", extra))

    if not args.skip_presupuesto:
        codes.append(sync_presupuesto(args.dry_run))

    if not args.skip_estados:
        codes.append(sync_estados_excel(args.dry_run))

    if not args.skip_ventas_semana:
        codes.append(sync_ventas_semana(args.dry_run))

    failed = [c for c in codes if c != 0]
    if failed:
        raise SystemExit(f"Fallaron {len(failed)} paso(s) de sync finanzas")
    print("\nSync finanzas cloud completo.")


if __name__ == "__main__":
    main()
