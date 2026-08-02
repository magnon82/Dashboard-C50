import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { requireRrhhSession } from '@/app/lib/hr-api';
import {
  HR_EXPEDIENTES_DIR,
  HR_EXPEDIENTES_DRIVE_FOLDER_ID,
  hrDriveFolderUrl,
  fechaBajaFromNotes,
  isMergedDuplicateShell,
  type HrEmployeeStatus,
} from '@/app/lib/hr';
import {
  getHrRoot,
  hrRootExists,
  isUnderHrRoot,
  listHrFolder,
} from '@/app/lib/hr-biblioteca';
import {
  buildExpedientesFromEmployees,
  formatSyncBanner,
  upsertHrDriveSyncState,
} from '@/app/lib/hr-drive-sync';
import { localDriveFsEnabled } from '@/app/lib/local-fs';
import {
  folderBasenameFromPath,
  linkStatusFromMatch,
  matchPerson,
  normalizePersonKey,
  type PersonLinkStatus,
  type PersonMatchConfidence,
} from '@/app/lib/hr-person-match';
import { getServiceSupabase } from '@/app/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET_ALIASES: Record<string, string[]> = {
  altas: ['altas'],
  bajas: ['bajas'],
};

type DbEmp = {
  id: string;
  full_name: string;
  status: HrEmployeeStatus;
  fecha_ingreso: string | null;
  fecha_baja: string | null;
  puesto: string | null;
  force_exclude: boolean;
  drive_folder_path: string | null;
  notes: string | null;
};

type PersonFolder = {
  name: string;
  path: string;
  mtimeMs: number | null;
  /** Baja en sistema aunque la carpeta siga en Altas. */
  archiveStatus?: HrEmployeeStatus | null;
  fechaBaja?: string | null;
  employeeId?: string | null;
  archiveNote?: string | null;
  linkStatus?: PersonLinkStatus;
  matchConfidence?: PersonMatchConfidence | null;
  matchScore?: number | null;
  matchedName?: string | null;
};

function normalizeFolderKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolveFechaBaja(
  fecha: string | null | undefined,
  notes: string | null | undefined
): string | null {
  const col = fecha ? String(fecha).slice(0, 10) : null;
  return col || fechaBajaFromNotes(notes);
}

function normalizeEmpRow(
  e: Omit<DbEmp, 'fecha_ingreso' | 'fecha_baja' | 'drive_folder_path'> & {
    fecha_ingreso?: string | null;
    fecha_baja?: string | null;
    drive_folder_path?: string | null;
    notes?: string | null;
  }
): DbEmp {
  return {
    id: e.id,
    full_name: e.full_name,
    status: e.status,
    fecha_ingreso: e.fecha_ingreso
      ? String(e.fecha_ingreso).slice(0, 10)
      : null,
    fecha_baja: resolveFechaBaja(e.fecha_baja, e.notes),
    puesto: e.puesto,
    force_exclude: e.force_exclude,
    drive_folder_path: e.drive_folder_path ?? null,
    notes: e.notes ?? null,
  };
}

async function loadEmployees(): Promise<DbEmp[]> {
  try {
    const sb = getServiceSupabase();
    const withPath = await sb
      .from('hr_employees')
      .select(
        'id, full_name, status, fecha_ingreso, fecha_baja, puesto, force_exclude, drive_folder_path, notes'
      )
      .order('full_name', { ascending: true });
    if (!withPath.error && withPath.data) {
      return (withPath.data as DbEmp[]).map(normalizeEmpRow);
    }
    const fallback = await sb
      .from('hr_employees')
      .select(
        'id, full_name, status, fecha_ingreso, puesto, force_exclude, drive_folder_path, notes'
      )
      .order('full_name', { ascending: true });
    if (!fallback.error && fallback.data) {
      return (
        fallback.data as Omit<DbEmp, 'fecha_baja'>[]
      ).map((e) => normalizeEmpRow({ ...e, fecha_baja: null }));
    }
    const minimal = await sb
      .from('hr_employees')
      .select(
        'id, full_name, status, fecha_ingreso, puesto, force_exclude, notes'
      )
      .order('full_name', { ascending: true });
    if (minimal.error || !minimal.data) return [];
    return (
      minimal.data as Omit<DbEmp, 'fecha_baja' | 'drive_folder_path'>[]
    ).map((e) =>
      normalizeEmpRow({ ...e, fecha_baja: null, drive_folder_path: null })
    );
  } catch {
    return [];
  }
}

