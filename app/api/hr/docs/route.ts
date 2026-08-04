import { NextResponse } from 'next/server';
import { createReadStream } from 'fs';
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
import {
  attachDefaultDriveUrls,
  bibliotecaDriveApiAvailable,
  browseBibliotecaDriveFolder,
  downloadBibliotecaDriveByToken,
  findAndDownloadBibliotecaFile,
} from '@/app/lib/hr-biblioteca-drive';
import {
  formatSyncBanner,
  upsertHrDriveSyncState,
} from '@/app/lib/hr-drive-sync';
import { localDriveFsEnabled } from '@/app/lib/local-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function seedDocs(): HrDocLink[] {
  return HR_DOC_LINK_DEFAULTS.map((d, i) => ({
    ...d,
    id: `seed-${i}`,
    active: true,
  }));
}

/** Normaliza título legacy «Documentación vigente 2023» → sin año. */
function normalizeDocTitles(docs: HrDocLink[]): HrDocLink[] {
  return docs.map((d) => {
    if (
      d.category === 'politicas' &&
      (d.title === 'Documentación vigente 2023' || d.title === 'Documentación')
    ) {
      return {
        ...d,
        title: 'Documentación vigente',
        description:
          d.description ||
          'Carpeta: políticas, reglamentos, formatos y antigüedad',
      };
    }
    return d;
  });
}

