import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { access, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';
import {
  getEventosOsRoot,
  isUnderOsRoot,
  listEventOs,
  type EventOsItem,
} from '@/app/lib/eventos-os';
import {
  downloadOsDocFromStorage,
  getOsDocumentById,
  getOsDocumentByRelPath,
  listOsDocumentsFromDb,
  normalizeOsRelPath,
  type EventOsDocumentRow,
} from '@/app/lib/eventos-os-documents';
import {
  ensureOsPdfInStorage,
  syncEventOsPdfs,
} from '@/app/lib/eventos-os-sync';
import {
  createServiceOrderFromLead,
  createServiceOrderFromQuote,
  listDigitalServiceOrders,
} from '@/app/lib/eventos-service-order';
import { getServiceSupabase } from '@/app/lib/users';
import {
  clientSafeRoot,
  localDriveFsEnabled,
} from '@/app/lib/local-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UnifiedOsItem = EventOsItem & {
  kind: 'pdf' | 'digital';
  digital_id?: string | null;
  celebration?: string | null;
  pax?: number | null;
  total?: number | null;
  status?: string | null;
  /** UUID en event_os_documents */
  doc_id?: string | null;
  storage_path?: string | null;
  openable?: boolean;
};

function pdfResponse(
  buffer: Buffer,
  filename: string,
  forceDownload: boolean
): NextResponse {
  const disposition = forceDownload ? 'attachment' : 'inline';
  const safeName = filename.replace(/"/g, '') || 'orden-de-servicio.pdf';
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(safeName)}"`,
      'Cache-Control': 'private, max-age=120',
    },
  });
}

async function streamLocalPdf(
  absolutePath: string,
  forceDownload: boolean
): Promise<NextResponse> {
  await access(absolutePath);
  const st = await stat(absolutePath);
  if (!st.isFile() || !absolutePath.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'No es un PDF' }, { status: 400 });
  }
  const stream = createReadStream(absolutePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;
  const disposition = forceDownload ? 'attachment' : 'inline';
  return new NextResponse(webStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(path.basename(absolutePath))}"`,
      'Cache-Control': 'private, max-age=120',
    },
  });
}

async function openFromDbDoc(
  sb: ReturnType<typeof getServiceSupabase>,
  doc: EventOsDocumentRow,
  forceDownload: boolean,
  localHint?: string | null
): Promise<NextResponse> {
  if (doc.storage_path && doc.status === 'uploaded') {
    const dl = await downloadOsDocFromStorage(sb, doc.storage_path);
    if (dl) {
      return pdfResponse(dl.buffer, doc.filename, forceDownload);
    }
  }

  // Backfill: Drive/FS → Storage → servir desde BMS
  const ensured = await ensureOsPdfInStorage(sb, doc.rel_path, {
    localPath: localHint,
  });
  if (ensured?.storage_path) {
    const dl = await downloadOsDocFromStorage(sb, ensured.storage_path);
    if (dl) {
      return pdfResponse(dl.buffer, ensured.filename, forceDownload);
    }
  }

  // Último recurso local (PC admin)
  const root = getEventosOsRoot();
  if (localDriveFsEnabled() && doc.rel_path) {
    const candidate =
      localHint ||
      path.join(root, ...normalizeOsRelPath(doc.rel_path).split('/'));
    if (
      existsSync(candidate) &&
      isUnderOsRoot(candidate, root) &&
      candidate.toLowerCase().endsWith('.pdf')
    ) {
      try {
        return await streamLocalPdf(candidate, forceDownload);
      } catch {
        /* fall through */
      }
    }
  }

  return NextResponse.json(
    {
      error:
        'PDF aún no está en el BMS. Sincroniza Órdenes de servicio (Actualizar / sync_pdfs) desde PC admin o con Drive API.',
      code: 'os_pdf_not_in_storage',
      rel_path: doc.rel_path,
    },
    { status: 404 }
  );
}

function dbDocToUnified(doc: EventOsDocumentRow): UnifiedOsItem {
  const mtimeMs = doc.event_date
    ? new Date(`${doc.event_date}T12:00:00`).getTime()
    : doc.synced_at
      ? new Date(doc.synced_at).getTime()
      : 0;
  const openable = Boolean(doc.storage_path && doc.status === 'uploaded');
  return {
    id: `db:${doc.id}`,
    filename: doc.filename,
    path: '',
    rel_path: doc.rel_path,
    label: doc.label,
    folio: doc.folio,
    year: doc.year,
    event_date: doc.event_date,
    activity_date: doc.event_date,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
    source: doc.source === 'scan' ? 'scan' : 'activity_seed',
    matched_client_name: doc.matched_client_name,
    kind: 'pdf',
    digital_id: null,
    doc_id: doc.id,
    storage_path: doc.storage_path,
    openable,
  };
}

