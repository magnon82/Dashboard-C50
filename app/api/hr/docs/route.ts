import { NextResponse } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { access, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { getServiceSupabase } from '@/app/lib/users';
import { requireRrhhSession } from '@/app/lib/hr-api';
import {
  HR_DOC_LINK_DEFAULTS,
  isHrBibliotecaHiddenDoc,
  type HrDocLink,
} from '@/app/lib/hr';
import {
  enrichHrDocLinks,
  extractDocxPlainText,
  getHrRoot,
  hrBibliotecaContentType,
  hrRootExists,
  isHrBibliotecaOpenable,
  isUnderHrRoot,
  listHrFolder,
} from '@/app/lib/hr-biblioteca';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function seedDocs(): HrDocLink[] {
  return HR_DOC_LINK_DEFAULTS.map((d, i) => ({
    ...d,
    id: `seed-${i}`,
    active: true,
  }));
}

/**
 * GET /api/hr/docs
 * - Catálogo hr_doc_links (+ enrichment disco)
 * - ?open=<path> — stream archivo (PDF inline)
 * - ?browse=<path> — hijos de carpeta
 * - ?text=<path> — extracto texto .docx
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const openPath = url.searchParams.get('open') || '';
  const browsePath = url.searchParams.get('browse') || '';
  const textPath = url.searchParams.get('text') || '';

  if (openPath) {
    const decoded = decodeURIComponent(openPath);
    if (!isUnderHrRoot(decoded)) {
      return NextResponse.json(
        { error: 'Ruta fuera de la biblioteca RH' },
        { status: 403 }
      );
    }
    if (!isHrBibliotecaOpenable(decoded)) {
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
      const asAttachment = url.searchParams.get('download') === '1';
      const { contentType, inline } = hrBibliotecaContentType(decoded);
      const stream = createReadStream(decoded);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      const disposition =
        asAttachment || !inline ? 'attachment' : 'inline';
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

  if (browsePath) {
    const decoded = decodeURIComponent(browsePath);
    if (!isUnderHrRoot(decoded)) {
      return NextResponse.json(
        { error: 'Ruta fuera de la biblioteca RH' },
        { status: 403 }
      );
    }
    try {
      const listed = await listHrFolder(decoded);
      return NextResponse.json({
        ready: true,
        root: getHrRoot(),
        rootExists: hrRootExists(),
        ...listed,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : 'No se pudo listar la carpeta',
          path: decoded,
        },
        { status: 404 }
      );
    }
  }

  if (textPath) {
    const decoded = decodeURIComponent(textPath);
    if (!isUnderHrRoot(decoded)) {
      return NextResponse.json(
        { error: 'Ruta fuera de la biblioteca RH' },
        { status: 403 }
      );
    }
    try {
      await access(decoded);
      const st = await stat(decoded);
      if (!st.isFile()) {
        return NextResponse.json({ error: 'No es un archivo' }, { status: 400 });
      }
      const extracted = await extractDocxPlainText(decoded);
      if (!extracted) {
        return NextResponse.json({
          ready: false,
          path: decoded,
          filename: path.basename(decoded),
          text: null,
          truncated: false,
          message:
            'No se pudo extraer texto (solo .docx legibles). Usa Descargar u Abrir.',
        });
      }
      return NextResponse.json({
        ready: true,
        path: decoded,
        filename: path.basename(decoded),
        text: extracted.text,
        truncated: extracted.truncated,
      });
    } catch {
      return NextResponse.json(
        { error: 'Archivo no legible', path: decoded },
        { status: 404 }
      );
    }
  }

  try {
    const sb = getServiceSupabase();
    const res = await sb
      .from('hr_doc_links')
      .select(
        'id, category, title, description, local_path, drive_url, sort_order, active'
      )
      .eq('active', true)
      .order('sort_order', { ascending: true });

    let docs: HrDocLink[];
    let source: string;
    let message: string | undefined;
    let error: string | undefined;
    let ready: boolean;

    if (res.error) {
      docs = seedDocs();
      source = 'defaults';
      ready = false;
      error = res.error.message;
      message =
        'Usando rutas por defecto. Ejecuta supabase/hr_module.sql para persistir hr_doc_links.';
    } else if (!res.data || res.data.length === 0) {
      docs = seedDocs();
      source = 'defaults';
      ready = true;
      message =
        'Sin filas en hr_doc_links; mostrando rutas conocidas de Drive RH.';
    } else {
      docs = res.data as HrDocLink[];
      source = 'supabase';
      ready = true;
    }

    docs = docs.filter((d) => !isHrBibliotecaHiddenDoc(d));
    const enriched = await enrichHrDocLinks(docs);
    const root = getHrRoot();
    const rootExists = existsSync(root);
    const missingCount = enriched.filter((d) => d.local_path && !d.exists).length;

    return NextResponse.json({
      ready,
      source,
      docs: enriched,
      root,
      rootExists,
      message:
        message ||
        (!rootExists
          ? 'Drive RH no montado en este servidor: catálogo visible, sin consulta/abrir hasta montar la unidad.'
          : missingCount > 0
            ? `${missingCount} ruta(s) no encontradas en disco (revisa nombres exactos en Drive).`
            : undefined),
      error,
    });
  } catch (e) {
    const docs = seedDocs().filter((d) => !isHrBibliotecaHiddenDoc(d));
    const enriched = await enrichHrDocLinks(docs);
    return NextResponse.json({
      ready: false,
      source: 'defaults',
      docs: enriched,
      root: getHrRoot(),
      rootExists: hrRootExists(),
      error: e instanceof Error ? e.message : 'Error',
    });
  }
}
