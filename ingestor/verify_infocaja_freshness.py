"""
Tras Sync Gmail: comprueba que Infocaja en Supabase cubra el día mínimo
según hora CDMX (misma regla que la Suite).

Antes de las 10:00 CDMX solo advierte (madrugada: el Fin de Día a veces
aún no llega). Desde las 10:00 CDMX falla el job si falta ayer (o hoy
desde las 22:00), para no marcar verde un sync incompleto.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from supabase import create_client

CDMX = ZoneInfo("America/Mexico_City")


def today_cdmx(now: datetime | None = None) -> str:
    dt = now or datetime.now(CDMX)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc).astimezone(CDMX)
    else:
        dt = dt.astimezone(CDMX)
    return dt.date().isoformat()


def hour_cdmx(now: datetime | None = None) -> int:
    dt = now or datetime.now(CDMX)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc).astimezone(CDMX)
    else:
        dt = dt.astimezone(CDMX)
    return dt.hour


def expected_min(today_iso: str, hour: int) -> str:
    # Fin de Día del día D se sincroniza en madrugada de D+1 (1–6 AM CDMX).
    y, m, d = map(int, today_iso.split("-"))
    prev = datetime(y, m, d, tzinfo=timezone.utc) - timedelta(days=1)
    return prev.date().isoformat()


def max_infocaja_date() -> str | None:
    url = os.environ.get("SUPABASE_URL") or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_URL"
    )
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(
            "Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
        )
    sb = create_client(url, key)
    res = (
        sb.table("financial_records")
        .select("date")
        .eq("source_file", "infocaja")
        .eq("category", "Venta Total")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return str(rows[0].get("date") or "")[:10] or None


def main() -> None:
    today = today_cdmx()
    hour = hour_cdmx()
    need = expected_min(today, hour)
    max_d = max_infocaja_date()
    print(
        f"Infocaja freshness CDMX: hoy={today} hora={hour:02d}:00 "
        f"esperado≥{need} max_bd={max_d or '—'}"
    )

    if not max_d or max_d < need:
        msg = (
            f"Infocaja atrasada: último día {max_d or 'ninguno'} "
            f"(se espera ≥ {need})."
        )
        if hour < 10:
            print(f"::warning::{msg} Aún es madrugada CDMX; el Fin de Día puede llegar después.")
            raise SystemExit(0)
        print(f"::error::{msg}")
        raise SystemExit(1)

    print(f"OK Infocaja al día (último {max_d}).")


if __name__ == "__main__":
    main()
