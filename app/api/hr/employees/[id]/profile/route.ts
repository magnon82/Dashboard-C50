import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/app/lib/users';
import { canAccessAdmin, canEditHrEmployees } from '@/app/lib/auth';
import {
  requireMasterAdmin,
  requireRrhhSession,
  requireRrhhEmployeesWrite,
} from '@/app/lib/hr-api';
import {
  HR_DOCS_BUCKET,
  HR_DOC_TYPES,
  checklistSeedRows,
  docTypeDef,
  emptyChecklistStats,
  isRequiredDocSatisfied,
  placeholderDocuments,
  type HrDocStatus,
  type HrEmployeeDocument,
  type HrEmployeeExam,
  type HrMedicalJustification,
  type HrMedicalReimbursement,
} from '@/app/lib/hr-employee-profile';
import {
  HR_RESGUARDO_SELECT,
  HR_RESGUARDO_SELECT_LEGACY,
  asResguardoRequest,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';
import {
  pullExpedienteDocuments,
  profileSoftPullPending,
  repairMislabeledPackFromStorage,
  repairSharedPackFromStorage,
} from '@/app/lib/hr-expediente-docs-pull';
import {
  contractsFromDocumentRows,
  isContractDocType,
  pickDefaultContract,
  sortContracts,
  type HrEmployeeContract,
} from '@/app/lib/hr-employee-contracts';
import {
  employeeRequiresDocumentation,
  formatEmployeeAreas,
  parseEmployeeAreas,
  plantillaTeamGroup,
  type HrEmployee,
} from '@/app/lib/hr';
import {
  hasDualLimpiezaServicio,
  parseRolesFromBody,
  syncDualFlagInNotes,
} from '@/app/lib/hr-puestos';
import { matchPerson } from '@/app/lib/hr-person-match';
import { invalidatePlantillaCache } from '@/app/lib/hr-plantilla';
import { fillEmptyEmployeeIdentity } from '@/app/lib/hr-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function missingAcceptedCols(message: string | undefined | null): boolean {
  if (!message) return false;
  return /accepted_at|accepted_by|schema cache|42703/i.test(message);
}

/**
 * Select resguardos with legacy fallback when accepted_* cols are missing.
 * Returns rows as records so full vs legacy selects stay assignable under TS.
 */
async function fetchResguardoRows(
  sb: ReturnType<typeof getServiceSupabase>,
  opts: { employeeId: string | null; limit: number }
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  let q = sb
    .from('hr_resguardo_requests')
    .select(HR_RESGUARDO_SELECT)
    .order('created_at', { ascending: false })
    .limit(opts.limit);
  q =
    opts.employeeId == null
      ? q.is('employee_id', null)
      : q.eq('employee_id', opts.employeeId);
  const full = await q;
  if (!full.error) {
    return {
      rows: (full.data || []) as Record<string, unknown>[],
      error: null,
    };
  }
  if (!missingAcceptedCols(full.error.message)) {
    return { rows: [], error: full.error.message };
  }
  let q2 = sb
    .from('hr_resguardo_requests')
    .select(HR_RESGUARDO_SELECT_LEGACY)
    .order('created_at', { ascending: false })
    .limit(opts.limit);
  q2 =
    opts.employeeId == null
      ? q2.is('employee_id', null)
      : q2.eq('employee_id', opts.employeeId);
  const legacy = await q2;
  if (legacy.error) {
    return { rows: [], error: legacy.error.message };
  }
  return {
    rows: (legacy.data || []) as Record<string, unknown>[],
    error: null,
  };
}

/**
 * Cascada si faltan columnas. Importante: conservar `sueldo_diario` al quitar
 * `fecha_nacimiento` / `puestos_secundarios` — si no, el perfil Datos muestra
 * placeholder 0.00 aunque la ficha ya tenga SD en DB.
 */
const EMP_SELECTS = [
  'id, full_name, status, puesto, puestos_secundarios, areas, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, sueldo_diario_secundario, email, phone, domicilio, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone, tipo_empleo, requiere_documentacion',
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, sueldo_diario_secundario, email, phone, domicilio, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone, tipo_empleo, requiere_documentacion',
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, domicilio, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone, tipo_empleo, requiere_documentacion',
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone, tipo_empleo, requiere_documentacion',
  'id, full_name, status, puesto, puestos_secundarios, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone',
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, fecha_nacimiento, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone',
  // Sin fecha_nacimiento (DB sin patch nacimiento) — mantiene sueldo_diario
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes, photo_storage_path, nss, curp, emergency_contact, emergency_phone',
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, sueldo_diario, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes',
  'id, full_name, status, puesto, area, fecha_ingreso, fecha_baja, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes',
  'id, full_name, status, puesto, area, fecha_ingreso, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes',
] as const;

const EMP_SELECT_LEAN = EMP_SELECTS[EMP_SELECTS.length - 1];

async function loadEmployeeRow(id: string): Promise<{
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}> {
  const sb = getServiceSupabase();
  let lastError: { message: string } | null = null;
  for (const sel of EMP_SELECTS) {
    const res = await sb
      .from('hr_employees')
      .select(sel as string)
      .eq('id', id)
      .maybeSingle();
    if (!res.error && res.data) {
      return {
        data: res.data as unknown as Record<string, unknown>,
        error: null,
      };
    }
    lastError = res.error;
    if (res.error && !/column|42703/i.test(res.error.message)) {
      return { data: null, error: res.error };
    }
  }
  return { data: null, error: lastError };
}

