/**
 * PDF conciliación INGRESO CRISTALERIA vs 0.2% venta Infocaja (semanas Acumulado).
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
  CRISTALERIA_FORMULA_BLURB,
  CRISTALERIA_INGRESO_PCT,
  type CristaleriaConciliacionSummary,
  type CristaleriaWeekRow,
  type CristaleriaWeekStatus,
} from '@/app/lib/cristaleria-conciliacion';
import { SUITE } from '@/app/lib/themes';

const PAGE_W = 792; // letter landscape
const PAGE_H = 612;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const NAVY = hexToRgb(SUITE.navy);
const NAVY_DEEP = hexToRgb(SUITE.navyDeep);
const ORANGE = hexToRgb(SUITE.orange);
const MUTED = hexToRgb(SUITE.muted);
const WHITE = rgb(1, 1, 1);
const RULE = hexToRgb(SUITE.border);
const ROW_ALT = rgb(0.97, 0.98, 0.99);

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

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  return `${sign}$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number | null): string {
  if (n == null) return '-';
  return `${(n * 100).toFixed(2)}%`;
}

const STATUS_LABEL: Record<CristaleriaWeekStatus, string> = {
  ok: 'OK',
  bajo: 'Bajo 0.2%',
  sobre: 'Sobre 0.2%',
  falta_abono: 'Sin abono',
  abono_sin_venta: 'Abono sin venta',
};

/** Rellena semanas faltantes en el rango (p. ej. S01–S32). */
export function cristaleriaWeeksInRange(
  summary: CristaleriaConciliacionSummary,
  fromWeek: number,
  toWeek: number
): CristaleriaWeekRow[] {
  const byWeek = new Map(summary.weeks.map((w) => [w.week, w]));
  const out: CristaleriaWeekRow[] = [];
  for (let w = fromWeek; w <= toWeek; w++) {
    const hit = byWeek.get(w);
    if (hit) {
      out.push(hit);
      continue;
    }
    out.push({
      year: summary.year,
      week: w,
      label: `S${String(w).padStart(2, '0')}/${summary.year}`,
      ventaTotal: 0,
      abonoFlujo: 0,
      esperado2pct: 0,
      excelActual: 0,
      delta: 0,
      faltante: 0,
      pctReal: null,
      pctCobrado: null,
      status: 'falta_abono',
      abonoFecha: null,
      concepto: null,
    });
  }
  return out;
}

type Col = { key: string; title: string; w: number; align: 'left' | 'right' };

const COLS: Col[] = [
  { key: 'sem', title: 'Sem', w: 34, align: 'left' },
  { key: 'venta', title: 'Venta Total', w: 82, align: 'right' },
  { key: 'debido', title: 'Debido 0.2%', w: 78, align: 'right' },
  { key: 'abono', title: 'Abono reg.', w: 72, align: 'right' },
  { key: 'faltante', title: 'Faltante', w: 72, align: 'right' },
  { key: 'pctCob', title: '% cobrado', w: 52, align: 'right' },
  { key: 'pctVta', title: '% s/venta', w: 48, align: 'right' },
  { key: 'status', title: 'Estado', w: 72, align: 'left' },
];

function cellText(row: CristaleriaWeekRow, key: string): string {
  switch (key) {
    case 'sem':
      return row.label;
    case 'venta':
      return row.ventaTotal > 0 ? money(row.ventaTotal) : '-';
    case 'debido':
      return row.ventaTotal > 0 ? money(row.esperado2pct) : '-';
    case 'abono':
      return row.abonoFlujo > 0 ? money(row.abonoFlujo) : '-';
    case 'faltante':
      return row.ventaTotal > 0 ? money(row.faltante) : '-';
    case 'pctCob':
      return pct(row.pctCobrado);
    case 'pctVta':
      return pct(row.pctReal);
    case 'status':
      return STATUS_LABEL[row.status];
    default:
      return '';
  }
}

function drawTableHeader(
  page: PDFPage,
  y: number,
  fontBold: PDFFont
): number {
  let x = MARGIN;
  page.drawRectangle({
    x: MARGIN,
    y: y - 16,
    width: CONTENT_W,
    height: 16,
    color: NAVY,
  });
  for (const col of COLS) {
    page.drawText(pdfSafe(col.title), {
      x: col.align === 'right' ? x + col.w - 4 : x + 4,
      y: y - 12,
      size: 7,
      font: fontBold,
      color: WHITE,
    });
    x += col.w;
  }
  return y - 16;
}

function drawTableRow(
  page: PDFPage,
  y: number,
  row: CristaleriaWeekRow,
  idx: number,
  font: PDFFont,
  fontBold: PDFFont
): number {
  const h = 13;
  if (idx % 2 === 1) {
    page.drawRectangle({
      x: MARGIN,
      y: y - h,
      width: CONTENT_W,
      height: h,
      color: ROW_ALT,
    });
  }
  let x = MARGIN;
  for (const col of COLS) {
    const text = cellText(row, col.key);
    const useBold = col.key === 'status' && row.status !== 'ok';
    const f = useBold ? fontBold : font;
    const tw = f.widthOfTextAtSize(pdfSafe(text), 7);
    const tx =
      col.align === 'right'
        ? x + col.w - tw - 4
        : x + 4;
    page.drawText(pdfSafe(text), {
      x: tx,
      y: y - 10,
      size: 7,
      font: f,
      color: NAVY,
    });
    x += col.w;
  }
  return y - h;
}

