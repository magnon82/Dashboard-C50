"""
Ingestor: PRESUPUESTO MENSUAL (hoja TOTAL + SEM n) → financial_records.

source_file:
  - presupuesto_mensual  — gastos por canal (Efectivo/Mifel/BBVA) por rubro
  - presupuesto_saldos   — saldo ACTUAL Mifel / BBVA del mes
  - presupuesto_rubro    — presupuesto vs real por rubro (+ canales, padre)
  - presupuesto_semana   — componentes del roll-forward bancario semanal
"""

from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from openpyxl import load_workbook
from supabase import create_client

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

SOURCE_FILE = "presupuesto_mensual"
SOURCE_SALDOS = "presupuesto_saldos"
SOURCE_RUBRO = "presupuesto_rubro"
SOURCE_SEMANA = "presupuesto_semana"

DEFAULT_YEAR_FOLDER = Path(
    r"I:\.shortcut-targets-by-id\1-6eRRMYs_V7qHEjD8GHjQgwFC63ucMPk\PRESUPUESTOS 2026"
)

YEAR_FOLDERS = [
    Path(r"I:\.shortcut-targets-by-id\1dDDnlR8VfbCeaI1Hn0cPg7HBHqfyUJFA\PRESUPUESTOS 2022"),
    Path(r"I:\.shortcut-targets-by-id\1c6J44HPdUaoGKQI8RcRdBtxg-c0HZMAT\PRESUPUESTOS 2023"),
    Path(
        r"I:\.shortcut-targets-by-id\1-2gKQvuVI_3O2N5-uZ2NG51FbQftMqSG\PRESUPUESTOS MENSUALES  2024"
    ),
    Path(
        r"I:\.shortcut-targets-by-id\10X4rPJGf3mGqVWGybos3O11nHD_4e7Cx\PRESUPUESTOS MENSUALES 2025"
    ),
    DEFAULT_YEAR_FOLDER,
]

MONTHS = {
    "ENERO": 1,
    "FEBRERO": 2,
    "FEBRRERO": 2,
    "MARZO": 3,
    "ABRIL": 4,
    "MAYO": 5,
    "JUNIO": 6,
    "JULIO": 7,
    "AGOSTO": 8,
    "SEPTIEMBRE": 9,
    "OCTUBRE": 10,
    "NOVIEMBRE": 11,
    "DICIEMBRE": 12,
}

PARENT_CATEGORIES = {"INSUMOS DE COCINA", "INSUMOS DE BARRA"}

COCINA_CHILDREN = {
    "FRUTAS Y VERDURAS",
    "PROTEINAS",
    "ABARROTES",
    "LACTEOS",
    "PANES, TORTILLAS, POSTRES",
    "AGUA",
}

BARRA_CHILDREN = {
    "DESTILADOS Y VINOS",
    "CERVEZAS",
    "ABARROTES",
    "CAFE",
    "CAFÉ",
    "REFRESCOS, AGUAS Y HIELO",
    "FRUTAS Y VERDURAS",
}

SKIP_NAMES = {
    "GASTOS EN EFECTIVO",
    "GASTOS BANCO MIFEL",
    "GASTOS BANCO BBVA",
    "GASTOS BANCO",
    "EFE",
    "BA",
    "VENTA",
    "INICIAL EFE",
    "INICIAL BANCOS",
    "FINAL BANCOS",
    "FINAL EFE",
}

STREAMS = (
    (0, 1, "Efectivo"),
    (3, 4, "Mifel"),
    (6, 7, "BBVA"),
)

ALL_SOURCES = (SOURCE_FILE, SOURCE_SALDOS, SOURCE_RUBRO, SOURCE_SEMANA)


def parse_month_year(filename: str) -> tuple[int, int] | None:
    upper = filename.upper()
    year_m = re.search(r"(20\d{2})", upper)
    if not year_m:
        return None
    year = int(year_m.group(1))
    for name, num in MONTHS.items():
        if name in upper:
            return year, num
    return None


def as_amount(value) -> float | None:
    if value is None or isinstance(value, str):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def money_or_0(value) -> float:
    v = as_amount(value)
    return 0.0 if v is None else float(v)


def norm_cat(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip())


