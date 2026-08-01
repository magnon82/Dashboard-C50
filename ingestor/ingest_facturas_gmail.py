"""
Ingestor Gmail -> Supabase: facturas CFDI (PDF/XML).

Descubre mensajes con:
  - Adjunto XML/PDF (Factura/CFDI/QROFA/Comprobante/gobierno)
  - ZIP CFDI (SuKarne y portales que empaquetan XML+PDF)
  - PDFs de "Compras y venta de barra" (Propimex VCC-*, etc.)
  - Enlaces MyBusinessPOS (poscloud -> Azure blob)
  - Enlaces Interfactura ("Descargar XML/PDF", Heineken/Moctezuma)
  - Recibos Mifel de contribuciones (comprobante de pago sin CFDI)
  - Acuses SAT / líneas de captura del contador (CP Oscar Noguez · onoguez8a@hotmail.com)

Alias opcional: deliveredto:facturacion@carranza50.com.mx

Mismo OAuth que Infocaja (google_auth.py · gmail.readonly).
No modifica sync Infocaja/CORTE; se puede llamar aparte o vía sync_gmail_diario.py.

source_file = factura_cfdi

Uso:
  python ingest_facturas_gmail.py
  python ingest_facturas_gmail.py --newer-than 365
  python ingest_facturas_gmail.py --after 2025/01/01
  python ingest_facturas_gmail.py --xml-only
  python ingest_facturas_gmail.py --dry-run --limit 20
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from google_auth import gmail_service

load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

SOURCE_FILE = "factura_cfdi"
# Dominio real del alias (probe Gmail: .com.mx, no .com)
FACTURACION_ALIAS = "facturacion@carranza50.com.mx"

DEFAULT_SAVE_ROOT = Path(
    os.environ.get("FACTURAS_PATH")
    or r"I:\Mi unidad\FACTURAS CFDI"
)
# Fallback if Drive path is unavailable (CI / PC sin I:)
LOCAL_FALLBACK_ROOT = Path(__file__).resolve().parent / "data" / "facturas"


def resolve_save_root(explicit: Path | None = None) -> Path:
    if explicit is not None:
        return explicit
    root = DEFAULT_SAVE_ROOT
    if root.exists() or root.parent.exists():
        return root
    return LOCAL_FALLBACK_ROOT


# CFDI namespaces (3.3 / 4.0)
CFDI_NS = {
    "cfdi": "http://www.sat.gob.mx/cfd/4",
    "cfdi3": "http://www.sat.gob.mx/cfd/3",
    "tfd": "http://www.sat.gob.mx/TimbreFiscalDigital",
}


def autenticar_gmail():
    return gmail_service()


def _date_clause(
    after: str | None,
    before: str | None,
    newer_than_days: int | None,
) -> str:
    parts: list[str] = []
    if newer_than_days:
        parts.append(f"newer_than:{newer_than_days}d")
    if after:
        parts.append(f"after:{after}")
    if before:
        parts.append(f"before:{before}")
    return " ".join(parts)


def build_queries(
    after: str | None,
    before: str | None,
    newer_than_days: int | None,
    *,
    with_alias: bool = False,
    pdf_facturas: bool = False,
) -> list[str]:
    """Varias queries acotadas (unión de IDs) — evita un OR gigante sobre toda la inbox."""
    date_q = _date_clause(after, before, newer_than_days)
    alias = f"deliveredto:{FACTURACION_ALIAS}" if with_alias else ""

    def wrap(core: str) -> str:
        bits = [core]
        if alias:
            bits.append(alias)
        if date_q:
            bits.append(date_q)
        return " ".join(bits)

    queries: list[str] = [
        wrap("has:attachment filename:xml"),
        wrap(
            "(from:mybusinesspos.net OR from:contacto@mybusinesspos.net) "
            "(subject:Factura OR subject:CFDI OR \"Factura electrónica\")"
        ),
        wrap(
            "(from:interfactura.com OR from:notificaciones.interfactura.com) "
            "(subject:Factura OR subject:\"Factura electronica\" OR "
            "subject:Cuauhtemoc OR subject:Moctezuma OR subject:Heineken)"
        ),
        wrap(
            "has:attachment filename:zip "
            "(from:sukarne.com OR subject:Factura OR subject:CFDI OR "
            "subject:Facturaci OR subject:\"Comprobante Fiscal\" OR "
            "subject:\"Facturación Electrónica\")"
        ),
    ]

    if pdf_facturas:
        queries.extend(
            [
                wrap(
                    "has:attachment filename:pdf ("
                    "subject:Factura OR subject:CFDI OR subject:QROFA OR "
                    "subject:Comprobante OR subject:IMSS OR subject:SAT OR "
                    "subject:Hacienda OR subject:SHCP OR subject:INFONAVIT OR "
                    "subject:Impuesto OR subject:acuse OR "
                    "from:sat.gob.mx OR from:imss.gob.mx OR from:gob.mx"
                    ")"
                ),
                # Contador (CP Oscar Noguez): acuses SAT / líneas de captura (sin CFDI)
                wrap(
                    "has:attachment filename:pdf ("
                    "from:onoguez8a@hotmail.com OR from:onoguez OR "
                    "subject:impuestos OR filename:sat1 OR filename:sat2 OR "
                    "\"hojas de impuestos\" OR \"linea de captura\" OR "
                    "\"línea de captura\" OR \"acuse de recibo\")"
                ),
                wrap(
                    "has:attachment filename:pdf "
                    "(subject:\"Compras y venta\" OR filename:VCC- OR "
                    "filename:PRO840423SG8 OR filename:VCC)"
                ),
                wrap(
                    "(from:mifel.com.mx OR from:mifel) has:attachment filename:pdf "
                    "(subject:\"recibo bancario\" OR subject:Contribuciones OR "
                    "subject:IMSS OR subject:SAT OR subject:Hacienda OR "
                    "subject:INFONAVIT OR subject:comprobante)"
                ),
            ]
        )

    return queries


def build_query(
    after: str | None,
    before: str | None,
    newer_than_days: int | None,
    *,
    with_alias: bool = False,
    pdf_facturas: bool = False,
) -> str:
    """Compat: primera query. Preferir build_queries."""
    qs = build_queries(
        after,
        before,
        newer_than_days,
        with_alias=with_alias,
        pdf_facturas=pdf_facturas,
    )
    return qs[0] if qs else ""


GOV_PDF_RE = re.compile(
    r"(imss|infonavit|shcp|hacienda|impuesto|tesorer|secretaria|"
    r"\bsat\b|\bisr\b|\biva\b|linea\s*de\s*captura|acuse|gob\.mx|"
    r"contribuci[oó]nes|recibo\s*bancario|predial|municipio|"
    r"onoguez|noguez)",
    re.IGNORECASE,
)


def is_gobierno_factura(filename: str, subject: str = "") -> bool:
    return bool(GOV_PDF_RE.search(f"{filename} {subject}"))


def _pdf_extract_text(data: bytes, max_pages: int = 4) -> str:
    """Best-effort text from PDF bytes (SAT acuses are text-based)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # type: ignore
        except ImportError:
            return ""
    try:
        reader = PdfReader(io.BytesIO(data))
        parts: list[str] = []
        for page in reader.pages[:max_pages]:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
    except Exception:
        return ""


