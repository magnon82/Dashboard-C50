import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { access, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { requireEventosSession } from '@/app/lib/eventos-api';
import {
  getEventosOsRoot,
  isUnderOsRoot,
  listEventOs,
} from '@/app/lib/eventos-os';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/eventos/os
 * Lista OS PDF (fecha del evento desc → sin fecha al final). Query: year, q, open=<path>
 */
export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';
  const root = getEventosOsRoot();

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
      return new NextResponse(webStream, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(decoded))}"`,
          'Cache-Control': 'private, max-age=120',
        },
      });
    } catch {
      return NextResponse.json(
        { error: 'Archivo no legible en este servidor', path: decoded },
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

  try {
    const { items, rootExists, source } = await listEventOs({
      year,
      q,
      clientNames,
    });

    return NextResponse.json({
      ready: items.length > 0 || rootExists,
      root,
      rootExists: rootExists || existsSync(root),
      source,
      items,
      count: items.length,
      note:
        source === 'activity_seed'
          ? 'Carpeta Drive no montada o vacía: listando desde seed_event_client_activity.json (sin abrir PDF).'
          : source === 'scan'
            ? null
            : 'Sin OS. Monta I:\\Mi unidad\\Eventos\\Ordenes de servicio o regenera el seed de actividad.',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        error: e instanceof Error ? e.message : 'Error al listar OS',
        items: [],
        count: 0,
        root,
        rootExists: existsSync(root),
        source: 'none',
      },
      { status: 200 }
    );
  }
}
