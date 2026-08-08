import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createReadStream, existsSync } from 'fs';
import { access, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import {
  listComprobantesPagoFiscal,
  listFacturas,
  listFacturasFaltantes,
  findComprobanteForFacturaLike,
  companionPdfPathFromXml,
  SOURCE_FACTURA_CFDI,
} from '@/app/lib/facturas';
import { fetchFacturaAttachmentFromGmail } from '@/app/lib/gmail-facturas';
import { listPdfComprobantes } from '@/app/lib/estados-cuenta';
import { getServiceSupabase } from '@/app/lib/users';
import type { FinancialRecord } from '@/app/lib/ventas-semana';
import {
  clientSafeRoot,
  localDriveFsEnabled,
} from '@/app/lib/local-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ROOT = process.env.FACTURAS_PATH?.trim()
  || 'I:\\Mi unidad\\FACTURAS CFDI';
const LOCAL_FALLBACK_ROOT = path.join(
  process.cwd(),
  'ingestor',
  'data',
  'facturas'
);
const COMPROBANTES_ROOT = process.env.COMPROBANTES_PATH?.trim()
  || 'I:\\Mi unidad\\COMPROBANTES BANCARIOS';

function allowedRoots(): string[] {
  return [DEFAULT_ROOT, LOCAL_FALLBACK_ROOT].filter(Boolean);
}

async function requireSession(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  return session;
}

function isUnderRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isUnderAnyRoot(filePath: string, roots: string[]): boolean {
  return roots.some((r) => isUnderRoot(filePath, r));
}

async function loadRecords(
  sources: string[],
  opts: { year?: number; month?: number; day?: number } = {}
): Promise<FinancialRecord[]> {
  const sb = getServiceSupabase();
  const all: FinancialRecord[] = [];
  let from = 0;
  const pageSize = 1000;
  const { year, month, day } = opts;

  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  if (year && month && day) {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    dateFrom = `${year}-${mm}-${dd}`;
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    dateTo = next.toISOString().slice(0, 10);
  } else if (year && month) {
    const mm = String(month).padStart(2, '0');
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    dateFrom = `${year}-${mm}-01`;
    dateTo = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  } else if (year) {
    dateFrom = `${year}-01-01`;
    dateTo = `${year + 1}-01-01`;
  }

  while (true) {
    let q = sb
      .from('financial_records')
      .select('id,date,type,category,amount,description,source_file')
      .in('source_file', sources)
      .order('date', { ascending: false });
    if (dateFrom) q = q.gte('date', dateFrom);
    if (dateTo) q = q.lt('date', dateTo);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...(data as FinancialRecord[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function fileDisposition(
  basename: string,
  asAttachment: boolean | undefined
): string {
  const disposition = asAttachment ? 'attachment' : 'inline';
  const asciiName = basename.replace(/[^\x20-\x7E]/g, '_');
  return `${disposition}; filename="${asciiName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(basename)}`;
}

function binaryFileResponse(
  body: BodyInit,
  opts: {
    basename: string;
    contentType: string;
    asAttachment?: boolean;
  }
) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': opts.contentType,
      'Content-Disposition': fileDisposition(opts.basename, opts.asAttachment),
      'Cache-Control': 'private, max-age=120',
    },
  });
}

async function streamFile(
  filePath: string,
  roots: string | string[],
  opts?: { asAttachment?: boolean }
) {
  const rootList = Array.isArray(roots) ? roots : [roots];
  if (!isUnderAnyRoot(filePath, rootList)) {
    return NextResponse.json(
      { error: 'Ruta fuera del directorio permitido' },
      { status: 403 }
    );
  }
  try {
    await access(filePath);
    const st = await stat(filePath);
    if (!st.isFile()) {
      return NextResponse.json({ error: 'No es un archivo' }, { status: 400 });
    }
    const lower = filePath.toLowerCase();
    const isPdf = lower.endsWith('.pdf');
    const isXml = lower.endsWith('.xml');
    if (!isPdf && !isXml) {
      return NextResponse.json({ error: 'Tipo no permitido' }, { status: 400 });
    }
    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream;
    return binaryFileResponse(webStream, {
      basename: path.basename(filePath),
      contentType: isPdf ? 'application/pdf' : 'application/xml',
      asAttachment: opts?.asAttachment,
    });
  } catch {
    return NextResponse.json(
      {
        error: 'Archivo no legible en este servidor',
        ...(localDriveFsEnabled() ? { path: filePath } : {}),
      },
      { status: 404 }
    );
  }
}

async function streamFromGmail(
  gmailId: string,
  prefer: 'pdf' | 'xml',
  asAttachment: boolean
): Promise<NextResponse | null> {
  try {
    const file = await fetchFacturaAttachmentFromGmail(gmailId, prefer);
    if (!file) return null;
    return binaryFileResponse(new Uint8Array(file.bytes), {
      basename: file.filename,
      contentType: file.contentType,
      asAttachment,
    });
  } catch {
    return null;
  }
}

function parseDesc(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw || '{}')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** GET /api/facturas — lista facturas + faltantes; ?open=path | ?id=uuid sirve PDF/XML; ?download=1 fuerza attachment */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';
  const openComprobante = url.searchParams.get('openComprobante') || '';
  const recordId = url.searchParams.get('id') || '';
  const format = (url.searchParams.get('format') || '').toLowerCase();
  const asAttachment =
    url.searchParams.get('download') === '1' ||
    url.searchParams.get('download') === 'true';

  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    return streamFile(decoded, allowedRoots(), { asAttachment });
  }
  if (openComprobante) {
    const decoded = decodeURIComponent(openComprobante);
    // Comprobante "Abrir" stays inline unless ?download=1 is requested.
    return streamFile(decoded, COMPROBANTES_ROOT, { asAttachment });
  }
  if (recordId) {
    try {
      const sb = getServiceSupabase();
      const { data, error } = await sb
        .from('financial_records')
        .select('id,description,source_file')
        .eq('id', recordId)
        .eq('source_file', SOURCE_FACTURA_CFDI)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 });
      }
      const d = parseDesc(data.description);
      const pdf = d.pdf_path ? String(d.pdf_path) : '';
      const xml = d.xml_path ? String(d.xml_path) : '';
      const companion =
        !pdf && xml ? companionPdfPathFromXml(xml) || '' : '';
      const gmailId = d.gmail_id ? String(d.gmail_id) : '';
      const prefer: 'pdf' | 'xml' =
        format === 'xml' ? 'xml' : format === 'pdf' ? 'pdf' : pdf || companion ? 'pdf' : 'xml';

      let chosen = '';
      if (prefer === 'xml') {
        chosen = xml;
      } else {
        // Prefer real PDF; fall back to companion beside XML; never serve XML as PDF.
        if (pdf && existsSync(pdf)) chosen = pdf;
        else if (companion && existsSync(companion)) chosen = companion;
        else if (pdf) chosen = pdf;
        else if (companion) chosen = companion;
      }

      if (chosen) {
        const local = await streamFile(chosen, allowedRoots(), { asAttachment });
        if (local.status < 400) return local;
      }

      // Vercel / sin File Stream: releer adjunto desde Gmail
      if (gmailId) {
        const fromGmail = await streamFromGmail(gmailId, prefer, asAttachment);
        if (fromGmail) return fromGmail;
        // Pedido PDF sin adjunto PDF: no devolver XML disfrazado
        if (prefer === 'pdf') {
          return NextResponse.json(
            {
              error: 'Sin PDF en Gmail para esta factura',
              gmail_id: gmailId,
            },
            { status: 404 }
          );
        }
      }

      return NextResponse.json(
        {
          error: 'Sin archivo local; re-ejecuta ingest_facturas_gmail.py',
          gmail_id: gmailId || null,
        },
        { status: 404 }
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Error al abrir factura' },
        { status: 500 }
      );
    }
  }

  const year = Number(url.searchParams.get('year') || 0) || undefined;
  const month = Number(url.searchParams.get('month') || 0) || undefined;
  const day = Number(url.searchParams.get('day') || 0) || undefined;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const view = url.searchParams.get('view') || 'all'; // all | faltantes

  try {
    // Scope by year/month at DB so we don't pull ~9k+ rows then hang on
    // per-row PDF index rebuilds (was making /api/facturas appear empty).
    const records = await loadRecords(
      [
        SOURCE_FACTURA_CFDI,
        'cxp',
        'presupuesto_sem_detalle',
        'flujo_efectivo_mov',
        'estado_mifel',
        'estado_bbva',
        'estado_pdf_index',
      ],
      { year, month, day }
    );

    let facturas = listFacturas(records);
    let comprobantesPago = listComprobantesPagoFiscal(records);
    if (year) {
      facturas = facturas.filter((f) => Number(f.date.slice(0, 4)) === year);
      comprobantesPago = comprobantesPago.filter(
        (f) => Number(f.date.slice(0, 4)) === year
      );
    }
    if (month) {
      facturas = facturas.filter(
        (f) => Number(f.date.slice(5, 7)) === month
      );
      comprobantesPago = comprobantesPago.filter(
        (f) => Number(f.date.slice(5, 7)) === month
      );
    }
    if (day) {
      facturas = facturas.filter(
        (f) => Number(f.date.slice(8, 10)) === day
      );
      comprobantesPago = comprobantesPago.filter(
        (f) => Number(f.date.slice(8, 10)) === day
      );
    }
    if (q) {
      const matchesQ = (f: (typeof facturas)[number]) => {
        const hay = [
          f.emisor_nombre,
          f.emisor_rfc,
          f.folio,
          f.uuid,
          f.filename,
          f.subject,
          f.date,
          f.es_comprobante_pago ? 'comprobante pago fiscal' : '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      };
      facturas = facturas.filter(matchesQ);
      comprobantesPago = comprobantesPago.filter(matchesQ);
    }

    const faltantesRaw = listFacturasFaltantes(records, { year, month, day });
    const faltantes = q
      ? faltantesRaw.filter((row) => {
          const hay = [
            row.descripcion,
            row.razonSocial,
            row.folio,
            row.nota,
            row.source_file,
            row.gobierno ? 'imss impuestos gobierno hacienda sat shcp' : '',
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        })
      : faltantesRaw;

    const pdfs = listPdfComprobantes(records);
    const enrichFacturaRow = (f: (typeof facturas)[number]) => {
      let pdf_path = f.pdf_path;
      let has_pdf = f.has_pdf;
      // If ingest only stored XML, expose companion PDF when it exists on disk.
      if (!pdf_path && f.xml_path) {
        const companion = companionPdfPathFromXml(f.xml_path);
        if (
          companion &&
          isUnderAnyRoot(companion, allowedRoots()) &&
          existsSync(companion)
        ) {
          pdf_path = companion;
          has_pdf = true;
        }
      }
      const comp = findComprobanteForFacturaLike(
        {
          amount: f.amount,
          date: f.date,
          vendor: f.emisor_nombre,
        },
        records,
        pdfs
      );
      return {
        ...f,
        pdf_path,
        has_pdf,
        comprobante_path: comp?.rel_path || null,
        comprobante_filename: comp?.filename || null,
      };
    };
    const withComprobante = facturas.map(enrichFacturaRow);
    const comprobantesPagoRows = comprobantesPago.map(enrichFacturaRow);

    const faltantesWithComp = faltantes.map((row) => {
      const comp = findComprobanteForFacturaLike(
        {
          amount: row.amount,
          date: row.date,
          vendor: row.razonSocial || row.descripcion,
          week: row.week,
        },
        records,
        pdfs
      );
      return {
        ...row,
        comprobante_path: comp?.rel_path || null,
        comprobante_filename: comp?.filename || null,
      };
    });

    const localFs = localDriveFsEnabled();
    const rootExists =
      localFs &&
      (existsSync(DEFAULT_ROOT) || existsSync(LOCAL_FALLBACK_ROOT));
    const comprobantesRootExists = localFs && existsSync(COMPROBANTES_ROOT);

    const stripLocalPaths = <
      T extends {
        pdf_path?: string | null;
        xml_path?: string | null;
        comprobante_path?: string | null;
      },
    >(
      row: T
    ): T =>
      localFs
        ? row
        : {
            ...row,
            pdf_path: null,
            xml_path: null,
            comprobante_path: null,
          };

    return NextResponse.json({
      items: view === 'faltantes' ? [] : withComprobante.map(stripLocalPaths),
      comprobantesPago:
        view === 'faltantes' ? [] : comprobantesPagoRows.map(stripLocalPaths),
      faltantes: faltantesWithComp.map(stripLocalPaths),
      count: withComprobante.length,
      comprobantesPagoCount: comprobantesPagoRows.length,
      faltantesCount: faltantesWithComp.length,
      root: clientSafeRoot(DEFAULT_ROOT),
      rootExists,
      comprobantesRootExists,
      localFsEnabled: localFs,
      canOpenFiles: rootExists,
      source: SOURCE_FACTURA_CFDI,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al listar facturas',
      },
      { status: 500 }
    );
  }
}
