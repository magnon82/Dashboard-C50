"""
Construye relación cliente ↔ actividad (más reciente → más antiguo).

Fuentes (solo lectura; NO escribe financial_records / Ventas):
  1. Google Sheet «Seguimiento eventos» (contactos / fechas)
  2. Google Sheets EVENTOS C50 {año} → pestañas Anticipos* (evento + fecha)
  3. Carpetas locales Ordenes de servicio/*.pdf (nombre + mtime / fecha en nombre)
  4. supabase/seed_event_clients.json (lista Excel)

Salida:
  supabase/seed_event_client_activity.json

Uso:
  python build_event_client_activity.py
  python build_event_client_activity.py --skip-sheets   # solo OS + seed
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OS = Path(r"I:\Mi unidad\Eventos\Ordenes de servicio")
SEED_PATH = ROOT / "supabase" / "seed_event_clients.json"
OUT_PATH = ROOT / "supabase" / "seed_event_client_activity.json"

SKIP_EXT = {".gsheet", ".gdoc", ".gslides", ".gform", ".tmp"}
READABLE_EXT = {".pdf", ".xlsx", ".docx", ".doc"}
PARENS = re.compile(r"\s*\(\d+\)\s*$")
G_ONLY = re.compile(r"^G\d+$", re.I)
MONTH_THEN_DAY = re.compile(
    r"\b(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|MZO|"
    r"ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|"
    r"SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*\.?\s*(\d{1,2})\b",
    re.I,
)
DAY_THEN_MONTH = re.compile(
    r"\b(\d{1,2})\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|MZO|"
    r"ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|"
    r"SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b",
    re.I,
)
ISO_IN_NAME = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
DMY_IN_NAME = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](20\d{2})\b")
YEAR_IN_NAME = re.compile(r"\b(20\d{2})\b")
# Compat: builders antiguos
DATE_IN_NAME = MONTH_THEN_DAY
MESES = {
    "ene": 1,
    "enero": 1,
    "feb": 2,
    "febrero": 2,
    "mar": 3,
    "marzo": 3,
    "mzo": 3,
    "abr": 4,
    "abril": 4,
    "may": 5,
    "mayo": 5,
    "jun": 6,
    "junio": 6,
    "jul": 7,
    "julio": 7,
    "ago": 8,
    "agosto": 8,
    "sep": 9,
    "septiembre": 9,
    "oct": 10,
    "octubre": 10,
    "nov": 11,
    "noviembre": 11,
    "dic": 12,
    "diciembre": 12,
}
MESES_ES_FULL = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}

GENERIC_EVENT = {
    "boda",
    "boda civil",
    "preboda",
    "rompe hielos",
    "rompehielos",
    "rompe-hielos",
    "cumpleanos",
    "cumpleaños",
    "evento",
    "cena",
    "cena empresarial",
    "desayuno",
    "baby shower",
    "titulacion",
    "titulación",
}


NOISE_LABELS = {
    "",
    "orden servicio",
    "orden de servicio",
    "cotizacion",
    "cotización",
}


def norm(s: str | None) -> str:
    if not s:
        return ""
    t = unicodedata.normalize("NFKD", str(s))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def is_generic_event_label(label: str | None) -> bool:
    n = norm(label)
    if not n:
        return True
    if n in GENERIC_EVENT:
        return True
    if n.startswith("rompe hielo") or n.startswith("rompehielo"):
        return True
    if n in {"preboda", "boda civil"} or n.startswith("preboda "):
        return True
    return False


def parse_date_any(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    s = str(value).strip()
    if not s:
        return None
    # Excel serial? skip — Sheets API returns strings
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", s.lower())
    if m:
        day, month_name, year = int(m.group(1)), m.group(2), int(m.group(3))
        month = MESES_ES_FULL.get(month_name)
        if month:
            return f"{year:04d}-{month:02d}-{day:02d}"
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[:10] if fmt.startswith("%Y") else s, fmt).date().isoformat()
        except ValueError:
            continue
    # d/m/yyyy without zero pad already covered; try flexible
    m2 = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m2:
        d, mo, y = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        try:
            return datetime(y, mo, d).date().isoformat()
        except ValueError:
            return None
    return None


def clean_os_label(stem: str) -> str | None:
    label = PARENS.sub("", stem).strip()
    label = re.sub(r"(?i)orden\s*de?\s*servicio", " ", label)
    label = re.sub(r"(?i)cotizaci[oó]n", " ", label)
    label = re.sub(r"(?i)folio\s*\d+", " ", label)
    label = re.sub(r"(?i)sin\s*folio|s\s*n", " ", label)
    label = re.sub(r"(?i)\bG\s*[-]?\s*\d+(?:-\d+)?\b", " ", label)
    # year glued in FOLIO 01 27ORDEN… → leftover "27 BODA…"
    label = re.sub(r"(?i)^\s*(20)?\d{2}\s+(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])", " ", label)
    label = re.sub(r"\s+", " ", label).strip(" -_")
    if not label or G_ONLY.match(label.replace(" ", "")):
        return None
    if norm(label) in NOISE_LABELS or norm(label).startswith("orden servicio"):
        return None
    # drop pure short numeric leftovers
    if re.fullmatch(r"\d{1,4}", label):
        return None
    return label


def to_iso_date(year: int, month: int, day: int) -> str | None:
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def event_date_from_stem(stem: str, folder_year: int | None) -> str | None:
    """Paridad con app/lib/eventos-os.ts eventDateFromStem."""
    iso_m = ISO_IN_NAME.search(stem)
    if iso_m:
        return to_iso_date(int(iso_m.group(1)), int(iso_m.group(2)), int(iso_m.group(3)))

    dmy = DMY_IN_NAME.search(stem)
    if dmy:
        day, month, year = int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3))
        as_dmy = to_iso_date(year, month, day)
        if as_dmy:
            return as_dmy
        if day <= 12:
            return to_iso_date(year, day, month)

    yin = YEAR_IN_NAME.search(stem)
    year = int(yin.group(1)) if yin else folder_year
    if not year:
        return None

    day_first = DAY_THEN_MONTH.search(stem)
    if day_first:
        mon = MESES.get(day_first.group(2).lower().rstrip("."))
        if mon:
            iso = to_iso_date(year, mon, int(day_first.group(1)))
            if iso:
                return iso

    month_first = MONTH_THEN_DAY.search(stem)
    if month_first:
        mon = MESES.get(month_first.group(1).lower().rstrip("."))
        if mon:
            iso = to_iso_date(year, mon, int(month_first.group(2)))
            if iso:
                return iso
    return None


DATE_MATCH_STOP = {
    "y",
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "un",
    "una",
    "boda",
    "preboda",
    "rompe",
    "hielos",
    "rompehielos",
    "evento",
    "cena",
    "cumpleanos",
    "os",
    "orden",
    "servicio",
    "folio",
    "sin",
}


def significant_tokens(key: str) -> set[str]:
    return {
        t
        for t in key.split()
        if len(t) >= 3 and t not in DATE_MATCH_STOP and not re.match(r"^g\d", t)
    }


def is_weak_os_label(label: str | None) -> bool:
    key = norm(label)
    if not key:
        return True
    if G_ONLY.match(key.replace(" ", "")):
        return True
    if key.startswith("os g"):
        return True
    return not significant_tokens(key)


def best_date_from_list(
    dates: list[str], year: int | None, require_year: bool
) -> str | None:
    if not dates:
        return None
    uniq = sorted(set(dates), reverse=True)
    if year:
        same = [d for d in uniq if d.startswith(str(year))]
        if same:
            return same[0]
        if require_year:
            return None
    return None if require_year else uniq[0]


def pick_activity_event_date(
    raw_name: str | None,
    by_client_key: dict[str, list[str]],
    year: int | None,
) -> str | None:
    key = norm(raw_name)
    if not key or is_weak_os_label(raw_name):
        return None
    if key in by_client_key:
        return best_date_from_list(
            by_client_key[key], year, require_year=year is not None
        )

    key_tokens = significant_tokens(key)
    if not key_tokens:
        return None

    best_score = 0.0
    best_dates: list[str] | None = None
    for ck, dates in by_client_key.items():
        if not ck or not dates:
            continue
        ck_tokens = significant_tokens(ck)
        if not ck_tokens:
            continue
        score = 0.0
        if key in ck or ck in key:
            score = min(len(key), len(ck)) / max(len(key), len(ck))
        inter = len(key_tokens & ck_tokens)
        if inter >= 2:
            score = max(
                score, inter / max(len(key_tokens), len(ck_tokens))
            )
        elif (
            inter == 1
            and len(key_tokens) <= 2
            and any(len(t) >= 4 and t in ck_tokens for t in key_tokens)
        ):
            score = max(score, 0.55)
        if score < 0.5:
            continue
        if score > best_score:
            best_score = score
            best_dates = dates
    if not best_dates:
        return None
    return best_date_from_list(best_dates, year, require_year=True)


def backfill_os_event_dates(events: list[dict]) -> int:
    """Rellena event_date de os_pdf desde anticipos/seguimiento (fuzzy + año + folio G)."""
    by_client: dict[str, list[str]] = defaultdict(list)
    by_folio_year: dict[str, str] = {}

    def push_folio(folio: str | None, ed: str) -> None:
        if not folio or not ed:
            return
        by_folio_year[f"{folio.upper()}|{ed[:4]}"] = ed

    for ev in events:
        ed = ev.get("event_date")
        if not ed:
            continue
        if ev.get("source") in (
            "anticipos_c50",
            "seguimiento",
            "seguimiento_eventos",
        ):
            for raw in (ev.get("company_hint"), ev.get("display_name")):
                k = norm(raw)
                if k:
                    by_client[k].append(ed)
            push_folio(ev.get("folio"), ed)
            g_embed = re.search(
                r"\bG\s*[-]?\s*(\d+(?:-\d+)?)\b",
                str(ev.get("display_name") or ev.get("company_hint") or ""),
                re.I,
            )
            if g_embed:
                push_folio(f"G{g_embed.group(1)}", ed)

    filled = 0
    for ev in events:
        if ev.get("source") != "os_pdf" or ev.get("event_date"):
            continue
        detail = ev.get("detail") or ""
        folder_year = (
            int(detail[:4]) if len(detail) >= 4 and detail[:4].isdigit() else None
        )
        folio = ev.get("folio")
        if folio and folder_year:
            from_folio = by_folio_year.get(f"{str(folio).upper()}|{folder_year}")
            if from_folio:
                ev["event_date"] = from_folio
                ev["activity_date"] = from_folio
                filled += 1
                continue
        picked = pick_activity_event_date(
            ev.get("company_hint") or ev.get("display_name"),
            by_client,
            folder_year,
        )
        if picked:
            ev["event_date"] = picked
            ev["activity_date"] = picked
            filled += 1
    print(f"  OS event_date backfill: {filled}")
    return filled


def scan_os_folder(folder: Path) -> list[dict]:
    events: list[dict] = []
    if not folder.exists():
        print(f"  OS folder missing: {folder}")
        return events
    for path in folder.rglob("*"):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext in SKIP_EXT or ext not in READABLE_EXT:
            continue
        parts = path.relative_to(folder).parts
        year = int(parts[0]) if parts and parts[0].isdigit() and len(parts[0]) == 4 else None
        stem = path.stem
        folio_m = re.search(r"FOLIO\s*(\d+)", stem, re.I)
        g_m = re.search(r"\bG\s*[-]?\s*(\d+(?:-\d+)?)\b", stem, re.I)
        folio = (
            folio_m.group(1)
            if folio_m
            else (f"G{g_m.group(1)}" if g_m else None)
        )
        label = clean_os_label(stem)
        mtime = datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()
        event_date = event_date_from_stem(stem, year)
        display = label or (f"OS {folio}" if folio else path.name)
        events.append(
            {
                "client_key": norm(label) if label else f"os:{folio or path.name}",
                "display_name": display,
                "company_hint": label,
                "contact_hint": None,
                "email": None,
                "phone": None,
                "activity_date": event_date or mtime,
                "event_date": event_date,
                "source": "os_pdf",
                "detail": str(path.relative_to(folder)).replace("\\", "/"),
                "folio": folio,
            }
        )
    dated = sum(1 for e in events if e.get("event_date"))
    print(f"  OS: {len(events)} archivos legibles ({dated} con fecha en nombre)")
    return events


def pull_seguimiento() -> list[dict]:
    """Delega a ingestor/eventos_seguimiento.py (compartido con seed de leads)."""
    from eventos_seguimiento import pull_seguimiento_activity

    return pull_seguimiento_activity()


def pull_anticipos(years: list[int] | None = None) -> list[dict]:
    from google_auth import drive_service, sheets_service

    drive = drive_service()
    sheets = sheets_service()
    target = years or list(range(2021, datetime.now().year + 2))
    events: list[dict] = []
    for year in target:
        sid = None
        name = None
        for cand in (f"EVENTOS C50 {year}", f"Eventos C50 {year}", f"EVENTO C50 {year}"):
            q = (
                f"name = '{cand}' "
                "and mimeType='application/vnd.google-apps.spreadsheet'"
            )
            res = drive.files().list(q=q, pageSize=1, fields="files(id,name)").execute()
            files = res.get("files") or []
            if files:
                sid, name = files[0]["id"], files[0]["name"]
                break
        if not sid:
            continue
        meta = sheets.spreadsheets().get(spreadsheetId=sid).execute()
        tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]
        ant_tabs = [t for t in tabs if "anticip" in t.lower()]
        for tab in ant_tabs:
            result = (
                sheets.spreadsheets()
                .values()
                .get(spreadsheetId=sid, range=f"'{tab}'!A1:L2000")
                .execute()
            )
            rows = result.get("values", [])
            if not rows:
                continue
            header = [norm(h) for h in rows[0]]
            try:
                i_ev_name = header.index("evento")
            except ValueError:
                continue
            i_fecha_ev = next(
                (i for i, h in enumerate(header) if "fecha evento" in h), None
            )
            i_fecha_dep = next(
                (i for i, h in enumerate(header) if "fecha deposito" in h or "fecha dep" in h),
                0,
            )
            i_folio = next(
                (i for i, h in enumerate(header) if "folio" in h), None
            )
            for raw in rows[1:]:
                cells = list(raw) + [""] * 12
                ev_name = str(cells[i_ev_name] if i_ev_name < len(cells) else "").strip()
                if not ev_name:
                    continue
                event_d = (
                    parse_date_any(cells[i_fecha_ev]) if i_fecha_ev is not None else None
                )
                dep_d = parse_date_any(cells[i_fecha_dep])
                activity = event_d or dep_d
                if not activity:
                    continue
                folio = (
                    str(cells[i_folio]).strip()
                    if i_folio is not None and i_folio < len(cells)
                    else None
                )
                # Generic labels ("Rompehielos", "Preboda") must stay per-folio/date
                if is_generic_event_label(ev_name):
                    key = norm(f"{ev_name}|{folio or ''}|{activity}")
                else:
                    key = norm(ev_name)
                events.append(
                    {
                        "client_key": key,
                        "display_name": ev_name
                        + (f" ({folio})" if folio and is_generic_event_label(ev_name) else ""),
                        "company_hint": None
                        if is_generic_event_label(ev_name)
                        else ev_name,
                        "contact_hint": None,
                        "email": None,
                        "phone": None,
                        "activity_date": activity,
                        "event_date": event_d,
                        "source": "anticipos_c50",
                        "detail": f"{name} / {tab}",
                        "folio": folio or None,
                    }
                )
        print(f"  Anticipos {name}: +{sum(1 for e in events if e['detail'].startswith(name or ''))} (acum {len(events)})")
    return events


def load_seed() -> list[dict]:
    if not SEED_PATH.exists():
        return []
    rows = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    return rows if isinstance(rows, list) else []


def best_seed_match(key: str, seed_index: dict[str, dict]) -> str | None:
    if not key or key.startswith("os:"):
        return None
    if key in seed_index:
        return key
    # containment / token overlap
    best = None
    best_score = 0.0
    key_tokens = set(key.split())
    if len(key_tokens) < 1:
        return None
    for sk, row in seed_index.items():
        if key in sk or sk in key:
            score = min(len(key), len(sk)) / max(len(key), len(sk))
            if score > best_score:
                best_score = score
                best = sk
            continue
        st = set(sk.split())
        if not st:
            continue
        inter = len(key_tokens & st)
        if inter >= 2 or (inter == 1 and len(key_tokens) == 1 and len(st) <= 2):
            score = inter / max(len(key_tokens), len(st))
            if score > best_score:
                best_score = score
                best = sk
    if best_score >= 0.45:
        return best
    return None


def aggregate(events: list[dict], seed: list[dict]) -> dict:
    seed_index = {
        norm(r.get("company")): r for r in seed if r.get("company")
    }
    by_key: dict[str, list[dict]] = defaultdict(list)
    key_meta: dict[str, dict] = {}

    for ev in events:
        raw_key = ev["client_key"]
        matched = best_seed_match(raw_key, seed_index)
        key = matched or raw_key
        by_key[key].append(ev)
        meta = key_meta.setdefault(
            key,
            {
                "client_key": key,
                "company_name": None,
                "contact_name": None,
                "email": None,
                "phone": None,
                "matched_seed": bool(matched),
            },
        )
        if matched and not meta["company_name"]:
            s = seed_index[matched]
            meta["company_name"] = s.get("company")
            meta["contact_name"] = s.get("contact")
            meta["email"] = s.get("email")
            meta["phone"] = s.get("phone")
        if not meta["company_name"] and ev.get("company_hint"):
            meta["company_name"] = ev["company_hint"]
        if not meta["company_name"]:
            meta["company_name"] = ev.get("display_name")
        if not meta["contact_name"] and ev.get("contact_hint"):
            meta["contact_name"] = ev["contact_hint"]
        if not meta["email"] and ev.get("email"):
            meta["email"] = ev["email"]
        if not meta["phone"] and ev.get("phone"):
            meta["phone"] = ev["phone"]

    # ensure all seed clients appear (even without activity)
    for sk, row in seed_index.items():
        if sk not in key_meta:
            key_meta[sk] = {
                "client_key": sk,
                "company_name": row.get("company"),
                "contact_name": row.get("contact"),
                "email": row.get("email"),
                "phone": row.get("phone"),
                "matched_seed": True,
            }
            by_key[sk] = []

    clients: list[dict] = []
    for key, meta in key_meta.items():
        timeline = sorted(
            by_key.get(key, []),
            key=lambda e: e["activity_date"],
            reverse=True,
        )
        # dedupe identical date+source+detail
        seen: set[tuple] = set()
        uniq: list[dict] = []
        for t in timeline:
            sig = (t["activity_date"], t["source"], t.get("detail"), t.get("folio"))
            if sig in seen:
                continue
            seen.add(sig)
            uniq.append(
                {
                    "date": t["activity_date"],
                    "event_date": t.get("event_date"),
                    "source": t["source"],
                    "label": t.get("display_name"),
                    "detail": t.get("detail"),
                    "folio": t.get("folio"),
                }
            )
        last = uniq[0]["date"] if uniq else None
        sources = sorted({u["source"] for u in uniq})
        clients.append(
            {
                **meta,
                "last_activity_at": last,
                "last_activity_source": uniq[0]["source"] if uniq else None,
                "activity_count": len(uniq),
                "sources": sources,
                "timeline": uniq[:40],
            }
        )

    clients.sort(
        key=lambda c: (c["last_activity_at"] or "0000", c["company_name"] or ""),
        reverse=True,
    )
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sources_note": {
            "readable": [
                "Seguimiento eventos (Google Sheet API)",
                "EVENTOS C50 Anticipos* (Google Sheet API)",
                "Ordenes de servicio PDF filenames + mtime",
                "seed_event_clients.json",
            ],
            "not_readable_local": [
                "*.gsheet shortcuts (Controles EVENTOS C50, Seguimiento.gsheet)",
                "*.gdoc OS drafts",
                "OS G-only PDFs without client name in filename",
            ],
        },
        "stats": {
            "clients": len(clients),
            "with_activity": sum(1 for c in clients if c["last_activity_at"]),
            "matched_seed": sum(1 for c in clients if c["matched_seed"]),
            "events_total": sum(c["activity_count"] for c in clients),
        },
        "clients": clients,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--os-dir", type=Path, default=DEFAULT_OS)
    parser.add_argument("--skip-sheets", action="store_true")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()

    events: list[dict] = []
    print("Escaneando OS…")
    events.extend(scan_os_folder(args.os_dir))

    if not args.skip_sheets:
        print("Leyendo Google Sheets (solo lectura)…")
        try:
            events.extend(pull_seguimiento())
        except Exception as exc:
            print(f"  Seguimiento SKIP: {exc}")
        try:
            events.extend(pull_anticipos())
        except Exception as exc:
            print(f"  Anticipos SKIP: {exc}")
    else:
        print("Sheets omitidos (--skip-sheets)")

    backfill_os_event_dates(events)

    seed = load_seed()
    print(f"Seed clientes: {len(seed)}")
    payload = aggregate(events, seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    st = payload["stats"]
    print(
        f"OK -> {args.out}\n"
        f"  clientes={st['clients']} con_actividad={st['with_activity']} "
        f"matched_seed={st['matched_seed']} eventos={st['events_total']}"
    )
    print("Top 15 mas recientes:")
    for c in payload["clients"][:15]:
        name = (c["company_name"] or "?")[:60]
        print(
            f"  {c['last_activity_at'] or '-'} | {name} "
            f"({c['activity_count']} · {c.get('last_activity_source')})"
        )


if __name__ == "__main__":
    main()