def extract_sat_acuse_meta(data: bytes) -> dict:
    """Parse SAT 'Acuse de recibo' / línea de captura PDFs from the contador.

    Returns keys: folio (número de operación), total, fecha (ISO), emisor.
    Empty dict if not an acuse.
    """
    text = _pdf_extract_text(data)
    if not text:
        return {}
    low = text.lower()
    if not (
        "número de operación" in low
        or "numero de operacion" in low
        or "línea de captura" in low
        or "linea de captura" in low
        or "acuse de recibo" in low
    ):
        return {}

    out: dict = {"emisor": "Secretaría de Hacienda / SAT"}

    m_op = re.search(
        r"N[uú]mero\s+de\s+operaci[oó]n\s*:?\s*(\d{6,})",
        text,
        re.I,
    )
    if m_op:
        out["folio"] = m_op.group(1)

    # Prefer "Importe total a pagar: $8,325" over intermediate "A cargo"
    m_pay = re.search(
        r"Importe\s+total\s*\n?\s*a\s+pagar\s*:?\s*\$?\s*([\d,]+(?:\.\d+)?)",
        text,
        re.I,
    )
    if not m_pay:
        m_pay = re.search(
            r"Cantidad\s+a\s+pagar\s*:?\s*\$?\s*([\d,]+(?:\.\d+)?)",
            text,
            re.I,
        )
    if m_pay:
        try:
            out["total"] = float(m_pay.group(1).replace(",", ""))
        except ValueError:
            pass

    m_fecha = re.search(
        r"Fecha\s+y\s+hora\s+de\s+presentaci[oó]n\s*:?\s*"
        r"(\d{1,2})/(\d{1,2})/(\d{4})",
        text,
        re.I,
    )
    if m_fecha:
        d, mo, y = m_fecha.group(1), m_fecha.group(2), m_fecha.group(3)
        out["fecha"] = f"{y}-{int(mo):02d}-{int(d):02d}"

    return out


def _mime_body_text(payload: dict | None) -> str:
    """Concatenate text/plain + text/html bodies from a Gmail payload."""
    parts_out: list[str] = []

    def walk(part: dict) -> None:
        mime = part.get("mimeType") or ""
        body = part.get("body") or {}
        raw = body.get("data")
        if mime.startswith("text/") and raw:
            try:
                parts_out.append(
                    base64.urlsafe_b64decode(raw).decode("utf-8", "ignore")
                )
            except Exception:
                pass
        for child in part.get("parts") or []:
            walk(child)

    walk(payload or {})
    return "\n".join(parts_out)


_BLOB_XML_RE = re.compile(
    r"https://mycfdi\.blob\.core\.windows\.net/facturas/[^\s\"'<>]+\.xml",
    re.I,
)
_BLOB_PDF_RE = re.compile(
    r"https://mycfdi\.blob\.core\.windows\.net/facturas/[^\s\"'<>]+\.pdf",
    re.I,
)
_DETALLE_URL_RE = re.compile(
    r"https://poscloud\.mybusinesspos\.net/detallefactura40\.aspx\?uuid=([0-9A-Fa-f\-]+)(?:&amp;|&)rfc=([A-Z0-9]+)",
    re.I,
)
_EMISOR_SERIE_FOLIO_RE = re.compile(
    r"Emisor:\s*(.*?)\s*Serie:\s*(\S+)\s*Folio:\s*(\d+)\s*Fecha:\s*(\d{4}-\d{2}-\d{2})",
    re.I | re.S,
)
_DIRECT_XML_URL_RE = re.compile(
    r"https?://[^\s\"'<>]+\.xml(?:\?[^\s\"'<>]*)?",
    re.I,
)
_DIRECT_PDF_URL_RE = re.compile(
    r"https?://[^\s\"'<>]+\.pdf(?:\?[^\s\"'<>]*)?",
    re.I,
)
_INTERFACTURA_CLICK_RE = re.compile(
    r"https?://clic\.interfactura\.com/ls/click\?[^\s\"'<>]+",
    re.I,
)


class _HtmlLinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.links.append(
                (self._href.replace("&amp;", "&"), "".join(self._text).strip())
            )
            self._href = None


def _http_get_urllib(url: str, timeout: int = 30) -> bytes | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "mi-dashboard-financiero/facturas-ingest"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"  HTTP fail {url[:80]}: {exc}")
        return None