function preferArchivedSurvivor(a: DbEmp, b: DbEmp): DbEmp {
  const aFolder = Boolean(a.drive_folder_path);
  const bFolder = Boolean(b.drive_folder_path);
  let best: DbEmp;
  if (aFolder !== bFolder) best = aFolder ? a : b;
  else if (a.full_name.length !== b.full_name.length) {
    // Nombre de carpeta Altas (más tokens) suele ser el canónico
    best = a.full_name.length >= b.full_name.length ? a : b;
  } else {
    best = a.id <= b.id ? a : b;
  }
  const other = best.id === a.id ? b : a;
  // Conservar fechas del cluster si al survivor le faltan
  if (!best.fecha_ingreso && other.fecha_ingreso) {
    best = { ...best, fecha_ingreso: other.fecha_ingreso };
  }
  if (!best.fecha_baja && other.fecha_baja) {
    best = { ...best, fecha_baja: other.fecha_baja };
  }
  return best;
}

/**
 * Bajas operativas reales — excluye cáscaras de duplicado fusionado
 * y colapsa near-dupes (p. ej. LUIS FERNANDO GALLARDO vs GALLARDO ÁVILA…)
 * preferiendo la fila con carpeta de expediente.
 */
function archivedOperational(employees: DbEmp[]): DbEmp[] {
  const operational = employees.filter(
    (e) => e.status === 'baja' && !isMergedDuplicateShell(e.notes)
  );
  if (operational.length <= 1) return operational;

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const r = find(p);
    parent.set(id, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const e of operational) parent.set(e.id, e.id);

  for (let i = 0; i < operational.length; i++) {
    const a = operational[i];
    const rest = operational.slice(i + 1);
    if (!rest.length) continue;
    const hit = matchPerson(
      a.full_name,
      rest.map((o) => ({ id: o.id, full_name: o.full_name })),
      { minAutoScore: 0.9 }
    );
    if (hit.autoLink && hit.employeeId) union(a.id, hit.employeeId);
  }

  const clusters = new Map<string, DbEmp[]>();
  for (const e of operational) {
    const root = find(e.id);
    const list = clusters.get(root) || [];
    list.push(e);
    clusters.set(root, list);
  }

  return [...clusters.values()].map((group) =>
    group.reduce((best, cur) => preferArchivedSurvivor(best, cur))
  );
}

/**
 * Al vincular expediente ↔ empleado: escribe drive_folder_path (si falta)
 * y fija full_name al nombre de carpeta del expediente (canónico).
 */
async function persistExpedienteLink(
  emp: DbEmp,
  folderPath: string,
  folderName: string
): Promise<{ pathWritten: boolean; nameUpdated: boolean }> {
  const canonical = folderName.replace(/\s+/g, ' ').trim();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  let pathWritten = false;
  let nameUpdated = false;

  if (!emp.drive_folder_path) {
    patch.drive_folder_path = folderPath;
    pathWritten = true;
  }

  // Carpeta de expediente = nombre canónico (ID / contrato).
  if (canonical && emp.full_name.replace(/\s+/g, ' ').trim() !== canonical) {
    patch.full_name = canonical;
    nameUpdated = true;
  }

  if (!pathWritten && !nameUpdated) {
    return { pathWritten: false, nameUpdated: false };
  }

  try {
    const sb = getServiceSupabase();
    let q = sb.from('hr_employees').update(patch).eq('id', emp.id);
    // Evitar pisar una ruta ya escrita por otra carpeta.
    if (pathWritten) q = q.is('drive_folder_path', null);
    const { error } = await q;
    if (error) return { pathWritten: false, nameUpdated: false };
    if (pathWritten) emp.drive_folder_path = folderPath;
    if (nameUpdated) emp.full_name = canonical;
    return { pathWritten, nameUpdated };
  } catch {
    return { pathWritten: false, nameUpdated: false };
  }
}

