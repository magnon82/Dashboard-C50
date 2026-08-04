/**
 * Sync Drive RH → Supabase: tipos de contenido + estado.
 * Soft-sync cloud: Actions diario 12:00 PM CDMX (sync-hr-drive.yml → sync_hr_drive_cloud.py).
 * File Stream / Drive API / POST /api/hr/sync refrescan; Vercel lee filas ya persistidas.
 */

import { getServiceSupabase } from '@/app/lib/users';
import { folderBasenameFromPath } from '@/app/lib/hr-person-match';
import { HR_EXPEDIENTES_DIR, isMergedDuplicateShell } from '@/app/lib/hr';
import { hrRootExists } from '@/app/lib/hr-biblioteca';

export type HrDriveSyncContentType =
  | 'nomina'
  | 'horarios'
  | 'expedientes'
  | 'biblioteca'
  | 'cultura'
  | 'eventos_os'
  | 'eventos_biblioteca'
  | 'eventos_activity'
  | 'base_datos_personal';

export type HrDriveSyncStatus =
  | 'never'
  | 'ok'
  | 'partial'
  | 'error'
  | 'skipped';

export type HrDriveSyncContentDef = {
  id: HrDriveSyncContentType;
  label: string;
  /** Dónde vive lo operativo en Suite (sin File Stream). */
  persistsIn: string;
  /** Qué sigue necesitando Drive (API o File Stream) para abrir/refrescar. */
  stillNeedsDrive: string;
  /** Cadencia documentada (cloud soft-sync diario; tipos individuales pueden diferir). */
  cadenceHint: string;
  /** Cómo se refresca hoy. */
  refreshHow: string;
};

/** Catálogo para preguntar al usuario con qué frecuencia actualizar cada tipo. */
export const HR_DRIVE_SYNC_CONTENT_TYPES: HrDriveSyncContentDef[] = [
  {
    id: 'nomina',
    label: 'Nómina',
    persistsIn: 'hr_payroll_periods + hr_payroll_lines (+ plantilla vía unión)',
    stillNeedsDrive:
      'Import xlsx nuevos opcional: Drive API (HR_NOMINA_DRIVE_FOLDER_ID) o PC de admin',
    cadenceHint: 'Diario 12:00 PM CDMX (Actions soft-sync); import xlsx al publicar/semana',
    refreshHow: '/rrhh → Nómina (datos en Supabase; sync opcional)',
  },
  {
    id: 'horarios',
    label: 'Horarios',
    persistsIn: 'hr_schedule_weeks + hr_schedule_shifts (+ disponibilidad)',
    stillNeedsDrive:
      'Import histórico xlsx opcional (Descargas / PC de admin)',
    cadenceHint: 'Diario 12:00 PM CDMX (Actions soft-sync); publicar semana en /rrhh',
    refreshHow: '/rrhh → Horarios (publicado en Supabase; Importar 2026 opcional)',
  },
  {
    id: 'expedientes',
    label: 'Expedientes (índice Altas/Bajas)',
    persistsIn:
      'hr_employees.drive_folder_path + status/fecha_baja (índice en DB)',
    stillNeedsDrive:
      'Binarios: Drive API (HR_EXPEDIENTES_DRIVE_FOLDER_ID) → Storage; detectar carpetas nuevas = PC admin opcional',
    cadenceHint: 'Diario 12:00 PM CDMX (Actions soft-sync); alta/baja en Suite',
    refreshHow: 'Índice en Supabase; sync local opcional',
  },
  {
    id: 'biblioteca',
    label: 'Biblioteca RH (políticas, RIT, perfiles, exámenes)',
    persistsIn: 'hr_doc_links (metadatos/rutas); Cultura también en código',
    stillNeedsDrive:
      'Abrir PDF/docx: Drive API (HR_DOCS_VIGENTE_DRIVE_FOLDER_ID) o drive_url',
    cadenceHint: 'Diario 12:00 PM CDMX (Actions soft-sync); docs cambian raro',
    refreshHow: 'Seed SQL + POST /api/hr/sync content_type=biblioteca',
  },
  {
    id: 'cultura',
    label: 'Cultura organizacional',
    persistsIn: 'app/lib/hr-cultura.ts (textos Suite) + hr_doc_links',
    stillNeedsDrive: 'Carpeta Drive solo como respaldo opcional',
    cadenceHint: 'Muy rara (cambio de misión/valores); soft-sync no la pisa',
    refreshHow: 'Edición en código / deploy',
  },
  {
    id: 'eventos_os',
    label: 'Eventos · órdenes de servicio (PDF)',
    persistsIn:
      'event_service_orders (digital) + seed_event_client_activity.json (índice PDF)',
    stillNeedsDrive: 'Abrir PDF legacy opcional (OS digitales en CRM)',
    cadenceHint: 'Frecuente en temporada de eventos',
    refreshHow: 'OS digital en Suite; seed de actividad',
  },
  {
    id: 'eventos_biblioteca',
    label: 'Eventos · menús / políticas / publicidad',
    persistsIn: 'event_menus (+ seed JSON); políticas in-app; catálogo seed',
    stillNeedsDrive: 'Abrir menús PDF/Word (scan local opcional)',
    cadenceHint: 'Al cambiar menú vigente o contrato',
    refreshHow: 'Seed / políticas in-app',
  },
  {
    id: 'eventos_activity',
    label: 'Eventos · anticipos / actividad clientes',
    persistsIn: 'seed_event_client_activity.json + CRM leads/clientes',
    stillNeedsDrive: 'Excel/Drive Eventos al regenerar seed',
    cadenceHint: 'Según cierres de anticipo / seguimiento',
    refreshHow: 'ingestor/build_event_client_activity.py',
  },
  {
    id: 'base_datos_personal',
    label: 'BASE DATOS PERSONAL C50.xlsx',
    persistsIn: 'Enrich hacia hr_employees (fechas/puesto) vía import',
    stillNeedsDrive: 'Drive API / Descargas en PC de admin (opcional)',
    cadenceHint: 'Diario 12:00 PM CDMX (Actions soft-sync); enrich al actualizar base',
    refreshHow: '/rrhh → Nómina · enrich_base_datos',
  },
];

