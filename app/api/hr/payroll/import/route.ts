import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  hrSchemaMissing,
  requireRrhhSession,
  requireRrhhWrite,
} from '@/app/lib/hr-api';
import {
  isPayrollStatus,
  todayIsoCdmxPayroll,
  type HrPayrollLineInput,
} from '@/app/lib/hr-payroll';
import {
  importNominaSheet,
  listNominaSheets,
  parsePayrollCsv,
  pickLatestNominaSheet,
} from '@/app/lib/hr-payroll-import';
import { loadBaseDatosRows } from '@/app/lib/hr-payroll-drive';
import {
  formatLocalFileLabel,
  importNominaFromLocal,
  listSheetsFromLocalFile,
  parseLocalNominaFileId,
  probeLocalPayrollSources,
} from '@/app/lib/hr-payroll-local';
import {
  applyPaidSideEffects,
  enrichEmployeesFromBaseDatos,
  ensureYearPayrollFromLocal,
  replacePeriodLines,
} from '@/app/lib/hr-payroll-sync';
import type { HrPayrollStatus } from '@/app/lib/hr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERIOD_SELECT =
  'id, label, period_start, period_end, status, paid_at, notes, source_file, created_by, updated_by, created_at, updated_at';

function publicError(e: unknown): string {
  if (e instanceof Error) {
    const m = e.message;
    if (/[A-Za-z]:\\|\/Mi unidad|File Stream|ENOENT|EPERM|Downloads/i.test(m)) {
      return 'No se pudo leer el archivo de nómina local. Revisa Descargas o usa «Más… → Subir CSV / xlsx».';
    }
    return m;
  }
  return 'Error';
}