async function enrichPeople(
  people: PersonFolder[],
  employees: DbEmp[],
  bucketKind: string | null,
  writePaths: boolean
): Promise<{
  people: PersonFolder[];
  pathsWritten: number;
  namesUpdated: number;
}> {
  let pathsWritten = 0;
  let namesUpdated = 0;
  const named = employees.map((e) => {
    const alias = folderBasenameFromPath(e.drive_folder_path);
    return {
      id: e.id,
      full_name: e.full_name,
      aliases:
        alias && normalizePersonKey(alias) !== normalizePersonKey(e.full_name)
          ? [alias]
          : undefined,
    };
  });
  const byId = new Map(employees.map((e) => [e.id, e]));

  const out: PersonFolder[] = [];
  for (const p of people) {
    const match = matchPerson(p.name, named);
    const linkStatus = linkStatusFromMatch(match);
    const emp =
      match.autoLink && match.employeeId
        ? byId.get(match.employeeId) ?? null
        : null;

    if (writePaths && bucketKind === 'altas' && emp && match.autoLink) {
      const res = await persistExpedienteLink(emp, p.path, p.name);
      if (res.pathWritten) pathsWritten += 1;
      if (res.nameUpdated) {
        namesUpdated += 1;
        // Mantener candidatos de match alineados con el nombre canónico.
        const n = named.find((x) => x.id === emp.id);
        if (n) n.full_name = emp.full_name;
      }
    }

    if (!emp) {
      out.push({
        ...p,
        employeeId: null,
        linkStatus,
        matchConfidence: match.confidence,
        matchScore: match.score || null,
        matchedName: match.candidates?.[0]?.full_name ?? null,
      });
      continue;
    }

    const stillInAltas = bucketKind === 'altas' && emp.status === 'baja';
    out.push({
      ...p,
      archiveStatus: emp.status === 'baja' ? 'baja' : emp.status,
      fechaBaja: emp.fecha_baja,
      employeeId: emp.id,
      linkStatus: 'linked',
      matchConfidence: match.confidence,
      matchScore: match.score,
      matchedName: emp.full_name,
      archiveNote:
        emp.status === 'baja'
          ? stillInAltas
            ? 'Archivado en sistema (carpeta aún en Altas)'
            : emp.fecha_baja
              ? `Baja desde ${emp.fecha_baja}`
              : 'Baja en sistema'
          : null,
    });
  }

  return { people: out, pathsWritten, namesUpdated };
}

/**
 * GET /api/hr/expedientes
 * Índice Altas/Bajas bajo Expedientes personal C50 (solo módulo rrhh).
 * - Sin params: buckets + conteos + archivedFromDb
 * - ?bucket=altas|bajas|otros&path=… — listado de carpetas (match → employeeId)
 */
