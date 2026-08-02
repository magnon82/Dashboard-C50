import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { hrSchemaMissing, requireRrhhSession } from '@/app/lib/hr-api';
import {
  docAlertSummary,
  HR_REQUIRED_DOC_TYPES,
  type HrDocAlertSummary,
} from '@/app/lib/hr-employee-profile';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHUNK = 80;

function parseIds(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[, ]+/)) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * GET /api/hr/employees/doc-alerts
 * Resumen de documentos obligatorios faltantes por empleado (batch).
 * ?ids=uuid,uuid — lista explícita; sin ids → plantilla vigente.
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  let ids = parseIds(url.searchParams.get('ids'));

  try {
    const sb = getServiceSupabase();

    if (!ids.length) {
      const plantilla = await resolvePlantillaVigente(sb, { allowSeed: false });
      ids = plantilla.employees.map((e) => e.id);
    }

    const requiredMeta = HR_REQUIRED_DOC_TYPES.map((d) => ({
      id: d.id,
      title: d.title,
    }));
    const requiredIds = requiredMeta.map((d) => d.id);
    const requiredTotal = requiredMeta.length;

    const emptyAlert = (): HrDocAlertSummary => ({
      missingCount: requiredTotal,
      missing: requiredMeta.map((d) => ({ id: d.id, title: d.title })),
      requiredTotal,
      requiredUploaded: 0,
    });

    if (!ids.length) {
      return NextResponse.json({
        ready: true,
        requiredTypes: requiredMeta,
        alerts: {} as Record<string, HrDocAlertSummary>,
        count: 0,
        withMissing: 0,
      });
    }

    type DocRow = { employee_id: string; doc_type: string; status: string };
    const rows: DocRow[] = [];

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await sb
        .from('hr_employee_documents')
        .select('employee_id, doc_type, status')
        .in('employee_id', chunk)
        .in('doc_type', requiredIds);

      if (res.error) {
        if (hrSchemaMissing(res.error.message)) {
          return NextResponse.json({
            ready: false,
            schemaMissing: true,
            error: res.error.message,
            hint: 'Ejecuta supabase/hr_employee_documents.sql en Supabase',
            requiredTypes: requiredMeta,
            alerts: {} as Record<string, HrDocAlertSummary>,
            count: 0,
            withMissing: 0,
          });
        }
        return NextResponse.json(
          { error: res.error.message },
          { status: 500 }
        );
      }
      for (const r of res.data || []) {
        rows.push(r as DocRow);
      }
    }

    const byEmp = new Map<string, DocRow[]>();
    for (const r of rows) {
      const list = byEmp.get(r.employee_id);
      if (list) list.push(r);
      else byEmp.set(r.employee_id, [r]);
    }

    const alerts: Record<string, HrDocAlertSummary> = {};
    let withMissing = 0;
    for (const id of ids) {
      const summary = byEmp.has(id)
        ? docAlertSummary(byEmp.get(id))
        : emptyAlert();
      alerts[id] = summary;
      if (summary.missingCount > 0) withMissing += 1;
    }

    return NextResponse.json({
      ready: true,
      requiredTypes: requiredMeta,
      alerts,
      count: ids.length,
      withMissing,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
