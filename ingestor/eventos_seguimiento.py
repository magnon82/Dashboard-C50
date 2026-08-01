"""
Lectura compartida del Google Sheet «Seguimiento eventos».

Usado por:
  - build_event_client_activity.py (timeline CRM)
  - scripts/seed_event_leads_from_seguimiento.py (import a event_leads)

Solo lectura Sheets/Drive. No escribe financial_records.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any

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

# Status libres del Sheet → stage del pipeline CRM (solo lo soportado).
STATUS_TO_STAGE = {
    "cotizado": "cotizado",
    "cerrado": "ganado",
    "declinado": "perdido",
    "perdido": "perdido",
    "ganado": "ganado",
    "nuevo": "nuevo",
    "contactado": "contactado",
    "negociacion": "negociacion",
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


def parse_date_any(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    s = str(value).strip()
    if not s:
        return None
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", s.lower())
    if m:
        day, month_name, year = int(m.group(1)), m.group(2), int(m.group(3))
        month = MESES_ES_FULL.get(month_name)
        if month:
            return f"{year:04d}-{month:02d}-{day:02d}"
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(
                s[:10] if fmt.startswith("%Y") else s, fmt
            ).date().isoformat()
        except ValueError:
            continue
    m2 = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m2:
        d, mo, y = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        try:
            return datetime(y, mo, d).date().isoformat()
        except ValueError:
            return None
    return None


def normalize_phone(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float):
        if value != value:  # NaN
            return None
        value = int(value) if value == int(value) else value
    if isinstance(value, int):
        digits = str(value)
    else:
        digits = re.sub(r"\D", "", str(value))
    if not digits:
        return None
    if len(digits) == 12 and digits.startswith("52"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) < 7:
        return None
    return digits


def normalize_email(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s or "@" not in s or " " in s:
        return None
    return s


def map_status_to_stage(status: str | None) -> str:
    n = norm(status)
    if not n:
        return "nuevo"
    if n in STATUS_TO_STAGE:
        return STATUS_TO_STAGE[n]
    # Frases sueltas vistas en hoja mal llevada
    if "cotiz" in n:
        return "cotizado"
    if "declin" in n or "cancel" in n or "perdid" in n:
        return "perdido"
    if "cerrad" in n or "confirm" in n or "ganad" in n:
        return "ganado"
    if "contact" in n:
        return "contactado"
    if "negoci" in n:
        return "negociacion"
    return "nuevo"


def parse_pax(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and value == value:
        n = int(value)
        return n if n > 0 else None
    m = re.search(r"(\d{1,5})", str(value).replace(",", ""))
    if not m:
        return None
    n = int(m.group(1))
    return n if n > 0 else None


def parse_money(value: Any) -> float | None:
    """Monto cotizado del Sheet → estimated_amount (total, no por persona)."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and value == value:
        return float(value) if value > 0 else None
    s = str(value).strip().replace(",", "").replace("$", "").replace(" ", "")
    try:
        n = float(s)
        return n if n > 0 else None
    except ValueError:
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        if not m:
            return None
        n = float(m.group(1))
        return n if n > 0 else None