export type HrDriveSyncStateRow = {
  content_type: HrDriveSyncContentType;
  label: string;
  last_synced_at: string | null;
  last_source: string | null;
  last_status: HrDriveSyncStatus;
  last_message: string | null;
  row_count: number | null;
  updated_at: string | null;
};

export async function listHrDriveSyncState(): Promise<{
  rows: HrDriveSyncStateRow[];
  tableMissing: boolean;
  driveMounted: boolean;
}> {
  const driveMounted = hrRootExists();
  const defs = HR_DRIVE_SYNC_CONTENT_TYPES;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_drive_sync_state')
      .select(
        'content_type, label, last_synced_at, last_source, last_status, last_message, row_count, updated_at'
      );
    if (error) {
      const missing =
        /does not exist|schema cache|Could not find the table/i.test(
          error.message || ''
        );
      return {
        tableMissing: missing,
        driveMounted,
        rows: defs.map((d) => ({
          content_type: d.id,
          label: d.label,
          last_synced_at: null,
          last_source: null,
          last_status: 'never' as const,
          last_message: missing
            ? 'Ejecuta supabase/hr_drive_sync.sql para persistir estado de sync.'
            : error.message,
          row_count: null,
          updated_at: null,
        })),
      };
    }
    const byType = new Map(
      (data || []).map((r) => [r.content_type as string, r])
    );
    return {
      tableMissing: false,
      driveMounted,
      rows: defs.map((d) => {
        const r = byType.get(d.id);
        if (!r) {
          return {
            content_type: d.id,
            label: d.label,
            last_synced_at: null,
            last_source: null,
            last_status: 'never' as const,
            last_message: null,
            row_count: null,
            updated_at: null,
          };
        }
        return {
          content_type: d.id,
          label: (r.label as string) || d.label,
          last_synced_at: (r.last_synced_at as string) || null,
          last_source: (r.last_source as string) || null,
          last_status: (r.last_status as HrDriveSyncStatus) || 'never',
          last_message: (r.last_message as string) || null,
          row_count:
            typeof r.row_count === 'number' ? (r.row_count as number) : null,
          updated_at: (r.updated_at as string) || null,
        };
      }),
    };
  } catch (e) {
    return {
      tableMissing: true,
      driveMounted,
      rows: defs.map((d) => ({
        content_type: d.id,
        label: d.label,
        last_synced_at: null,
        last_source: null,
        last_status: 'never' as const,
        last_message: e instanceof Error ? e.message : 'Error',
        row_count: null,
        updated_at: null,
      })),
    };
  }
}

