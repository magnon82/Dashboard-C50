import { NextResponse } from 'next/server';
import {
  requireRrhhSession,
  requireRrhhEmployeesWrite,
} from '@/app/lib/hr-api';
import {
  applyDocsReviewAnswer,
  buildDocsReviewQueue,
  type DocsReviewAnswer,
  type DocsReviewMode,
} from '@/app/lib/hr-docs-review';
import { PACK_DOC_ORDER } from '@/app/lib/hr-docs-pack-split';
import type { HrDocTypeId } from '@/app/lib/hr-employee-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function parseAnswer(raw: unknown): DocsReviewAnswer | null {
  const v = String(raw || '').trim();
  if (v === 'omit' || v === 'ignore') return v;
  if (PACK_DOC_ORDER.includes(v as HrDocTypeId)) return v as HrDocTypeId;
  return null;
}

/**
 * GET /api/hr/employees/[id]/docs-review?mode=uncertain|all
 * Cola de páginas a clasificar («¿Qué es este documento?»).
 */
export async function GET(request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
  if (denied) return denied;

  const { id } = await ctx.params;
  const url = new URL(request.url);
  const modeParam = url.searchParams.get('mode');
  const mode: DocsReviewMode =
    modeParam === 'all' ? 'all' : 'uncertain';

  try {
    const queue = await buildDocsReviewQueue({
      employeeId: id,
      mode,
    });
    return NextResponse.json({
      ready: true,
      ...queue,
      message:
        queue.items.length === 0
          ? mode === 'uncertain'
            ? 'No hay páginas dudosas · prueba «Revisar todas»'
            : 'Sin páginas de paquete (INE/acta/CURP/domicilio/CV) en Storage'
          : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al armar la cola';
    return NextResponse.json(
      {
        error: msg,
        hint: /relation|does not exist|schema/i.test(msg)
          ? 'Ejecuta supabase/hr_employee_documents.sql en Supabase'
          : undefined,
      },
      { status: 400 }
    );
  }
}

/**
 * POST /api/hr/employees/[id]/docs-review
 * Body: { storagePath, pageIndex, answer: ine|acta_nacimiento|…|omit|ignore }
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
  if (denied) return denied;

  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const storagePath = String(body.storagePath || body.storage_path || '').trim();
  const pageIndex = Number(body.pageIndex ?? body.page_index);
  const answer = parseAnswer(body.answer);

  if (!storagePath) {
    return NextResponse.json({ error: 'storagePath requerido' }, { status: 400 });
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    return NextResponse.json({ error: 'pageIndex inválido' }, { status: 400 });
  }
  if (!answer) {
    return NextResponse.json(
      {
        error:
          'answer inválido · usa ine | acta_nacimiento | curp | comprobante_domicilio | cv | omit | ignore',
      },
      { status: 400 }
    );
  }

  try {
    const result = await applyDocsReviewAnswer({
      employeeId: id,
      storagePath,
      pageIndex,
      answer,
      who: auth.username,
    });
    return NextResponse.json({ ready: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo aplicar';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
