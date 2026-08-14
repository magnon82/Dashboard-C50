"""Audit flujo_efectivo_semana SEM5 dual-bucket spill for 2025–2026."""
from __future__ import annotations

import json
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestor"))

from ingest_saldos_flujo import (  # noqa: E402
    first_monday_on_or_after,
    prev_month_sem5_alias,
)


def load_env() -> dict[str, str]:
    vals: dict[str, str] = {}
    for name in (".env.local", ".env"):
        p = ROOT / name
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def get(url: str, key: str, path_q: str):
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{path_q}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def parse_desc(d):
    if isinstance(d, str):
        try:
            return json.loads(d)
        except Exception:
            return None
    return d if isinstance(d, dict) else None


def main() -> None:
    print("=== Months where next SEM1 == prev SEM5 (dual-bucket needed) ===")
    spill_months: list[tuple[int, int, int, int, str]] = []
    for y in (2025, 2026):
        for m in range(1, 13):
            ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
            alias = prev_month_sem5_alias(ny, nm, 1)
            mon = first_monday_on_or_after(ny, nm, 1)
            pstart = first_monday_on_or_after(y, m, 1)
            next_m_start = first_monday_on_or_after(ny, nm, 1)
            n_sem = (next_m_start - pstart).days // 7
            has_spill = alias == (y, m, 5)
            flag = "SPILL->SEM5" if has_spill else f"{n_sem}w"
            if has_spill:
                spill_months.append((y, m, ny, nm, mon.isoformat()))
            print(
                f"  {y}-{m:02d}: weeks_to_next_mon={n_sem} {flag} "
                f"next_sem1_mon={mon.isoformat()} alias={alias}"
            )

    print("\nSpill months:", spill_months)

    vals = load_env()
    url = vals.get("NEXT_PUBLIC_SUPABASE_URL") or vals.get("SUPABASE_URL")
    key = vals.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Missing Supabase env")

    rows = get(
        url,
        key,
        "financial_records?select=date,amount,category,description"
        "&source_file=eq.flujo_efectivo_semana"
        "&date=gte.2025-01-01&date=lte.2026-12-01"
        "&order=date",
    )
    print(f"\n=== DB flujo_efectivo_semana rows: {len(rows)} ===")

    by_month: dict[tuple[int, int], dict[int, dict]] = defaultdict(dict)
    for r in rows:
        d = parse_desc(r.get("description"))
        if not d:
            continue
        w = int(d.get("week") or 0)
        y = int(d.get("year") or 0) or int(r["date"][:4])
        m = int(d.get("month") or 0) or int(r["date"][5:7])
        by_month[(y, m)][w] = {
            "ing": d.get("efectivo_ingresos"),
            "egr": d.get("efectivo_egresos"),
            "neto": d.get("efectivo_neto"),
            "date": r["date"],
        }

    broken: list[str] = []
    ok_spill: list[str] = []
    print("\nMonth week presence:")
    for y in (2025, 2026):
        for m in range(1, 13):
            weeks = by_month.get((y, m), {})
            if not weeks and y == 2026 and m > 8:
                continue
            wklist = sorted(weeks.keys())
            has5 = 5 in weeks
            ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
            needs5 = prev_month_sem5_alias(ny, nm, 1) == (y, m, 5)
            next_sem1 = by_month.get((ny, nm), {}).get(1)
            status = "ok"
            if needs5 and not has5:
                if next_sem1:
                    status = "BROKEN: missing SEM5 but next SEM1 exists"
                    broken.append(f"{y}-{m:02d}")
                else:
                    status = "MISSING SEM5 (no next SEM1 either)"
                    broken.append(f"{y}-{m:02d}")
            elif needs5 and has5:
                status = "OK (spill dual-bucket present)"
                ok_spill.append(f"{y}-{m:02d}")
            elif has5 and not needs5:
                status = "has SEM5 (unexpected?)"
            print(f"  {y}-{m:02d}: weeks={wklist} needs5={needs5} {status}")
            if needs5 and has5:
                s5 = weeks[5]
                print(
                    f"         SEM5 ing={s5['ing']} egr={s5['egr']} neto={s5['neto']}"
                )
                if next_sem1:
                    print(
                        f"         next SEM1 ing={next_sem1['ing']} "
                        f"egr={next_sem1['egr']} neto={next_sem1['neto']}"
                    )
                    match = (
                        s5["ing"] == next_sem1["ing"]
                        and s5["egr"] == next_sem1["egr"]
                    )
                    print(f"         SEM5==nextSEM1? {match}")

    print("\n=== SUMMARY ===")
    print("spill_months_calendar:", [f"{y}-{m:02d}" for y, m, *_ in spill_months])
    print("ok_spill:", ok_spill)
    print("broken:", broken)


if __name__ == "__main__":
    main()
