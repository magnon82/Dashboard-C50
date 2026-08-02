import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireVentasSession } from '@/app/lib/tpv-api';
import {
  TPV_UPLOAD_MAX_BYTES,
  TPV_MIN_BYTES,
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_STORAGE_BUCKET,
  buildAdminReportDay,
  buildDayCompleteness,
  computeNetoBanco,
  parsePhotoKind,
  parseTerminalNumber,
  defaultCorteDateCdmx,
  todayCdmxIso,
  validateTpvImageQuality,
  asTpvRow,
  type TpvAdminReportDay,
  type TpvAdminReportRptSummary,
  type TpvCorteUpload,
  type TpvPhotoKind,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';
import {
  STAFF_RPT_TABLE,
  asStaffRptRow,
} from '@/app/lib/staff-rpt';
import {
  TPV_OCR_RETAKE_MSG,
  amountsFromOcr,
  decodeTicketTotalFromOcrText,
  reconcilePairAmounts,
  runTpvOcr,
} from '@/app/lib/tpv-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** OCR multipass puede tardar en CPU local */
export const maxDuration = 60;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Borra todas las filas (fotos + unused) de una terminal/día. */
async function deleteExistingForTerminal(
  sb: ReturnType<typeof getServiceSupabase>,
  corteDate: string,
  terminal: TpvTerminalNumber
) {
  const { data: existing } = await sb
    .from('tpv_corte_uploads')
    .select('id, storage_path')
    .eq('corte_date', corteDate)
    .eq('terminal_number', terminal);

  if (!existing?.length) return;
  const paths = existing
    .map((r) => r.storage_path)
    .filter((p): p is string => Boolean(p));
  if (paths.length) {
    await sb.storage.from(TPV_STORAGE_BUCKET).remove(paths);
  }
  await sb
    .from('tpv_corte_uploads')
    .delete()
    .eq('corte_date', corteDate)
    .eq('terminal_number', terminal);
}

/** Borra solo la foto de un kind (+ cualquier unused) al subir una foto. */
async function deleteExistingForPhotoKind(
  sb: ReturnType<typeof getServiceSupabase>,
  corteDate: string,
  terminal: TpvTerminalNumber,
  photoKind: TpvPhotoKind
) {
  const { data: existing } = await sb
    .from('tpv_corte_uploads')
    .select('id, storage_path, entry_kind, photo_kind')
    .eq('corte_date', corteDate)
    .eq('terminal_number', terminal);

  if (!existing?.length) return;

  const toRemove = existing.filter(
    (r) =>
      r.entry_kind === 'unused' ||
      (r.entry_kind === 'photo' && r.photo_kind === photoKind) ||
      // Legacy sin photo_kind: tratar como venta
      (r.entry_kind === 'photo' &&
        photoKind === 'venta' &&
        (r.photo_kind == null || r.photo_kind === ''))
  );
  if (!toRemove.length) return;

  const paths = toRemove
    .map((r) => r.storage_path)
    .filter((p): p is string => Boolean(p));
  if (paths.length) {
    await sb.storage.from(TPV_STORAGE_BUCKET).remove(paths);
  }
  const ids = toRemove.map((r) => r.id);
  await sb.from('tpv_corte_uploads').delete().in('id', ids);
}

/**
 * Tras tener venta + propina: cobrado = ticket_total − propina;
 * neto banco = cobrado + propinas (depósito).
 */
async function reconcileTerminalAfterUpload(
  sb: ReturnType<typeof getServiceSupabase>,
  corteDate: string,
  terminal: TpvTerminalNumber
): Promise<void> {
  const { data } = await sb
    .from('tpv_corte_uploads')
    .select('*')
    .eq('corte_date', corteDate)
    .eq('terminal_number', terminal)
    .eq('entry_kind', 'photo');

  if (!data?.length) return;
  const rows = data.map((r) => asTpvRow(r as Record<string, unknown>));
  const venta = rows.find((r) => r.photo_kind === 'venta') || null;
  const propinaRow = rows.find((r) => r.photo_kind === 'propina') || null;
  if (!venta || !propinaRow) return;

  const tip = propinaRow.propina;
  if (tip == null) return;

  const ticketFromMeta = decodeTicketTotalFromOcrText(venta.ocr_text);
  const consumoFromMeta = (() => {
    const m = propinaRow.ocr_text?.match(/consumo=([\d.]+)/);
    return m ? Number(m[1]) : null;
  })();

  const reconciled = reconcilePairAmounts({
    ventaTicketTotal: ticketFromMeta ?? venta.neto_banco,
    ventaCobrado: venta.total_cobrado,
    propinaAmount: tip,
    propinaConsumo: Number.isFinite(consumoFromMeta) ? consumoFromMeta : null,
  });
  if (!reconciled) return;

  const now = new Date().toISOString();
  await sb
    .from('tpv_corte_uploads')
    .update({
      total_cobrado: reconciled.cobrado,
      neto_banco: reconciled.neto,
      status: 'parsed',
      updated_at: now,
    })
    .eq('id', venta.id);

  await sb
    .from('tpv_corte_uploads')
    .update({
      propina: reconciled.propina,
      neto_banco: reconciled.neto,
      status: 'parsed',
      updated_at: now,
    })
    .eq('id', propinaRow.id);
}

function mondaySundayCdmx(today = todayCdmxIso()): { mon: string; sun: string } {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  const mon = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const sun = new Date(dt);
  sun.setDate(sun.getDate() + 6);
  const sunKey = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}`;
  return { mon, sun: sunKey };
}

function rptToSummary(
  r: ReturnType<typeof asStaffRptRow>
): TpvAdminReportRptSummary {
  return {
    wi_amount: r.wi_amount,
    eventos_amount: r.eventos_amount,
    propinas: r.propinas,
    efectivo_tombola: r.efectivo_tombola,
    efectivo_contado: r.efectivo_contado,
    efectivo_infocaja: r.efectivo_infocaja,
    bancos_neto_tpv: r.bancos_neto_tpv,
    bancos_cobrado_tpv: r.bancos_cobrado_tpv,
    bancos_propina_tpv: r.bancos_propina_tpv,
    tpv_complete: r.tpv_complete,
    created_by: r.created_by,
    updated_by: r.updated_by,
  };
}

/**
 * GET /api/tpv-cortes?date= | from=&to= | week=1 | recent=1 | report=1
 * report=1 → listado admin de días (fotos + cierre staff_rpt_diario), newest first.
 */
export async function GET(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const date = url.searchParams.get('date')?.slice(0, 10) || null;
  const from = url.searchParams.get('from')?.slice(0, 10) || null;
  const to = url.searchParams.get('to')?.slice(0, 10) || null;
  const week = url.searchParams.get('week');
  const recent = url.searchParams.get('recent') === '1';
  const report = url.searchParams.get('report') === '1';
  const withUrls = url.searchParams.get('urls') === '1';
  const withDay = url.searchParams.get('day') === '1';
  const reportLimit = Math.min(
    120,
    Math.max(10, Number(url.searchParams.get('limit') || 60) || 60)
  );

  try {
    const sb = getServiceSupabase();

    // --- Admin report: días con uploads y/o cierre RPT ---
    if (report) {
      const { data: uploadRows, error: upErr } = await sb
        .from('tpv_corte_uploads')
        .select('*')
        .order('corte_date', { ascending: false })
        .order('terminal_number', { ascending: true })
        .order('photo_kind', { ascending: true })
        .limit(800);

      if (upErr) {
        return NextResponse.json(
          {
            error: upErr.message,
            hint: '¿Ejecutaste supabase/tpv_cortes.sql en el SQL Editor?',
          },
          { status: 500 }
        );
      }

      const uploads = (uploadRows || []).map((r) =>
        asTpvRow(r as Record<string, unknown>)
      );

      let rptByDate = new Map<string, TpvAdminReportRptSummary>();
      const { data: rptRows, error: rptErr } = await sb
        .from(STAFF_RPT_TABLE)
        .select('*')
        .order('rpt_date', { ascending: false })
        .limit(reportLimit);

      if (!rptErr && rptRows) {
        for (const raw of rptRows) {
          const row = asStaffRptRow(raw as Record<string, unknown>);
          rptByDate.set(row.rpt_date, rptToSummary(row));
        }
      }

      const dateSet = new Set<string>();
      for (const u of uploads) dateSet.add(u.corte_date);
      for (const d of rptByDate.keys()) dateSet.add(d);
      if (from && to) {
        for (const d of [...dateSet]) {
          if (d < from || d > to) dateSet.delete(d);
        }
      }

      const dates = [...dateSet]
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
        .slice(0, reportLimit);

      const byDate = new Map<string, TpvCorteUpload[]>();
      for (const u of uploads) {
        if (!dateSet.has(u.corte_date)) continue;
        const list = byDate.get(u.corte_date) || [];
        list.push(u);
        byDate.set(u.corte_date, list);
      }

      const days: TpvAdminReportDay[] = dates.map((d) =>
        buildAdminReportDay(d, byDate.get(d) || [], rptByDate.get(d) || null)
      );

      // Detalle de un día (fotos + URLs) si piden date= junto con report
      let detailUploads: TpvCorteUpload[] | null = null;
      let detailDay = null;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        detailUploads = byDate.get(date) || [];
        if (withUrls) {
          await Promise.all(
            detailUploads.map(async (row) => {
              if (!row.storage_path) {
                row.image_url = null;
                return;
              }
              const { data: signed } = await sb.storage
                .from(TPV_STORAGE_BUCKET)
                .createSignedUrl(row.storage_path, 60 * 30);
              row.image_url = signed?.signedUrl || null;
            })
          );
        }
        detailDay = buildDayCompleteness(detailUploads, date);
      }

      return NextResponse.json({
        days,
        count: days.length,
        rptError: rptErr
          ? 'No se pudo leer staff_rpt_diario (¿ejecutaste supabase/staff_rpt_diario.sql?)'
          : null,
        uploads: detailUploads,
        day: detailDay,
        date: date || null,
      });
    }

    let q = sb
      .from('tpv_corte_uploads')
      .select('*')
      .order('corte_date', { ascending: false })
      .order('terminal_number', { ascending: true })
      .order('photo_kind', { ascending: true })
      .limit(recent ? 500 : 200);

    const corteDateForDay = date || defaultCorteDateCdmx();

    if (recent) {
      // Sin filtro de fecha: galería admin / listado reciente (más nuevos primero).
    } else if (week === '1' || week === 'current') {
      const { mon, sun } = mondaySundayCdmx();
      q = q.gte('corte_date', mon).lte('corte_date', sun);
    } else if (date) {
      q = q.eq('corte_date', date);
    } else if (from && to) {
      q = q.gte('corte_date', from).lte('corte_date', to);
    } else {
      q = q.eq('corte_date', corteDateForDay);
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          hint: '¿Ejecutaste supabase/tpv_cortes.sql en el SQL Editor?',
        },
        { status: 500 }
      );
    }

    const rows = (data || []).map((r) => asTpvRow(r as Record<string, unknown>));

    if (withUrls) {
      await Promise.all(
        rows.map(async (row) => {
          if (!row.storage_path) {
            row.image_url = null;
            return;
          }
          const { data: signed } = await sb.storage
            .from(TPV_STORAGE_BUCKET)
            .createSignedUrl(row.storage_path, 60 * 30);
          row.image_url = signed?.signedUrl || null;
        })
      );
    }

    const day =
      withDay || (!recent && (date || (!week && !from)))
        ? buildDayCompleteness(
            rows,
            week ? defaultCorteDateCdmx() : corteDateForDay
          )
        : null;

    return NextResponse.json({
      uploads: rows,
      count: rows.length,
      day,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al listar cortes TPV' },
      { status: 500 }
    );
  }
}

/**
 * POST:
 * - multipart file + terminal_number + photo_kind (venta|propina) → foto
 * - JSON { entry_kind: 'unused', terminal_number, corte_date? } → no se usó
 */
export async function POST(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const contentType = request.headers.get('content-type') || '';

  try {
    // --- Unused (JSON) ---
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      if (String(body.entry_kind) !== 'unused') {
        return NextResponse.json(
          { error: 'Para foto usa multipart; para no-uso envía entry_kind=unused' },
          { status: 400 }
        );
      }
      const terminal = parseTerminalNumber(body.terminal_number);
      if (!terminal) {
        return NextResponse.json(
          { error: 'terminal_number debe ser 1, 2 o 3' },
          { status: 400 }
        );
      }
      const corteDate =
        String(body.corte_date || '').slice(0, 10) || defaultCorteDateCdmx();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) {
        return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
      }

      const sb = getServiceSupabase();
      await deleteExistingForTerminal(sb, corteDate, terminal);

      const id = crypto.randomUUID();
      const row = {
        id,
        corte_date: corteDate,
        terminal_number: terminal,
        entry_kind: 'unused',
        photo_kind: null,
        terminal_label: `Terminal ${terminal}`,
        uploader_username: auth.username,
        storage_path: null,
        mime_type: null,
        byte_size: null,
        width_px: null,
        height_px: null,
        sharpness_score: null,
        total_cobrado: null,
        propina: null,
        neto_banco: null,
        ocr_text: null,
        ocr_status: 'skipped',
        status: 'unused',
        notes:
          String(body.notes || '').trim() ||
          `No se utilizó la terminal ${terminal}`,
        verified_by: auth.username,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await sb
        .from('tpv_corte_uploads')
        .insert(row)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json(
          {
            error: error.message,
            hint: '¿Ejecutaste supabase/tpv_cortes.sql o tpv_cortes_two_photos.sql?',
          },
          { status: 500 }
        );
      }

      const upload = asTpvRow(data as Record<string, unknown>);
      const { data: dayRows } = await sb
        .from('tpv_corte_uploads')
        .select('*')
        .eq('corte_date', corteDate);
      const day = buildDayCompleteness(
        (dayRows || []).map((r) => asTpvRow(r as Record<string, unknown>)),
        corteDate
      );

      return NextResponse.json({ upload, day }, { status: 201 });
    }

    // --- Photo (multipart) ---
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo (file)' }, { status: 400 });
    }

    const terminal = parseTerminalNumber(form.get('terminal_number'));
    if (!terminal) {
      return NextResponse.json(
        { error: 'Elige la terminal: 1, 2 o 3' },
        { status: 400 }
      );
    }

    const photoKind =
      parsePhotoKind(form.get('photo_kind')) ||
      parsePhotoKind(form.get('kind'));
    if (!photoKind) {
      return NextResponse.json(
        {
          error:
            'Indica photo_kind: venta (Totalización) o propina (Reporte de propinas)',
        },
        { status: 400 }
      );
    }

    const mime = (file.type || 'image/jpeg').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        { error: 'Formato no permitido. Usa JPG, PNG o HEIC.' },
        { status: 400 }
      );
    }

    const widthPx = Number(form.get('width_px') || 0) || 0;
    const heightPx = Number(form.get('height_px') || 0) || 0;
    const sharpnessRaw = form.get('sharpness');
    const sharpness =
      sharpnessRaw != null && String(sharpnessRaw) !== ''
        ? Number(sharpnessRaw)
        : undefined;

    const quality = validateTpvImageQuality({
      width: widthPx || TPV_MIN_LONG_SIDE,
      height: heightPx || TPV_MIN_LONG_SIDE,
      byteSize: file.size,
      sharpness,
    });
    if (!quality.ok) {
      return NextResponse.json(
        {
          error: quality.errors[0] || 'La foto no pasó el control de calidad. Vuelve a tomar la foto.',
          errors: quality.errors,
          retake: true,
        },
        { status: 400 }
      );
    }

    // Defensa extra en servidor (Vercel ~4.5 MB; cliente comprime a ≤3 MB)
    if (file.size > TPV_UPLOAD_MAX_BYTES || file.size < TPV_MIN_BYTES) {
      return NextResponse.json(
        {
          error:
            file.size > TPV_UPLOAD_MAX_BYTES
              ? 'Foto demasiado grande. Actualiza la página, toma de nuevo la foto y súbela (se comprime sola).'
              : 'La foto no tiene el tamaño adecuado. Vuelve a tomar la foto.',
          retake: true,
        },
        { status: 400 }
      );
    }
    if (
      widthPx &&
      heightPx &&
      Math.max(widthPx, heightPx) < TPV_MIN_LONG_SIDE
    ) {
      return NextResponse.json(
        {
          error: `La foto es muy chica. Vuelve a tomar la foto (≥${TPV_MIN_LONG_SIDE}px).`,
          retake: true,
        },
        { status: 400 }
      );
    }
    if (sharpness != null && sharpness < TPV_MIN_SHARPNESS) {
      return NextResponse.json(
        {
          error:
            'La foto se ve borrosa. Enfoca el ticket y vuelve a tomar la foto.',
          retake: true,
        },
        { status: 400 }
      );
    }

    const corteDate =
      String(form.get('corte_date') || '').slice(0, 10) ||
      defaultCorteDateCdmx();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(corteDate)) {
      return NextResponse.json({ error: 'Fecha de corte inválida' }, { status: 400 });
    }

    // Montos manuales opcionales (override / fallback si OCR no corre)
    const totalCobradoRaw = form.get('total_cobrado');
    const propinaRaw = form.get('propina');
    const manualCobrado =
      totalCobradoRaw != null && String(totalCobradoRaw) !== ''
        ? Number(totalCobradoRaw)
        : null;
    const manualPropina =
      propinaRaw != null && String(propinaRaw) !== ''
        ? Number(propinaRaw)
        : null;

    const notes = String(form.get('notes') || '').trim() || null;
    const ext = mime.includes('png')
      ? 'png'
      : mime.includes('webp')
        ? 'webp'
        : mime.includes('heic') || mime.includes('heif')
          ? 'heic'
          : 'jpg';

    const id = crypto.randomUUID();
    const storagePath = `${corteDate}/t${terminal}-${photoKind}-${id}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // --- OCR: lee montos del ticket; si no legible → retake (no guarda) ---
    const ocr = await runTpvOcr(buffer, photoKind);
    const fromOcr = amountsFromOcr(photoKind, ocr);

    let rowCobrado: number | null = null;
    let rowPropina: number | null = null;
    let ticketTotal: number | null = null;
    let ocrText: string | null = null;
    let ocrStatus: 'done' | 'failed' | 'skipped' = 'skipped';

    if (fromOcr && ocr.ok && fromOcr.ocrStatus === 'done') {
      ocrStatus = 'done';
      ocrText = fromOcr.ocrText;
      ticketTotal = fromOcr.ticketTotal;
      if (photoKind === 'venta') {
        rowCobrado = fromOcr.totalCobrado;
      } else {
        rowPropina = fromOcr.propina;
      }
    } else if (
      photoKind === 'venta' &&
      manualCobrado != null &&
      !Number.isNaN(manualCobrado) &&
      manualCobrado >= 0
    ) {
      // Fallback manual solo si el cliente envió monto (edición / sin OCR)
      rowCobrado = manualCobrado;
      ticketTotal = manualCobrado;
      ocrStatus = ocr.rawText ? 'failed' : 'skipped';
      ocrText = fromOcr?.ocrText || ocr.rawText || null;
    } else if (
      photoKind === 'propina' &&
      manualPropina != null &&
      !Number.isNaN(manualPropina) &&
      manualPropina >= 0
    ) {
      rowPropina = manualPropina;
      ocrStatus = ocr.rawText ? 'failed' : 'skipped';
      ocrText = fromOcr?.ocrText || ocr.rawText || null;
    } else {
      return NextResponse.json(
        {
          error: ocr.error || TPV_OCR_RETAKE_MSG,
          retake: true,
          ocr_status: 'failed',
          ocr_confidence: ocr.meanConfidence,
        },
        { status: 400 }
      );
    }

    let netoBanco =
      photoKind === 'venta' && ticketTotal != null
        ? ticketTotal
        : photoKind === 'propina' && ticketTotal != null
          ? ticketTotal
          : null;
    if (
      netoBanco == null &&
      rowCobrado != null &&
      rowPropina != null
    ) {
      netoBanco = computeNetoBanco(rowCobrado, rowPropina);
    }

    const sb = getServiceSupabase();
    await deleteExistingForPhotoKind(sb, corteDate, terminal, photoKind);

    const { error: upErr } = await sb.storage
      .from(TPV_STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: false });

    if (upErr) {
      return NextResponse.json(
        {
          error: upErr.message,
          hint: '¿Creaste el bucket tpv-cortes? Ejecuta supabase/tpv_cortes.sql',
        },
        { status: 500 }
      );
    }

    const hasAmount =
      photoKind === 'venta'
        ? rowCobrado != null && !Number.isNaN(rowCobrado)
        : rowPropina != null && !Number.isNaN(rowPropina);
    const row = {
      id,
      corte_date: corteDate,
      terminal_number: terminal,
      entry_kind: 'photo',
      photo_kind: photoKind,
      terminal_label: `Terminal ${terminal} · ${photoKind === 'venta' ? 'Venta' : 'Propinas'}`,
      uploader_username: auth.username,
      storage_path: storagePath,
      mime_type: mime,
      byte_size: file.size,
      width_px: widthPx || null,
      height_px: heightPx || null,
      sharpness_score: sharpness ?? null,
      total_cobrado: rowCobrado,
      propina: rowPropina,
      neto_banco: netoBanco,
      ocr_text: ocrText,
      ocr_status: ocrStatus,
      status: hasAmount ? 'parsed' : 'pending',
      notes,
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from('tpv_corte_uploads')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      await sb.storage.from(TPV_STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json(
        {
          error: error.message,
          hint: '¿Ejecutaste supabase/tpv_cortes_two_photos.sql (columna photo_kind)?',
        },
        { status: 500 }
      );
    }

    // Reconciliar cobrado = ticket_total − propina cuando ya hay ambas fotos
    await reconcileTerminalAfterUpload(sb, corteDate, terminal);

    const { data: refreshed } = await sb
      .from('tpv_corte_uploads')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    const upload = asTpvRow(
      (refreshed || data) as Record<string, unknown>
    ) as TpvCorteUpload;
    const { data: signed } = await sb.storage
      .from(TPV_STORAGE_BUCKET)
      .createSignedUrl(storagePath, 60 * 30);
    upload.image_url = signed?.signedUrl || null;

    const { data: dayRows } = await sb
      .from('tpv_corte_uploads')
      .select('*')
      .eq('corte_date', corteDate);
    const day = buildDayCompleteness(
      (dayRows || []).map((r) => asTpvRow(r as Record<string, unknown>)),
      corteDate
    );

    const sibling = (dayRows || [])
      .map((r) => asTpvRow(r as Record<string, unknown>))
      .filter(
        (r) =>
          r.terminal_number === terminal &&
          r.entry_kind === 'photo' &&
          r.id !== upload.id
      );

    return NextResponse.json(
      {
        upload,
        day,
        ocr: {
          status: ocrStatus,
          confidence: ocr.meanConfidence,
          ticket_total: ticketTotal,
          total_cobrado: upload.total_cobrado,
          propina: upload.propina,
          sibling: sibling[0]
            ? {
                photo_kind: sibling[0].photo_kind,
                total_cobrado: sibling[0].total_cobrado,
                propina: sibling[0].propina,
                neto_banco: sibling[0].neto_banco,
              }
            : null,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al subir corte TPV' },
      { status: 500 }
    );
  }
}
