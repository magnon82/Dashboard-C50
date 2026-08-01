"""Seed event_clients from supabase/seed_event_clients.json via service role.

Usage (after eventos_module.sql applied):
  python scripts/seed_event_clients.py

Prefer regenerating the JSON first:
  python scripts/import_event_clients_from_excel.py [--seed]

Never prints secrets. Idempotent by company + email/phone/contact.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "supabase" / "seed_event_clients.json"
ENV_PATH = ROOT / ".env.local"


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


def normalize_phone(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float):
        if value != value:
            return None
        value = int(value) if value == int(value) else value
    digits = re.sub(r"\D", "", str(value))
    if len(digits) == 12 and digits.startswith("52"):
        digits = digits[2:]
    return digits or None


def client_identity(company, contact, email, phone) -> str:
    c = (company or "").strip().lower()
    e = (email or "").strip().lower()
    p = normalize_phone(phone) or ""
    n = (contact or "").strip().lower()
    if e:
        return f"{c}|e:{e}"
    if p:
        return f"{c}|p:{p}"
    if n:
        return f"{c}|n:{n}"
    return f"{c}|solo"


def http_json(method: str, url: str, headers: dict[str, str], body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.add_header("Prefer", "return=minimal")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def main() -> int:
    env = load_env(ENV_PATH)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("BLOCKED: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local")
        return 2

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }

    status, existing = http_json(
        "GET",
        f"{url}/rest/v1/event_clients?select=company_name,contact_name,email,phone&limit=5000",
        headers,
    )
    if status != 200 or not isinstance(existing, list):
        print(f"FAIL reading event_clients: status={status} body={str(existing)[:300]}")
        print("Did you run supabase/eventos_module.sql in the SQL Editor?")
        return 1

    have = {
        client_identity(
            r.get("company_name"),
            r.get("contact_name"),
            r.get("email"),
            r.get("phone"),
        )
        for r in existing
    }
    rows = json.loads(SEED.read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc).isoformat()
    to_insert = []
    for r in rows:
        company = (r.get("company") or "").strip()
        if not company:
            continue
        contact = (r.get("contact") or "").strip() or None
        email = (r.get("email") or "").strip() or None
        phone = normalize_phone(r.get("phone"))
        ident = client_identity(company, contact, email, phone)
        if ident in have:
            continue
        to_insert.append(
            {
                "company_name": company,
                "contact_name": contact,
                "email": email,
                "phone": phone,
                "source": "excel_seed",
                "owner_username": "seed",
                "created_at": now,
                "updated_at": now,
            }
        )

    inserted = 0
    chunk = 80
    for i in range(0, len(to_insert), chunk):
        slice_ = to_insert[i : i + chunk]
        st, body = http_json(
            "POST",
            f"{url}/rest/v1/event_clients",
            headers,
            slice_,
        )
        if not (200 <= st < 300):
            print(f"FAIL insert at offset {i}: status={st} body={str(body)[:300]}")
            print(f"partial inserted={inserted}")
            return 1
        inserted += len(slice_)

    print(
        f"OK inserted={inserted} skipped={len(rows) - inserted} "
        f"totalSeed={len(rows)} existingBefore={len(existing)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
