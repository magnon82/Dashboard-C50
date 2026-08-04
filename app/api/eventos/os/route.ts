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
};

/**
 * GET /api/eventos/os
 * Lista OS PDF (Drive) + OS digitales (Supabase).
 * Query: year, q, open=<path PDF>, download=1 (fuerza attachment), digital=1 (solo digitales)
 */
export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';
  const forceDownload = url.searchParams.get('download') === '1';
  const root = getEventosOsRoot();
  const digitalOnly = url.searchParams.get('digital') === '1';

  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    if (!isUnderOsRoot(decoded, root)) {
      return NextResponse.json(
        { error: 'Ruta fuera de Órdenes de servicio' },
        { status: 403 }
      );
    }
    try {
      await access(decoded);
      const st = await stat(decoded);
      if (!st.isFile() || !decoded.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ error: 'No es un PDF' }, { status: 400 });
      }
      const stream = createReadStream(decoded);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      const disposition = forceDownload ? 'attachment' : 'inline';
      return new NextResponse(webStream, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${encodeURIComponent(path.basename(decoded))}"`,
          'Cache-Control': 'private, max-age=120',
        },
      });
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

  const year = Number(url.searchParams.get('year') || 0) || undefined;
  const q = url.searchParams.get('q') || '';

  let clientNames: string[] = [];
  try {
    const sb = getServiceSupabase();
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

  let pdfItems: EventOsItem[] = [];
  let pdfSource: 'scan' | 'activity_seed' | 'none' = 'none';
  let rootExists = existsSync(root);
  let pdfNote: string | null = null;

  if (!digitalOnly) {
    try {
      const listed = await listEventOs({ year, q, clientNames });
      pdfItems = listed.items;
      pdfSource = listed.source;
      rootExists = listed.rootExists || rootExists;
      pdfNote =
        listed.source === 'activity_seed'
          ? null
          : listed.source === 'scan'
            ? null
            : 'Sin PDFs de OS en índice. Las OS digitales del CRM siguen disponibles.';
    } catch (e) {
      pdfNote = e instanceof Error ? e.message : 'Error al listar OS PDF';
    }
  }

  let digital: UnifiedOsItem[] = [];
  let digitalReady = false;
  let digitalError: string | null = null;
  try {
    const sb = getServiceSupabase();
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
      };
    });
  } catch (e) {
    digitalError =
      e instanceof Error ? e.message : 'Error al listar OS digitales';
  }

  const pdfUnified: UnifiedOsItem[] = pdfItems.map((it) => ({
    ...it,
    kind: 'pdf' as const,
    digital_id: null,
  }));

  // Evitar duplicar por fecha+cliente si hay digital y PDF del mismo evento
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
    // Digitales primero el mismo día
    if (a.kind !== b.kind) return a.kind === 'digital' ? -1 : 1;
    return (a.filename || '').localeCompare(b.filename || '', 'es');
  });

  const localFs = localDriveFsEnabled();
  const itemsOut = localFs
    ? items
    : items.map((it) =>
        it.kind === 'pdf'
          ? { ...it, path: '', rel_path: '' }
          : it
      );

  return NextResponse.json({
    ready: itemsOut.length > 0 || rootExists || digitalReady,
    root: clientSafeRoot(root),
    rootExists,
    localFsEnabled: localFs,
    canOpenFiles: rootExists,
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
 * Genera OS digital desde quote_id o lead_id.
 * Body: { quote_id?, lead_id?, refresh? }
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
    /** Fecha de anticipo (YYYY-MM-DD) si el cliente la conoce; no inventar */
    anticipo_date?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
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
      { error: 'Indica quote_id o lead_id' },
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