export async function upsertHrDriveSyncState(input: {
  contentType: HrDriveSyncContentType;
  status: HrDriveSyncStatus;
  source?: string | null;
  message?: string | null;
  rowCount?: number | null;
}): Promise<boolean> {
  const def = HR_DRIVE_SYNC_CONTENT_TYPES.find((d) => d.id === input.contentType);
  if (!def) return false;
  try {
    const sb = getServiceSupabase();
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      content_type: input.contentType,
      label: def.label,
      last_source: input.source ?? null,
      last_status: input.status,
      last_message: input.message ?? null,
      row_count: input.rowCount ?? null,
      updated_at: now,
    };
    if (input.status === 'ok' || input.status === 'partial') {
      row.last_synced_at = now;
    }
    const { error } = await sb
      .from('hr_drive_sync_state')
      .upsert(row, { onConflict: 'content_type' });
    return !error;
  } catch {
    return false;
  }
}

export type ExpedienteBucketKind = 'altas' | 'bajas' | 'otros';

export function inferExpedienteBucket(
  driveFolderPath: string | null | undefined,
  status: string | null | undefined
): ExpedienteBucketKind {
  const n = String(driveFolderPath || '')
    .replace(/\\/g, '/')
    .toLowerCase();
  if (n.includes('/bajas/') || /\/bajas$/i.test(n)) return 'bajas';
  if (n.includes('/altas/') || /\/altas$/i.test(n)) return 'altas';
  if (status === 'baja') return 'bajas';
  if (driveFolderPath) return 'altas';
  return 'otros';
}

export type DbExpedientePerson = {
  name: string;
  path: string;
  mtimeMs: number | null;
  archiveStatus: string | null;
  fechaBaja: string | null;
  employeeId: string;
  archiveNote: string | null;
  linkStatus: 'linked';
  matchConfidence: 'exact';
  matchScore: number;
  matchedName: string;
  bucket: ExpedienteBucketKind;
};

/** Índice de expedientes ya persistido en hr_employees (sin File Stream). */
export function buildExpedientesFromEmployees(
  employees: Array<{
    id: string;
    full_name: string;
    status: string;
    fecha_baja: string | null;
    drive_folder_path: string | null;
  }>
): {
  people: DbExpedientePerson[];
  buckets: Array<{
    id: string;
    kind: ExpedienteBucketKind;
    name: string;
    path: string;
    count: number;
    mtimeMs: number | null;
  }>;
  linkedCount: number;
} {
  const people: DbExpedientePerson[] = [];
  for (const e of employees) {
    if (!e.drive_folder_path) continue;
    const name =
      folderBasenameFromPath(e.drive_folder_path) || e.full_name;
    const bucket = inferExpedienteBucket(e.drive_folder_path, e.status);
    const stillInAltas = e.status === 'baja' && bucket === 'altas';
    people.push({
      name,
      path: e.drive_folder_path,
      mtimeMs: null,
      archiveStatus: e.status === 'baja' ? 'baja' : e.status,
      fechaBaja: e.fecha_baja,
      employeeId: e.id,
      archiveNote:
        e.status === 'baja'
          ? stillInAltas
            ? 'Archivado en sistema (carpeta aún en Altas)'
            : e.fecha_baja
              ? `Baja desde ${e.fecha_baja}`
              : 'Baja en sistema'
          : null,
      linkStatus: 'linked',
      matchConfidence: 'exact',
      matchScore: 1,
      matchedName: e.full_name,
      bucket,
    });
  }

  const altasPath = `${HR_EXPEDIENTES_DIR}\\Altas`;
  const bajasPath = `${HR_EXPEDIENTES_DIR}\\Bajas`;
  const altas = people.filter((p) => p.bucket === 'altas');
  const bajas = people.filter((p) => p.bucket === 'bajas');
  const otros = people.filter((p) => p.bucket === 'otros');

  const buckets: Array<{
    id: string;
    kind: ExpedienteBucketKind;
    name: string;
    path: string;
    count: number;
    mtimeMs: number | null;
  }> = [
    {
      id: 'altas',
      kind: 'altas',
      name: 'Altas',
      path: altasPath,
      count: altas.length,
      mtimeMs: null,
    },
    {
      id: 'bajas',
      kind: 'bajas',
      name: 'Bajas',
      path: bajasPath,
      count: bajas.length,
      mtimeMs: null,
    },
  ];
  if (otros.length) {
    buckets.push({
      id: 'otros:db',
      kind: 'otros',
      name: 'Otros (DB)',
      path: HR_EXPEDIENTES_DIR,
      count: otros.length,
      mtimeMs: null,
    });
  }

  return { people, buckets, linkedCount: people.length };
}