def _http_get_curl(url: str, timeout: int = 45) -> bytes | None:
    """Fallback: curl.exe follows SSL quirks (Interfactura) better than urllib."""
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(prefix="cfdi_dl_", suffix=".bin")
        os.close(fd)
        cmd = [
            "curl",
            "-fsSL",
            "-k",
            "--max-time",
            str(timeout),
            "-A",
            "Mozilla/5.0 (compatible; mi-dashboard-financiero/facturas-ingest)",
            "-o",
            tmp_path,
            url,
        ]
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout + 15, check=False
        )
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", "ignore")[:120]
            print(f"  curl fail {url[:70]}: rc={proc.returncode} {err}")
            return None
        data = Path(tmp_path).read_bytes()
        return data or None
    except Exception as exc:
        print(f"  curl fail {url[:70]}: {exc}")
        return None
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError:
                pass


def _http_get(url: str, timeout: int = 45) -> bytes | None:
    low = url.lower()
    # Interfactura tracking resets urllib; curl follows SSL quirks reliably
    if any(
        h in low
        for h in (
            "interfactura",
            "clic.interfactura",
            "blob.core.windows.net",
            "onedrive",
            "1drv.ms",
            "drive.google",
            "sharepoint",
        )
    ):
        return _http_get_curl(url, timeout=timeout)
    data = _http_get_urllib(url, timeout=min(timeout, 25))
    if data:
        return data
    return _http_get_curl(url, timeout=timeout)


def fetch_mybusinesspos_cfdi(
    detalle_url: str,
) -> tuple[bytes | None, bytes | None, dict]:
    """Fetch detalle HTML -> Azure blob XML/PDF. Returns (xml_bytes, pdf_bytes, labels)."""
    html_bytes = _http_get(detalle_url)
    labels: dict = {}
    if not html_bytes:
        return None, None, labels
    html = html_bytes.decode("utf-8", "ignore")
    for key, pat in (
        ("serie", r'id="lblSerie">\s*SERIE:\s*([^<]+)'),
        ("folio", r'id="lblFolio">\s*FOLIO:\s*([^<]+)'),
        ("uuid", r'id="lblUUID">\s*UUID:\s*([^<]+)'),
        ("importe", r'id="lblImporte">\s*IMPORTE:\s*\$?\s*([^<]+)'),
    ):
        m = re.search(pat, html, re.I)
        if m:
            labels[key] = m.group(1).strip()
    xml_m = _BLOB_XML_RE.search(html)
    pdf_m = _BLOB_PDF_RE.search(html)
    xml_bytes = _http_get(xml_m.group(0)) if xml_m else None
    pdf_bytes = _http_get(pdf_m.group(0)) if pdf_m else None
    return xml_bytes, pdf_bytes, labels


def _looks_like_cfdi_xml(data: bytes) -> bool:
    head = data.lstrip()[:800]
    if head.startswith(b"\xef\xbb\xbf"):
        head = head[3:]
    return head.startswith(b"<?xml") or b"Comprobante" in head or b"cfdi:" in head


def _looks_like_pdf(data: bytes) -> bool:
    return data[:4] == b"%PDF"


def fetch_interfactura_cfdi(
    html_or_text: str,
) -> tuple[bytes | None, bytes | None]:
    """Follow Interfactura 'Descargar XML/PDF' click-tracking links."""
    parser = _HtmlLinkExtractor()
    try:
        parser.feed(html_or_text)
    except Exception:
        parser.links = []

    xml_url = pdf_url = None
    for href, label in parser.links:
        low = label.lower()
        if "xml" in low and "clic.interfactura.com" in href.lower():
            xml_url = href
        elif "pdf" in low and "clic.interfactura.com" in href.lower():
            pdf_url = href

    # Fallback: first two click links if labels missing
    if not xml_url or not pdf_url:
        clicks = _INTERFACTURA_CLICK_RE.findall(html_or_text.replace("&amp;", "&"))
        if clicks and not xml_url:
            xml_url = clicks[0]
        if len(clicks) > 1 and not pdf_url:
            pdf_url = clicks[1]

    xml_bytes = _http_get(xml_url) if xml_url else None
    pdf_bytes = _http_get(pdf_url) if pdf_url else None
    if xml_bytes and not _looks_like_cfdi_xml(xml_bytes):
        xml_bytes = None
    if pdf_bytes and not _looks_like_pdf(pdf_bytes):
        pdf_bytes = None
    return xml_bytes, pdf_bytes


def fetch_generic_cfdi_urls(
    text: str,
) -> tuple[bytes | None, bytes | None]:
    """Direct .xml/.pdf URLs and known blob hosts in body."""
    xml_bytes = pdf_bytes = None
    for m in _BLOB_XML_RE.finditer(text):
        xml_bytes = _http_get(m.group(0))
        if xml_bytes:
            break
    for m in _BLOB_PDF_RE.finditer(text):
        pdf_bytes = _http_get(m.group(0))
        if pdf_bytes:
            break
    if not xml_bytes:
        for m in _DIRECT_XML_URL_RE.finditer(text):
            u = m.group(0).rstrip(").,;")
            if any(
                skip in u.lower()
                for skip in ("logo", "tracking", "facebook", "linkedin", "avast")
            ):
                continue
            data = _http_get(u)
            if data and _looks_like_cfdi_xml(data):
                xml_bytes = data
                break
    if not pdf_bytes:
        for m in _DIRECT_PDF_URL_RE.finditer(text):
            u = m.group(0).rstrip(").,;")
            if any(
                skip in u.lower()
                for skip in ("logo", "tracking", "facebook", "linkedin", "avast")
            ):
                continue
            data = _http_get(u)
            if data and _looks_like_pdf(data):
                pdf_bytes = data
                break
    return xml_bytes, pdf_bytes