/**
 * GET /api/hr/payroll/import — lista nóminas locales (Downloads) + hojas SEM.
 * Query: ?localFileId=local:2026 | ?year=2026
 * POST — importar desde archivo local / CSV|xlsx upload / enriquecer BASE DATOS.
 *
 * Solo RR.HH. con permiso de edición en escrituras.
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const url = new URL(request.url);
    const preferred =
      url.searchParams.get('localFileId') ||
      url.searchParams.get('driveFileId') ||
      (url.searchParams.get('year')
        ? `local:${url.searchParams.get('year')}`
        : null);

    const probe = await probeLocalPayrollSources(preferred);
    return NextResponse.json({
      ready: Boolean(probe.selectedFileId && probe.sheets.length),
      source: 'local',
      sourceLabel: probe.sourceLabel,
      localConfigured: probe.localConfigured,
      localDirOk: probe.localDirOk,
      localFiles: probe.localFiles,
      localFileLabels: probe.localFiles.map((f) => ({
        id: f.id,
        year: f.year,
        name: f.label,
        fileName: f.fileName,
        modifiedTime: f.modifiedTime,
        label: formatLocalFileLabel(f),
      })),
      // Compat UI legada (misma forma que Drive, pero ids local:YYYY)
      driveConfigured: false,
      driveConnected: false,
      driveFiles: [],
      driveFileLabels: probe.localFiles.map((f) => ({
        id: f.id,
        name: f.label,
        modifiedTime: f.modifiedTime,
        label: formatLocalFileLabel(f),
      })),
      selectedFileId: probe.selectedFileId,
      selectedFileName: probe.selectedFileName,
      selectedYear: probe.selectedYear,
      sheets: probe.sheets,
      suggestedSheet: probe.suggestedSheet,
      defaultNominaOk: Boolean(probe.selectedFileId && probe.sheets.length),
      note:
        probe.localFiles.length > 0
          ? 'Nóminas C50 (archivos) · historial disponible'
          : 'No hay archivos locales de nómina. El historial usa periodos ya cargados o una subida opcional.',
    });
  } catch {
    return NextResponse.json(
      {
        ready: false,
        source: 'local',
        sourceLabel: 'Nóminas C50 (archivos)',
        localConfigured: true,
        localDirOk: false,
        localFiles: [],
        localFileLabels: [],
        driveConfigured: false,
        driveConnected: false,
        driveFiles: [],
        driveFileLabels: [],
        sheets: [],
        note: 'No hay archivos locales de nómina.',
      },
      { status: 200 }
    );
  }
}

/**
 * POST body JSON:
 * - { action: 'ensure_year', year?|localFileId?, refreshExisting? } — soft-load año
 * - { action: 'import_sheet', localFileId?|year?, sheetName?, status?, markPaid?, … }
 * - { action: 'list_sheets', localFileId?|year? }
 * - { action: 'enrich_base_datos', createMissing? }
 * - { action: 'preview_sheet', localFileId?|year?, sheetName? }
 *
 * O multipart:
 * - file (csv/xlsx) + action=upload_csv|upload_xlsx + sheetName? + status?
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhWrite(auth);
  if (denied) return denied;

  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('multipart/form-data')) {
      return await handleUpload(request, auth.username);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const action = String(body.action || '');
    const sb = getServiceSupabase();

    const resolveYear = (): number | null => {
      const fromId = parseLocalNominaFileId(
        String(body.localFileId || body.driveFileId || '').trim()
      );
      if (fromId != null) return fromId;
      const y = Number(body.year);
      return Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : null;
    };

    if (action === 'list_sheets') {
      const year = resolveYear();
      if (year == null) {
        return NextResponse.json(
          { error: 'Selecciona un archivo en «Archivos locales»' },
          { status: 400 }
        );
      }
      try {
        const listed = await listSheetsFromLocalFile(year);
        const suggested = pickLatestNominaSheet(listed.sheets);
        return NextResponse.json({
          ready: true,
          fileId: listed.file.id,
          fileName: listed.file.label,
          year: listed.file.year,
          sheets: listed.sheets,
          suggestedSheet: suggested?.name ?? null,
        });
      } catch (e) {
        return NextResponse.json({ error: publicError(e) }, { status: 400 });
      }
    }

    if (action === 'preview_sheet') {
      const year = resolveYear();
      if (year == null) {
        return NextResponse.json(
          { error: 'Selecciona un archivo local' },
          { status: 400 }
        );
      }
      try {
        const listed = await listSheetsFromLocalFile(year);
        const sheetName =
          String(body.sheetName || '').trim() ||
          pickLatestNominaSheet(listed.sheets)?.name ||
          '';
        if (!sheetName) {
          return NextResponse.json(
            { error: 'No hay hoja para previsualizar' },
            { status: 400 }
          );
        }
        const parsed = importNominaSheet(listed.buffer, sheetName);
        return NextResponse.json({
          ready: true,
          meta: parsed.meta,
          lines: parsed.lines,
          sourceLabel: `Local:${listed.file.label}#${sheetName}`,
          previewCount: parsed.lines.length,
        });
      } catch (e) {
        return NextResponse.json({ error: publicError(e) }, { status: 400 });
      }
    }

    if (action === 'enrich_base_datos') {
      try {
        const { rows, source } = await loadBaseDatosRows();
        const createMissing = body.createMissing === true;
        const filtered = createMissing
          ? rows
          : rows.filter((r) => r.status === 'activo');
        const result = await enrichEmployeesFromBaseDatos(sb, filtered);
        return NextResponse.json({
          ready: true,
          rowsRead: rows.length,
          source,
          ...result,
          message: `Base datos: ${result.matched} coincidencias, ${result.updated} actualizados, ${result.created} altos.`,
        });
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? publicError(e)
                : 'No se pudo enriquecer desde BASE DATOS',
          },
          { status: 400 }
        );
      }
    }

    if (action === 'ensure_year') {
      const year = resolveYear() ?? 2026;
      try {
        const result = await ensureYearPayrollFromLocal(
          sb,
          auth.username,
          year,
          {
            refreshExisting: body.refreshExisting === true,
            refreshPaid: body.refreshPaid === true,
            enrichBase: body.enrichBase !== false,
          }
        );
        return NextResponse.json({
          ready: true,
          ...result,
        });
      } catch (e) {
        return NextResponse.json({ error: publicError(e) }, { status: 400 });
      }
    }

    if (action === 'import_sheet') {
      const year = resolveYear();
      if (year == null) {
        return NextResponse.json(
          {
            error:
              'Selecciona un archivo en «Archivos locales» o sube un CSV/xlsx.',
          },
          { status: 400 }
        );
      }

      let sheetName = String(body.sheetName || '').trim();
      try {
        const parsed = await importNominaFromLocal(year, sheetName);
        sheetName = parsed.meta.name;
        return await persistImportedPeriod(sb, auth.username, parsed.lines, {
          label:
            String(body.label || '').trim() ||
            parsed.meta.weekLabel ||
            sheetName,
          period_start:
            String(body.period_start || '').slice(0, 10) ||
            parsed.meta.periodStart ||
            todayIsoCdmxPayroll(),
          period_end:
            String(body.period_end || '').slice(0, 10) ||
            parsed.meta.periodEnd ||
            todayIsoCdmxPayroll(),
          status: isPayrollStatus(body.status)
            ? body.status
            : body.markPaid === true
              ? 'pagado'
              : 'borrador',
          source_file: parsed.sourceLabel,
          paid_at:
            body.paid_at != null ? String(body.paid_at).slice(0, 10) : null,
          enrichBase: body.enrichBase !== false,
        });
      } catch (e) {
        return NextResponse.json({ error: publicError(e) }, { status: 400 });
      }
    }

    return NextResponse.json(
      {
        error:
          'action inválida. Usa ensure_year | import_sheet | list_sheets | preview_sheet | enrich_base_datos',
      },
      { status: 400 }
    );
  } catch (e) {
    const msg = publicError(e);
    const missing = hrSchemaMissing(msg);
    return NextResponse.json(
      {
        error: missing
          ? 'Ejecuta supabase/hr_module.sql en Supabase.'
          : msg,
      },
      { status: missing ? 503 : 500 }
    );
  }
}

async function handleUpload(request: Request, username: string) {
  const form = await request.formData();
  const action = String(form.get('action') || 'upload_csv');
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file requerido' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const statusRaw = String(form.get('status') || 'borrador');
  const status: HrPayrollStatus = isPayrollStatus(statusRaw)
    ? statusRaw
    : 'borrador';
  const markPaid = String(form.get('markPaid') || '') === 'true';
  const sb = getServiceSupabase();

  let lines: HrPayrollLineInput[] = [];
  let label = String(form.get('label') || '').trim();
  let period_start = String(form.get('period_start') || '').slice(0, 10);
  let period_end = String(form.get('period_end') || '').slice(0, 10);
  let source_file = file.name;

  if (action === 'upload_xlsx' || /\.xlsx$/i.test(file.name)) {
    const sheetName =
      String(form.get('sheetName') || '').trim() ||
      pickLatestNominaSheet(listNominaSheets(buf))?.name ||
      '';
    if (!sheetName) {
      return NextResponse.json(
        { error: 'No se encontró hoja SEM en el xlsx' },
        { status: 400 }
      );
    }
    const parsed = importNominaSheet(buf, sheetName);
    lines = parsed.lines;
    label = label || parsed.meta.weekLabel || sheetName;
    period_start = period_start || parsed.meta.periodStart || todayIsoCdmxPayroll();
    period_end = period_end || parsed.meta.periodEnd || todayIsoCdmxPayroll();
    source_file = `upload:${file.name}#${sheetName}`;
  } else {
    const text = buf.toString('utf-8');
    lines = parsePayrollCsv(text);
    label = label || `Import CSV · ${file.name}`;
    period_start = period_start || todayIsoCdmxPayroll();
    period_end = period_end || todayIsoCdmxPayroll();
  }

  if (!lines.length) {
    return NextResponse.json(
      { error: 'El archivo no tiene líneas de nómina legibles' },
      { status: 400 }
    );
  }

  return persistImportedPeriod(sb, username, lines, {
    label,
    period_start,
    period_end,
    status: markPaid ? 'pagado' : status,
    source_file,
    paid_at: null,
    enrichBase: String(form.get('enrichBase') || 'true') !== 'false',
  });
}

async function persistImportedPeriod(
  sb: ReturnType<typeof getServiceSupabase>,
  username: string,
  lines: HrPayrollLineInput[],
  opts: {
    label: string;
    period_start: string;
    period_end: string;
    status: HrPayrollStatus;
    source_file: string;
    paid_at: string | null;
    enrichBase: boolean;
  }
) {
  if (opts.enrichBase) {
    try {
      const { rows } = await loadBaseDatosRows();
      await enrichEmployeesFromBaseDatos(sb, rows);
    } catch {
      /* BASE DATOS opcional */
    }
  }

  const wantPaid = opts.status === 'pagado';

  // Reusar periodo existente con el mismo period_start (evita duplicados).
  const { data: existing } = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT)
    .eq('period_start', opts.period_start)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let period = existing;
  if (!period) {
    const ins = await sb
      .from('hr_payroll_periods')
      .insert({
        label: opts.label,
        period_start: opts.period_start,
        period_end: opts.period_end,
        status: 'borrador',
        notes: 'Importado desde archivo local / subida',
        source_file: opts.source_file,
        created_by: username,
        updated_by: username,
      })
      .select(PERIOD_SELECT)
      .single();
    if (ins.error || !ins.data) {
      const missing = hrSchemaMissing(ins.error?.message);
      return NextResponse.json(
        {
          error: missing
            ? 'Ejecuta supabase/hr_module.sql en Supabase.'
            : ins.error?.message || 'No se pudo crear periodo',
        },
        { status: missing ? 503 : 500 }
      );
    }
    period = ins.data;
  } else {
    await sb
      .from('hr_payroll_periods')
      .update({
        label: opts.label,
        period_end: opts.period_end,
        source_file: opts.source_file,
        notes: 'Importado desde archivo local / subida',
        updated_by: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', String((period as { id: string }).id));
  }

  const periodId = String((period as { id: string }).id);
  const lineStats = await replacePeriodLines(
    sb,
    periodId,
    lines,
    'nomina_import'
  );

  let balancesSynced = 0;
  if (wantPaid) {
    const side = await applyPaidSideEffects(sb, periodId, opts.paid_at);
    await sb
      .from('hr_payroll_periods')
      .update({
        status: 'pagado',
        paid_at: side.paid_at,
        updated_by: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId);
    balancesSynced = side.balancesSynced;
  }

  const { data: refreshed } = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT)
    .eq('id', periodId)
    .single();

  return NextResponse.json({
    ready: true,
    period: refreshed || period,
    ...lineStats,
    balancesSynced,
    message: wantPaid
      ? 'Nómina importada y marcada como pagada. Revisa Plantilla vigente.'
      : 'Nómina importada en borrador. Cierra → Pagado para fijar plantilla.',
  });
}