/** Desajuste Altas↔status (solo lectura; no auto-baja activos). */
export type ExpedienteStatusMismatch = {
  id: string;
  full_name: string;
  status: string;
  fecha_baja: string | null;
  drive_folder_path: string | null;
  kind:
    | 'baja_still_in_altas'
    | 'activo_with_fecha_baja'
    | 'baja_without_fecha'
    | 'merged_shell';
  note: string;
};

/**
 * Auditoría de inconsistencias expediente/status.
 * No muta filas: Master/script lista y RH decide (mover carpeta / reactivar).
 */
export function auditExpedienteStatusMismatches(
  employees: Array<{
    id: string;
    full_name: string;
    status: string;
    fecha_baja: string | null;
    drive_folder_path: string | null;
    notes?: string | null;
  }>
): ExpedienteStatusMismatch[] {
  const out: ExpedienteStatusMismatch[] = [];
  for (const e of employees) {
    const bucket = inferExpedienteBucket(e.drive_folder_path, e.status);
    if (isMergedDuplicateShell(e.notes)) {
      out.push({
        id: e.id,
        full_name: e.full_name,
        status: e.status,
        fecha_baja: e.fecha_baja,
        drive_folder_path: e.drive_folder_path,
        kind: 'merged_shell',
        note: 'Cáscara de duplicado fusionado (revisar / limpiar)',
      });
      continue;
    }
    if (e.status === 'baja' && bucket === 'altas') {
      out.push({
        id: e.id,
        full_name: e.full_name,
        status: e.status,
        fecha_baja: e.fecha_baja,
        drive_folder_path: e.drive_folder_path,
        kind: 'baja_still_in_altas',
        note: 'Archivado en sistema (carpeta aún en Altas)',
      });
    }
    if (e.status === 'activo' && e.fecha_baja) {
      out.push({
        id: e.id,
        full_name: e.full_name,
        status: e.status,
        fecha_baja: e.fecha_baja,
        drive_folder_path: e.drive_folder_path,
        kind: 'activo_with_fecha_baja',
        note: `Activo con fecha_baja ${e.fecha_baja} (no auto-baja)`,
      });
    }
    if (e.status === 'baja' && !e.fecha_baja) {
      out.push({
        id: e.id,
        full_name: e.full_name,
        status: e.status,
        fecha_baja: null,
        drive_folder_path: e.drive_folder_path,
        kind: 'baja_without_fecha',
        note: 'Baja sin fecha_baja',
      });
    }
  }
  return out;
}

export function formatSyncBanner(opts: {
  driveMounted: boolean;
  source: 'file_stream' | 'supabase' | 'defaults' | string;
  linkedCount?: number;
  lastSyncedAt?: string | null;
  openBlocked?: boolean;
  /** Texto tras el conteo, p.ej. "expediente(s) vinculados" o "docs en catálogo". */
  countLabel?: string;
  /** CTA de actualización (default: altas/bajas). */
  refreshHint?: string;
  /** Si true, no emitir banner cuando ya hay datos en Supabase (prod online). */
  hideWhenOnline?: boolean;
}): string | undefined {
  const when = opts.lastSyncedAt
    ? ` Última sync: ${opts.lastSyncedAt.slice(0, 16).replace('T', ' ')}.`
    : '';
  if (opts.driveMounted && opts.source === 'file_stream') {
    return undefined;
  }
  const hasData =
    opts.source === 'supabase' ||
    opts.source === 'defaults' ||
    Boolean(opts.linkedCount && opts.linkedCount > 0);
  if (hasData && opts.hideWhenOnline !== false) {
    // Operación online: sin aviso de File Stream / "Drive no montado".
    return undefined;
  }
  if (opts.source === 'supabase' || (opts.linkedCount && opts.linkedCount > 0)) {
    const n = opts.linkedCount ?? 0;
    const label = opts.countLabel || 'expediente(s) vinculados';
    const open = opts.openBlocked
      ? ' Usa «Abrir en Drive» para binarios.'
      : '';
    const refresh = opts.refreshHint || '';
    return `Datos en servidor${n ? `: ${n} ${label}` : ''}.${when}${open}${refresh}`;
  }
  if (!opts.driveMounted) {
    return `Sin índice local aún.${when} Los datos operativos viven en Supabase; configura IDs Drive (env) o sincroniza una vez desde el PC de admin.`;
  }
  return undefined;
}