def norm_rubro_key(name: str) -> str:
    """Match frontend: strip accents, upper, collapse non-alnum."""
    nfkd = unicodedata.normalize("NFD", name)
    plain = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]+", " ", plain.upper()).strip()


def rubro_merge_key(rubro: str, parent: str | None) -> str:
    return f"{parent or ''}::{norm_rubro_key(rubro)}"


def months_in_recent_window(days: int, today: date | None = None) -> set[tuple[int, int]]:
    """Year/month pairs overlapping the last `days` calendar days."""
    today = today or date.today()
    start = today - timedelta(days=max(days, 1))
    out: set[tuple[int, int]] = set()
    cur = date(start.year, start.month, 1)
    end = date(today.year, today.month, 1)
    while cur <= end:
        out.add((cur.year, cur.month))
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return out


def extract_saldos_from_total(rows: list, year: int, month: int, month_label: str) -> list[dict]:
    if len(rows) < 2:
        return []

    month_date = f"{year:04d}-{month:02d}-01"
    records: list[dict] = []

    r2 = list(rows[1]) + [None] * 19
    mifel = as_amount(r2[14])  # O
    if mifel is not None and mifel != 0:
        records.append(
            {
                "date": month_date,
                "type": "income",
                "category": "Saldo Mifel",
                "amount": abs(mifel),
                "description": f"{month_label} · MIFEL ACTUAL",
                "source_file": SOURCE_SALDOS,
            }
        )

    bbva = None
    for i, row in enumerate(rows):
        cells = list(row) + [None] * 19
        label = str(cells[14] or "").strip().upper()
        if label == "BBVA":
            for j in range(i + 1, min(i + 6, len(rows))):
                c2 = list(rows[j]) + [None] * 19
                val = as_amount(c2[14])
                if val is not None:
                    bbva = val
                    break
            break

    if bbva is not None and bbva != 0:
        records.append(
            {
                "date": month_date,
                "type": "income",
                "category": "Saldo BBVA",
                "amount": abs(bbva),
                "description": f"{month_label} · BBVA ACTUAL",
                "source_file": SOURCE_SALDOS,
            }
        )

    return records


def detect_parent(rubro: str, row_idx: int, last_parent: str | None) -> tuple[str | None, str | None]:
    """Returns (parent_for_this_row, new_last_parent)."""
    upper = rubro.upper()
    if upper in PARENT_CATEGORIES:
        return None, upper
    if last_parent == "INSUMOS DE COCINA":
        if upper in COCINA_CHILDREN or upper.startswith("PANES"):
            return last_parent, last_parent
        if upper in PARENT_CATEGORIES:
            return None, upper
        # left cocina block when we hit a top-level non-child
        if upper not in BARRA_CHILDREN:
            return None, None
    if last_parent == "INSUMOS DE BARRA":
        if upper in BARRA_CHILDREN or upper in {"CAFE", "CAFÉ"}:
            return last_parent, last_parent
        return None, None
    return None, last_parent


