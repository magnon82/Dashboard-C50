/**
 * Genera un PDF de cotización (bytes) desde CotizacionDoc.
 * Usable en cliente y servidor (pdf-lib); dispara descarga directa sin window.print().
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import {
  buildCotizacionTotals,
  formatEventDateEs,
  formatIssuedAtEs,
  formatMxn,
  holdNoteEs,
  optionEntries,
  shortTermsEs,
  EVENTOS_CONTACT,
  type CotizacionDoc,
} from '@/app/lib/eventos-cotizacion-doc';
import { SUITE } from '@/app/lib/themes';

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN_X = 48;
const MARGIN_BOTTOM = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const NAVY = hexToRgb(SUITE.navy);
const NAVY_DEEP = hexToRgb(SUITE.navyDeep);
const ORANGE = hexToRgb(SUITE.orange);
const ORANGE_DEEP = hexToRgb(SUITE.orangeDeep);
const MUTED = hexToRgb(SUITE.muted);
const ORANGE_SOFT = hexToRgb(SUITE.orangeSoft);
const WHITE = rgb(1, 1, 1);
const RULE = hexToRgb(SUITE.border);

/** WinAnsi-safe: quita caracteres fuera de Latin-1 que romperían Helvetica. */
function pdfSafe(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

function wrapLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const safe = pdfSafe(text);
  const paragraphs = safe.split(/\r?\n/);
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const trial = `${line} ${words[i]}`;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        line = trial;
      } else {
        out.push(line);
        line = words[i];
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function cotizacionPdfFilename(doc: CotizacionDoc): string {
  const folio = (doc.quote_number || 'borrador').replace(/[^\w.\-]+/g, '_');
  return `Cotizacion-${folio}.pdf`;
}

/**
 * Construye el PDF de la cotización. Devuelve bytes listos para Blob / Response.
 */
export async function buildCotizacionPdfBytes(
  doc: CotizacionDoc
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const totals = buildCotizacionTotals(doc);
  const terms = shortTermsEs();

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  const ensureSpace = (need: number) => {
    if (y - need >= MARGIN_BOTTOM) return;
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN_X;
    drawPageChrome(page);
  };

  const drawPageChrome = (p: PDFPage) => {
    // thin top accent on continuation pages
    p.drawRectangle({
      x: 0,
      y: PAGE_H - 4,
      width: PAGE_W,
      height: 4,
      color: ORANGE,
    });
  };

  // —— Header band ——
  const headerH = 128;
  page.drawRectangle({
    x: 0,
    y: PAGE_H - headerH,
    width: PAGE_W,
    height: headerH,
    color: NAVY_DEEP,
  });
  page.drawRectangle({
    x: 0,
    y: PAGE_H - headerH,
    width: PAGE_W,
    height: 4,
    color: ORANGE,
  });

  page.drawText(pdfSafe('COTIZACIÓN DE EVENTO · TERRAZA'), {
    x: MARGIN_X,
    y: PAGE_H - 28,
    size: 8,
    font: fontBold,
    color: ORANGE,
  });
  page.drawText(pdfSafe('Carranza 50'), {
    x: MARGIN_X,
    y: PAGE_H - 52,
    size: 22,
    font: fontBold,
    color: WHITE,
  });
  page.drawText(pdfSafe('Propuesta para tu celebración'), {
    x: MARGIN_X,
    y: PAGE_H - 72,
    size: 10,
    font,
    color: rgb(0.85, 0.88, 0.93),
  });

  const contactX = PAGE_W - MARGIN_X - 160;
  page.drawText(pdfSafe('CONTACTO EVENTOS'), {
    x: contactX,
    y: PAGE_H - 28,
    size: 7,
    font: fontBold,
    color: rgb(0.7, 0.75, 0.82),
  });
  page.drawText(pdfSafe(EVENTOS_CONTACT.email), {
    x: contactX,
    y: PAGE_H - 42,
    size: 9,
    font: fontBold,
    color: WHITE,
  });
  page.drawText(pdfSafe(EVENTOS_CONTACT.phone), {
    x: contactX,
    y: PAGE_H - 56,
    size: 9,
    font,
    color: rgb(0.85, 0.88, 0.93),
  });

  page.drawText(
    pdfSafe(
      `Folio ${doc.quote_number || 'Pendiente'}  ·  Emitida ${formatIssuedAtEs(doc.issued_at)}`
    ),
    {
      x: MARGIN_X,
      y: PAGE_H - 100,
      size: 9,
      font,
      color: rgb(0.75, 0.8, 0.88),
    }
  );

  y = PAGE_H - headerH - 24;

  // —— Cliente + meta ——
  const drawSectionLabel = (label: string) => {
    ensureSpace(28);
    page.drawText(pdfSafe(label.toUpperCase()), {
      x: MARGIN_X,
      y,
      size: 8,
      font: fontBold,
      color: ORANGE_DEEP,
    });
    y -= 16;
  };

  drawSectionLabel('Cliente');
  const clientName = doc.client_name || 'Cliente por asignar';
  page.drawText(pdfSafe(clientName), {
    x: MARGIN_X,
    y,
    size: 14,
    font: fontBold,
    color: NAVY,
  });
  y -= 16;
  if (doc.contact_name) {
    page.drawText(pdfSafe(`Contacto: ${doc.contact_name}`), {
      x: MARGIN_X,
      y,
      size: 9,
      font,
      color: MUTED,
    });
    y -= 12;
  }
  if (doc.phone || doc.email) {
    page.drawText(
      pdfSafe([doc.phone, doc.email].filter(Boolean).join(' · ')),
      {
        x: MARGIN_X,
        y,
        size: 9,
        font,
        color: MUTED,
      }
    );
    y -= 12;
  }

  y -= 8;
  const metaRows: Array<[string, string]> = [
    ['Celebración', doc.celebration || '—'],
    ['Personas', `${doc.pax} pax`],
    ['Fecha del evento', formatEventDateEs(doc.event_date)],
  ];
  for (const [label, value] of metaRows) {
    ensureSpace(28);
    page.drawText(pdfSafe(label.toUpperCase()), {
      x: MARGIN_X,
      y,
      size: 7,
      font: fontBold,
      color: MUTED,
    });
    y -= 12;
    const lines = wrapLines(value, fontBold, 10, CONTENT_W);
    for (const ln of lines) {
      ensureSpace(14);
      page.drawText(pdfSafe(ln), {
        x: MARGIN_X,
        y,
        size: 10,
        font: fontBold,
        color: NAVY,
      });
      y -= 13;
    }
    y -= 4;
  }

  y -= 6;
  page.drawRectangle({
    x: MARGIN_X,
    y: y + 4,
    width: CONTENT_W,
    height: 0.6,
    color: RULE,
  });
  y -= 16;

  // —— Conceptos ——
  drawSectionLabel('Conceptos');

  for (const line of doc.lines) {
    const opts = optionEntries(line.options);
    const title = line.description.split(' · ')[0] || line.description;
    const importe = Number(line.quantity) * Number(line.unit_price);
    const priceCol = 118;
    const descW = CONTENT_W - priceCol - 8;
    const titleLines = wrapLines(title, fontBold, 11, descW);
    let blockH = titleLines.length * 14 + 18;
    if (opts.length) blockH += opts.length * 12;
    else if (line.description.includes(' · ')) blockH += 14;
    ensureSpace(blockH + 8);

    let ty = y;
    for (const tl of titleLines) {
      page.drawText(pdfSafe(tl), {
        x: MARGIN_X,
        y: ty,
        size: 11,
        font: fontBold,
        color: NAVY,
      });
      ty -= 14;
    }

    const qtyLabel = `${line.quantity} × ${formatMxn(line.unit_price)}${
      line.unit ? ` / ${line.unit}` : ''
    }`;
    const qtyW = font.widthOfTextAtSize(pdfSafe(qtyLabel), 8);
    page.drawText(pdfSafe(qtyLabel), {
      x: PAGE_W - MARGIN_X - qtyW,
      y,
      size: 8,
      font,
      color: MUTED,
    });
    const impW = fontBold.widthOfTextAtSize(pdfSafe(formatMxn(importe)), 10);
    page.drawText(pdfSafe(formatMxn(importe)), {
      x: PAGE_W - MARGIN_X - impW,
      y: y - 12,
      size: 10,
      font: fontBold,
      color: NAVY,
    });

    y = ty;
    if (opts.length) {
      for (const o of opts) {
        ensureSpace(14);
        page.drawText(pdfSafe(`${o.label}: ${o.value}`), {
          x: MARGIN_X,
          y,
          size: 9,
          font,
          color: MUTED,
        });
        y -= 12;
      }
    } else if (line.description.includes(' · ')) {
      const rest = line.description.split(' · ').slice(1).join(' · ');
      for (const rl of wrapLines(rest, font, 9, descW)) {
        ensureSpace(12);
        page.drawText(pdfSafe(rl), {
          x: MARGIN_X,
          y,
          size: 9,
          font,
          color: MUTED,
        });
        y -= 12;
      }
    }
    y -= 10;
    page.drawRectangle({
      x: MARGIN_X,
      y: y + 6,
      width: CONTENT_W,
      height: 0.4,
      color: RULE,
    });
    y -= 6;
  }

  // —— Totales ——
  ensureSpace(78);
  const boxH = 64;
  page.drawRectangle({
    x: MARGIN_X,
    y: y - boxH + 14,
    width: CONTENT_W,
    height: boxH,
    color: ORANGE_SOFT,
  });
  const row = (label: string, value: string, bold = false, size = 10) => {
    page.drawText(pdfSafe(label), {
      x: MARGIN_X + 14,
      y,
      size,
      font: bold ? fontBold : font,
      color: bold ? NAVY : MUTED,
    });
    const vw = (bold ? fontBold : font).widthOfTextAtSize(pdfSafe(value), size);
    page.drawText(pdfSafe(value), {
      x: PAGE_W - MARGIN_X - 14 - vw,
      y,
      size,
      font: bold ? fontBold : font,
      color: NAVY,
    });
    y -= 16;
  };
  y -= 2;
  row('Subtotal', formatMxn(totals.subtotal));
  row(
    `Servicio ${(totals.servicioPct * 100).toFixed(0)}%${
      !totals.applyServicio ? ' (no aplica)' : ''
    }`,
    formatMxn(totals.servicioAmount)
  );
  row('Total', formatMxn(totals.total), true, 12);
  y -= 18;

  // —— Observaciones ——
  if (doc.notes?.trim()) {
    drawSectionLabel('Observaciones');
    for (const ln of wrapLines(doc.notes, font, 9, CONTENT_W)) {
      ensureSpace(12);
      page.drawText(pdfSafe(ln || ' '), {
        x: MARGIN_X,
        y,
        size: 9,
        font,
        color: MUTED,
      });
      y -= 12;
    }
    y -= 8;
  }

  // —— Condiciones ——
  drawSectionLabel('Condiciones');
  for (const ln of wrapLines(holdNoteEs(doc.hold_until), font, 9, CONTENT_W)) {
    ensureSpace(12);
    page.drawText(pdfSafe(ln), {
      x: MARGIN_X,
      y,
      size: 9,
      font,
      color: MUTED,
    });
    y -= 12;
  }
  y -= 4;
  for (const t of terms) {
    const lines = wrapLines(`· ${t}`, font, 9, CONTENT_W);
    for (const ln of lines) {
      ensureSpace(12);
      page.drawText(pdfSafe(ln), {
        x: MARGIN_X,
        y,
        size: 9,
        font,
        color: MUTED,
      });
      y -= 12;
    }
  }

  // —— Footer ——
  ensureSpace(56);
  y -= 8;
  page.drawRectangle({
    x: MARGIN_X,
    y: y + 4,
    width: CONTENT_W,
    height: 0.5,
    color: RULE,
  });
  y -= 14;
  page.drawText(pdfSafe(EVENTOS_CONTACT.brand), {
    x: MARGIN_X,
    y,
    size: 9,
    font: fontBold,
    color: NAVY,
  });
  y -= 12;
  for (const ln of wrapLines(EVENTOS_CONTACT.address, font, 8, CONTENT_W)) {
    page.drawText(pdfSafe(ln), {
      x: MARGIN_X,
      y,
      size: 8,
      font,
      color: MUTED,
    });
    y -= 11;
  }
  page.drawText(
    pdfSafe(
      `${EVENTOS_CONTACT.email}  ·  ${EVENTOS_CONTACT.phone}  ·  ${EVENTOS_CONTACT.web}`
    ),
    {
      x: MARGIN_X,
      y,
      size: 8,
      font,
      color: MUTED,
    }
  );

  return pdf.save();
}

/** Dispara descarga del PDF en el navegador (sin diálogo de impresión). */
export async function downloadCotizacionPdf(doc: CotizacionDoc): Promise<void> {
  const bytes = await buildCotizacionPdfBytes(doc);
  const blob = new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cotizacionPdfFilename(doc);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export { cotizacionPdfFilename };
