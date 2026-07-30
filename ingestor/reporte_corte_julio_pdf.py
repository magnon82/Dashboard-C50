"""
Genera PDF de Cancelaciones y Descuentos del mes en curso (julio 2026).
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
load_dotenv()

OUT_DIR = Path(__file__).resolve().parent.parent / "reportes"
YEAR = 2026
MONTH = 7


def money(v: float) -> str:
    return f"${v:,.2f}"


def parse_detail(desc: str | None) -> dict:
    if not desc:
        return {}
    try:
        d = json.loads(desc)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def fetch_rows():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        raise SystemExit("Faltan credenciales Supabase")

    sb = create_client(url, key)
    start = f"{YEAR}-{MONTH:02d}-01"
    end = f"{YEAR}-{MONTH:02d}-31"
    res = (
        sb.table("financial_records")
        .select("*")
        .eq("source_file", "corte_caja")
        .gte("date", start)
        .lte("date", end)
        .order("date", desc=False)
        .execute()
    )
    return res.data or []


def build_pdf(rows: list[dict], out_path: Path) -> None:
    cancelaciones = []
    descuentos = []
    for r in rows:
        detail = parse_detail(r.get("description"))
        kind = "cancelacion" if r.get("category") == "Corte Cancelacion" else "descuento"
        item = {
            "date": r.get("date", ""),
            "kind": kind,
            "amount": float(r.get("amount") or 0),
            "motivo": str(detail.get("motivo") or ("Cancelación" if kind == "cancelacion" else "Descuento")),
            "grupo": str(detail.get("grupo") or ""),
            "persona": str(detail.get("persona") or ""),
            "producto": str(detail.get("producto") or "").replace("\n", " ").strip(),
            "mesero": str(detail.get("mesero") or ""),
            "autorizo": str(detail.get("autorizo") or ""),
            "mesa": str(detail.get("mesa") or ""),
            "hora": str(detail.get("hora") or ""),
        }
        if kind == "cancelacion":
            cancelaciones.append(item)
        else:
            descuentos.append(item)

    total_c = sum(i["amount"] for i in cancelaciones)
    total_d = sum(i["amount"] for i in descuentos)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=letter,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleMx",
        parent=styles["Heading1"],
        fontSize=16,
        textColor=colors.HexColor("#1e3a5f"),
        spaceAfter=4,
        alignment=TA_CENTER,
    )
    sub_style = ParagraphStyle(
        "SubMx",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#475569"),
        alignment=TA_CENTER,
        spaceAfter=12,
    )
    h2 = ParagraphStyle(
        "H2Mx",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=colors.HexColor("#1e3a5f"),
        spaceBefore=12,
        spaceAfter=6,
    )
    cell = ParagraphStyle(
        "CellMx",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
    )
    cell_r = ParagraphStyle(
        "CellR",
        parent=cell,
        alignment=TA_RIGHT,
    )

    story = []
    hoy = date.today().strftime("%d/%m/%Y")
    story.append(Paragraph("Cluster Culinario · Carranza 50", sub_style))
    story.append(Paragraph("Cancelaciones y Descuentos · Julio 2026", title_style))
    story.append(
        Paragraph(
            f"Lo que va del mes · Generado el {hoy} · "
            f"Canc. {money(total_c)} · Desc. {money(total_d)} · Total {money(total_c + total_d)}",
            sub_style,
        )
    )

    def section(title: str, items: list[dict], accent: str):
        story.append(Paragraph(title, h2))
        if not items:
            story.append(Paragraph("Sin registros.", cell))
            return

        # Agrupar por día
        by_day: dict[str, list] = defaultdict(list)
        for it in items:
            by_day[it["date"]].append(it)

        header = [
            Paragraph("<b>Fecha</b>", cell),
            Paragraph("<b>Motivo</b>", cell),
            Paragraph("<b>Detalle</b>", cell),
            Paragraph("<b>Mesero / Autorizó</b>", cell),
            Paragraph("<b>Monto</b>", cell_r),
        ]
        data = [header]
        for day in sorted(by_day.keys()):
            for it in by_day[day]:
                detalle_parts = [
                    p
                    for p in (
                        it["producto"],
                        it["persona"] and f"Persona: {it['persona']}",
                        it["grupo"],
                        it["mesa"] and f"Mesa {it['mesa']}",
                        it["hora"],
                    )
                    if p
                ]
                data.append(
                    [
                        Paragraph(day[8:10] + "/" + day[5:7] + "/" + day[0:4], cell),
                        Paragraph(it["motivo"], cell),
                        Paragraph(" · ".join(detalle_parts) or "—", cell),
                        Paragraph(
                            " / ".join(p for p in (it["mesero"], it["autorizo"]) if p) or "—",
                            cell,
                        ),
                        Paragraph(money(it["amount"]), cell_r),
                    ]
                )
            day_total = sum(i["amount"] for i in by_day[day])
            data.append(
                [
                    Paragraph("", cell),
                    Paragraph("", cell),
                    Paragraph("", cell),
                    Paragraph(f"<b>Subtotal {day[8:10]}/{day[5:7]}</b>", cell_r),
                    Paragraph(f"<b>{money(day_total)}</b>", cell_r),
                ]
            )

        data.append(
            [
                Paragraph("", cell),
                Paragraph("", cell),
                Paragraph("", cell),
                Paragraph("<b>TOTAL</b>", cell_r),
                Paragraph(f"<b>{money(sum(i['amount'] for i in items))}</b>", cell_r),
            ]
        )

        table = Table(data, colWidths=[2.2 * cm, 4.2 * cm, 6.5 * cm, 4.2 * cm, 2.4 * cm])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(accent)),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f8fafc")]),
                    ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#e2e8f0")),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(KeepTogether([table]))

    section(f"Descuentos y cortesías ({len(descuentos)})", descuentos, "#c65911")
    story.append(Spacer(1, 0.4 * cm))
    section(f"Cancelaciones ({len(cancelaciones)})", cancelaciones, "#be123c")

    doc.build(story)


def main() -> None:
    rows = fetch_rows()
    out = OUT_DIR / f"cancelaciones_descuentos_julio_{YEAR}.pdf"
    build_pdf(rows, out)
    print(f"Registros: {len(rows)}")
    print(f"PDF: {out}")


if __name__ == "__main__":
    main()
