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
  listFacturas,
  listFacturasFaltantes,
  findComprobanteForFacturaLike,
  SOURCE_FACTURA_CFDI,
} from '@/app/lib/facturas';
import { getServiceSupabase } from '@/app/lib/users';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

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

async function loadRecords(sources: string[]): Promise<FinancialRecord[]> {
  const sb = getServiceSupabase();
  const all: FinancialRecord[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('financial_records')
      .select('id,date,type,category,amount,description,source_file')
      .in('source_file', sources)
      .order('date', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...(data as FinancialRecord[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function streamFile(filePath: string, roots: string | string[]) {
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
    return new NextResponse(webStream, {
      headers: {
        'Content-Type': isPdf ? 'application/pdf' : 'application/xml',
        'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(filePath))}"`,
        'Cache-Control': 'private, max-age=120',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Archivo no legible en este servidor', path: filePath },
      { status: 404 }
    );
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

/** GET /api/facturas — lista facturas + faltantes; ?open=path | ?id=uuid sirve PDF/XML */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';
  const openComprobante = url.searchParams.get('openComprobante') || '';
  const recordId = url.searchParams.get('id') || '';
  const format = (url.searchParams.get('format') || '').toLowerCase();

  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    return streamFile(decoded, allowedRoots());
  }
  if (openComprobante) {
    const decoded = decodeURIComponent(openComprobante);
    return streamFile(decoded, COMPROBANTES_ROOT);
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
      let chosen = '';
      if (format === 'xml') chosen = xml || pdf;
      else if (format === 'pdf') chosen = pdf || xml;
      else chosen = pdf || xml;
      if (!chosen) {
        return NextResponse.json(
          {
            error: 'Sin archivo local; re-ejecuta ingest_facturas_gmail.py',
            gmail_id: d.gmail_id || null,
          },
          { status: 404 }
        );
      }
      return streamFile(chosen, allowedRoots());
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
    const records = await loadRecords([
      SOURCE_FACTURA_CFDI,
      'cxp',
      'presupuesto_sem_detalle',
      'flujo_efectivo_mov',
      'estado_mifel',
      'estado_bbva',
      'estado_pdf_index',
    ]);

    let facturas = listFacturas(records);
    if (year) {
      facturas = facturas.filter((f) => Number(f.date.slice(0, 4)) === year);
    }
    if (month) {
      facturas = facturas.filter(
        (f) => Number(f.date.slice(5, 7)) === month
      );
    }
    if (day) {
      facturas = facturas.filter(
        (f) => Number(f.date.slice(8, 10)) === day
      );
    }
    if (q) {
      facturas = facturas.filter((f) => {
        const hay = [
          f.emisor_nombre,
          f.emisor_rfc,
          f.folio,
          f.uuid,
          f.filename,
          f.subject,
          f.date,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
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

    const withComprobante = facturas.map((f) => {
      const comp = findComprobanteForFacturaLike(
        {
          amount: f.amount,
          date: f.date,
          vendor: f.emisor_nombre,
        },
        records
      );
      return {
        ...f,
        comprobante_path: comp?.rel_path || null,
        comprobante_filename: comp?.filename || null,
      };
    });

    const faltantesWithComp = faltantes.map((row) => {
      const comp = findComprobanteForFacturaLike(
        {
          amount: row.amount,
          date: row.date,
          vendor: row.razonSocial || row.descripcion,
          week: row.week,
        },
        records
      );
      return {
        ...row,
        comprobante_path: comp?.rel_path || null,
        comprobante_filename: comp?.filename || null,
      };
    });

    const rootExists = existsSync(DEFAULT_ROOT) || existsSync(LOCAL_FALLBACK_ROOT);
    const comprobantesRootExists = existsSync(COMPROBANTES_ROOT);

    return NextResponse.json({
      items: view === 'faltantes' ? [] : withComprobante,
      faltantes: faltantesWithComp,
      count: withComprobante.length,
      faltantesCount: faltantesWithComp.length,
      root: DEFAULT_ROOT,
      rootExists,
      comprobantesRootExists,
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