export async function buildCristaleriaConciliacionPdfBytes(opts: {
  summary: CristaleriaConciliacionSummary;
  fromWeek?: number;
  toWeek?: number;
}): Promise<Uint8Array> {
  const { summary } = opts;
  const fromWeek = opts.fromWeek ?? 1;
  const toWeek = opts.toWeek ?? 32;
  const rows = cristaleriaWeeksInRange(summary, fromWeek, toWeek);

  const ventaTotal = rows.reduce((s, r) => s + r.ventaTotal, 0);
  const abonoFlujo = rows.reduce((s, r) => s + r.abonoFlujo, 0);
  const debido = ventaTotal * CRISTALERIA_INGRESO_PCT;
  const faltanteTotal = debido - abonoFlujo;
  const pctCobrado = debido > 0 ? abonoFlujo / debido : null;
  const pctSobreVenta = ventaTotal > 0 ? abonoFlujo / ventaTotal : null;

  const counts = {
    ok: 0,
    bajo: 0,
    sobre: 0,
    falta_abono: 0,
    abono_sin_venta: 0,
  } as Record<CristaleriaWeekStatus, number>;
  for (const r of rows) counts[r.status] += 1;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  // Header band
  const headerH = 88;
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
  page.drawText(pdfSafe('CONCILIACION CRISTALERIA'), {
    x: MARGIN,
    y: PAGE_H - 32,
    size: 14,
    font: fontBold,
    color: WHITE,
  });
  page.drawText(
    pdfSafe(
      `Semanas ${fromWeek}-${toWeek} / ${summary.year}  ·  Debido = venta x 0.002 (0.2%)`
    ),
    {
      x: MARGIN,
      y: PAGE_H - 50,
      size: 9,
      font,
      color: ORANGE,
    }
  );
  page.drawText(pdfSafe(`Generado ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`), {
    x: MARGIN,
    y: PAGE_H - 66,
    size: 7,
    font,
    color: MUTED,
  });

  y = PAGE_H - headerH - 14;

  // KPI strip
  const kpis = [
    ['Venta acum.', money(ventaTotal)],
    ['Debido 0.2%', money(debido)],
    ['Abono registrado', money(abonoFlujo)],
    ['Faltante total', money(faltanteTotal)],
    ['% cobrado', pct(pctCobrado)],
    ['% s/venta', pct(pctSobreVenta)],
  ];
  const kpiW = CONTENT_W / kpis.length;
  page.drawRectangle({
    x: MARGIN,
    y: y - 36,
    width: CONTENT_W,
    height: 36,
    color: rgb(0.98, 0.99, 1),
    borderColor: RULE,
    borderWidth: 0.5,
  });
  kpis.forEach(([label, val], i) => {
    const x = MARGIN + i * kpiW + 8;
    page.drawText(pdfSafe(label), { x, y: y - 14, size: 7, font, color: MUTED });
    page.drawText(pdfSafe(val), { x, y: y - 28, size: 9, font: fontBold, color: NAVY });
  });
  y -= 48;

  page.drawText(pdfSafe(CRISTALERIA_FORMULA_BLURB), {
    x: MARGIN,
    y: y - 8,
    size: 6.5,
    font,
    color: MUTED,
    maxWidth: CONTENT_W,
  });
  y -= 22;

  y = drawTableHeader(page, y, fontBold);
  for (let i = 0; i < rows.length; i++) {
    y = drawTableRow(page, y, rows[i], i, font, fontBold);
  }

  // Totals row
  page.drawRectangle({
    x: MARGIN,
    y: y - 14,
    width: CONTENT_W,
    height: 14,
    color: rgb(0.93, 0.95, 0.98),
  });
  const totalCells = [
    'TOTAL',
    money(ventaTotal),
    money(debido),
    money(abonoFlujo),
    money(faltanteTotal),
    pct(pctCobrado),
    pct(pctSobreVenta),
    '',
  ];
  let x = MARGIN;
  COLS.forEach((col, i) => {
    const text = totalCells[i];
    const tw = fontBold.widthOfTextAtSize(pdfSafe(text), 7);
    const tx = col.align === 'right' ? x + col.w - tw - 4 : x + 4;
    page.drawText(pdfSafe(text), {
      x: tx,
      y: y - 11,
      size: 7,
      font: fontBold,
      color: NAVY,
    });
    x += col.w;
  });
  y -= 22;

  const foot =
    `Semanas OK ${counts.ok}  ·  Bajo 0.2% ${counts.bajo}  ·  Sobre 0.2% ${counts.sobre}  ·  ` +
    `Sin abono ${counts.falta_abono}  ·  Abono sin venta ${counts.abono_sin_venta}`;
  page.drawText(pdfSafe(foot), {
    x: MARGIN,
    y: y - 8,
    size: 7,
    font,
    color: MUTED,
  });

  return pdf.save();
}

export function cristaleriaConciliacionPdfFilename(
  year: number,
  fromWeek: number,
  toWeek: number
): string {
  return `reporte-cristaleria-conciliacion-${year}-s${String(fromWeek).padStart(2, '0')}-s${String(toWeek).padStart(2, '0')}.pdf`;
}