/**
 * GET /api/eventos/os
 * Lista OS PDF (BMS Storage + índice) + OS digitales.
 * Open: ?id=<uuid doc> | ?rel=<rel_path> | ?open=<abs|rel>
 * download=1 fuerza attachment.
 */
export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const forceDownload = url.searchParams.get('download') === '1';
  const root = getEventosOsRoot();
  const digitalOnly = url.searchParams.get('digital') === '1';
  const docId = (url.searchParams.get('id') || '').trim();
  const relParam = (url.searchParams.get('rel') || '').trim();
  const openPath = url.searchParams.get('open') || '';

  const sb = getServiceSupabase();

  // —— Abrir PDF desde BMS (id) ——
  if (docId) {
    const doc = await getOsDocumentById(sb, docId);
    if (!doc) {
      return NextResponse.json(
        { error: 'Documento OS no encontrado' },
        { status: 404 }
      );
    }
    return openFromDbDoc(sb, doc, forceDownload);
  }

  // —— Abrir por rel_path ——
  if (relParam) {
    const rel = normalizeOsRelPath(decodeURIComponent(relParam));
    let doc = await getOsDocumentByRelPath(sb, rel);
    if (!doc) {
      doc = await ensureOsPdfInStorage(sb, rel);
    }
    if (doc) {
      return openFromDbDoc(sb, doc, forceDownload);
    }
    // Local fallback
    if (localDriveFsEnabled()) {
      const candidate = path.join(root, ...rel.split('/'));
      if (
        existsSync(candidate) &&
        isUnderOsRoot(candidate, root) &&
        candidate.toLowerCase().endsWith('.pdf')
      ) {
        try {
          return await streamLocalPdf(candidate, forceDownload);
        } catch {
          /* fall through */
        }
      }
    }
    return NextResponse.json(
      {
        error:
          'PDF no disponible. Ejecuta sync_pdfs o supabase/eventos_os_documents.sql.',
        code: 'os_pdf_not_found',
        rel_path: rel,
      },
      { status: 404 }
    );
  }

  // —— open= abs path o rel_path ——
  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    const looksAbsolute =
      /^[a-zA-Z]:[\\/]/.test(decoded) ||
      decoded.startsWith('\\\\') ||
      decoded.startsWith('/');

    if (!looksAbsolute) {
      const rel = normalizeOsRelPath(decoded);
      let doc = await getOsDocumentByRelPath(sb, rel);
      if (!doc) doc = await ensureOsPdfInStorage(sb, rel);
      if (doc) return openFromDbDoc(sb, doc, forceDownload, null);
    }

    if (isUnderOsRoot(decoded, root)) {
      // Prefer Storage if we know the rel
      const rel = normalizeOsRelPath(path.relative(root, decoded));
      if (rel && !rel.startsWith('..')) {
        const doc = await getOsDocumentByRelPath(sb, rel);
        if (doc?.storage_path) {
          return openFromDbDoc(sb, doc, forceDownload, decoded);
        }
        const ensured = await ensureOsPdfInStorage(sb, rel, {
          localPath: decoded,
        });
        if (ensured?.storage_path) {
          return openFromDbDoc(sb, ensured, forceDownload, decoded);
        }
      }
      try {
        return await streamLocalPdf(decoded, forceDownload);
      } catch {
        return NextResponse.json(
          {
            error: 'Archivo no legible en este servidor',
            ...(localDriveFsEnabled() ? { path: decoded } : {}),
          },
          { status: 404 }
        );
      }
    }

    // open=rel_path sin ser abs
    const asRel = normalizeOsRelPath(decoded);
    if (asRel.toLowerCase().endsWith('.pdf')) {
      let doc = await getOsDocumentByRelPath(sb, asRel);
      if (!doc) doc = await ensureOsPdfInStorage(sb, asRel);
      if (doc) return openFromDbDoc(sb, doc, forceDownload);
    }

    return NextResponse.json(
      { error: 'Ruta fuera de Órdenes de servicio' },
      { status: 403 }
    );
  }

  const year = Number(url.searchParams.get('year') || 0) || undefined;
  const q = url.searchParams.get('q') || '';

  let clientNames: string[] = [];
  try {
    const { data } = await sb
      .from('event_clients')
      .select('company_name')
      .limit(500);
    clientNames = (data || [])
      .map((c) => String(c.company_name || '').trim())
      .filter(Boolean);
  } catch {
    clientNames = [];
  }

  // —— PDF desde BMS (preferido) ——
  const dbListed = await listOsDocumentsFromDb(sb, { year, q });
  const dbByRel = new Map(
    dbListed.items.map((d) => [normalizeOsRelPath(d.rel_path), d])
  );

  let pdfItems: EventOsItem[] = [];
  let pdfSource: 'scan' | 'activity_seed' | 'db' | 'none' = 'none';
  let rootExists = existsSync(root);
  let pdfNote: string | null = null;

  if (!digitalOnly) {
    if (dbListed.ready && dbListed.items.length) {
      pdfSource = 'db';
    }

    try {
      const listed = await listEventOs({ year, q, clientNames });
      pdfItems = listed.items;
      if (pdfSource === 'none') {
        pdfSource = listed.source;
      }
      rootExists = listed.rootExists || rootExists;
      pdfNote =
        listed.source === 'activity_seed' || listed.source === 'scan'
          ? null
          : dbListed.ready
            ? null
            : 'Sin PDFs de OS en índice. Las OS digitales del CRM siguen disponibles.';
    } catch (e) {
      pdfNote = e instanceof Error ? e.message : 'Error al listar OS PDF';
    }

    if (!dbListed.ready && dbListed.error) {
      pdfNote = [pdfNote, dbListed.error].filter(Boolean).join(' ');
    }
  }

  let digital: UnifiedOsItem[] = [];
  let digitalReady = false;
  let digitalError: string | null = null;
  try {
    const listed = await listDigitalServiceOrders(sb, { year, q });
    digitalReady = listed.ready;
    digitalError = listed.error || null;
    digital = listed.items.map((it) => {
      const eventDate = it.event_date || null;
      const yearNum = eventDate ? Number(eventDate.slice(0, 4)) : null;
      const mtimeMs = it.updated_at
        ? new Date(it.updated_at).getTime()
        : eventDate
          ? new Date(`${eventDate}T12:00:00`).getTime()
          : 0;
      return {
        id: `digital:${it.id}`,
        filename: it.os_number || `OS ${it.id.slice(0, 8)}`,
        path: '',
        rel_path: '',
        label: it.celebration || it.client_name || it.os_number,
        folio: it.os_number,
        year: Number.isFinite(yearNum as number) ? yearNum : null,
        event_date: eventDate,
        activity_date: eventDate,
        mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
        source: 'activity_seed' as const,
        matched_client_name: it.client_name,
        kind: 'digital' as const,
        digital_id: it.id,
        celebration: it.celebration,
        pax: it.pax,
        total: it.total,
        status: it.status,
        openable: true,
      };
    });
  } catch (e) {
    digitalError =
      e instanceof Error ? e.message : 'Error al listar OS digitales';
  }

  // Homogeneizar PDF: DB gana; seed/scan rellena huecos; enriquecer openable
  const pdfUnifiedMap = new Map<string, UnifiedOsItem>();

  for (const doc of dbListed.items) {
    const u = dbDocToUnified(doc);
    // Si hay path local reciente, adjuntarlo para PC admin
    pdfUnifiedMap.set(normalizeOsRelPath(doc.rel_path), u);
  }

  for (const it of pdfItems) {
    const rel = normalizeOsRelPath(it.rel_path || '');
    if (!rel) continue;
    const existing = pdfUnifiedMap.get(rel);
    const db = dbByRel.get(rel);
    if (existing) {
      pdfUnifiedMap.set(rel, {
        ...existing,
        path: localDriveFsEnabled() ? it.path || existing.path : '',
        label: existing.label || it.label,
        folio: existing.folio || it.folio,
        matched_client_name:
          existing.matched_client_name || it.matched_client_name || null,
        event_date: existing.event_date || it.event_date,
        mtimeMs: Math.max(existing.mtimeMs || 0, it.mtimeMs || 0),
      });
      continue;
    }
    const openable = Boolean(db?.storage_path && db.status === 'uploaded');
    pdfUnifiedMap.set(rel, {
      ...it,
      path: localDriveFsEnabled() ? it.path : '',
      kind: 'pdf',
      digital_id: null,
      doc_id: db?.id || null,
      storage_path: db?.storage_path || null,
      openable: openable || Boolean(localDriveFsEnabled() && it.path),
    });
  }

  const pdfUnified = [...pdfUnifiedMap.values()];

  const digitalKeys = new Set(
    digital
      .filter((d) => d.event_date && d.matched_client_name)
      .map(
        (d) =>
          `${d.event_date}|${String(d.matched_client_name)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()}`
      )
  );

  const pdfFiltered = pdfUnified.filter((it) => {
    if (!it.event_date) return true;
    const who = (it.matched_client_name || it.label || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!who) return true;
    return !digitalKeys.has(`${it.event_date}|${who}`);
  });

  const items = [...digital, ...pdfFiltered].sort((a, b) => {
    const ea = a.event_date || '';
    const eb = b.event_date || '';
    if (ea && eb && ea !== eb) return eb.localeCompare(ea);
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    if (a.kind !== b.kind) return a.kind === 'digital' ? -1 : 1;
    return (a.filename || '').localeCompare(b.filename || '', 'es');
  });

  const localFs = localDriveFsEnabled();
  // En Vercel: conservar rel_path / doc_id / storage_path; solo limpiar path Windows
  const itemsOut = items.map((it) =>
    it.kind === 'pdf' && !localFs
      ? { ...it, path: '' }
      : it
  );

  const uploadedCount = pdfFiltered.filter((it) => it.storage_path).length;

  return NextResponse.json({
    ready: itemsOut.length > 0 || rootExists || digitalReady || dbListed.ready,
    root: clientSafeRoot(root),
    rootExists,
    localFsEnabled: localFs,
    canOpenFiles: rootExists || uploadedCount > 0,
    docsTableReady: dbListed.ready,
    uploaded_pdf_count: uploadedCount,
    source: digital.length
      ? pdfSource === 'none'
        ? 'digital'
        : `digital+${pdfSource}`
      : pdfSource,
    items: itemsOut,
    count: itemsOut.length,
    digital_count: digital.length,
    pdf_count: pdfFiltered.length,
    note: [
      digital.length
        ? `${digital.length} OS digital${digital.length === 1 ? '' : 'es'} en plataforma.`
        : null,
      uploadedCount
        ? `${uploadedCount} PDF${uploadedCount === 1 ? '' : 's'} en Storage BMS.`
        : dbListed.ready
          ? 'PDFs indexados: sincroniza para subir binarios al BMS (Actualizar con permiso de edición).'
          : null,
      pdfNote,
      digitalError && !digitalReady
        ? `OS digital pendiente de SQL: ejecuta supabase/eventos_service_orders.sql.`
        : null,
    ]
      .filter(Boolean)
      .join(' ') || null,
  });
}