def extract_rubros(
    rows: list, year: int, month: int, month_label: str
) -> tuple[list[dict], list[dict], dict]:
    """Channel expenses + rubro resumen. Also returns meta totals."""
    month_date = f"{year:04d}-{month:02d}-01"
    channel_rows: list[dict] = []
    rubro_rows: list[dict] = []
    meta = {"venta": 0.0, "efe": 0.0, "ba": 0.0}

    last_parent: str | None = None
    seen_barra_parent = False

    for i, row in enumerate(rows[:55]):
        if i == 0:
            continue
        cells = list(row) + [None] * 12

        # Footer meta
        a = str(cells[0] or "").strip().lower()
        if a in ("venta",):
            meta["venta"] = money_or_0(cells[1])
        elif a in ("efe", "inicial efe"):
            meta["efe"] = money_or_0(cells[1])
        elif a in ("ba", "inicial bancos"):
            meta["ba"] = money_or_0(cells[1])
        elif "final bancos" in str(cells[9] or "").strip().lower():
            meta["ba"] = money_or_0(cells[10])

        # Resolve rubro name: prefer Mifel label, then Efectivo, then BBVA
        name_m = cells[3]
        name_e = cells[0]
        name_b = cells[6]
        raw = name_m or name_e or name_b
        if not raw:
            continue
        rubro = norm_cat(str(raw))
        upper = rubro.upper()
        if upper in SKIP_NAMES:
            continue

        # Track parent sections by row order on Efectivo/Mifel columns
        e_name = norm_cat(str(name_e)) if name_e else ""
        e_upper = e_name.upper()
        if e_upper in PARENT_CATEGORIES:
            last_parent = e_upper
            if e_upper == "INSUMOS DE BARRA":
                seen_barra_parent = True
            parent = None
            is_parent = True
            rubro = e_name
        elif last_parent == "INSUMOS DE COCINA" and (
            e_upper in COCINA_CHILDREN or e_upper.startswith("PANES")
        ):
            parent = "INSUMOS DE COCINA"
            is_parent = False
            rubro = e_name or rubro
        elif last_parent == "INSUMOS DE BARRA" and (
            e_upper in BARRA_CHILDREN or e_upper in {"CAFE", "CAFÉ"} or upper in BARRA_CHILDREN
        ):
            parent = "INSUMOS DE BARRA"
            is_parent = False
            # Prefer efectivo name when present for barra children
            rubro = e_name or rubro
        else:
            if e_upper and e_upper not in COCINA_CHILDREN and e_upper not in BARRA_CHILDREN:
                if last_parent == "INSUMOS DE COCINA" and e_upper != "INSUMOS DE BARRA":
                    # still in cocina until barra parent or other major section
                    if e_upper.startswith("INSUMOS"):
                        last_parent = e_upper if e_upper in PARENT_CATEGORIES else None
                    elif money_or_0(cells[9]) or money_or_0(cells[10]) or name_e:
                        # top-level rubro (COMIDA PERSONAL, etc.)
                        last_parent = None
            parent = None
            is_parent = upper in PARENT_CATEGORIES
            if is_parent:
                last_parent = upper

        efectivo = money_or_0(cells[1]) if name_e else money_or_0(cells[1]) if cells[1] else 0.0
        mifel = money_or_0(cells[4])
        bbva = money_or_0(cells[7])
        # If only Mifel/BBVA columns have the name for this row
        if name_e and not name_m and not name_b:
            mifel = 0.0
            bbva = 0.0
            efectivo = money_or_0(cells[1])
        else:
            efectivo = money_or_0(cells[1]) if name_e else 0.0
            mifel = money_or_0(cells[4]) if name_m else 0.0
            bbva = money_or_0(cells[7]) if name_b else 0.0
            # When names repeat across streams on same row, take all three
            if name_e and name_m and name_b:
                efectivo = money_or_0(cells[1])
                mifel = money_or_0(cells[4])
                bbva = money_or_0(cells[7])

        presupuesto = money_or_0(cells[9])  # J
        real_k = money_or_0(cells[10])  # K
        pct = as_amount(cells[8])  # I
        real = real_k if real_k else (efectivo + mifel + bbva)

        # Skip empty noise rows (keep children under a parent even if 0)
        if (
            not is_parent
            and parent is None
            and efectivo == 0
            and mifel == 0
            and bbva == 0
            and presupuesto == 0
            and real == 0
        ):
            continue
        if not is_parent and parent and efectivo == 0 and mifel == 0 and bbva == 0 and real == 0:
            # still keep known zero children for expand UI
            pass
        payload = {
            "rubro": rubro,
            "efectivo": efectivo,
            "mifel": mifel,
            "bbva": bbva,
            "presupuesto": presupuesto,
            "real": real,
            "pct": pct,
            "parent": parent,
            "isParent": is_parent,
            "sort": i,
        }
        rubro_rows.append(payload)

        if not is_parent:
            for canal, amount in (
                ("Efectivo", efectivo),
                ("Mifel", mifel),
                ("BBVA", bbva),
            ):
                if amount == 0:
                    continue
                channel_rows.append(
                    {
                        "date": month_date,
                        "type": "expense",
                        "category": f"{canal}: {rubro}",
                        "amount": amount,
                        "description": f"{month_label} · {canal} · {rubro}",
                        "source_file": SOURCE_FILE,
                    }
                )

    # Merge Excel split rows (same rubro across Efectivo/Mifel/BBVA) → 1 row
    merged: dict[str, dict] = {}
    for p in rubro_rows:
        key = rubro_merge_key(p["rubro"], p["parent"])
        if key not in merged:
            merged[key] = dict(p)
            continue
        cur = merged[key]
        cur["efectivo"] = float(cur["efectivo"]) + float(p["efectivo"])
        cur["mifel"] = float(cur["mifel"]) + float(p["mifel"])
        cur["bbva"] = float(cur["bbva"]) + float(p["bbva"])
        cur["presupuesto"] = float(cur["presupuesto"]) + float(p["presupuesto"])
        cur["real"] = float(cur["real"]) + float(p["real"])
        if p.get("pct") is not None and cur.get("pct") is None:
            cur["pct"] = p["pct"]
        cur["sort"] = min(int(cur["sort"]), int(p["sort"]))
        if p.get("isParent"):
            cur["isParent"] = True
            cur["parent"] = None

    out_rubros: list[dict] = []
    for p in sorted(merged.values(), key=lambda x: int(x["sort"])):
        real = float(p["real"])
        if not real:
            real = float(p["efectivo"]) + float(p["mifel"]) + float(p["bbva"])
            p["real"] = real
        out_rubros.append(
            {
                "date": month_date,
                "type": "expense",
                "category": p["rubro"],
                "amount": real,
                "description": json.dumps(p, ensure_ascii=False),
                "source_file": SOURCE_RUBRO,
            }
        )

    # Month meta row
    out_rubros.append(
        {
            "date": month_date,
            "type": "income",
            "category": "__meta__",
            "amount": meta["venta"] or 0,
            "description": json.dumps({"meta": True, **meta}, ensure_ascii=False),
            "source_file": SOURCE_RUBRO,
        }
    )

    return channel_rows, out_rubros, meta


