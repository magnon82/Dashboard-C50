import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { access, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { requireEventosSession } from '@/app/lib/eventos-api';
import {
  bibliotecaContentType,
  getMenusVigentesRoot,
  isBibliotecaOpenable,
  isBibliotecaCategory,
  isUnderBibliotecaRoots,
  listBiblioteca,
} from '@/app/lib/eventos-biblioteca';
import { getEventosRoot } from '@/app/lib/eventos-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/eventos/biblioteca
 * Lista menús / políticas / etc. en Drive. Query: category, q, open=<path>
 */
export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';

  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    if (!isUnderBibliotecaRoots(decoded)) {
      return NextResponse.json(
        { error: 'Ruta fuera de la biblioteca de Eventos' },
        { status: 403 }
      );
    }
    if (!isBibliotecaOpenable(decoded)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no soportado para abrir' },
        { status: 400 }
      );
    }
    try {
      await access(decoded);
      const st = await stat(decoded);
      if (!st.isFile()) {
        return NextResponse.json({ error: 'No es un archivo' }, { status: 400 });
      }
      const { contentType, inline } = bibliotecaContentType(decoded);
      const stream = createReadStream(decoded);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      const disposition = inline ? 'inline' : 'attachment';
      return new NextResponse(webStream, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `${disposition}; filename="${encodeURIComponent(path.basename(decoded))}"`,
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

  const categoryRaw = (url.searchParams.get('category') || 'all').toLowerCase();
  const category = isBibliotecaCategory(categoryRaw) ? categoryRaw : 'all';
  const q = url.searchParams.get('q') || '';

  try {
    const { items, root, rootExists, menusRoot, menusRootExists, source } =
      await listBiblioteca({ category, q });

    return NextResponse.json({
      ready: items.length > 0,
      root,
      rootExists: rootExists || existsSync(root),
      menusRoot,
      menusRootExists,
      source,
      items,
      count: items.length,
      note:
        source === 'seed'
          ? 'Carpeta Drive no montada o vacía: listando nombres conocidos (sin Abrir). Monta I:\\Mi unidad\\Eventos para abrir PDFs.'
          : source === 'scan'
            ? null
            : 'Sin documentos. Monta I:\\Mi unidad\\Eventos\\Menús\\Menús eventos vigentes.',
    });
  } catch (e) {
    const root = getEventosRoot();
    return NextResponse.json(
      {
        ready: false,
        error: e instanceof Error ? e.message : 'Error al listar biblioteca',
        items: [],
        count: 0,
        root,
        rootExists: existsSync(root),
        menusRoot: getMenusVigentesRoot(),
        menusRootExists: false,
        source: 'none',
      },
      { status: 200 }
    );
  }
}
