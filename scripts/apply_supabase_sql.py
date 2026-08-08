"""
Apply pending suite SQL to Supabase (local one-shot).

Needs ONE of:
  - DATABASE_URL / DIRECT_URL / POSTGRES_URL in .env.local  → uses psql or pg8000/psycopg
  - SUPABASE_ACCESS_TOKEN (+ project ref from NEXT_PUBLIC_SUPABASE_URL) → Management API

Never prints secrets. Usage:
  python scripts/apply_supabase_sql.py
  python scripts/apply_supabase_sql.py --only eventos
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"

SQL_FILES = {
    "eventos": ROOT / "supabase" / "eventos_module.sql",
    "eventos_leads": ROOT / "supabase" / "eventos_leads_fields.sql",
    "eventos_leads_source": ROOT / "supabase" / "eventos_leads_source.sql",
    "reportes": ROOT / "supabase" / "reportes_socios.sql",
    "tpv": ROOT / "supabase" / "tpv_cortes.sql",
    "hr_nacimiento": ROOT / "supabase" / "hr_employee_nacimiento.sql",
    "reservas": ROOT / "supabase" / "restaurant_reservations.sql",
}

DEFAULT_ORDER = ["eventos", "eventos_leads", "eventos_leads_source", "reportes", "tpv"]


def load_env(path: Path) -> dict[str, str]:
    vals: dict[str, str] = {}
    if not path.exists():
        return vals
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def project_ref(url: str) -> str:
    host = url.replace("https://", "").replace("http://", "").split("/")[0]
    return host.split(".")[0] if host else ""


def http_json(method: str, url: str, headers: dict[str, str], body: dict | None = None, timeout: int = 300):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)


def apply_via_mgmt(access: str, ref: str, sql: str) -> tuple[bool, str]:
    status, body = http_json(
        "POST",
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        {"Authorization": f"Bearer {access}"},
        {"query": sql},
    )
    ok = 200 <= status < 300
    return ok, f"status={status} body={body[:400]}"


def apply_via_psql(db_url: str, sql_path: Path) -> tuple[bool, str]:
    try:
        r = subprocess.run(
            ["psql", db_url, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        out = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()
        return r.returncode == 0, out[:600]
    except FileNotFoundError:
        return False, "psql not installed"


def apply_via_psycopg(db_url: str, sql: str) -> tuple[bool, str]:
    try:
        import psycopg  # type: ignore
    except ImportError:
        try:
            import psycopg2 as psycopg  # type: ignore
        except ImportError:
            return False, "psycopg/psycopg2 not installed"

    try:
        conn = psycopg.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
        finally:
            conn.close()
        return True, "ok"
    except Exception as e:
        return False, str(e)[:400]


def probe_tables(url: str, service: str) -> None:
    headers = {
        "apikey": service,
        "Authorization": f"Bearer {service}",
    }
    for table in (
        "event_menus",
        "event_clients",
        "event_leads",
        "event_quotes",
        "reportes_socios_content",
        "tpv_corte_uploads",
        "restaurant_reservations",
    ):
        status, body = http_json(
            "GET",
            f"{url.rstrip('/')}/rest/v1/{table}?select=*&limit=1",
            headers,
        )
        exists = status == 200
        print(f"  {table}: {'OK' if exists else f'MISSING ({status})'}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--only",
        choices=list(SQL_FILES.keys()) + ["all"],
        default="all",
        help="Which SQL bundle to apply",
    )
    args = parser.parse_args()

    env = load_env(ENV_PATH)
    # Also accept process env overrides
    for k in (
        "DATABASE_URL",
        "DIRECT_URL",
        "POSTGRES_URL",
        "SUPABASE_ACCESS_TOKEN",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
    ):
        if os.environ.get(k):
            env[k] = os.environ[k]

    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    service = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    db_url = env.get("DATABASE_URL") or env.get("DIRECT_URL") or env.get("POSTGRES_URL") or ""
    access = env.get("SUPABASE_ACCESS_TOKEN") or ""
    ref = project_ref(url)

    print(f"Project ref: {ref or '(unknown)'}")
    print(f"Has DATABASE_URL: {bool(db_url)}")
    print(f"Has ACCESS_TOKEN: {bool(access)}")
    print(f"Has SERVICE_ROLE: {bool(service)}")

    if not db_url and not access:
        print()
        print("BLOCKED: need DATABASE_URL (or DIRECT_URL) OR SUPABASE_ACCESS_TOKEN.")
        print("One-shot (Dashboard):")
        print(f"  1. Open https://supabase.com/dashboard/project/{ref or '<ref>'}/sql/new")
        print("  2. Paste & Run:")
        keys = (
            list(SQL_FILES.keys())
            if args.only == "all"
            else [args.only]
        )
        for key in keys:
            print(f"     - {SQL_FILES[key].relative_to(ROOT)}")
        print("  3. Optional CLI later:")
        print("     npx supabase login")
        print("     set SUPABASE_ACCESS_TOKEN=...   # or DATABASE_URL=postgresql://...")
        print(f"     python scripts/apply_supabase_sql.py --only {args.only}")
        if url and service:
            print()
            print("Current table probe:")
            probe_tables(url, service)
        return 2

    keys = DEFAULT_ORDER if args.only == "all" else [args.only]
    failures = 0
    for key in keys:
        path = SQL_FILES[key]
        if not path.exists():
            print(f"SKIP {key}: file missing ({path.name})")
            continue
        sql = path.read_text(encoding="utf-8")
        print(f"Applying {path.relative_to(ROOT)} …")
        if db_url:
            ok, msg = apply_via_psql(db_url, path)
            if not ok and "not installed" in msg:
                ok, msg = apply_via_psycopg(db_url, sql)
        else:
            ok, msg = apply_via_mgmt(access, ref, sql)
        print(f"  {'OK' if ok else 'FAIL'}: {msg[:300]}")
        if not ok:
            failures += 1

    if url and service:
        print()
        print("Post-apply probe:")
        probe_tables(url, service)

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