def extract_week_bank_components(wb, year: int, month: int) -> list[dict]:
    """Build per-week bank roll-forward components from SEM sheets + TOTAL right panel."""
    month_date = f"{year:04d}-{month:02d}-01"
    if "TOTAL" not in wb.sheetnames:
        return []

    total_rows = [
        list(r) + [None] * 20
        for r in wb["TOTAL"].iter_rows(max_row=45, max_col=20, values_only=True)
    ]

    # Mifel inicial (fila 2, col M) / BBVA inicial (bloque inferior)
    mifel_inicial = money_or_0(total_rows[1][12]) if len(total_rows) > 1 else 0.0
    bbva_inicial = 0.0
    for i, cells in enumerate(total_rows):
        if str(cells[14] or "").strip().upper() != "BBVA":
            continue
        for j in range(i + 1, min(i + 6, len(total_rows))):
            val = as_amount(total_rows[j][12])
            if val is not None:
                bbva_inicial = float(val)
                break
        break
    # Weekly ventas/comisiones Mifel (rows where L=SEM n around row 5+)
    mifel_weeks: dict[int, dict] = {}
    bbva_weeks: dict[int, dict] = {}
    # Anticipos: col M = entradas (van en ingresos), col N = salidas (fila inversiones)
    mifel_inv_in: dict[int, float] = {}
    mifel_inv_out: dict[int, float] = {}
    bbva_inv_in: dict[int, float] = {}
    bbva_inv_out: dict[int, float] = {}

    in_bbva = False
    for idx, cells in enumerate(total_rows):
        if str(cells[14] or "").strip().upper() == "BBVA":
            in_bbva = True
        lab = str(cells[11] or "").strip().upper()
        m = re.match(r"SEM\s*(\d+)$", lab)
        if m:
            w = int(m.group(1))
            entry = {
                "ventas": money_or_0(cells[12]) + money_or_0(cells[13]),  # M + N
                "comisiones": money_or_0(cells[14]) + money_or_0(cells[15]),  # O + P
            }
            if in_bbva:
                bbva_weeks[w] = entry
            else:
                mifel_weeks[w] = entry

        ant = re.match(r"ANTICIPOS SEM\s*(\d+)", lab)
        if ant:
            w = int(ant.group(1))
            entrada = money_or_0(cells[12])  # M
            salida = money_or_0(cells[13])  # N
            if in_bbva:
                bbva_inv_in[w] = bbva_inv_in.get(w, 0) + entrada
                bbva_inv_out[w] = bbva_inv_out.get(w, 0) + salida
            else:
                mifel_inv_in[w] = mifel_inv_in.get(w, 0) + entrada
                mifel_inv_out[w] = mifel_inv_out.get(w, 0) + salida

    # SEM sheet bank pagos — incluir toda hoja SEM n existente (aunque esté en ceros)
    week_pagos: dict[int, dict] = {}
    for n in range(1, 6):
        name = f"SEM {n}"
        if name not in wb.sheetnames:
            continue
        ws = wb[name]
        r1 = list(next(ws.iter_rows(min_row=1, max_row=1, max_col=8, values_only=True))) + [
            None
        ] * 8
        week_pagos[n] = {
            "pagos_mifel": money_or_0(r1[4]),
            "pagos_bbva": money_or_0(r1[7]),
        }

    weeks = sorted(week_pagos.keys())
    if not weeks:
        return []

    inicial = mifel_inicial + bbva_inicial
    records: list[dict] = []
    for w in weeks:
        mp = week_pagos.get(w, {"pagos_mifel": 0.0, "pagos_bbva": 0.0})
        mv = mifel_weeks.get(w, {"ventas": 0.0, "comisiones": 0.0})
        bv = bbva_weeks.get(w, {"ventas": 0.0, "comisiones": 0.0})
        # Entradas de anticipos se suman a ingresos (como en la tabla resumen)
        ingresos = (
            mv["ventas"]
            + bv["ventas"]
            + mifel_inv_in.get(w, 0.0)
            + bbva_inv_in.get(w, 0.0)
        )
        comisiones = mv["comisiones"] + bv["comisiones"]
        inversiones = mifel_inv_out.get(w, 0.0) + bbva_inv_out.get(w, 0.0)
        pagos_mifel = mp["pagos_mifel"]
        pagos_bbva = mp["pagos_bbva"]

        suma_ingreso = inicial + ingresos
        suma_gasto = pagos_mifel + comisiones + pagos_bbva + inversiones
        total = suma_ingreso - suma_gasto

        payload = {
            "week": w,
            "inicial": inicial,
            "ingresos": ingresos,
            "pagos_mifel": pagos_mifel,
            "comisiones": comisiones,
            "pagos_bbva": pagos_bbva,
            "inversiones": inversiones,
            "suma_ingreso": suma_ingreso,
            "suma_gasto": suma_gasto,
            "total": total,
        }
        records.append(
            {
                "date": month_date,
                "type": "expense",
                "category": f"Semana {w}",
                "amount": total,
                "description": json.dumps(payload, ensure_ascii=False),
                "source_file": SOURCE_SEMANA,
            }
        )
        inicial = total

    return records