def fetch_seguimiento_raw_rows(
    range_a1: str = "'Eventos'!A1:Z5000",
) -> list[dict[str, Any]]:
    """
    Filas normalizadas del Sheet (una por renglón útil).
    Omite filas sin nombre ni empresa/giro.
    """
    from google_auth import drive_service, sheets_service

    drive = drive_service()
    q = (
        "name = 'Seguimiento eventos' "
        "and mimeType='application/vnd.google-apps.spreadsheet'"
    )
    res = drive.files().list(q=q, pageSize=1, fields="files(id,name)").execute()
    files = res.get("files") or []
    if not files:
        return []

    sid = files[0]["id"]
    sheets = sheets_service()
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sid, range=range_a1)
        .execute()
    )
    rows = result.get("values", [])
    if not rows:
        return []

    header = [norm(h) for h in rows[0]]

    def col(*names: str) -> int | None:
        for n in names:
            if n in header:
                return header.index(n)
        return None

    i_atiende = col("atiende")
    i_nombre = col("nombre completo del cliente", "nombre completo", "nombre")
    i_tel = col("telefono")
    i_mail = col("correo")
    i_emp = col("empresa giro celebracion", "empresa")
    i_pax = col("no de pax", "pax")
    i_sol = col("fecha de solicitud")
    i_ev = col("fecha evento")
    i_first = col("fecha de primer contacto")
    i_last = col("fecha ultimo contacto", "fecha ltimo contacto")
    i_monto = col("monto cotizado")
    i_status = col("status")
    # Columnas libres / mal nombradas → notes
    i_notas = col("notas", "observaciones", "comentarios", "requisitos", "requisiciones")

    out: list[dict[str, Any]] = []
    for idx, raw in enumerate(rows[1:], start=2):
        cells = list(raw) + [""] * 20

        def get(i: int | None) -> str:
            if i is None:
                return ""
            return str(cells[i] if i < len(cells) else "").strip()

        empresa_raw = get(i_emp)
        nombre = get(i_nombre)
        if not empresa_raw and not nombre:
            continue

        phone = normalize_phone(get(i_tel) or None)
        email = normalize_email(get(i_mail) or None)
        event_d = parse_date_any(get(i_ev))
        first = parse_date_any(get(i_first))
        last = parse_date_any(get(i_last))
        sol = parse_date_any(get(i_sol))
        status = get(i_status)
        atiende = get(i_atiende)
        pax = parse_pax(get(i_pax))
        monto = parse_money(get(i_monto))
        extra_notes = get(i_notas)

        empresa_is_org = bool(empresa_raw) and not is_generic_event_label(empresa_raw)
        celebration = None
        company = None
        if empresa_raw:
            if empresa_is_org:
                company = empresa_raw
            else:
                celebration = empresa_raw

        # Título kanban: celebración > empresa > nombre
        title = celebration or company or nombre
        if not title:
            continue

        note_parts = []
        if atiende:
            note_parts.append(f"Atiende: {atiende}")
        if status:
            note_parts.append(f"Status Sheet: {status}")
        if sol:
            note_parts.append(f"Solicitud: {sol}")
        if first:
            note_parts.append(f"Primer contacto: {first}")
        if last:
            note_parts.append(f"Último contacto: {last}")
        if monto is not None:
            note_parts.append(f"Monto cotizado Sheet: ${monto:,.2f}")
        if extra_notes:
            note_parts.append(extra_notes)
        # Texto suelto de empresa cuando también es celebración genérica ya mapeada
        if empresa_raw and celebration and company is None and empresa_is_org is False:
            pass  # ya en celebration
        notes = " · ".join(note_parts) if note_parts else None

        out.append(
            {
                "sheet_row": idx,
                "contact_name": nombre or None,
                "phone": phone,
                "email": email,
                "company": company,
                "celebration": celebration or (empresa_raw if not company else None),
                "title": title,
                "event_date": event_d,
                "solicitud_date": sol,
                "first_contact_date": first,
                "last_contact_date": last,
                "activity_date": last or event_d or first or sol,
                "pax": pax,
                "estimated_amount": monto,
                "status_raw": status or None,
                "stage": map_status_to_stage(status),
                "atiende": atiende or None,
                "notes": notes,
                "source": "sheets",
                "source_detail": "seguimiento",
            }
        )
    return out


def rows_to_activity_events(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convierte filas crudas al formato del timeline (build_event_client_activity)."""
    events: list[dict[str, Any]] = []
    for r in rows:
        activity = r.get("activity_date")
        if not activity:
            continue
        nombre = r.get("contact_name") or ""
        empresa = r.get("celebration") or r.get("company") or ""
        empresa_is_org = bool(r.get("company"))
        if nombre:
            key = norm(nombre)
            display = f"{nombre}" + (f" · {empresa}" if empresa else "")
            company_hint = r.get("company")
        elif empresa_is_org:
            key = norm(empresa)
            display = empresa
            company_hint = empresa
        else:
            key = f"seg:{norm(empresa)}:{activity}:{r.get('phone') or r.get('email') or ''}"
            display = empresa or "Seguimiento"
            company_hint = None

        detail_bits = []
        if empresa:
            detail_bits.append(f"Giro {empresa}")
        if r.get("atiende"):
            detail_bits.append(f"Atiende {r['atiende']}")
        if r.get("status_raw"):
            detail_bits.append(f"Status {r['status_raw']}")
        if r.get("pax"):
            detail_bits.append(f"{r['pax']} pax")
        if r.get("estimated_amount") is not None:
            detail_bits.append(f"Cotizado ${r['estimated_amount']:,.2f}")

        events.append(
            {
                "client_key": key,
                "display_name": display,
                "company_hint": company_hint,
                "contact_hint": nombre or None,
                "email": r.get("email"),
                "phone": r.get("phone"),
                "activity_date": activity,
                "event_date": r.get("event_date"),
                "source": "seguimiento",
                "detail": " · ".join(detail_bits),
                "folio": None,
            }
        )
    return events


def pull_seguimiento_activity() -> list[dict[str, Any]]:
    """API estable para el builder de actividad."""
    rows = fetch_seguimiento_raw_rows()
    events = rows_to_activity_events(rows)
    print(f"  Seguimiento: {len(events)} filas con fecha (de {len(rows)} útiles)")
    return events