function areaFromPuesto(puesto: string | null): string | null {
  if (!puesto) return null;
  const team = plantillaTeamGroup(puesto);
  if (team === 'cocina') return 'Cocina';
  if (team === 'admin') return 'Administrativo';
  if (team === 'piso') return 'Piso';
  return null;
}

function parseSueldoDiario(
  value: unknown
): { ok: true; set: false } | { ok: true; set: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, set: false };
  if (value == null || value === '') return { ok: true, set: true, value: null };
  const n = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'sueldo_diario inválido' };
  }
  return { ok: true, set: true, value: Math.round(n * 100) / 100 };
}

async function signedUrl(
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  const sb = getServiceSupabase();
  const { data } = await sb.storage
    .from(HR_DOCS_BUCKET)
    .createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

/** Solo paths del empleado (`{id}/…`) — evita firmar archivos ajenos. */
function isEmployeeStoragePath(employeeId: string, path: string): boolean {
  const p = path.replace(/^\/+/, '');
  return p.startsWith(`${employeeId}/`);
}

async function ensureChecklist(
  employeeId: string
): Promise<{ error: string | null }> {
  const sb = getServiceSupabase();
  const { data: existing, error } = await sb
    .from('hr_employee_documents')
    .select('doc_type')
    .eq('employee_id', employeeId);
  if (error) return { error: error.message };
  const have = new Set((existing || []).map((r) => String(r.doc_type)));
  const missing = checklistSeedRows(employeeId).filter(
    (r) => !have.has(r.doc_type)
  );
  if (missing.length) {
    const ins = await sb.from('hr_employee_documents').insert(missing);
    if (ins.error) return { error: ins.error.message };
  }
  return { error: null };
}

function schemaHint(msg: string): string | undefined {
  if (
    /hr_employee_documents|relation|schema cache|Could not find the table/i.test(
      msg
    )
  ) {
    return 'Ejecuta supabase/hr_employee_documents.sql en Supabase SQL Editor';
  }
  if (/hr_employee_contracts/i.test(msg)) {
    return 'Ejecuta supabase/hr_employee_contracts.sql en Supabase SQL Editor';
  }
  if (/fecha_baja/i.test(msg)) {
    return 'Ejecuta supabase/hr_employee_documents.sql (incluye fecha_baja; o hr_employee_baja.sql)';
  }
  if (/does not exist/i.test(msg)) {
    return 'Ejecuta supabase/hr_employee_documents.sql en Supabase SQL Editor';
  }
  return undefined;
}

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/hr/employees/[id]/profile
 * Perfil + checklist ligero (metadata). Soft-pull / OCR / firmas masivas NO bloquean.
 * ?sign={storage_path} → URL firmada on-demand (previews).
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  // Preview under demand: no descarga/OCR, solo firma Storage.
  const signPath = new URL(req.url).searchParams.get('sign');
  if (signPath) {
    if (!isEmployeeStoragePath(id, signPath)) {
      return NextResponse.json({ error: 'path inválido' }, { status: 400 });
    }
    const url = await signedUrl(signPath);
    if (!url) {
      return NextResponse.json(
        { error: 'No se pudo firmar el archivo' },
        { status: 404 }
      );
    }
    return NextResponse.json({ url });
  }

  try {
    const sb = getServiceSupabase();
    const empRes = await loadEmployeeRow(id);
    if (empRes.error || !empRes.data) {
      const msg = empRes.error?.message || 'Empleado no encontrado';
      return NextResponse.json(
        {
          error: msg,
          hint: schemaHint(msg),
          documents: placeholderDocuments(id),
          docTypes: HR_DOC_TYPES,
          checklist: emptyChecklistStats(),
        },
        { status: 404 }
      );
    }

    const empEarly = empRes.data as HrEmployee & {
      drive_folder_path?: string | null;
      photo_storage_path?: string | null;
    };
    const docsRequired = employeeRequiresDocumentation(empEarly);

    // Semilla DB primero; si falta schema → checklist local + aviso SQL.
    // Externos / sin docs requeridos: no forzar filas pendientes.
    if (docsRequired) {
      const seed = await ensureChecklist(id);
      if (seed.error) {
        const placeholders = placeholderDocuments(id);
        return NextResponse.json(
          {
            ready: false,
            schemaMissing: true,
            softPullPending: false,
            error:
              'Falta el schema de documentos en Supabase (tabla o bucket).',
            hint:
              schemaHint(seed.error) ||
              'Ejecuta supabase/hr_employee_documents.sql en Supabase SQL Editor',
            detail: seed.error,
            employee: empEarly,
            documents: placeholders,
            docTypes: HR_DOC_TYPES,
            reimbursements: [],
            justifications: [],
            exams: [],
            contracts: [],
            resguardos: [],
            checklist: emptyChecklistStats(),
            photoUrl: empEarly.photo_storage_path
              ? await signedUrl(empEarly.photo_storage_path)
              : null,
            canVerify: canAccessAdmin(auth),
            canEditEmployee: canEditHrEmployees(auth),
          },
          { status: 200 }
        );
      }
    }

    // Soft-pull / pack-repair / OCR: NO aquí — bloqueaban "Cargando perfil…".
    // El cliente dispara POST pull_expediente tras el primer paint si softPullPending.
    const softPullPending = await profileSoftPullPending(id, {
      docsRequired,
    });

    const docsRes = await sb
      .from('hr_employee_documents')
      .select('*')
      .eq('employee_id', id)
      .order('required', { ascending: false });

    if (docsRes.error) {
      const placeholders = placeholderDocuments(id);
      return NextResponse.json(
        {
          ready: false,
          schemaMissing: true,
          softPullPending: false,
          error: docsRes.error.message,
          hint:
            schemaHint(docsRes.error.message) ||
            'Ejecuta supabase/hr_employee_documents.sql en Supabase',
          employee: empEarly,
          documents: placeholders,
          docTypes: HR_DOC_TYPES,
          reimbursements: [],
          justifications: [],
          exams: [],
          contracts: [],
          resguardos: [],
          checklist: emptyChecklistStats(),
          photoUrl: null,
          canVerify: canAccessAdmin(auth),
          canEditEmployee: canEditHrEmployees(auth),
        },
        { status: 200 }
      );
    }

    // Metadata only — firmas Storage on-demand (?sign=) al abrir preview.
    const docs: HrEmployeeDocument[] = [];
    for (const row of docsRes.data || []) {
      const d = row as HrEmployeeDocument;
      const def = docTypeDef(d.doc_type);
      docs.push({
        ...d,
        // Catálogo manda sobre filas viejas (p. ej. CV ya no es obligatorio).
        // Externos / sin docs: nada es obligatorio de alta.
        required: docsRequired ? (def ? def.required : d.required) : false,
        viewUrl: null,
      });
    }

    // Orden según checklist
    const order = new Map(HR_DOC_TYPES.map((t, i) => [t.id, i]));
    docs.sort(
      (a, b) => (order.get(a.doc_type as never) ?? 99) - (order.get(b.doc_type as never) ?? 99)
    );

    const [rem, jus, ex, contractsRes] = await Promise.all([
      sb
        .from('hr_medical_reimbursements')
        .select('*')
        .eq('employee_id', id)
        .order('created_at', { ascending: false }),
      sb
        .from('hr_medical_justifications')
        .select('*')
        .eq('employee_id', id)
        .order('absence_date', { ascending: false }),
      sb
        .from('hr_employee_exams')
        .select('*')
        .eq('employee_id', id)
        .order('test_date', { ascending: false }),
      sb.from('hr_employee_contracts').select('*').eq('employee_id', id),
    ]);

    let reimbursements: HrMedicalReimbursement[] = [];
    if (!rem.error && rem.data) {
      for (const row of rem.data) {
        const r = row as HrMedicalReimbursement;
        reimbursements.push({
          ...r,
          amount: Number(r.amount),
          viewUrl: null,
        });
      }
    }

    let justifications: HrMedicalJustification[] = [];
    if (!jus.error && jus.data) {
      for (const row of jus.data) {
        const j = row as HrMedicalJustification;
        justifications.push({
          ...j,
          viewUrl: null,
        });
      }
    }

    let exams: HrEmployeeExam[] = [];
    if (!ex.error && ex.data) {
      for (const row of ex.data) {
        const e = row as HrEmployeeExam;
        exams.push({
          ...e,
          viewUrl: null,
        });
      }
    }

    let contracts: HrEmployeeContract[] = [];
    if (!contractsRes.error && contractsRes.data) {
      const raw: HrEmployeeContract[] = [];
      for (const row of contractsRes.data) {
        const c = row as HrEmployeeContract;
        raw.push({
          ...c,
          viewUrl: null,
        });
      }
      contracts = sortContracts(raw);
    }
    // Fallback si falta hr_employee_contracts o está vacía: filas contrato__* en documents.
    if (!contracts.length) {
      contracts = contractsFromDocumentRows(
        id,
        docs.filter((d) => isContractDocType(d.doc_type))
      );
    }
    // Checklist Documentos: sin filas contrato__* (van al bloque Contratos).
    const checklistDocs = docs.filter((d) => !isContractDocType(d.doc_type));

    const emp = empRes.data as HrEmployee & {
      photo_storage_path?: string | null;
      nss?: string | null;
      curp?: string | null;
      emergency_contact?: string | null;
      emergency_phone?: string | null;
    };

    let resguardos: HrResguardoRequest[] = [];
    const seenResguardoIds = new Set<string>();
    const resg = await fetchResguardoRows(sb, { employeeId: id, limit: 100 });
    for (const row of resg.rows) {
      const req = asResguardoRequest(row);
      seenResguardoIds.add(req.id);
      resguardos.push(req);
    }
    // Cartas antiguas a veces no tienen employee_id: emparejar por nombre.
    const unlinked = await fetchResguardoRows(sb, {
      employeeId: null,
      limit: 200,
    });
    if (unlinked.rows.length) {
      const candidate = [{ id, full_name: emp.full_name || '' }];
      for (const row of unlinked.rows) {
        const req = asResguardoRequest(row);
        if (seenResguardoIds.has(req.id)) continue;
        const nombre =
          req.payload?.nombre ||
          req.payload?.receptor_nombre ||
          '';
        if (!nombre.trim()) continue;
        const m = matchPerson(nombre, candidate);
        if (
          m.employeeId === id &&
          (m.autoLink || m.confidence === 'exact' || m.confidence === 'high')
        ) {
          seenResguardoIds.add(req.id);
          resguardos.push(req);
        }
      }
      resguardos.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const required = checklistDocs.filter((d) => d.required);
    const done = required.filter((d) =>
      isRequiredDocSatisfied(d.status, d.storage_path)
    ).length;
    const verified = required.filter((d) => d.status === 'verified').length;

    // Solo foto del header (1 firma). Previews de docs: ?sign= on click.
    let photoUrl: string | null = null;
    const foto = checklistDocs.find((d) => d.doc_type === 'foto_perfil');
    if (foto?.storage_path) {
      photoUrl = await signedUrl(foto.storage_path);
    } else if (emp.photo_storage_path) {
      photoUrl = await signedUrl(emp.photo_storage_path);
    }

    return NextResponse.json({
      ready: true,
      softPullPending,
      employee: emp,
      documents: checklistDocs,
      docTypes: HR_DOC_TYPES,
      reimbursements,
      justifications,
      exams,
      contracts,
      defaultContractId: pickDefaultContract(contracts)?.id ?? null,
      resguardos,
      checklist: {
        requiredTotal: required.length,
        requiredUploaded: done,
        requiredVerified: verified,
      },
      photoUrl,
      canVerify: canAccessAdmin(auth),
      canEditEmployee: canEditHrEmployees(auth),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/hr/employees/[id]/profile
 * Actualiza ficha: empleo (puesto, área, ingreso, sueldo) + contacto / CURP / NSS.
 * Misma capacidad de escritura RH que PATCH /api/hr/employees (plantilla).
 */
export async function PATCH(request: Request, ctx: Ctx) {
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

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const key of [
    'phone',
    'email',
    'domicilio',
    'nss',
    'curp',
    'emergency_contact',
    'emergency_phone',
    'notes',
  ] as const) {
    if (key in body) {
      const v = body[key];
      patch[key] = v == null || String(v).trim() === '' ? null : String(v).trim();
    }
  }
  const rolesTouched =
    'puesto' in body ||
    'puestos_secundarios' in body ||
    Array.isArray(body.puestos) ||
    Array.isArray(body.roles);
  if (rolesTouched) {
    const rolesParsed = parseRolesFromBody(body);
    if (!rolesParsed.ok) {
      return NextResponse.json({ error: rolesParsed.error }, { status: 400 });
    }
    if (
      'puesto' in body ||
      Array.isArray(body.puestos) ||
      Array.isArray(body.roles)
    ) {
      patch.puesto = rolesParsed.roles.primary;
    }
    if (
      'puestos_secundarios' in body ||
      Array.isArray(body.puestos) ||
      Array.isArray(body.roles)
    ) {
      patch.puestos_secundarios = rolesParsed.roles.secondary;
    }
    if (!('area' in body) && !('areas' in body) && patch.puesto) {
      const inferred = areaFromPuesto(String(patch.puesto));
      if (inferred) {
        patch.area = inferred;
        patch.areas = [inferred];
      }
    }
  }
  if ('area' in body || 'areas' in body) {
    let list: string[] = [];
    if (Array.isArray(body.areas)) {
      list = parseEmployeeAreas(null, body.areas.map((x) => String(x ?? '')));
    } else if (Array.isArray(body.area)) {
      list = parseEmployeeAreas(
        body.area.map((x) => String(x ?? '')),
        null
      );
    } else {
      list = parseEmployeeAreas(
        body.area == null ? null : String(body.area),
        null
      );
    }
    patch.area = formatEmployeeAreas(list);
    patch.areas = list;
  }
  if ('fecha_nacimiento' in body) {
    const raw = String(body.fecha_nacimiento || '').trim();
    patch.fecha_nacimiento =
      raw === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    if (raw && patch.fecha_nacimiento == null) {
      return NextResponse.json(
        { error: 'fecha_nacimiento inválida (usa YYYY-MM-DD)' },
        { status: 400 }
      );
    }
  }
  if ('fecha_ingreso' in body) {
    const raw = String(body.fecha_ingreso || '').trim();
    if (raw === '') {
      patch.fecha_ingreso = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      patch.fecha_ingreso = raw;
    } else {
      return NextResponse.json(
        { error: 'fecha_ingreso inválida (usa YYYY-MM-DD)' },
        { status: 400 }
      );
    }
  }
  const sueldo = parseSueldoDiario(body.sueldo_diario);
  if (!sueldo.ok) {
    return NextResponse.json({ error: sueldo.error }, { status: 400 });
  }
  if (sueldo.set) patch.sueldo_diario = sueldo.value;

  const sueldo2 = parseSueldoDiario(body.sueldo_diario_secundario);
  if (!sueldo2.ok) {
    return NextResponse.json(
      { error: sueldo2.error.replace('sueldo_diario', 'sueldo_diario_secundario') },
      { status: 400 }
    );
  }
  if (sueldo2.set) patch.sueldo_diario_secundario = sueldo2.value;

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
  }

  const sb = getServiceSupabase();

  // Sync flag legado dual_limpieza_mesero según roles
  if (rolesTouched || 'notes' in body) {
    const cur = await loadEmployeeRow(id);
    const curEmp = (cur.data || {}) as {
      puesto?: string | null;
      puestos_secundarios?: string[] | null;
      notes?: string | null;
      full_name?: string | null;
    };
    const nextPuesto =
      patch.puesto !== undefined
        ? (patch.puesto as string | null)
        : curEmp.puesto ?? null;
    const nextSec =
      patch.puestos_secundarios !== undefined
        ? (patch.puestos_secundarios as string[])
        : curEmp.puestos_secundarios ?? [];
    const nextNotes =
      patch.notes !== undefined
        ? (patch.notes as string | null)
        : curEmp.notes ?? null;
    patch.notes = syncDualFlagInNotes(
      nextNotes,
      hasDualLimpiezaServicio({
        puesto: nextPuesto,
        puestos_secundarios: nextSec,
        notes: nextNotes,
        full_name: curEmp.full_name,
      })
    );
  }

  // Update sin .select() del schema completo: si faltan columnas solo en el
  // RETURNING/select (nacimiento, puestos…), el PATCH no debe fallar ni mentir
  // que falta sueldo_diario. Luego releemos con la cascada de loadEmployeeRow.
  let working = { ...patch };
  let upErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await sb.from('hr_employees').update(working).eq('id', id);
    if (!res.error) {
      upErr = null;
      break;
    }
    upErr = res.error;
    const msg = res.error.message || '';
    if (!/column .* does not exist|42703/i.test(msg)) break;

    if (/puestos_secundarios/i.test(msg) && working.puestos_secundarios !== undefined) {
      return NextResponse.json(
        {
          error: 'Falta columna puestos_secundarios en hr_employees.',
          hint: 'Ejecuta supabase/hr_employee_puestos.sql en Supabase',
        },
        { status: 503 }
      );
    }
    if (/sueldo_diario_secundario/i.test(msg) && sueldo2.set) {
      return NextResponse.json(
        {
          error: 'Falta columna sueldo_diario_secundario en hr_employees.',
          hint: 'Ejecuta supabase/hr_employee_sueldo_secundario.sql en Supabase',
        },
        { status: 503 }
      );
    }
    if (/sueldo_diario/i.test(msg) && sueldo.set) {
      return NextResponse.json(
        {
          error: 'Falta columna sueldo_diario en hr_employees.',
          hint: 'Ejecuta supabase/hr_employee_sueldo.sql en Supabase',
        },
        { status: 503 }
      );
    }
    if (/fecha_nacimiento/i.test(msg) && working.fecha_nacimiento !== undefined) {
      const { fecha_nacimiento: _fn, ...rest } = working;
      void _fn;
      working = rest;
      continue;
    }
    if (/domicilio/i.test(msg) && working.domicilio !== undefined) {
      return NextResponse.json(
        {
          error: 'Falta columna domicilio en hr_employees.',
          hint: 'Ejecuta supabase/hr_employee_documents.sql (o el ALTER domicilio) en Supabase',
        },
        { status: 503 }
      );
    }
    if (/puestos_secundarios/i.test(msg)) {
      const { puestos_secundarios: _ps, ...rest } = working;
      void _ps;
      working = rest;
      continue;
    }
    if (/\bareas\b/i.test(msg) && working.areas !== undefined) {
      const { areas: _ar, ...rest } = working;
      void _ar;
      working = rest;
      continue;
    }
    if (/sueldo_diario_secundario/i.test(msg)) {
      const { sueldo_diario_secundario: _sd2, ...rest } = working;
      void _sd2;
      working = rest;
      continue;
    }
    if (/sueldo_diario/i.test(msg)) {
      const { sueldo_diario: _sd, ...rest } = working;
      void _sd;
      working = rest;
      continue;
    }
    break;
  }

  if (upErr) {
    return NextResponse.json(
      {
        error: upErr.message,
        hint: /fecha_nacimiento|column/i.test(upErr.message)
          ? 'Revisa columnas en hr_employees (nacimiento / documentos)'
          : undefined,
      },
      { status: 400 }
    );
  }

  const loaded = await loadEmployeeRow(id);
  if (loaded.error || !loaded.data) {
    return NextResponse.json(
      { error: loaded.error?.message || 'No se pudo releer el empleado' },
      { status: 400 }
    );
  }
  invalidatePlantillaCache();
  return NextResponse.json({ ready: true, employee: loaded.data });
}

function parseExamFields(src: Record<string, unknown> | FormData): {
  ok: true;
  exam_type: string;
  test_date: string;
  result: string;
  notes: string | null;
} | { ok: false; error: string } {
  const get = (k: string) => {
    if (src instanceof FormData) return String(src.get(k) || '').trim();
    const v = src[k];
    return v == null ? '' : String(v).trim();
  };
  const exam_type = get('exam_type');
  const test_date = get('test_date');
  const result = get('result');
  const notesRaw = get('notes');
  if (!exam_type) return { ok: false, error: 'Tipo de examen requerido' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(test_date)) {
    return { ok: false, error: 'Fecha de la prueba inválida (YYYY-MM-DD)' };
  }
  if (!result) return { ok: false, error: 'Resultado requerido' };
  return {
    ok: true,
    exam_type,
    test_date,
    result,
    notes: notesRaw || null,
  };
}

/**
 * POST: documento / médico (multipart) o JSON (exam | pull_expediente).
 * multipart kind=document|reimbursement|justification|photo|exam|contract
 * JSON: { kind: 'exam', … } | { kind: 'pull_expediente', force? }
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireRrhhEmployeesWrite(auth);
  if (denied) return denied;
  const { id } = await ctx.params;

  const contentType = request.headers.get('content-type') || '';
  const sb = getServiceSupabase();
  const who = auth.username;

  if (contentType.includes('application/json')) {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    const jsonKind = String(body.kind || body.action || '');

    if (jsonKind === 'pull_expediente') {
      const empRes = await loadEmployeeRow(id);
      if (empRes.error || !empRes.data) {
        return NextResponse.json(
          { error: empRes.error?.message || 'Empleado no encontrado' },
          { status: 404 }
        );
      }
      const emp = empRes.data as HrEmployee & {
        drive_folder_path?: string | null;
      };
      const force = Boolean(body.force);
      const result = await pullExpedienteDocuments({
        employeeId: id,
        driveFolderPath: emp.drive_folder_path,
        fullName: emp.full_name,
        who,
        force,
      });
      // Tras el pull (o si no hay File Stream): partir paquete compartido +
      // reclasificar slots mal etiquetados (CURP↔Acta, Acta↔INE, etc.).
      const repaired = await repairSharedPackFromStorage({
        employeeId: id,
        who,
        force,
      });
      const relabeled = await repairMislabeledPackFromStorage({
        employeeId: id,
        who,
        force,
      });
      const imported =
        result.imported + repaired.imported + relabeled.imported;
      const skipped =
        result.skipped + repaired.skipped + relabeled.skipped;
      if (!result.ok && !repaired.repaired && !relabeled.repaired) {
        return NextResponse.json(
          {
            error: result.error || 'No se pudo jalar el expediente',
            hint: result.hint,
            ...result,
          },
          { status: 400 }
        );
      }
      // Identity fill diferido (antes bloqueaba GET del perfil).
      try {
        await fillEmptyEmployeeIdentity(sb, [id], {
          extractFromDocs: true,
          includeLeavePayloads: true,
          maxDocExtracts: 8,
        });
      } catch {
        /* best-effort */
      }
      return NextResponse.json({
        ready: true,
        message:
          imported > 0
            ? relabeled.repaired
              ? `Expediente: ${imported} documento(s) · tipos corregidos por contenido`
              : repaired.repaired
                ? `Expediente: ${imported} documento(s) · paquete separado por tipo`
                : `Expediente: ${imported} documento(s) importado(s)`
            : result.matched.length ||
                repaired.repaired ||
                relabeled.repaired
              ? 'Expediente revisado · sin cambios (ya cargados o verificados)'
              : 'Sin archivos de alta reconocibles en la carpeta',
        ok: true,
        imported,
        skipped,
        scanned: result.scanned,
        matched: result.matched,
        packRepaired: repaired.repaired,
        packRelabeled: relabeled.repaired,
        relabelSwaps: relabeled.swaps,
      });
    }

    if (jsonKind !== 'exam') {
      return NextResponse.json(
        { error: 'JSON admite kind=exam o kind=pull_expediente' },
        { status: 400 }
      );
    }
    const parsed = parseExamFields(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { error } = await sb.from('hr_employee_exams').insert({
      employee_id: id,
      exam_type: parsed.exam_type,
      test_date: parsed.test_date,
      result: parsed.result,
      notes: parsed.notes,
      created_by: who,
    });
    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          hint: /does not exist|relation|42P01/i.test(error.message)
            ? 'Ejecuta supabase/hr_employee_exams.sql en Supabase'
            : undefined,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ready: true, message: 'Examen registrado' });
  }

  const form = await request.formData();
  const kind = String(form.get('kind') || 'document');

  if (kind === 'exam') {
    const parsed = parseExamFields(form);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const file = form.get('file');
    let storage_path: string | null = null;
    let mime_type: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'Archivo máximo 10 MB' },
          { status: 413 }
        );
      }
      const mime = file.type || 'application/octet-stream';
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = mime.includes('pdf')
        ? 'pdf'
        : mime.includes('png')
          ? 'png'
          : mime.includes('webp')
            ? 'webp'
            : 'jpg';
      const path = `${id}/examen-${Date.now()}.${ext}`;
      const up = await sb.storage.from(HR_DOCS_BUCKET).upload(path, buf, {
        contentType: mime,
        upsert: false,
      });
      if (up.error) {
        return NextResponse.json({ error: up.error.message }, { status: 500 });
      }
      storage_path = path;
      mime_type = mime;
    }
    const { error } = await sb.from('hr_employee_exams').insert({
      employee_id: id,
      exam_type: parsed.exam_type,
      test_date: parsed.test_date,
      result: parsed.result,
      notes: parsed.notes,
      storage_path,
      mime_type,
      created_by: who,
    });
    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          hint: /does not exist|relation|42P01/i.test(error.message)
            ? 'Ejecuta supabase/hr_employee_exams.sql en Supabase'
            : undefined,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ready: true, message: 'Examen registrado' });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size < 1) {
    return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Archivo máximo 10 MB' },
      { status: 413 }
    );
  }

  const mime = file.type || 'application/octet-stream';
  const buf = Buffer.from(await file.arrayBuffer());
  const ext =
    mime.includes('pdf')
      ? 'pdf'
      : mime.includes('png')
        ? 'png'
        : mime.includes('webp')
          ? 'webp'
          : 'jpg';

  if (kind === 'document' || kind === 'photo') {
    const docType =
      kind === 'photo'
        ? 'foto_perfil'
        : String(form.get('doc_type') || '').trim();
    const def = docTypeDef(docType);
    if (!def) {
      return NextResponse.json({ error: 'doc_type inválido' }, { status: 400 });
    }
    const seeded = await ensureChecklist(id);
    if (seeded.error) {
      return NextResponse.json(
        {
          error: seeded.error,
          hint:
            schemaHint(seeded.error) ||
            'Ejecuta supabase/hr_employee_documents.sql en Supabase',
        },
        { status: 503 }
      );
    }
    const path = `${id}/${docType}-${Date.now()}.${ext}`;
    const up = await sb.storage.from(HR_DOCS_BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: true,
    });
    if (up.error) {
      return NextResponse.json(
        {
          error: up.error.message,
          hint: '¿Existe el bucket hr-employee-docs? Ejecuta hr_employee_documents.sql',
        },
        { status: 500 }
      );
    }

    const { data: existing } = await sb
      .from('hr_employee_documents')
      .select('id, storage_path')
      .eq('employee_id', id)
      .eq('doc_type', docType)
      .maybeSingle();

    if (existing?.storage_path) {
      await sb.storage.from(HR_DOCS_BUCKET).remove([existing.storage_path]);
    }

    const row = {
      employee_id: id,
      doc_type: docType,
      title: def.title,
      storage_path: path,
      mime_type: mime,
      byte_size: file.size,
      required: def.required,
      status: 'uploaded' as HrDocStatus,
      notes: (() => {
        const src = String(form.get('source') || '')
          .trim()
          .toLowerCase();
        if (src === 'scan') return `${def.hint} · Escaneo documentación`;
        if (src === 'photo') return `${def.hint} · Fotografía`;
        return def.hint;
      })(),

      uploaded_by: who,
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (existing?.id) {
      const res = await sb
        .from('hr_employee_documents')
        .update(row)
        .eq('id', existing.id);
      error = res.error;
    } else {
      const res = await sb.from('hr_employee_documents').insert(row);
      error = res.error;
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (docType === 'foto_perfil') {
      await sb
        .from('hr_employees')
        .update({
          photo_storage_path: path,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
    }

    return NextResponse.json({ ready: true, message: `${def.title} subido` });
  }

  if (kind === 'reimbursement') {
    const amount = Number(String(form.get('amount') || '0').replace(/,/g, ''));
    const expenseDate = String(form.get('expense_date') || '').trim() || null;
    const description = String(form.get('description') || '').trim() || null;
    const source = String(form.get('source') || '')
      .trim()
      .toLowerCase();
    const captureNote =
      source === 'scan'
        ? 'Escaneo documentación'
        : source === 'photo'
          ? 'Fotografía'
          : null;
    const path = `${id}/reembolso-${Date.now()}.${ext}`;
    const up = await sb.storage.from(HR_DOCS_BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }
    const { error } = await sb.from('hr_medical_reimbursements').insert({
      employee_id: id,
      amount: Number.isFinite(amount) ? amount : 0,
      expense_date: expenseDate,
      description,
      storage_path: path,
      mime_type: mime,
      status: 'solicitado',
      notes: captureNote,
      created_by: who,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ready: true, message: 'Reembolso registrado' });
  }

  if (kind === 'justification') {
    const absenceDate = String(form.get('absence_date') || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(absenceDate)) {
      return NextResponse.json(
        { error: 'absence_date (YYYY-MM-DD) requerida' },
        { status: 400 }
      );
    }
    const absenceEnd = String(form.get('absence_end_date') || '').trim() || null;
    const description = String(form.get('description') || '').trim() || null;
    const source = String(form.get('source') || '')
      .trim()
      .toLowerCase();
    const captureNote =
      source === 'scan'
        ? 'Escaneo documentación'
        : source === 'photo'
          ? 'Fotografía'
          : null;
    const path = `${id}/justificante-${Date.now()}.${ext}`;
    const up = await sb.storage.from(HR_DOCS_BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }
    const { error } = await sb.from('hr_medical_justifications').insert({
      employee_id: id,
      absence_date: absenceDate,
      absence_end_date: absenceEnd,
      description,
      storage_path: path,
      mime_type: mime,
      status: 'pendiente',
      pays_absence: true,
      notes: captureNote,
      created_by: who,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({
      ready: true,
      message: 'Justificante médico registrado (ligado a ausencia / nómina)',
    });
  }

  if (kind === 'contract') {
    const titleRaw = String(form.get('title') || '').trim();
    const asVigente =
      String(form.get('as_vigente') || '1') !== '0' &&
      String(form.get('as_vigente') || 'true') !== 'false';
    const effectiveFrom =
      String(form.get('effective_from') || '').trim() || null;
    if (effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      return NextResponse.json(
        { error: 'effective_from inválida (YYYY-MM-DD)' },
        { status: 400 }
      );
    }
    const path = `${id}/contrato-${Date.now()}.${ext}`;
    const up = await sb.storage.from(HR_DOCS_BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: false,
    });
    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    if (asVigente) {
      await sb
        .from('hr_employee_contracts')
        .update({ status: 'historico', updated_at: new Date().toISOString() })
        .eq('employee_id', id)
        .eq('status', 'vigente');
    }

    const { data: existingCount } = await sb
      .from('hr_employee_contracts')
      .select('id')
      .eq('employee_id', id)
      .limit(1);

    const status =
      asVigente || !existingCount?.length ? 'vigente' : 'historico';

    const { error } = await sb.from('hr_employee_contracts').insert({
      employee_id: id,
      title: titleRaw || 'Contrato',
      status,
      effective_from: effectiveFrom,
      source_filename: file.name || null,
      storage_path: path,
      mime_type: mime,
      byte_size: file.size,
      notes: null,
      uploaded_by: who,
    });
    if (error) {
      await sb.storage.from(HR_DOCS_BUCKET).remove([path]);
      return NextResponse.json(
        {
          error: error.message,
          hint: /does not exist|relation|42P01/i.test(error.message)
            ? 'Ejecuta supabase/hr_employee_contracts.sql en Supabase'
            : undefined,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ready: true,
      message:
        status === 'vigente'
          ? 'Contrato vigente guardado'
          : 'Contrato agregado al historial',
    });
  }

  return NextResponse.json({ error: 'kind inválido' }, { status: 400 });
}

/**
 * PUT JSON:
 * - update_exam / delete_exam → escritura RH
 * - set_contract_vigente / delete_contract → escritura RH
 * - verify_doc / reject_doc / set_*_status → solo Master admin
 */
export async function PUT(request: Request, ctx: Ctx) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const action = String(body.action || '');
  const sb = getServiceSupabase();
  const who = auth.username;
  const now = new Date().toISOString();

  if (action === 'update_exam' || action === 'delete_exam') {
    const denied = requireRrhhEmployeesWrite(auth);
    if (denied) return denied;
    const examId = String(body.examId || '');
    if (!examId) {
      return NextResponse.json({ error: 'examId requerido' }, { status: 400 });
    }

    if (action === 'delete_exam') {
      const { data: existing } = await sb
        .from('hr_employee_exams')
        .select('storage_path')
        .eq('id', examId)
        .eq('employee_id', id)
        .maybeSingle();
      const { error } = await sb
        .from('hr_employee_exams')
        .delete()
        .eq('id', examId)
        .eq('employee_id', id);
      if (error) {
        return NextResponse.json(
          {
            error: error.message,
            hint: /does not exist|relation|42P01/i.test(error.message)
              ? 'Ejecuta supabase/hr_employee_exams.sql en Supabase'
              : undefined,
          },
          { status: 400 }
        );
      }
      if (existing?.storage_path) {
        await sb.storage
          .from(HR_DOCS_BUCKET)
          .remove([String(existing.storage_path)]);
      }
      return NextResponse.json({ ready: true, message: 'Examen eliminado' });
    }

    const parsed = parseExamFields(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { error } = await sb
      .from('hr_employee_exams')
      .update({
        exam_type: parsed.exam_type,
        test_date: parsed.test_date,
        result: parsed.result,
        notes: parsed.notes,
        updated_by: who,
        updated_at: now,
      })
      .eq('id', examId)
      .eq('employee_id', id);
    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          hint: /does not exist|relation|42P01/i.test(error.message)
            ? 'Ejecuta supabase/hr_employee_exams.sql en Supabase'
            : undefined,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ready: true, message: 'Examen actualizado' });
  }

  if (action === 'set_contract_vigente' || action === 'delete_contract') {
    const denied = requireRrhhEmployeesWrite(auth);
    if (denied) return denied;
    const contractId = String(body.contractId || '');
    if (!contractId) {
      return NextResponse.json(
        { error: 'contractId requerido' },
        { status: 400 }
      );
    }

    if (action === 'delete_contract') {
      const { data: existing } = await sb
        .from('hr_employee_contracts')
        .select('id, storage_path, status')
        .eq('id', contractId)
        .eq('employee_id', id)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json(
          { error: 'Contrato no encontrado' },
          { status: 404 }
        );
      }
      const { error } = await sb
        .from('hr_employee_contracts')
        .delete()
        .eq('id', contractId)
        .eq('employee_id', id);
      if (error) {
        return NextResponse.json(
          {
            error: error.message,
            hint: /does not exist|relation|42P01/i.test(error.message)
              ? 'Ejecuta supabase/hr_employee_contracts.sql en Supabase'
              : undefined,
          },
          { status: 400 }
        );
      }
      if (existing.storage_path) {
        await sb.storage
          .from(HR_DOCS_BUCKET)
          .remove([String(existing.storage_path)]);
      }
      if (existing.status === 'vigente') {
        const { data: rest } = await sb
          .from('hr_employee_contracts')
          .select('id, effective_from, created_at')
          .eq('employee_id', id);
        if (rest?.length) {
          const pick = [...rest].sort((a, b) => {
            const da = a.effective_from || a.created_at || '';
            const db = b.effective_from || b.created_at || '';
            return String(db).localeCompare(String(da));
          })[0];
          if (pick?.id) {
            await sb
              .from('hr_employee_contracts')
              .update({ status: 'vigente', updated_at: now })
              .eq('id', pick.id);
          }
        }
      }
      return NextResponse.json({ ready: true, message: 'Contrato eliminado' });
    }

    await sb
      .from('hr_employee_contracts')
      .update({ status: 'historico', updated_at: now })
      .eq('employee_id', id)
      .eq('status', 'vigente');
    const { error } = await sb
      .from('hr_employee_contracts')
      .update({ status: 'vigente', updated_at: now })
      .eq('id', contractId)
      .eq('employee_id', id);
    if (error) {
      return NextResponse.json(
        {
          error: error.message,
          hint: /does not exist|relation|42P01/i.test(error.message)
            ? 'Ejecuta supabase/hr_employee_contracts.sql en Supabase'
            : undefined,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ready: true,
      message: 'Contrato marcado como vigente',
    });
  }

  const master = requireMasterAdmin(auth);
  if (master) return master;

  if (action === 'verify_doc' || action === 'reject_doc') {
    const docId = String(body.docId || '');
    if (!docId) {
      return NextResponse.json({ error: 'docId requerido' }, { status: 400 });
    }
    const status: HrDocStatus =
      action === 'verify_doc' ? 'verified' : 'rejected';
    const { error } = await sb
      .from('hr_employee_documents')
      .update({
        status,
        verified_by: who,
        verified_at: now,
        updated_at: now,
        notes: body.notes != null ? String(body.notes) : undefined,
      })
      .eq('id', docId)
      .eq('employee_id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ready: true, status });
  }

  if (action === 'set_reimbursement_status') {
    const rid = String(body.reimbursementId || '');
    const status = String(body.status || '');
    if (!rid || !['aprobado', 'pagado', 'rechazado', 'solicitado'].includes(status)) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const { error } = await sb
      .from('hr_medical_reimbursements')
      .update({ status, updated_by: who, updated_at: now })
      .eq('id', rid)
      .eq('employee_id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ready: true });
  }

  if (action === 'set_justification_status') {
    const jid = String(body.justificationId || '');
    const status = String(body.status || '');
    if (!jid || !['aceptado', 'rechazado', 'pendiente'].includes(status)) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const { error } = await sb
      .from('hr_medical_justifications')
      .update({
        status,
        verified_by: who,
        verified_at: now,
        updated_at: now,
      })
      .eq('id', jid)
      .eq('employee_id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ready: true });
  }

  return NextResponse.json({ error: 'action inválida' }, { status: 400 });
}
