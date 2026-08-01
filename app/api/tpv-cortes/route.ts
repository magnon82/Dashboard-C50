import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { requireVentasSession } from '@/app/lib/tpv-api';
import {
  TPV_MAX_BYTES,
  TPV_MIN_BYTES,
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_STORAGE_BUCKET,
  buildDayCompleteness,
  computeNetoBanco,
  parseTerminalNumber,
  defaultCorteDateCdmx,
  todayCdmxIso,
  validateTpvImageQuality,
  asTpvRow,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

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

/** GET /api/tpv-cortes?date= | from=&to= | week=1 | recent=1 */
export async function GET(request: Request) {
  const auth = await requireVentasSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const date = url.searchParams.get('date')?.slice(0, 10) || null;
  const from = url.searchParams.get('from')?.slice(0, 10) || null;
  const to = url.searchParams.get('to')?.slice(0, 10) || null;
  const week = url.searchParams.get('week');
  const recent = url.searchParams.get('recent') === '1';
  const withUrls = url.searchParams.get('urls') === '1';
  const withDay = url.searchParams.get('day') === '1';

  try {
    const sb = getServiceSupabase();
    let q = sb
      .from('tpv_corte_uploads')
      .select('*')
      .order('corte_date', { ascending: false })
      .order('terminal_number', { ascending: true })
      .limit(recent ? 300 : 200);

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
 * - multipart file + terminal_number → foto (reemplaza slot del día)
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
            hint: '¿Ejecutaste supabase/tpv_cortes.sql?',
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

    // Defensa extra en servidor
    if (file.size > TPV_MAX_BYTES || file.size < TPV_MIN_BYTES) {
      return NextResponse.json(
        {
          error: 'La foto no tiene el tamaño adecuado. Vuelve a tomar la foto.',
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

    const totalCobradoRaw = form.get('total_cobrado');
    const propinaRaw = form.get('propina');
    const netoRaw = form.get('neto_banco');
    const totalCobrado =
      totalCobradoRaw != null && String(totalCobradoRaw) !== ''
        ? Number(totalCobradoRaw)
        : null;
    const propina =
      propinaRaw != null && String(propinaRaw) !== ''
        ? Number(propinaRaw)
        : null;
    let netoBanco =
      netoRaw != null && String(netoRaw) !== '' ? Number(netoRaw) : null;
    if (netoBanco == null && totalCobrado != null) {
      netoBanco = computeNetoBanco(totalCobrado, propina);
    }

    const notes = String(form.get('notes') || '').trim() || null;
    const ext = mime.includes('png')
      ? 'png'
      : mime.includes('webp')
        ? 'webp'
        : mime.includes('heic') || mime.includes('heif')
          ? 'heic'
          : 'jpg';

    const id = crypto.randomUUID();
    const storagePath = `${corteDate}/t${terminal}-${id}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const sb = getServiceSupabase();
    await deleteExistingForTerminal(sb, corteDate, terminal);

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

    const hasAmounts =
      totalCobrado != null || propina != null || netoBanco != null;
    const row = {
      id,
      corte_date: corteDate,
      terminal_number: terminal,
      entry_kind: 'photo',
      terminal_label: `Terminal ${terminal}`,
      uploader_username: auth.username,
      storage_path: storagePath,
      mime_type: mime,
      byte_size: file.size,
      width_px: widthPx || null,
      height_px: heightPx || null,
      sharpness_score: sharpness ?? null,
      total_cobrado: totalCobrado,
      propina,
      neto_banco: netoBanco,
      ocr_text: null,
      ocr_status: 'skipped',
      status: hasAmounts ? 'parsed' : 'pending',
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
          hint: '¿Ejecutaste supabase/tpv_cortes.sql (tabla + terminal_number)?',
        },
        { status: 500 }
      );
    }

    const upload = asTpvRow(data as Record<string, unknown>);
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

    return NextResponse.json({ upload, day }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al subir corte TPV' },
      { status: 500 }
    );
  }
}