/**
 * POST /api/eventos/os
 * - Genera OS digital: { quote_id?, lead_id?, refresh? }
 * - Sync PDFs → Storage: { action: 'sync_pdfs', limit?, force?, year?, q? }
 */
export async function POST(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  let body: {
    quote_id?: string;
    lead_id?: string;
    refresh?: boolean;
    anticipo_date?: string | null;
    action?: string;
    limit?: number;
    force?: boolean;
    year?: number;
    q?: string;
    meta_only?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (body.action === 'sync_pdfs') {
    try {
      const sb = getServiceSupabase();
      const result = await syncEventOsPdfs(sb, {
        limit: body.limit,
        force: body.force,
        year: body.year,
        q: body.q,
        metaOnly: body.meta_only,
      });
      return NextResponse.json(result, {
        status: result.ready ? 200 : 503,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : 'Error al sincronizar PDFs',
        },
        { status: 500 }
      );
    }
  }

  const quoteId = typeof body.quote_id === 'string' ? body.quote_id.trim() : '';
  const leadId = typeof body.lead_id === 'string' ? body.lead_id.trim() : '';
  const anticipoDate =
    typeof body.anticipo_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.anticipo_date.trim().slice(0, 10))
      ? body.anticipo_date.trim().slice(0, 10)
      : null;

  if (!quoteId && !leadId) {
    return NextResponse.json(
      { error: 'Indica quote_id, lead_id o action: sync_pdfs' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const result = quoteId
      ? await createServiceOrderFromQuote(sb, {
          quoteId,
          ownerUsername: auth.username,
          refresh: body.refresh !== false,
          markQuoteAccepted: true,
          markLeadGanado: true,
          anticipoDate,
        })
      : await createServiceOrderFromLead(sb, {
          leadId,
          ownerUsername: auth.username,
        });

    if (!result.order) {
      return NextResponse.json(
        {
          error: result.error || 'No se pudo generar OS',
          hint: result.hint,
        },
        { status: result.hint ? 503 : 400 }
      );
    }

    return NextResponse.json(
      {
        order: result.order,
        created: result.created,
        href: `/eventos/os/${result.order.id}`,
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Error al generar OS',
      },
      { status: 500 }
    );
  }
}