async function patchLegacyDocTitles(): Promise<void> {
  try {
    const sb = getServiceSupabase();
    await sb
      .from('hr_doc_links')
      .update({
        title: 'Documentación vigente',
        description: 'Carpeta: políticas, reglamentos, formatos y antigüedad',
      })
      .eq('category', 'politicas')
      .in('title', ['Documentación vigente 2023', 'Documentación']);
  } catch {
    /* best-effort */
  }
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

    if (decoded.startsWith('drive:file:')) {
      try {
        const dl = await downloadBibliotecaDriveByToken(decoded);
        if (!dl) {
          return NextResponse.json(
            {
              error: 'Archivo Drive no descargable',
              code: 'drive_unavailable',
            },
            { status: 404 }
          );
        }
        const asAttachment = url.searchParams.get('download') === '1';
        const { contentType, inline } = hrBibliotecaContentType(dl.name);
        const disposition =
          asAttachment || !inline ? 'attachment' : 'inline';
        return new NextResponse(new Uint8Array(dl.buffer), {
          headers: {
            'Content-Type': dl.mimeType || contentType,
            'Content-Disposition': `${disposition}; filename="${encodeURIComponent(dl.name)}"`,
            'Cache-Control': 'private, max-age=120',
          },
        });
      } catch (e) {
        return NextResponse.json(
          {
            error: e instanceof Error ? e.message : 'Error Drive',
            code: 'drive_unavailable',
          },
          { status: 502 }
        );
      }
    }

    if (!localDriveFsEnabled()) {
      if (bibliotecaDriveApiAvailable()) {
        try {
          const dl = await findAndDownloadBibliotecaFile(decoded);
          if (dl) {
            const asAttachment = url.searchParams.get('download') === '1';
            const { contentType, inline } = hrBibliotecaContentType(dl.name);
            const disposition =
              asAttachment || !inline ? 'attachment' : 'inline';
            return new NextResponse(new Uint8Array(dl.buffer), {
              headers: {
                'Content-Type': dl.mimeType || contentType,
                'Content-Disposition': `${disposition}; filename="${encodeURIComponent(dl.name)}"`,
                'Cache-Control': 'private, max-age=120',
              },
            });
          }
        } catch (e) {
          return NextResponse.json(
            {
              error: e instanceof Error ? e.message : 'Error Drive',
              code: 'drive_unavailable',
              hint: 'Revisa HR_DOCS_VIGENTE_DRIVE_FOLDER_ID + credenciales Google, o usa «Abrir en Drive».',
            },
            { status: 502 }
          );
        }
      }
      return NextResponse.json(
        {
          error:
            'Archivo no disponible en este servidor. Usa «Abrir en Drive» o configura Drive API + HR_DOCS_VIGENTE_DRIVE_FOLDER_ID.',
          code: 'local_fs_unavailable',
        },
        { status: 404 }
      );
    }
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

    if (
      decoded.startsWith('drive:folder:') ||
      (!localDriveFsEnabled() && bibliotecaDriveApiAvailable())
    ) {
      try {
        const listed = await browseBibliotecaDriveFolder(decoded);
        return NextResponse.json({
          ready: true,
          root: null,
          rootExists: false,
          ...listed,
          source: 'drive_api',
        });
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : 'No se pudo listar la carpeta en Drive',
            code: 'drive_unavailable',
            ready: false,
            items: [],
            rootExists: false,
          },
          { status: 502 }
        );
      }
    }

    if (!localDriveFsEnabled() || !hrRootExists()) {
      return NextResponse.json(
        {
          error:
            'Explorar carpeta no disponible. Configura Drive API + HR_DOCS_VIGENTE_DRIVE_FOLDER_ID o usa «Abrir en Drive».',
          code: 'local_fs_unavailable',
          ready: false,
          items: [],
          rootExists: false,
        },
        { status: 404 }
      );
    }
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
    if (!localDriveFsEnabled()) {
      return NextResponse.json(
        {
          error:
            'Vista de texto local no disponible en línea. Usa «Abrir en Drive» o Abrir/Descargar.',
          code: 'local_fs_unavailable',
        },
        { status: 404 }
      );
    }
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
        'Usando catálogo por defecto. Ejecuta supabase/hr_module.sql para persistir hr_doc_links.';
    } else if (!res.data || res.data.length === 0) {
      docs = seedDocs();
      source = 'defaults';
      ready = true;
      message = undefined;
    } else {
      docs = res.data as HrDocLink[];
      source = 'supabase';
      ready = true;
      void patchLegacyDocTitles();
    }

    docs = attachDefaultDriveUrls(
      normalizeDocTitles(docs).filter((d) => !isHrBibliotecaHiddenDoc(d))
    );
    const enriched = await enrichHrDocLinks(docs);
    const root = getHrRoot();
    const rootExists = hrRootExists();
    const driveLinked = enriched.filter((d) => d.drive_url).length;
    const localOpenable = enriched.filter((d) => d.openable && d.exists).length;

    if (source === 'supabase') {
      void upsertHrDriveSyncState({
        contentType: 'biblioteca',
        status: 'ok',
        source: rootExists ? 'file_stream' : 'supabase',
        message: rootExists
          ? `Catálogo ${enriched.length} docs · ${localOpenable} en disco`
          : `Catálogo ${enriched.length} docs en servidor · ${driveLinked} con enlace Drive`,
        rowCount: enriched.length,
      });
    }

    const syncMsg = formatSyncBanner({
      driveMounted: rootExists,
      source,
      linkedCount: enriched.length,
      openBlocked: !rootExists,
      countLabel: 'docs en catálogo',
      hideWhenOnline: true,
    });

    return NextResponse.json({
      ready,
      source,
      docs: enriched,
      root: localDriveFsEnabled() ? root : null,
      rootExists,
      localFsEnabled: localDriveFsEnabled(),
      message: message || syncMsg,
      error,
    });
  } catch (e) {
    const docs = attachDefaultDriveUrls(
      normalizeDocTitles(
        seedDocs().filter((d) => !isHrBibliotecaHiddenDoc(d))
      )
    );
    const enriched = await enrichHrDocLinks(docs);
    return NextResponse.json({
      ready: false,
      source: 'defaults',
      docs: enriched,
      root: localDriveFsEnabled() ? getHrRoot() : null,
      rootExists: hrRootExists(),
      localFsEnabled: localDriveFsEnabled(),
      error: e instanceof Error ? e.message : 'Error',
      message: formatSyncBanner({
        driveMounted: hrRootExists(),
        source: 'defaults',
        linkedCount: enriched.length,
        hideWhenOnline: true,
        refreshHint:
          ' Ejecuta supabase/hr_module.sql para persistir hr_doc_links.',
      }),
    });
  }
}