export async function GET(request: Request) {
  const auth = await requireRrhhSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const bucketParam = (url.searchParams.get('bucket') || '').toLowerCase();
  const listPath = url.searchParams.get('path') || '';

  const root = getHrRoot();
  const rootExists = hrRootExists();
  const expedientesPath = HR_EXPEDIENTES_DIR;
  const expedientesExists =
    localDriveFsEnabled() && rootExists
      ? existsSync(expedientesPath)
      : false;
  const driveUrl = hrDriveFolderUrl(HR_EXPEDIENTES_DRIVE_FOLDER_ID);
  const allEmployees = await loadEmployees();
  const archivedFromDb = archivedOperational(allEmployees);
  const dbIndex = buildExpedientesFromEmployees(allEmployees);

  if (!rootExists || !expedientesExists) {
    let people = dbIndex.people;
    if (bucketParam === 'altas' || bucketParam === 'bajas') {
      people = people.filter((p) => p.bucket === bucketParam);
    } else if (bucketParam === 'otros') {
      people = people.filter((p) => p.bucket === 'otros');
    } else if (listPath) {
      const decoded = decodeURIComponent(listPath).toLowerCase();
      if (decoded.includes('bajas')) {
        people = people.filter((p) => p.bucket === 'bajas');
      } else if (decoded.includes('altas')) {
        people = people.filter((p) => p.bucket === 'altas');
      }
    }

    const ready = dbIndex.linkedCount > 0 || archivedFromDb.length > 0;
    const listing = Boolean(listPath || bucketParam);
    const message = formatSyncBanner({
      driveMounted: false,
      source: ready ? 'supabase' : 'none',
      linkedCount: dbIndex.linkedCount,
      openBlocked: !driveUrl,
      hideWhenOnline: ready,
    });

    return NextResponse.json({
      ready,
      source: 'supabase',
      root: localDriveFsEnabled() ? root : null,
      rootExists,
      localFsEnabled: localDriveFsEnabled(),
      path: listing
        ? bucketParam === 'bajas'
          ? `${expedientesPath}\\Bajas`
          : bucketParam === 'altas'
            ? `${expedientesPath}\\Altas`
            : listPath
              ? decodeURIComponent(listPath)
              : expedientesPath
        : expedientesPath,
      exists: expedientesExists,
      driveUrl,
      buckets: listing ? undefined : dbIndex.buckets,
      people: listing ? people : [],
      archivedFromDb,
      pathsWritten: 0,
      namesUpdated: 0,
      linkedCount: dbIndex.linkedCount,
      message,
    });
  }

  if (!isUnderHrRoot(expedientesPath)) {
    return NextResponse.json(
      { error: 'Ruta de expedientes fuera de la biblioteca RH' },
      { status: 403 }
    );
  }

  try {
    if (listPath || bucketParam) {
      let target = listPath ? decodeURIComponent(listPath) : '';
      if (!target && bucketParam) {
        const listed = await listHrFolder(expedientesPath);
        const match = listed.items.find((it) => {
          if (it.kind !== 'folder') return false;
          const key = normalizeFolderKey(it.name);
          if (bucketParam === 'otros') {
            return (
              !BUCKET_ALIASES.altas.includes(key) &&
              !BUCKET_ALIASES.bajas.includes(key)
            );
          }
          const aliases = BUCKET_ALIASES[bucketParam];
          return aliases ? aliases.includes(key) : key === bucketParam;
        });
        target = match?.path || '';
      }

      if (!target || !isUnderHrRoot(target)) {
        return NextResponse.json(
          { error: 'Carpeta de expediente no válida', path: target || null },
          { status: 400 }
        );
      }

      const listed = await listHrFolder(target);
      const rawPeople: PersonFolder[] = listed.items
        .filter((it) => it.kind === 'folder')
        .map((it) => ({
          name: it.name,
          path: it.path,
          mtimeMs: it.mtimeMs,
        }));

      const { people, pathsWritten, namesUpdated } = await enrichPeople(
        rawPeople,
        allEmployees,
        bucketParam || null,
        bucketParam === 'altas'
      );

      void upsertHrDriveSyncState({
        contentType: 'expedientes',
        status: 'ok',
        source: 'file_stream',
        message: `Listado ${bucketParam || 'carpeta'}: ${people.length} carpetas`,
        rowCount: people.length,
      });

      return NextResponse.json({
        ready: true,
        source: 'file_stream',
        root,
        rootExists: true,
        path: target,
        parent: listed.parent,
        exists: true,
        driveUrl,
        bucket: bucketParam || null,
        people,
        archivedFromDb,
        pathsWritten,
        namesUpdated,
        linkedCount: dbIndex.linkedCount + pathsWritten,
        files: listed.items.filter((it) => it.kind === 'file'),
        message: undefined,
      });
    }

    const listed = await listHrFolder(expedientesPath);
    const folders = listed.items.filter((it) => it.kind === 'folder');

    const buckets = await Promise.all(
      folders.map(async (f) => {
        const key = normalizeFolderKey(f.name);
        let kind: 'altas' | 'bajas' | 'otros' = 'otros';
        if (BUCKET_ALIASES.altas.includes(key)) kind = 'altas';
        else if (BUCKET_ALIASES.bajas.includes(key)) kind = 'bajas';

        let count = 0;
        try {
          const inner = await listHrFolder(f.path);
          count = inner.items.filter((it) => it.kind === 'folder').length;
        } catch {
          count = 0;
        }

        return {
          id: kind === 'otros' ? `otros:${f.name}` : kind,
          kind,
          name: f.name,
          path: f.path,
          count,
          mtimeMs: f.mtimeMs,
        };
      })
    );

    buckets.sort((a, b) => {
      const order = { altas: 0, bajas: 1, otros: 2 } as const;
      if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });

    const totalFolders = buckets.reduce((n, b) => n + b.count, 0);
    void upsertHrDriveSyncState({
      contentType: 'expedientes',
      status: 'ok',
      source: 'file_stream',
      message: `Índice File Stream: ${totalFolders} carpetas`,
      rowCount: totalFolders,
    });

    return NextResponse.json({
      ready: true,
      source: 'file_stream',
      root,
      rootExists: true,
      path: expedientesPath,
      exists: true,
      driveUrl,
      buckets,
      people: [],
      archivedFromDb,
      pathsWritten: 0,
      namesUpdated: 0,
      linkedCount: dbIndex.linkedCount,
      message: undefined,
    });
  } catch (e) {
    const ready = dbIndex.linkedCount > 0 || archivedFromDb.length > 0;
    return NextResponse.json(
      {
        ready,
        source: ready ? 'supabase' : 'none',
        root,
        rootExists,
        path: expedientesPath,
        exists: expedientesExists,
        driveUrl,
        buckets: ready ? dbIndex.buckets : [],
        people: [],
        archivedFromDb,
        pathsWritten: 0,
        namesUpdated: 0,
        linkedCount: dbIndex.linkedCount,
        error: e instanceof Error ? e.message : 'No se pudo listar expedientes',
        message: ready
          ? formatSyncBanner({
              driveMounted: rootExists,
              source: 'supabase',
              linkedCount: dbIndex.linkedCount,
              openBlocked: !driveUrl,
              hideWhenOnline: true,
            })
          : undefined,
      },
      { status: 200 }
    );
  }
}