def _row_from_cfdi_bytes(
    *,
    xml_bytes: bytes | None,
    pdf_bytes: bytes | None,
    subject: str,
    message_id: str,
    msg_date: str | None,
    save_root: Path,
    dry_run: bool,
    source: str,
    extra: dict | None = None,
    folio_hint: str | None = None,
    serie_hint: str | None = None,
    emisor_hint: str | None = None,
    rfc_hint: str | None = None,
) -> dict | None:
    meta = parse_cfdi_xml(xml_bytes) if xml_bytes else None
    meta = meta or {}
    folio = meta.get("folio") or folio_hint
    serie = meta.get("serie") or serie_hint
    if not meta and not folio and not pdf_bytes:
        return None
    fecha = (
        meta.get("fecha")
        or msg_date
        or date.today().isoformat()
    )
    year = str(fecha)[:4]
    dest_dir = save_root / year
    amount = float(meta.get("total") or 0)
    uuid = (meta.get("uuid") or "").upper() or None
    emisor = (
        meta.get("emisor_nombre")
        or emisor_hint
        or emisor_from_subject(subject)
        or ""
    )
    pdf_path = xml_path = None
    if pdf_bytes:
        pref = f"{uuid}.pdf" if uuid else f"{serie or 'FAC'}-{folio or 'x'}.pdf"
        pdf_path = _save_bytes(dest_dir, pref, pdf_bytes, dry_run)
    if xml_bytes:
        pref = f"{uuid}.xml" if uuid else f"{serie or 'FAC'}-{folio or 'x'}.xml"
        xml_path = _save_bytes(dest_dir, pref, xml_bytes, dry_run)
    if not xml_path and not pdf_path:
        return None
    payload_row = {
        "uuid": uuid,
        "emisor_rfc": meta.get("emisor_rfc") or rfc_hint,
        "emisor_nombre": emisor or None,
        "receptor_rfc": meta.get("receptor_rfc"),
        "receptor_nombre": meta.get("receptor_nombre"),
        "serie": serie,
        "folio": folio,
        "total": amount,
        "fecha": str(fecha)[:10],
        "subject": subject,
        "gmail_id": message_id,
        "pdf_path": pdf_path,
        "xml_path": xml_path,
        "has_pdf": bool(pdf_path),
        "has_xml": bool(xml_path),
        "filename": Path(pdf_path or xml_path or "").name,
        "source": source,
    }
    if extra:
        payload_row.update(extra)
    return _record_from_payload(
        payload_row, emisor or "Factura CFDI", amount, str(fecha)[:10]
    )


def process_link_only_cfdi(
    payload: dict | None,
    subject: str,
    message_id: str,
    msg_date: str | None,
    save_root: Path,
    dry_run: bool,
) -> list[dict]:
    """Index CFDI emails that only include download links (no XML/PDF attach)."""
    text = _mime_body_text(payload)
    if not text and not subject:
        return []

    rows: list[dict] = []

    # --- MyBusinessPOS ---
    detalle_urls = []
    for m in _DETALLE_URL_RE.finditer(text):
        uuid, rfc = m.group(1), m.group(2)
        detalle_urls.append(
            (
                f"https://poscloud.mybusinesspos.net/detallefactura40.aspx"
                f"?uuid={uuid}&rfc={rfc}",
                uuid.upper(),
                rfc.upper(),
            )
        )
    meta_m = _EMISOR_SERIE_FOLIO_RE.search(text.replace("&amp;", "&"))
    seen_uuid: set[str] = set()
    for detalle_url, uuid_hint, rfc_hint in detalle_urls:
        if uuid_hint in seen_uuid:
            continue
        seen_uuid.add(uuid_hint)
        xml_bytes, pdf_bytes, labels = fetch_mybusinesspos_cfdi(detalle_url)
        row = _row_from_cfdi_bytes(
            xml_bytes=xml_bytes,
            pdf_bytes=pdf_bytes,
            subject=subject,
            message_id=message_id,
            msg_date=(meta_m.group(4) if meta_m else None) or msg_date,
            save_root=save_root,
            dry_run=dry_run,
            source="gmail_mybusinesspos_link",
            folio_hint=labels.get("folio")
            or (meta_m.group(3) if meta_m else None),
            serie_hint=labels.get("serie")
            or (meta_m.group(2) if meta_m else None),
            emisor_hint=(
                meta_m.group(1).replace("&amp;", "&").strip() if meta_m else None
            ),
            rfc_hint=rfc_hint,
            extra={"detalle_url": detalle_url, "uuid_hint": uuid_hint},
        )
        if row:
            # Ensure uuid from hint if XML missing labels
            try:
                p = json.loads(row["description"])
                if not p.get("uuid"):
                    p["uuid"] = labels.get("uuid") or uuid_hint
                    row["description"] = json.dumps(p, ensure_ascii=False)
            except Exception:
                pass
            rows.append(row)

    if rows:
        return rows

    # --- Interfactura (Moctezuma / Heineken) ---
    if (
        "interfactura" in text.lower()
        or "clic.interfactura.com" in text.lower()
        or re.search(r"cuauht[eé]moc|moctezuma|heineken", subject, re.I)
    ):
        xml_bytes, pdf_bytes = fetch_interfactura_cfdi(text)
        row = _row_from_cfdi_bytes(
            xml_bytes=xml_bytes,
            pdf_bytes=pdf_bytes,
            subject=subject,
            message_id=message_id,
            msg_date=msg_date,
            save_root=save_root,
            dry_run=dry_run,
            source="gmail_interfactura_link",
            emisor_hint="CERVEZAS CUAUHTEMOC MOCTEZUMA"
            if re.search(r"moctezuma|cuauht", subject, re.I)
            else None,
        )
        if row:
            rows.append(row)
            return rows

    # --- Generic direct / blob links ---
    if re.search(
        r"(factura|cfdi|descargar|comprobante\s+fiscal|xml|timbr)",
        f"{subject}\n{text[:2000]}",
        re.I,
    ):
        xml_bytes, pdf_bytes = fetch_generic_cfdi_urls(text)
        row = _row_from_cfdi_bytes(
            xml_bytes=xml_bytes,
            pdf_bytes=pdf_bytes,
            subject=subject,
            message_id=message_id,
            msg_date=msg_date,
            save_root=save_root,
            dry_run=dry_run,
            source="gmail_cfdi_link",
        )
        if row:
            rows.append(row)

    return rows


