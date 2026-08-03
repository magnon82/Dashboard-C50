import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { hrSchemaMissing, requireRrhhSession } from '@/app/lib/hr-api';
import {
  employeeRequiresDocumentation,
  type HrEmployee,
  type HrTipoEmpleo,
} from '@/app/lib/hr';
import {
  docAlertSummary,
  HR_REQUIRED_DOC_TYPES,
  missingRequiredDocs,
  type HrDocAlertSummary,
} from '@/app/lib/hr-employee-profile';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';
import {
  pullExpedienteDocuments,
  repairMislabeledPackFromStorage,
  repairSharedPackFromStorage,
  resolveExpedienteFolder,
  shouldSoftPullExpediente,
} from '@/app/lib/hr-expediente-docs-pull';
import { localDriveFsEnabled } from '@/app/lib/local-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHUNK = 80;
/** Soft-pull máximo por request para no bloquear la plantilla. */
const SOFT_PULL_MAX = 12;

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
 * Con File Stream local: soft-pull de expedientes con faltantes antes de contar.
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  let ids = parseIds(url.searchParams.get('ids'));
  const skipPull = url.searchParams.get('skipPull') === '1';

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

    const exemptAlert = (): HrDocAlertSummary => ({
      missingCount: 0,
      missing: [],
      requiredTotal: 0,
      requiredUploaded: 0,
    });

    if (!ids.length) {
      return NextResponse.json({
        ready: true,
        requiredTypes: requiredMeta,
        alerts: {} as Record<string, HrDocAlertSummary>,
        count: 0,
        withMissing: 0,
        softPulled: 0,
      });
    }

    type EmpMeta = Pick<
      HrEmployee,
      'id' | 'full_name' | 'notes' | 'tipo_empleo' | 'requiere_documentacion'
    >;
    const empMeta = new Map<string, EmpMeta>();
    {
      const EMP_META_SELECTS = [
        'id, full_name, notes, tipo_empleo, requiere_documentacion',
        'id, full_name, notes',
      ] as const;
      let metaRows: EmpMeta[] | null = null;
      let metaErr: string | null = null;
      for (const sel of EMP_META_SELECTS) {
        const rows: EmpMeta[] = [];
        let failed = false;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          const res = await sb
            .from('hr_employees')
            .select(sel as string)
            .in('id', chunk);
          if (res.error) {
            metaErr = res.error.message;
            failed = true;
            break;
          }
          for (const r of res.data || []) {
            // Columns may be absent from generated Supabase types; cast via unknown.
            const row = r as unknown as {
              id: string;
              full_name: string;
              notes?: string | null;
              tipo_empleo?: string | null;
              requiere_documentacion?: boolean | null;
            };
            rows.push({
              id: String(row.id),
              full_name: String(row.full_name || ''),
              notes: row.notes ?? null,
              tipo_empleo:
                row.tipo_empleo === 'externo' || row.tipo_empleo === 'interno'
                  ? (row.tipo_empleo as HrTipoEmpleo)
                  : null,
              requiere_documentacion:
                typeof row.requiere_documentacion === 'boolean'
                  ? row.requiere_documentacion
                  : null,
            });
          }
        }
        if (!failed) {
          metaRows = rows;
          break;
        }
        if (metaErr && !/tipo_empleo|requiere_documentacion|column|42703/i.test(metaErr)) {
          break;
        }
      }
      for (const row of metaRows || []) {
        empMeta.set(row.id, row);
      }
    }

    const docsRequiredFor = (id: string): boolean => {
      const meta = empMeta.get(id);
      if (!meta) return true;
      return employeeRequiresDocumentation(meta);
    };

    type DocRow = {
      employee_id: string;
      doc_type: string;
      status: string;
      storage_path: string | null;
    };
    const loadDocs = async (): Promise<DocRow[] | NextResponse> => {
      const rows: DocRow[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const res = await sb
          .from('hr_employee_documents')
          .select('employee_id, doc_type, status, storage_path')
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
      return rows;
    };

    let rowsOrErr = await loadDocs();
    if (rowsOrErr instanceof NextResponse) return rowsOrErr;
    let rows = rowsOrErr;

    let softPulled = 0;
    if (!skipPull && localDriveFsEnabled()) {
      const byEmp = new Map<string, DocRow[]>();
      for (const r of rows) {
        const list = byEmp.get(r.employee_id);
        if (list) list.push(r);
        else byEmp.set(r.employee_id, [r]);
      }
      const needPull: string[] = [];
      for (const id of ids) {
        if (!docsRequiredFor(id)) continue;
        const missing = missingRequiredDocs(byEmp.get(id) || []);
        if (missing.length === 0) continue;
        needPull.push(id);
      }

      const pullIds = needPull.slice(0, SOFT_PULL_MAX);
      if (pullIds.length) {
        const { data: emps } = await sb
          .from('hr_employees')
          .select('id, full_name, drive_folder_path')
          .in('id', pullIds);
        const empById = new Map(
          (emps || []).map((e) => [
            String((e as { id: string }).id),
            e as {
              id: string;
              full_name: string;
              drive_folder_path: string | null;
            },
          ])
        );

        for (const id of pullIds) {
          try {
            const should = await shouldSoftPullExpediente(id);
            if (!should) {
              const repaired = await repairSharedPackFromStorage({
                employeeId: id,
                who: auth.username,
                force: false,
              });
              const relabeled = await repairMislabeledPackFromStorage({
                employeeId: id,
                who: auth.username,
                force: false,
              });
              if (repaired.repaired || relabeled.repaired) softPulled += 1;
              continue;
            }
            const emp = empById.get(id);
            const folder = await resolveExpedienteFolder({
              employeeId: id,
              fullName: emp?.full_name || '',
              driveFolderPath: emp?.drive_folder_path,
            });
            if (!folder) continue;
            const result = await pullExpedienteDocuments({
              employeeId: id,
              driveFolderPath: folder,
              fullName: emp?.full_name || '',
              who: auth.username,
              force: false,
            });
            const repaired = await repairSharedPackFromStorage({
              employeeId: id,
              who: auth.username,
              force: false,
            });
            const relabeled = await repairMislabeledPackFromStorage({
              employeeId: id,
              who: auth.username,
              force: false,
            });
            if (
              result.imported > 0 ||
              repaired.repaired ||
              relabeled.repaired
            ) {
              softPulled += 1;
            }
          } catch {
            /* soft-pull best-effort */
          }
        }
      }
      if (softPulled > 0) {
        rowsOrErr = await loadDocs();
        if (rowsOrErr instanceof NextResponse) return rowsOrErr;
        rows = rowsOrErr;
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
      if (!docsRequiredFor(id)) {
        alerts[id] = exemptAlert();
        continue;
      }
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
      softPulled,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