def extract_from_workbook(path: Path) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    parsed = parse_month_year(path.name)
    if not parsed:
        raise ValueError(f"No se pudo inferir mes/año de: {path.name}")
    year, month = parsed
    month_label = path.stem.strip()

    wb = load_workbook(path, read_only=True, data_only=True)
    if "TOTAL" not in wb.sheetnames:
        wb.close()
        raise ValueError(f"Sin hoja TOTAL en {path.name}. Hojas: {wb.sheetnames}")

    total_rows = [
        list(r)
        for r in wb["TOTAL"].iter_rows(max_row=60, max_col=20, values_only=True)
    ]

    saldos = extract_saldos_from_total(total_rows, year, month, month_label)
    channel_rows, rubro_rows, _meta = extract_rubros(total_rows, year, month, month_label)
    week_rows = extract_week_bank_components(wb, year, month)
    wb.close()
    return channel_rows, saldos, rubro_rows, week_rows


def find_budget_files(folder: Path) -> list[Path]:
    return sorted(
        p
        for p in folder.glob("PRESUPUESTO*.xlsx")
        if "FLUJO" not in p.name.upper()
    )


def find_all_budget_files(folders: list[Path]) -> list[Path]:
    files: list[Path] = []
    for folder in folders:
        if not folder.exists():
            print(f"SKIP carpeta (no existe): {folder}")
            continue
        found = find_budget_files(folder)
        print(f"{folder.name}: {len(found)} archivos")
        files.extend(found)
    return files