def list_message_ids(service, query: str) -> list[str]:
    ids: list[str] = []
    page_token = None
    while True:
        kwargs = {"userId": "me", "q": query, "maxResults": 100}
        if page_token:
            kwargs["pageToken"] = page_token
        result = service.users().messages().list(**kwargs).execute()
        ids.extend(m["id"] for m in result.get("messages", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return ids


def list_message_ids_union(service, queries: list[str]) -> list[str]:
    """Union of Gmail message IDs. Contador/gobierno PDF queries are appended
    first so --limit does not starve them behind bulk CFDI XML results.
    """
    seen: set[str] = set()
    out: list[str] = []
    # Prefer queries that mention impuestos/contador/gobierno keywords
    def _priority(q: str) -> int:
        ql = q.lower()
        if any(
            k in ql
            for k in (
                "onoguez",
                "impuestos",
                "sat1",
                "linea de captura",
                "imss",
                "hacienda",
                "gob.mx",
            )
        ):
            return 0
        if "filename:pdf" in ql:
            return 1
        return 2

    ordered = sorted(queries, key=_priority)
    for q in ordered:
        print(f"  Query: {q}")
        try:
            ids = list_message_ids(service, q)
        except Exception as exc:
            print(f"  Query FAIL: {exc}")
            continue
        print(f"    -> {len(ids)} mensajes")
        for mid in ids:
            if mid not in seen:
                seen.add(mid)
                out.append(mid)
    return out


def walk_parts(payload: dict) -> list[dict]:
    """Flatten MIME parts that look like attachments."""
    out: list[dict] = []

    def walk(part: dict) -> None:
        filename = (part.get("filename") or "").strip()
        body = part.get("body") or {}
        if filename and (body.get("attachmentId") or body.get("data")):
            out.append(part)
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    return out


def download_attachment(service, message_id: str, part: dict) -> bytes | None:
    body = part.get("body") or {}
    raw = body.get("data")
    if raw:
        return base64.urlsafe_b64decode(raw)
    att_id = body.get("attachmentId")
    if not att_id:
        return None
    att = (
        service.users()
        .messages()
        .attachments()
        .get(userId="me", messageId=message_id, id=att_id)
        .execute()
    )
    data = att.get("data")
    if not data:
        return None
    return base64.urlsafe_b64decode(data)


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def parse_cfdi_xml(data: bytes) -> dict | None:
    """Extract UUID, RFCs, total, fecha from CFDI XML."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return None

    attrs = {
        _local(k) if isinstance(k, str) else k: v for k, v in root.attrib.items()
    }
    total = attrs.get("Total") or attrs.get("total")
    fecha = attrs.get("Fecha") or attrs.get("fecha")
    serie = attrs.get("Serie") or attrs.get("serie") or ""
    folio = attrs.get("Folio") or attrs.get("folio") or ""

    emisor_rfc = emisor_nombre = receptor_rfc = receptor_nombre = None
    uuid = None

    for el in root.iter():
        name = _local(el.tag)
        if name == "Emisor":
            emisor_rfc = el.attrib.get("Rfc") or el.attrib.get("rfc")
            emisor_nombre = el.attrib.get("Nombre") or el.attrib.get("nombre")
        elif name == "Receptor":
            receptor_rfc = el.attrib.get("Rfc") or el.attrib.get("rfc")
            receptor_nombre = el.attrib.get("Nombre") or el.attrib.get("nombre")
        elif name == "TimbreFiscalDigital":
            uuid = el.attrib.get("UUID") or el.attrib.get("uuid")

    if total is None and fecha is None and not uuid:
        return None

    try:
        amount = float(str(total).replace(",", "")) if total is not None else 0.0
    except ValueError:
        amount = 0.0

    if amount == 0:
        for el in root.iter():
            name = _local(el.tag)
            if name in ("Pago", "DoctoRelacionado"):
                imp = (
                    el.attrib.get("ImpPagado")
                    or el.attrib.get("Monto")
                    or el.attrib.get("impPagado")
                    or el.attrib.get("monto")
                )
                if imp:
                    try:
                        amount = float(str(imp).replace(",", ""))
                        break
                    except ValueError:
                        pass

    fecha_iso = None
    if fecha:
        fecha_iso = str(fecha)[:10]

    return {
        "uuid": (uuid or "").upper() or None,
        "total": amount,
        "fecha": fecha_iso,
        "serie": serie or None,
        "folio": folio or None,
        "emisor_rfc": emisor_rfc,
        "emisor_nombre": emisor_nombre,
        "receptor_rfc": receptor_rfc,
        "receptor_nombre": receptor_nombre,
    }


def safe_filename(name: str) -> str:
    name = re.sub(r"[^\w.\- ()áéíóúÁÉÍÓÚñÑ]+", "_", name, flags=re.UNICODE)
    return name[:180] or "factura"


def stem_key(filename: str) -> str:
    """Normalize attachment stem for PDF↔XML pairing."""
    stem = Path(filename).stem
    return re.sub(r"[^A-Za-z0-9]+", "", stem).upper()


def folio_from_filename(filename: str) -> tuple[str | None, str | None]:
    """Infer (serie, folio) from names like QROFA-05653.pdf or VCC-6014690.pdf.

    Returns clean serie + numeric folio (not 'QROFA-' / 'QROFA-05653') so
    CXP '5740' matches CFDI folio '05653' via digit normalization.
    """
    stem = Path(filename).stem
    # Skip scan/noise attachments from barra emails
    if re.match(r"^(maa\d|documento\s*-|img_|image|scan)", stem, re.I):
        return None, None
    # Propimex: PRO840423SG8-CCU1403064S1-VCC-6014690
    m_vcc = re.search(r"(?:^|[-_])VCC[-_]?(\d{5,})", stem, re.I)
    if m_vcc:
        return "VCC", m_vcc.group(1)
    m2 = re.search(r"(QROFA|QROPC|QROR)[-_]?(\d+)", stem, re.I)
    if m2:
        return m2.group(1).upper(), m2.group(2)
    # Tutuka / Emiliano: MIEM...FEM20284
    m_miem = re.search(r"MIEM[A-Z0-9]*?(?:FEM|G)?(\d{4,})$", stem, re.I)
    if m_miem:
        return "MIEM", m_miem.group(1)
    # Clear SERIE-digits at end of stem (avoid UUID/maa hashes)
    m = re.search(r"^([A-Z]{2,10})[-_]?(\d{3,})$", stem, re.I)
    if m and m.group(1).upper() not in {"MAA", "IMG", "PDF", "DOC"}:
        return m.group(1).upper(), m.group(2)
    # Pure numeric stem (208293.pdf)
    if re.fullmatch(r"\d{3,}", stem):
        return None, stem
    return None, None


def emisor_hint_from_filename(filename: str) -> str | None:
    stem = Path(filename).stem.upper()
    if "PRO840423SG8" in stem or re.search(r"(?:^|[-_])VCC[-_]?\d", stem):
        return "PROPIMEX S DE RL DE CV"
    if stem.startswith("MIEM") or "MIEM8103273" in stem:
        return "EMILIANO NICOLAS MIGLIETTA"
    if stem.startswith("FVCM"):
        return "FRUTAS Y VERDURAS DEL CAMPO"
    if "SUKARNE" in stem:
        return "SUKARNE"
    return None


def amount_from_subject(subject: str) -> float | None:
    m = re.search(
        r"(?:MXN|USD|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)",
        subject or "",
        re.I,
    )
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def emisor_from_subject(subject: str) -> str | None:
    s = subject or ""
    m = re.search(
        r"Factura\s*[-–:]\s*\S+\s+de\s+(.+)$",
        s,
        re.I,
    )
    if m:
        name = m.group(1).strip()
        if name and len(name) > 3:
            return name
    m = re.search(r"de\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ0-9 .&]+)$", s)
    if m:
        name = m.group(1).strip()
        if name and len(name) > 5 and "factura" not in name.lower():
            return name
    if re.search(r"moctezuma|cuauht[eé]moc", s, re.I):
        return "CERVEZAS CUAUHTEMOC MOCTEZUMA"
    if re.search(r"sukarne", s, re.I):
        return "SUKARNE"
    return None


def _save_bytes(dest_dir: Path, preferred: str, data: bytes, dry_run: bool) -> str:
    out_path = dest_dir / safe_filename(preferred)
    if dry_run:
        return str(out_path)
    dest_dir.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and out_path.read_bytes() != data:
        stem = out_path.stem
        suf = out_path.suffix
        out_path = dest_dir / safe_filename(f"{stem}_{abs(hash(data)) % 10000}{suf}")
    out_path.write_bytes(data)
    return str(out_path)


def _record_from_payload(payload: dict, emisor: str, amount: float, fecha: str) -> dict:
    return {
        "date": fecha,
        "type": "expense",
        "category": emisor or "Factura CFDI",
        "amount": amount,
        "description": json.dumps(payload, ensure_ascii=False),
        "source_file": SOURCE_FILE,
    }


def _expand_zip_attachments(
    zips: list[tuple[str, bytes]],
) -> tuple[list[tuple[str, bytes, dict | None]], list[tuple[str, bytes]]]:
    """Unpack CFDI XML/PDF from ZIP attachments (SuKarne, etc.)."""
    xmls: list[tuple[str, bytes, dict | None]] = []
    pdfs: list[tuple[str, bytes]] = []
    for zname, zdata in zips:
        try:
            zf = zipfile.ZipFile(io.BytesIO(zdata))
        except zipfile.BadZipFile:
            print(f"  ZIP inválido: {zname}")
            continue
        for name in zf.namelist():
            if name.endswith("/") or name.startswith("__MACOSX"):
                continue
            lower = name.lower()
            if not (lower.endswith(".xml") or lower.endswith(".pdf")):
                continue
            try:
                data = zf.read(name)
            except Exception as exc:
                print(f"  ZIP read fail {name}: {exc}")
                continue
            base = Path(name).name
            if lower.endswith(".xml"):
                xmls.append((base, data, parse_cfdi_xml(data)))
            else:
                pdfs.append((base, data))
    return xmls, pdfs


def process_message(
    service,
    message_id: str,
    save_root: Path,
    dry_run: bool,
) -> list[dict]:
    """Return financial_records rows for CFDI attachments / links in one Gmail message."""
    msj = (
        service.users()
        .messages()
        .get(userId="me", id=message_id, format="full")
        .execute()
    )
    headers = {
        h["name"].lower(): h["value"]
        for h in msj.get("payload", {}).get("headers", [])
    }
    subject = headers.get("subject", "")
    internal = msj.get("internalDate")
    msg_date = None
    if internal:
        try:
            msg_date = date.fromtimestamp(int(internal) / 1000).isoformat()
        except (ValueError, OSError):
            msg_date = None

    parts = walk_parts(msj.get("payload") or {})
    xmls: list[tuple[str, bytes, dict | None]] = []
    pdfs: list[tuple[str, bytes]] = []
    zips: list[tuple[str, bytes]] = []

    for part in parts:
        filename = (part.get("filename") or "").strip()
        lower = filename.lower()
        if not (
            lower.endswith(".pdf")
            or lower.endswith(".xml")
            or lower.endswith(".zip")
        ):
            continue
        data = download_attachment(service, message_id, part)
        if not data:
            continue
        if lower.endswith(".xml"):
            xmls.append((filename, data, parse_cfdi_xml(data)))
        elif lower.endswith(".zip"):
            zips.append((filename, data))
        else:
            pdfs.append((filename, data))

    if zips:
        z_xmls, z_pdfs = _expand_zip_attachments(zips)
        xmls.extend(z_xmls)
        pdfs.extend(z_pdfs)

    if not xmls and not pdfs:
        return process_link_only_cfdi(
            msj.get("payload"),
            subject,
            message_id,
            msg_date,
            save_root,
            dry_run,
        )

    # Also try links when attachments present but no XML (rare portal hybrids)
    link_rows: list[dict] = []
    if not xmls and re.search(
        r"interfactura|mybusinesspos|detallefactura|descargar\s+xml",
        _mime_body_text(msj.get("payload")),
        re.I,
    ):
        link_rows = process_link_only_cfdi(
            msj.get("payload"),
            subject,
            message_id,
            msg_date,
            save_root,
            dry_run,
        )

    pdf_by_stem = {stem_key(fn): (fn, data) for fn, data in pdfs}
    used_pdf_stems: set[str] = set()
    rows: list[dict] = list(link_rows)
    subj_amount = amount_from_subject(subject)
    subj_emisor = emisor_from_subject(subject)

    for filename, data, meta in xmls:
        meta = meta or {}
        fecha = meta.get("fecha") or msg_date or date.today().isoformat()
        year = fecha[:4]
        dest_dir = save_root / year
        amount = float(meta.get("total") or 0)
        uuid = meta.get("uuid")
        emisor = meta.get("emisor_nombre") or subj_emisor or ""
        stem = stem_key(filename)
        pdf_path = None
        if stem in pdf_by_stem:
            pfn, pdata = pdf_by_stem[stem]
            used_pdf_stems.add(stem)
            pref = f"{uuid}.pdf" if uuid else pfn
            pdf_path = _save_bytes(dest_dir, pref, pdata, dry_run)
        xml_pref = f"{uuid}.xml" if uuid else filename
        xml_path = _save_bytes(dest_dir, xml_pref, data, dry_run)
        payload = {
            "uuid": uuid,
            "emisor_rfc": meta.get("emisor_rfc"),
            "emisor_nombre": emisor or None,
            "receptor_rfc": meta.get("receptor_rfc"),
            "receptor_nombre": meta.get("receptor_nombre"),
            "serie": meta.get("serie"),
            "folio": meta.get("folio"),
            "total": amount,
            "fecha": fecha,
            "subject": subject,
            "gmail_id": message_id,
            "pdf_path": pdf_path,
            "xml_path": xml_path,
            "has_pdf": bool(pdf_path),
            "has_xml": True,
            "filename": Path(pdf_path or xml_path or "").name,
            "source": "gmail_facturacion"
            if not zips
            else "gmail_facturacion_zip",
        }
        rows.append(_record_from_payload(payload, emisor, amount, fecha))

    # PDF-only: folio from filename / subject / gobierno / invoice-like names
    barra = bool(re.search(r"compras\s+y\s+venta", subject or "", re.I))
    for filename, data in pdfs:
        stem = stem_key(filename)
        if stem in used_pdf_stems:
            continue
        serie, folio = folio_from_filename(filename)
        sat_meta = extract_sat_acuse_meta(data)
        gov = is_gobierno_factura(filename, subject) or bool(sat_meta)
        file_emisor = emisor_hint_from_filename(filename)
        if sat_meta.get("folio"):
            folio = str(sat_meta["folio"])
            serie = serie or None
        if not folio:
            m = re.search(r"(QROFA|QROPC|QROR|VCC)[-_]?(\d+)", subject or "", re.I)
            if m and len(pdfs) <= 3 and not xmls:
                serie = m.group(1).upper()
                folio = m.group(2)
            elif gov:
                # Avoid treating year "2026" in "junio 2026 sat1.pdf" as folio
                dig = None
                for hit in re.finditer(r"(\d{6,})", f"{filename} {subject}"):
                    cand = hit.group(1)
                    if cand.startswith("20") and len(cand) == 4:
                        continue
                    if 2000 <= int(cand[:4]) <= 2099 and len(cand) == 4:
                        continue
                    dig = cand
                    break
                folio = dig if dig else Path(filename).stem[:40]
            elif barra and re.search(
                r"(VCC|QROFA|QROR|QROPC|PRO\d|MIEM|FFE\d|INV-)",
                filename,
                re.I,
            ):
                # Soft: use trailing digits already attempted; skip noise xlsx-renamed
                continue
            else:
                continue
        fecha = (
            sat_meta.get("fecha")
            or msg_date
            or date.today().isoformat()
        )
        year = str(fecha)[:4]
        dest_dir = save_root / year
        pdf_path = _save_bytes(dest_dir, filename, data, dry_run)
        amount = float(
            sat_meta.get("total")
            or subj_amount
            or 0
        )
        emisor = (
            file_emisor
            or sat_meta.get("emisor")
            or subj_emisor
            or ""
        )
        if gov and not emisor:
            if re.search(r"(?i)\bimss\b", f"{filename} {subject}"):
                emisor = "IMSS"
            elif re.search(r"(?i)infonavit", f"{filename} {subject}"):
                emisor = "INFONAVIT"
            elif re.search(
                r"(?i)(hacienda|shcp|sat|impuesto|contribuci|acuse|noguez)",
                f"{filename} {subject}",
            ):
                emisor = "Secretaría de Hacienda / SAT"
            elif re.search(r"(?i)mifel", f"{filename} {subject}"):
                emisor = "Comprobante pago (Mifel)"
        payload = {
            "uuid": None,
            "emisor_rfc": None,
            "emisor_nombre": emisor or None,
            "receptor_rfc": None,
            "receptor_nombre": None,
            "serie": serie,
            "folio": folio,
            "total": amount,
            "fecha": fecha,
            "subject": subject,
            "gmail_id": message_id,
            "pdf_path": pdf_path,
            "xml_path": None,
            "has_pdf": True,
            "has_xml": False,
            "filename": Path(pdf_path).name,
            "source": "gmail_facturacion_pdf",
            "gobierno": gov,
            "sat_acuse": bool(sat_meta),
        }
        rows.append(
            _record_from_payload(
                payload,
                emisor or ("Gobierno" if gov else "Factura PDF"),
                amount,
                fecha,
            )
        )

    return rows


def chunked(items: list[dict], size: int = 100):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingesta facturas CFDI desde Gmail -> Supabase"
    )
    parser.add_argument("--after", default=None, help="Gmail after:YYYY/MM/DD")
    parser.add_argument("--before", default=None, help="Gmail before:YYYY/MM/DD")
    parser.add_argument(
        "--newer-than",
        type=int,
        default=None,
        help="Solo últimos N días. Default 365 si no hay --after",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--alias",
        action="store_true",
        help=f"Filtrar también deliveredto:{FACTURACION_ALIAS}",
    )
    parser.add_argument(
        "--xml-only",
        action="store_true",
        help="Solo filename:xml (no indexar PDF Factura/QROFA sin XML)",
    )
    parser.add_argument(
        "--save-dir",
        type=Path,
        default=None,
        help=f"Carpeta local para PDF/XML (default {DEFAULT_SAVE_ROOT})",
    )
    args = parser.parse_args()

    if args.newer_than is None and not args.after:
        args.newer_than = 365

    save_root = resolve_save_root(args.save_dir)

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not args.dry_run and (not url or not key):
        raise SystemExit(
            "Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
        )

    service = autenticar_gmail()
    after = None if args.newer_than else args.after
    queries = build_queries(
        after,
        args.before,
        args.newer_than,
        with_alias=args.alias,
        pdf_facturas=not args.xml_only,
    )
    print(f"Queries Gmail ({len(queries)}):")
    print(f"Guardar adjuntos en: {save_root}")

    message_ids = list_message_ids_union(service, queries)
    if args.limit:
        message_ids = message_ids[: args.limit]
    print(f"Correos únicos: {len(message_ids)}")
    if not message_ids:
        print("Nada que ingerir.")
        return

    records: list[dict] = []
    errors = 0
    link_ok = 0
    zip_ok = 0
    for i, mid in enumerate(message_ids):
        if i and i % 100 == 0:
            print(f"  … procesados {i}/{len(message_ids)} (indexados {len(records)})")
        try:
            rows = process_message(service, mid, save_root, args.dry_run)
            for r in rows:
                try:
                    src = json.loads(r["description"]).get("source") or ""
                except Exception:
                    src = ""
                if "link" in src:
                    link_ok += 1
                if "zip" in src:
                    zip_ok += 1
            records.extend(rows)
        except Exception as exc:
            print(f"ERROR {mid}: {exc}")
            errors += 1

    print(
        f"Facturas indexadas: {len(records)} "
        f"(errores: {errors}, links: {link_ok}, zip: {zip_ok})"
    )
    if args.dry_run:
        if records:
            print("Ejemplo:", records[0])
            for r in records:
                try:
                    p = json.loads(r["description"])
                except Exception:
                    continue
                if p.get("source") and p.get("source") != "gmail_facturacion":
                    print("Ejemplo especial:", r["category"], p.get("source"), p.get("folio"))
                    break
        print("Dry-run: no se escribió nada.")
        return

    supabase = create_client(url, key)

    if args.newer_than:
        cutoff = (date.today() - timedelta(days=args.newer_than)).isoformat()
        (
            supabase.table("financial_records")
            .delete()
            .eq("source_file", SOURCE_FILE)
            .gte("date", cutoff)
            .execute()
        )
        print(f"Limpieza {SOURCE_FILE} desde {cutoff}: OK")
    elif args.after:
        after_iso = args.after.replace("/", "-")
        (
            supabase.table("financial_records")
            .delete()
            .eq("source_file", SOURCE_FILE)
            .gte("date", after_iso)
            .execute()
        )
        print(f"Limpieza {SOURCE_FILE} desde {after_iso}: OK")
    else:
        supabase.table("financial_records").delete().eq(
            "source_file", SOURCE_FILE
        ).execute()
        print(f"Limpieza {SOURCE_FILE}: OK")

    seen: set[str] = set()
    unique: list[dict] = []
    for r in records:
        try:
            p = json.loads(r["description"])
        except Exception:
            p = {}
        key_u = (
            (p.get("uuid") or "")
            or f"{p.get('folio') or ''}|{r.get('date')}|{r.get('amount')}|{p.get('filename') or ''}"
            or p.get("gmail_id")
            or r["date"] + str(r["amount"])
        ).upper()
        if key_u in seen:
            continue
        seen.add(key_u)
        unique.append(r)

    inserted = 0
    for batch in chunked(unique, 100):
        result = supabase.table("financial_records").insert(batch).execute()
        inserted += len(result.data or [])
    print(f"Insertados: {inserted}")


if __name__ == "__main__":
    main()
