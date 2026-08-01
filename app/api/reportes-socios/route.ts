import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireReportesSociosSession,
  requireReportesSociosWrite,
} from '@/app/lib/reportes-socios-api';
import {
  DEFAULT_REPORTES_SOCIOS_CONTENT,
  normalizeReportesSociosContent,
  type ReportesSociosContent,
} from '@/app/lib/reportes-socios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROW_ID = 'default';

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('reportes_socios_content') &&
    (m.includes('does not exist') ||
      m.includes('schema cache') ||
      m.includes('could not find') ||
      m.includes('relation'))
  );
}

export async function GET() {
  const auth = await requireReportesSociosSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('reportes_socios_content')
      .select('id, content, updated_at, updated_by')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error.message)) {
        return NextResponse.json({
          ready: false,
          content: DEFAULT_REPORTES_SOCIOS_CONTENT,
          updatedAt: null,
          updatedBy: null,
          error:
            'Tabla reportes_socios_content no encontrada. Ejecuta supabase/reportes_socios.sql en el SQL Editor.',
        });
      }
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json({
        ready: true,
        content: DEFAULT_REPORTES_SOCIOS_CONTENT,
        updatedAt: null,
        updatedBy: null,
      });
    }

    return NextResponse.json({
      ready: true,
      content: normalizeReportesSociosContent(data.content),
      updatedAt: data.updated_at ?? null,
      updatedBy: data.updated_by ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        content: DEFAULT_REPORTES_SOCIOS_CONTENT,
        updatedAt: null,
        updatedBy: null,
        error: e instanceof Error ? e.message : 'Error al leer contenido',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireReportesSociosWrite();
  if (auth instanceof NextResponse) return auth;

  let body: { content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  if (body.content == null || typeof body.content !== 'object') {
    return NextResponse.json(
      { error: 'Falta el objeto content' },
      { status: 400 }
    );
  }

  const content: ReportesSociosContent = normalizeReportesSociosContent(body.content);
  const now = new Date().toISOString();

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('reportes_socios_content')
      .upsert(
        {
          id: ROW_ID,
          content,
          updated_at: now,
          updated_by: auth.username,
        },
        { onConflict: 'id' }
      )
      .select('id, content, updated_at, updated_by')
      .single();

    if (error) {
      if (isMissingTable(error.message)) {
        return NextResponse.json(
          {
            error:
              'Tabla reportes_socios_content no encontrada. Ejecuta supabase/reportes_socios.sql en el SQL Editor.',
          },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      content: normalizeReportesSociosContent(data.content),
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar' },
      { status: 500 }
    );
  }
}