def chunked(items: list[dict], size: int = 200):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingesta presupuesto mensual → Supabase")
    parser.add_argument(
        "--folder",
        type=Path,
        default=None,
        help="Una sola carpeta. Si se omite, ingiere 2022–2026.",
    )
    parser.add_argument("--file", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Wipe + reload de todos los años (2022–2026). Por defecto solo ~30 días.",
    )
    parser.add_argument(
        "--recent-days",
        type=int,
        default=40,
        help="Meses a refrescar (ventana en días). Default 40. Ignorado con --full.",
    )
    args = parser.parse_args()

    recent_months: set[tuple[int, int]] | None = None
    if not args.full and not args.file:
        recent_months = months_in_recent_window(args.recent_days)
        print(
            f"Modo incremental (~{args.recent_days}d): meses "
            + ", ".join(f"{y}-{m:02d}" for y, m in sorted(recent_months))
        )

    if args.file:
        files = [args.file]
    elif args.folder:
        files = find_budget_files(args.folder)
    else:
        files = find_all_budget_files(YEAR_FOLDERS)

    if recent_months is not None:
        filtered: list[Path] = []
        for path in files:
            parsed = parse_month_year(path.name)
            if parsed and parsed in recent_months:
                filtered.append(path)
            elif parsed:
                continue
            else:
                print(f"SKIP (mes no parseable): {path.name}")
        files = filtered

    if not files:
        raise SystemExit("No hay archivos PRESUPUESTO*.xlsx para ingerir")

    all_channel: list[dict] = []
    all_saldos: list[dict] = []
    all_rubros: list[dict] = []
    all_weeks: list[dict] = []

    for path in files:
        if not path.exists():
            print(f"SKIP (no existe): {path}")
            continue
        try:
            channels, saldos, rubros, weeks = extract_from_workbook(path)
        except Exception as exc:
            print(f"ERROR {path.name}: {exc}")
            continue
        print(
            f"{path.name}: canales={len(channels)} rubros={len(rubros)} "
            f"semanas={len(weeks)} saldos={len(saldos)}"
        )
        all_channel.extend(channels)
        all_saldos.extend(saldos)
        all_rubros.extend(rubros)
        all_weeks.extend(weeks)

    combined = all_channel + all_saldos + all_rubros + all_weeks
    print(f"TOTAL registros: {len(combined)}")

    if args.dry_run:
        print("Dry-run: no se escribió nada.")
        if all_rubros:
            print("Ejemplo rubro:", all_rubros[0])
        if all_weeks:
            print("Ejemplo semana:", all_weeks[0])
        # Dedup sanity: count categories per month
        from collections import Counter

        cats = Counter()
        for r in all_rubros:
            if r["category"] == "__meta__":
                continue
            try:
                payload = json.loads(r["description"])
                parent = payload.get("parent") or ""
            except Exception:
                parent = ""
            cats[f"{r['date']}:{parent}:{r['category']}"] += 1
        dups = {k: v for k, v in cats.items() if v > 1}
        print(f"Rubros duplicados post-merge: {len(dups)}")
        for k, v in list(dups.items())[:10]:
            print(f"  {k} x{v}")
        return

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        raise SystemExit("Faltan credenciales Supabase en .env / .env.local")

    supabase = create_client(url, key)

    if args.full or args.file:
        for src in ALL_SOURCES:
            if args.file:
                # Single-file: delete only that month's rows for each source
                parsed = parse_month_year(args.file.name)
                if parsed:
                    y, m = parsed
                    month_date = f"{y:04d}-{m:02d}-01"
                    (
                        supabase.table("financial_records")
                        .delete()
                        .eq("source_file", src)
                        .eq("date", month_date)
                        .execute()
                    )
                    print(f"Limpieza {src} {month_date}: OK")
                else:
                    supabase.table("financial_records").delete().eq("source_file", src).execute()
                    print(f"Limpieza {src}: OK")
            else:
                supabase.table("financial_records").delete().eq("source_file", src).execute()
                print(f"Limpieza {src}: OK")
    else:
        # Incremental: delete only months in the window
        assert recent_months is not None
        for y, m in sorted(recent_months):
            month_date = f"{y:04d}-{m:02d}-01"
            for src in ALL_SOURCES:
                (
                    supabase.table("financial_records")
                    .delete()
                    .eq("source_file", src)
                    .eq("date", month_date)
                    .execute()
                )
            print(f"Limpieza meses {month_date}: OK")

    inserted = 0
    for batch in chunked(combined, 200):
        result = supabase.table("financial_records").insert(batch).execute()
        inserted += len(result.data or [])

    print(f"Insertados: {inserted}")


if __name__ == "__main__":
    main()
