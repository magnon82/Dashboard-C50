"""
Importa el Google Sheet «Seguimiento eventos» → event_leads (+ seed JSON).

Uso:
  python scripts/seed_event_leads_from_seguimiento.py              # JSON + Supabase
  python scripts/seed_event_leads_from_seguimiento.py --json-only  # solo escribe seed
  python scripts/seed_event_leads_from_seguimiento.py --dry-run    # cuenta sin escribir DB

Requiere OAuth local: ingestor/credentials.json + token.json
  (mismos scopes que build_event_client_activity.py).

Upsert: no borra leads existentes. Match abierto por
  (client_id + event_date) o (phone + event_date) o (email + event_date)
  o (norm(contact/title) + event_date). Solo actualiza filas con
  source='sheets' (o sin source si la columna aún no existe).

Después del JSON también puedes POST /api/eventos/leads/seed-seguimiento.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INGESTOR = ROOT / "ingestor"
sys.path.insert(0, str(INGESTOR))

from eventos_seguimiento import (  # noqa: E402
    fetch_seguimiento_raw_rows,
    norm,
    normalize_email,
    normalize_phone,
)

SEED_OUT = ROOT / "supabase" / "seed_event_leads_seguimiento.json"
ENV_PATH = ROOT / ".env.local"
OPEN_STAGES = {"nuevo", "contactado", "cotizado", "negociacion"}


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


def http_json(method: str, url: str, headers: dict[str, str], body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def lead_match_keys(row: dict) -> list[str]:
    keys: list[str] = []
    ed = row.get("event_date") or ""
    phone = normalize_phone(row.get("phone")) or ""
    email = normalize_email(row.get("email")) or ""
    client_id = row.get("client_id") or ""
    contact = norm(row.get("contact_name") or row.get("title") or "")
    if client_id and ed:
        keys.append(f"c:{client_id}|d:{ed}")
    if phone and ed:
        keys.append(f"p:{phone}|d:{ed}")
    if email and ed:
        keys.append(f"e:{email}|d:{ed}")
    if contact and ed:
        keys.append(f"n:{contact}|d:{ed}")
    # Sin fecha de evento: phone+stage abierto o email
    if phone and not ed:
        keys.append(f"p:{phone}|d:")
    if email and not ed:
        keys.append(f"e:{email}|d:")
    if contact and not ed:
        keys.append(f"n:{contact}|d:")
    return keys


def match_client(
    row: dict,
    by_email: dict[str, str],
    by_phone: dict[str, str],
    by_company: dict[str, str],
    by_contact: dict[str, str],
) -> str | None:
    email = normalize_email(row.get("email"))
    if email and email in by_email:
        return by_email[email]
    phone = normalize_phone(row.get("phone"))
    if phone and phone in by_phone:
        return by_phone[phone]
    company = norm(row.get("company"))
    if company and company in by_company:
        return by_company[company]
    contact = norm(row.get("contact_name"))
    if contact and contact in by_contact:
        return by_contact[contact]
    # Company-like celebration sometimes matches seed company names
    celeb = norm(row.get("celebration"))
    if celeb and celeb in by_company:
        return by_company[celeb]
    return None


def to_seed_payload(rows: list[dict]) -> list[dict]:
    """JSON compacto para API / revisión humana."""
    out = []
    for r in rows:
        out.append(
            {
                "title": r["title"],
                "celebration": r.get("celebration"),
                "contact_name": r.get("contact_name"),
                "phone": r.get("phone"),
                "email": r.get("email"),
                "company": r.get("company"),
                "stage": r.get("stage") or "nuevo",
                "event_date": r.get("event_date"),
                "pax": r.get("pax"),
                "notes": r.get("notes"),
                "owner_username": r.get("atiende") or "seguimiento",
                "source": "sheets",
                "source_detail": "seguimiento",
                "sheet_row": r.get("sheet_row"),
                "status_raw": r.get("status_raw"),
            }
        )
    return out


def upsert_supabase(seed_rows: list[dict], dry_run: bool) -> int:
    env = load_env(ENV_PATH)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("BLOCKED: need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local")
        return 2

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    st, clients = http_json(
        "GET",
        f"{url}/rest/v1/event_clients?select=id,company_name,contact_name,email,phone&limit=5000",
        headers,
    )
    if st != 200 or not isinstance(clients, list):
        print(f"FAIL event_clients: {st} {str(clients)[:300]}")
        return 1

    by_email: dict[str, str] = {}
    by_phone: dict[str, str] = {}
    by_company: dict[str, str] = {}
    by_contact: dict[str, str] = {}
    for c in clients:
        cid = c["id"]
        e = normalize_email(c.get("email"))
        if e:
            by_email.setdefault(e, cid)
        p = normalize_phone(c.get("phone"))
        if p:
            by_phone.setdefault(p, cid)
        cn = norm(c.get("company_name"))
        if cn:
            by_company.setdefault(cn, cid)
        ct = norm(c.get("contact_name"))
        if ct:
            by_contact.setdefault(ct, cid)

    st, leads = http_json(
        "GET",
        f"{url}/rest/v1/event_leads?select=id,client_id,phone,email,contact_name,title,event_date,stage,source,notes&limit=5000",
        headers,
    )
    has_source_col = True
    if st == 400 and isinstance(leads, str) and "source" in leads.lower():
        # Columna source aún no aplicada
        has_source_col = False
        st, leads = http_json(
            "GET",
            f"{url}/rest/v1/event_leads?select=id,client_id,phone,email,contact_name,title,event_date,stage,notes&limit=5000",
            headers,
        )
    if st != 200 or not isinstance(leads, list):
        print(f"FAIL event_leads: {st} {str(leads)[:300]}")
        return 1

    index: dict[str, dict] = {}
    for lead in leads:
        # Prefer matching against prior sheets imports; still index all for dedupe
        src = (lead.get("source") or "") if has_source_col else ""
        notes = lead.get("notes") or ""
        from_sheets = src == "sheets" or "Status Sheet:" in notes or "seguimiento" in notes.lower()
        probe = {
            "client_id": lead.get("client_id"),
            "phone": lead.get("phone"),
            "email": lead.get("email"),
            "contact_name": lead.get("contact_name") or lead.get("title"),
            "title": lead.get("title"),
            "event_date": lead.get("event_date"),
        }
        for k in lead_match_keys(probe):
            # Sheets wins slot; otherwise first open lead
            if k not in index or from_sheets:
                index[k] = lead

    now = datetime.now(timezone.utc).isoformat()
    to_insert: list[dict] = []
    to_update: list[tuple[str, dict]] = []
    # pending inserts indexed by match key → index in to_insert (dedupe within batch)
    pending_keys: dict[str, int] = {}
    matched_clients = 0
    skipped_junk = 0
    skipped_batch_dup = 0

    for r in seed_rows:
        if not (r.get("title") or r.get("contact_name") or r.get("company")):
            skipped_junk += 1
            continue
        client_id = match_client(r, by_email, by_phone, by_company, by_contact)
        if client_id:
            matched_clients += 1
        payload = {
            "title": r["title"][:200],
            "celebration": r.get("celebration") or r["title"],
            "contact_name": r.get("contact_name"),
            "phone": r.get("phone"),
            "email": r.get("email"),
            "company": r.get("company"),
            "client_id": client_id,
            "stage": r.get("stage") or "nuevo",
            "event_date": r.get("event_date"),
            "pax": r.get("pax"),
            # Monto Sheet es total; estimated_amount del CRM es por persona → no inventar
            "estimated_amount": None,
            "notes": r.get("notes"),
            "owner_username": (r.get("owner_username") or "seguimiento")[:80],
            "updated_at": now,
        }
        if has_source_col:
            payload["source"] = "sheets"

        probe = {**payload, "title": r["title"]}
        keys = lead_match_keys(probe)

        # 1) ¿Ya hay un insert pendiente en este batch con la misma llave?
        pending_idx = None
        for k in keys:
            if k in pending_keys:
                pending_idx = pending_keys[k]
                break
        if pending_idx is not None:
            # Conserva la fila más reciente del Sheet (sobrescribe payload pendiente)
            to_insert[pending_idx] = {**to_insert[pending_idx], **payload}
            for k in keys:
                pending_keys[k] = pending_idx
            skipped_batch_dup += 1
            continue

        # 2) ¿Match contra lead real en DB?
        existing = None
        for k in keys:
            if k in index:
                existing = index[k]
                break

        if existing and isinstance(existing.get("id"), str) and not str(
            existing["id"]
        ).startswith("new-"):
            src = (existing.get("source") or "") if has_source_col else ""
            notes = existing.get("notes") or ""
            from_sheets = src == "sheets" or "Status Sheet:" in notes
            if from_sheets or existing.get("stage") in OPEN_STAGES:
                to_update.append((existing["id"], payload))
            for k in keys:
                index[k] = {**existing, **payload, "id": existing["id"]}
        else:
            payload["created_at"] = now
            if not payload.get("owner_username"):
                payload["owner_username"] = "seguimiento"
            idx = len(to_insert)
            to_insert.append(payload)
            for k in keys:
                pending_keys[k] = idx

    print(
        f"Plan: insert={len(to_insert)} update={len(to_update)} "
        f"batch_dup={skipped_batch_dup} "
        f"client_match={matched_clients}/{len(seed_rows)} junk={skipped_junk} "
        f"source_col={'yes' if has_source_col else 'NO (aplica eventos_leads_source.sql)'}"
    )

    if dry_run:
        print("DRY-RUN: no se escribió a Supabase")
        return 0

    inserted = 0
    chunk = 50
    for i in range(0, len(to_insert), chunk):
        slice_ = to_insert[i : i + chunk]
        st, body = http_json(
            "POST",
            f"{url}/rest/v1/event_leads",
            headers,
            slice_,
        )
        if not (200 <= st < 300):
            print(f"FAIL insert offset {i}: {st} {str(body)[:400]}")
            return 1
        inserted += len(slice_)

    updated = 0
    for lead_id, payload in to_update:
        patch_headers = {
            **headers,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        q = urllib.parse.quote(str(lead_id))
        st, body = http_json(
            "PATCH",
            f"{url}/rest/v1/event_leads?id=eq.{q}",
            patch_headers,
            payload,
        )
        if not (200 <= st < 300):
            print(f"FAIL update {lead_id}: {st} {str(body)[:300]}")
            return 1
        updated += 1

    print(f"Supabase OK inserted={inserted} updated={updated}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=SEED_OUT)
    parser.add_argument("--json-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("Leyendo Google Sheet «Seguimiento eventos»…")
    try:
        raw = fetch_seguimiento_raw_rows()
    except SystemExit as e:
        print(f"BLOCKED OAuth/credenciales: {e}")
        return 2
    except Exception as e:
        print(f"FAIL Sheets: {e}")
        return 1

    # Filas sin ninguna señal útil (sin contacto, sin fecha, sin tel/mail, sin título real)
    useful = []
    skipped = 0
    for r in raw:
        if not r.get("title"):
            skipped += 1
            continue
        if not any(
            [
                r.get("contact_name"),
                r.get("phone"),
                r.get("email"),
                r.get("company"),
                r.get("event_date"),
                r.get("activity_date"),
            ]
        ):
            skipped += 1
            continue
        useful.append(r)

    seed = to_seed_payload(useful)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source": "Seguimiento eventos (Google Sheet API)",
        "stats": {
            "raw_useful": len(raw),
            "exported": len(seed),
            "skipped_junk": skipped,
            "with_event_date": sum(1 for s in seed if s.get("event_date")),
            "by_stage": {},
        },
        "leads": seed,
    }
    stages: dict[str, int] = {}
    for s in seed:
        stages[s["stage"]] = stages.get(s["stage"], 0) + 1
    payload["stats"]["by_stage"] = stages

    args.out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"OK wrote {args.out} leads={len(seed)} skipped_junk={skipped} "
        f"stages={stages}"
    )

    if args.json_only:
        print("JSON-only: no Supabase")
        return 0

    return upsert_supabase(seed, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
