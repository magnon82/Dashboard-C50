import { NextResponse } from 'next/server';
import { requireRrhhSession, requireRrhhEmployeesWrite } from '@/app/lib/hr-api';
import {
  pullExpedienteDocuments,
  repairMislabeledPackFromStorage,
  repairSharedPackFromStorage,
} from '@/app/lib/hr-expediente-docs-pull';
import {
  HR_REQUIRED_DOC_TYPES,
  isRequiredDocSatisfied,
} from '@/app/lib/hr-employee-profile';
import { employeeRequiresDocumentation } from '@/app/lib/hr';
import { resolvePlantillaVigente } from '@/app/lib/hr-plantilla';
import {
  expedientePullSourceAvailable,
} from '@/app/lib/hr-expediente-docs-pull';
import { expedienteDriveUnavailableHint } from '@/app/lib/hr-expediente-drive';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/hr/employees/pull-docs
 * Jala documentación de expediente (File Stream o Drive API) → Storage/checklist.
 * Body: {
 *   employeeId?: string,
 *   force?: boolean,
 *   limit?: number,
 *   plantillaOnly?: boolean,  // default true si no hay employeeId
 *   onlyMissing?: boolean,    // default true si plantillaOnly
 * }
 */
export async function POST(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
  if (denied) return denied;

  if (!expedientePullSourceAvailable()) {
    return NextResponse.json(
      {
        error: 'Sin fuente de expediente (local ni Drive API)',
        hint: expedienteDriveUnavailableHint(),
      },
      { status: 400 }
    );
  }

  let body: {
    employeeId?: string;
    force?: boolean;
    limit?: number;
    plantillaOnly?: boolean;
    onlyMissing?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const force = Boolean(body.force);
  const limit = Math.min(
    Math.max(Number(body.limit) || 80, 1),
    200
  );
  const sb = getServiceSupabase();

  type EmpRow = {
    id: string;
    full_name: string;
    drive_folder_path: string | null;
  };

  let employees: EmpRow[] = [];
  let plantillaOnly = false;
  let onlyMissing = false;

  if (body.employeeId) {
    const { data, error } = await sb
      .from('hr_employees')
      .select('id, full_name, drive_folder_path')
      .eq('id', body.employeeId)
      .limit(1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    employees = (data || []) as EmpRow[];
  } else {
    plantillaOnly = body.plantillaOnly !== false;
    onlyMissing = body.onlyMissing !== false;

    if (plantillaOnly) {
      const plantilla = await resolvePlantillaVigente(sb, { allowSeed: false });
      // Incluye sin path: pull resuelve Altas/Bajas por nombre (matchPerson).
      // Socios / sin docs requeridos: no jalar expediente.
      employees = plantilla.employees
        .filter((e) => employeeRequiresDocumentation(e))
        .map((e) => ({
          id: e.id,
          full_name: e.full_name,
          drive_folder_path: e.drive_folder_path,
        }));
    } else {
      const { data, error } = await sb
        .from('hr_employees')
        .select('id, full_name, drive_folder_path')
        .order('full_name', { ascending: true })
        .limit(limit);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      employees = (data || []) as EmpRow[];
    }

    if (onlyMissing && employees.length) {
      const requiredIds = HR_REQUIRED_DOC_TYPES.map((d) => d.id);
      const ids = employees.map((e) => e.id);
      const byEmp = new Map<
        string,
        { doc_type: string; status: string; storage_path?: string | null }[]
      >();
      const CHUNK = 80;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const res = await sb
          .from('hr_employee_documents')
          .select('employee_id, doc_type, status, storage_path')
          .in('employee_id', chunk)
          .in('doc_type', requiredIds);
        if (res.error) {
          return NextResponse.json({ error: res.error.message }, { status: 400 });
        }
        for (const r of res.data || []) {
          const eid = String((r as { employee_id: string }).employee_id);
          const list = byEmp.get(eid) || [];
          list.push({
            doc_type: String((r as { doc_type: string }).doc_type),
            status: String((r as { status: string }).status),
            storage_path: (r as { storage_path: string | null }).storage_path,
          });
          byEmp.set(eid, list);
        }
      }
      employees = employees.filter((e) => {
        const rows = byEmp.get(e.id) || [];
        const byType = new Map(
          rows.map((r) => [
            r.doc_type,
            { status: r.status, storage_path: r.storage_path },
          ])
        );
        return requiredIds.some((id) => {
          const row = byType.get(id);
          return !isRequiredDocSatisfied(row?.status, row?.storage_path);
        });
      });
    }

    employees = employees.slice(0, limit);
  }
  let importedTotal = 0;
  let skippedTotal = 0;
  let okCount = 0;
  let failCount = 0;
  const samples: Array<{
    name: string;
    imported: number;
    error?: string;
  }> = [];

  for (const emp of employees) {
    const result = await pullExpedienteDocuments({
      employeeId: emp.id,
      driveFolderPath: emp.drive_folder_path,
      fullName: emp.full_name,
      who: auth.username,
      force,
    });
    const repaired = await repairSharedPackFromStorage({
      employeeId: emp.id,
      who: auth.username,
      force,
    });
    const relabeled = await repairMislabeledPackFromStorage({
      employeeId: emp.id,
      who: auth.username,
      force,
    });
    const imported =
      result.imported + repaired.imported + relabeled.imported;
    if (result.ok || repaired.repaired || relabeled.repaired) {
      okCount += 1;
      importedTotal += imported;
      skippedTotal +=
        result.skipped + repaired.skipped + relabeled.skipped;
    } else {
      failCount += 1;
    }
    if (samples.length < 12) {
      samples.push({
        name: emp.full_name,
        imported,
        error:
          result.ok || repaired.repaired || relabeled.repaired
            ? undefined
            : result.error,
      });
    }
  }

  return NextResponse.json({
    ready: true,
    processed: employees.length,
    okCount,
    failCount,
    importedTotal,
    skippedTotal,
    plantillaOnly,
    onlyMissing,
    samples,
    message: `Jalados ${importedTotal} doc(s) en ${okCount}/${employees.length} empleados`,
  });
}
