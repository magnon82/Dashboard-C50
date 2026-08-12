/**
 * Programación de sync por fuente (master panel /admin).
 * Horarios alineados a .github/workflows/*.yml (CDMX = UTC-6, sin DST).
 * Los cron de GitHub no se editan desde la UI; aquí solo se documentan + disparo manual.
 */

import {
  ALL_SOURCE_FILES,
  SOURCE_FILE_GROUPS,
  SOURCE_FILE_UPDATE,
} from '@/app/lib/admin-resources';
import type { DetectedSourceFile } from '@/app/lib/storage-format';
import type { HrLastUpdateProbe } from '@/app/lib/admin-last-updates';

export type SyncScheduleMode = 'cloud' | 'manual' | 'mixed';

export type SyncWorkflowKey = 'gmail' | 'saldos' | 'hr' | 'finanzas';

export type AdminSyncSchedule = {
  id: string;
  label: string;
  /** Qué alimenta (una línea). */
  feeds: string;
  mode: SyncScheduleMode;
  /** Horario programado legible (CDMX). */
  schedule: string;
  /** Cron(s) UTC tal como en el workflow (solo lectura). */
  cronUtc?: string;
  /** Área de admin-last-updates para «última sync». */
  areaId: string | null;
  /** source_file adicionales a mostrar en detalle (opcional). */
  sourceFiles?: string[];
  /** Workflow Actions si aplica. */
  workflow?: SyncWorkflowKey;
  /** Permite POST /api/admin/sync-dispatch. */
  canDispatch?: boolean;
  /** Enlace Actions (run history). */
  actionsUrl?: string;
  note?: string;
};

const REPO = 'magnon82/Dashboard-C50';

export const SYNC_WORKFLOW_FILES: Record<SyncWorkflowKey, string> = {
  gmail: 'sync-gmail.yml',
  saldos: 'sync-saldos.yml',
  hr: 'sync-hr-drive.yml',
  finanzas: 'sync-finanzas.yml',
};

export function actionsUrlFor(workflow: SyncWorkflowKey): string {
  return `https://github.com/${REPO}/actions/workflows/${SYNC_WORKFLOW_FILES[workflow]}`;
}

/** Catálogo operativo: cloud primero, luego manuales. */
export const ADMIN_SYNC_SCHEDULES: AdminSyncSchedule[] = [
  {
    id: 'sync-gmail',
    label: 'Gmail · Ventas + CFDI',
    feeds: 'infocaja, corte_caja, factura_cfdi → financial_records',
    mode: 'cloud',
    schedule:
      'Diario 2:17–7:17 AM cada hora + 8:23 / 10:23 / 12:23 / 14:23 · refuerzo Dom 7:17–11:17 PM (CDMX)',
    cronUtc: '17 8-13 * * * · 23 14,16,18,20 * * * · 17 1-5 * * 1',
    areaId: 'ventas',
    sourceFiles: ['infocaja', 'corte_caja', 'factura_cfdi'],
    workflow: 'gmail',
    canDispatch: true,
    actionsUrl: actionsUrlFor('gmail'),
    note: 'CFDI en paso best-effort del mismo workflow. GitHub cron es best-effort (puede saltar slots).',
  },
  {
    id: 'sync-saldos',
    label: 'Saldos al día · Flujo + CxP vivo',
    feeds: 'flujo_efectivo_* + cxp_por_pagar (Sheets)',
    mode: 'cloud',
    schedule: 'Cada hora · objetivo :07 CDMX (GitHub puede retrasar o saltar)',
    cronUtc: '7 * * * *',
    areaId: 'flujo',
    sourceFiles: [
      'flujo_efectivo_saldo',
      'flujo_efectivo_semana',
      'flujo_efectivo_mov',
      'cxp_por_pagar',
    ],
    workflow: 'saldos',
    canDispatch: true,
    actionsUrl: actionsUrlFor('saldos'),
    note:
      'Objetivo :07 CDMX; GitHub Actions es best-effort (a menudo +10–40 min o un hueco de 1–3 h). Última sync = max(created_at) flujo/cxp_por_pagar. Rescate: Run workflow o botón admin.',
  },
  {
    id: 'sync-hr',
    label: 'RR.HH. · Soft-sync Drive',
    feeds: 'hr_* + hr_drive_sync_state',
    mode: 'cloud',
    schedule: 'Diario 12:00 PM CDMX',
    cronUtc: '0 18 * * *',
    areaId: 'rrhh',
    workflow: 'hr',
    canDispatch: true,
    actionsUrl: actionsUrlFor('hr'),
    note: 'Soft-check en cloud. Import nómina/horarios sigue siendo botón en /rrhh o File Stream en PC.',
  },
  {
    id: 'sync-finanzas',
    label: 'Finanzas · Drive/Sheets (antes manual)',
    feeds:
      'cxp + cxp_saldos + presupuesto_* + estado_mifel/bbva (Excel) + ventas_semana + estado_pdf_index',
    mode: 'cloud',
    schedule: 'Diario 6:37 AM y 6:37 PM CDMX',
    cronUtc: '37 12 * * * · 37 0 * * *',
    areaId: 'presupuesto',
    sourceFiles: [
      'cxp',
      'cxp_saldos',
      'presupuesto_mensual',
      'presupuesto_saldos',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_sem_detalle',
      'presupuesto_ingreso',
      'estado_mifel',
      'estado_bbva',
      'ventas_semana',
      'estado_pdf_index',
    ],
    workflow: 'finanzas',
    canDispatch: true,
    actionsUrl: actionsUrlFor('finanzas'),
    note:
      'Descarga Excel de presupuesto, estados y Acumulado ventas x semana; lista PDFs de COMPROBANTES BANCARIOS (índice, sin descargar). CxP histórico desde Sheets. Ajustes /admin siguen manuales. Índice PDF de estados de cuenta (Bancos\\…): reindex Suite/PC.',
  },
  {
    id: 'bancos-pdf',
    label: 'Bancos · índice PDF estados',
    feeds: 'estado_cuenta_pdf_index',
    mode: 'manual',
    schedule: 'Manual / botón reindex en Suite',
    areaId: 'bancos',
    sourceFiles: ['estado_cuenta_pdf_index'],
    note:
      'PDFs de estados de cuenta (Administración\\Bancos). Comprobantes de pagos (estado_pdf_index) ya van en sync-finanzas.',
  },
  {
    id: 'eventos',
    label: 'Eventos (legacy)',
    feeds: 'eventos',
    mode: 'manual',
    schedule: 'Manual (ingest_eventos.py)',
    areaId: 'eventos',
    sourceFiles: ['eventos'],
    note: 'Legacy; Eventos vivos usan módulo /eventos (Supabase). ventas_semana va en sync-finanzas.',
  },
  {
    id: 'auth',
    label: 'Auth / usuarios Suite',
    feeds: 'dashboard_auth',
    mode: 'manual',
    schedule: 'Solo /admin (manual)',
    areaId: 'auth',
  },
  {
    id: 'suite-manual',
    label: 'Overrides Suite (no Drive)',
    feeds: 'presupuesto_ajuste, saldos_bancos_manual',
    mode: 'manual',
    schedule: 'Solo captura en /admin',
    areaId: null,
    sourceFiles: ['presupuesto_ajuste', 'saldos_bancos_manual'],
    note: 'No hay archivo origen externo: se editan en la Suite.',
  },
];

export function modeLabelEs(mode: SyncScheduleMode): string {
  switch (mode) {
    case 'cloud':
      return 'Cloud (Actions)';
    case 'manual':
      return 'Manual';
    case 'mixed':
      return 'Mixto';
  }
}

/** Fila del reporte Master: una por source_file (+ RH). */
export type SourceSyncReportRow = {
  sourceFile: string;
  groupLabel: string;
  scheduleLabel: string;
  mode: SyncScheduleMode;
  schedule: string;
  updateHint: string;
  rowCount: number;
  lastDate: string | null;
  lastIngestedAt: string | null;
  /** cloud | manual — etiqueta corta para UI */
  originKind: 'cloud' | 'manual' | 'suite';
};

function groupLabelFor(sourceFile: string): string {
  for (const g of SOURCE_FILE_GROUPS) {
    if (g.sources.includes(sourceFile)) return g.label;
  }
  return 'Otros';
}

function scheduleForSource(sourceFile: string): AdminSyncSchedule | null {
  for (const s of ADMIN_SYNC_SCHEDULES) {
    if (s.sourceFiles?.includes(sourceFile)) return s;
    // gmail area also covers infocaja/corte via areaId ventas; facturas separate
    if (
      s.id === 'sync-gmail' &&
      (sourceFile === 'infocaja' ||
        sourceFile === 'corte_caja' ||
        sourceFile === 'factura_cfdi')
    ) {
      return s;
    }
  }
  return null;
}

/**
 * Reporte plano: última ingestión de cada fuente de origen documentada +
 * cualquier source_file detectado extra + fila RR.HH.
 */
export function buildSourceSyncReport(
  detected: DetectedSourceFile[],
  hr: HrLastUpdateProbe,
): SourceSyncReportRow[] {
  const bySource = new Map(detected.map((d) => [d.sourceFile, d] as const));
  const catalog = new Set(ALL_SOURCE_FILES);
  const extras = detected
    .map((d) => d.sourceFile)
    .filter((sf) => sf && sf !== 'dashboard_auth' && !catalog.has(sf));
  const ordered = [...ALL_SOURCE_FILES, ...extras.sort((a, b) => a.localeCompare(b))];

  const rows: SourceSyncReportRow[] = ordered.map((sourceFile) => {
    const hit = bySource.get(sourceFile);
    const sched = scheduleForSource(sourceFile);
    const mode = sched?.mode ?? 'manual';
    return {
      sourceFile,
      groupLabel: groupLabelFor(sourceFile),
      scheduleLabel: sched?.label ?? 'Sin catálogo de sync',
      mode,
      schedule: sched?.schedule ?? 'Manual / al reindexar',
      updateHint: SOURCE_FILE_UPDATE[sourceFile] ?? '—',
      rowCount: hit?.rowCount ?? 0,
      lastDate: hit?.lastDate ?? null,
      lastIngestedAt: hit?.lastIngestedAt ?? null,
      originKind: mode === 'cloud' ? 'cloud' : 'manual',
    };
  });

  rows.push({
    sourceFile: 'hr_* (soft-sync Drive)',
    groupLabel: 'RR.HH.',
    scheduleLabel: 'RR.HH. · Soft-sync Drive',
    mode: 'cloud',
    schedule: 'Diario 12:00 PM CDMX',
    updateHint:
      'Soft-sync Drive → hr_* · Diario 12:00 PM CDMX (Actions). Import nómina/horarios: /rrhh.',
    rowCount: 0,
    lastDate: null,
    lastIngestedAt: hr.lastAt,
    originKind: 'suite',
  });

  // Más recientes primero; sin sync al final
  rows.sort((a, b) => {
    const ta = a.lastIngestedAt || '';
    const tb = b.lastIngestedAt || '';
    if (ta && tb) return tb.localeCompare(ta);
    if (ta) return -1;
    if (tb) return 1;
    return a.sourceFile.localeCompare(b.sourceFile);
  });

  return rows;
}

/* ─── Vista Master por módulo (estilo FUENTE / CANAL / ESTADO) ─── */

export type SyncModuleId = 'finanzas' | 'ventas' | 'rrhh' | 'master';

export type SyncStatusKind = 'ok' | 'stale' | 'never' | 'manual';

export type ModuleSyncSourceDef = {
  id: string;
  /** Código corto UI (F1, V1, H1…). */
  sourceCode: string;
  moduleId: SyncModuleId;
  moduleLabel: string;
  label: string;
  channel: string;
  detail: string;
  /** source_file a agregar para lastAt / regs (vacío si solo RH). */
  sourceFiles: string[];
  /** Área admin-last-updates alternativa (p.ej. rrhh). */
  areaId?: string | null;
  includeHr?: boolean;
  /** Sin datos → Manual/fijo (no “Sin sync”). */
  fixedManual?: boolean;
  /** Siempre badge Manual/fijo (p.ej. overrides / auth). */
  forceManualStatus?: boolean;
  workflow?: SyncWorkflowKey;
  actionHref?: string;
  actionLabel?: string;
};

export type ModuleSyncRow = {
  id: string;
  sourceCode: string;
  moduleId: SyncModuleId;
  moduleLabel: string;
  label: string;
  channel: string;
  lastAt: string | null;
  status: SyncStatusKind;
  records: number | null;
  detail: string;
  workflow?: SyncWorkflowKey;
  canDispatch?: boolean;
  actionHref?: string;
  actionLabel?: string;
};

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function maxIso(...vals: Array<string | null | undefined>): string | null {
  const ok = vals.filter((v): v is string => Boolean(v));
  if (!ok.length) return null;
  return ok.reduce((a, b) => (a >= b ? a : b));
}

function statusFromAt(
  at: string | null,
  neverAs: SyncStatusKind = 'never',
): SyncStatusKind {
  if (!at) return neverAs;
  const age = Date.now() - Date.parse(at);
  if (Number.isNaN(age) || age > STALE_MS) return 'stale';
  return 'ok';
}

/**
 * Catálogo operativo por módulo (C50). Códigos propios; columnas UX = BDMX Master.
 * No inventa filas BDMX S1–S8: mapea fuentes reales de financial_records / RH.
 */
export const MODULE_SYNC_SOURCES: ModuleSyncSourceDef[] = [
  {
    id: 'f1-cxp',
    sourceCode: 'F1',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Cuentas por pagar',
    channel: 'Sheets · CxP vivo + Excel histórico',
    detail: 'cxp_por_pagar (hora) · cxp / cxp_saldos (sync-finanzas)',
    sourceFiles: ['cxp_por_pagar', 'cxp', 'cxp_saldos'],
    workflow: 'saldos',
    actionHref: '/finanzas/gastos',
    actionLabel: 'Ver CxP',
  },
  {
    id: 'f2-comprobantes',
    sourceCode: 'F2',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Drive comprobantes (PDF pagos)',
    channel: 'Drive API · sync-finanzas 6:37 AM/PM',
    detail: 'estado_pdf_index (índice por nombre; sin descargar PDF)',
    sourceFiles: ['estado_pdf_index'],
    workflow: 'finanzas',
    actionHref: '/finanzas/comprobantes',
    actionLabel: 'Ver comprobantes',
  },
  {
    id: 'f3-estados',
    sourceCode: 'F3',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Estados de cuenta',
    channel: 'Excel Mifel/BBVA · índice PDF',
    detail: 'estado_mifel / estado_bbva (cloud) · estado_cuenta_pdf_index (reindex)',
    sourceFiles: ['estado_mifel', 'estado_bbva', 'estado_cuenta_pdf_index'],
    workflow: 'finanzas',
    actionHref: '/finanzas/estados-cuenta',
    actionLabel: 'Ver',
  },
  {
    id: 'f4-presupuesto',
    sourceCode: 'F4',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Presupuesto',
    channel: 'Drive Excel · sync-finanzas',
    detail: 'presupuesto_* (mensual, rubros, semanas, ingresos)',
    sourceFiles: [
      'presupuesto_mensual',
      'presupuesto_saldos',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_sem_detalle',
      'presupuesto_ingreso',
    ],
    workflow: 'finanzas',
    actionHref: '/finanzas',
    actionLabel: 'Presupuesto',
  },
  {
    id: 'f5-flujo',
    sourceCode: 'F5',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Saldos al día / flujo',
    channel: 'Actions · cada hora :07 CDMX (best-effort)',
    detail: 'flujo_efectivo_saldo / semana / mov',
    sourceFiles: [
      'flujo_efectivo_saldo',
      'flujo_efectivo_semana',
      'flujo_efectivo_mov',
    ],
    workflow: 'saldos',
    actionHref: '/finanzas',
    actionLabel: 'Saldos',
  },
  {
    id: 'f6-cfdi',
    sourceCode: 'F6',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Correo Finanzas (Gmail CFDI)',
    channel: 'Gmail · sync-gmail (best-effort)',
    detail: 'factura_cfdi → financial_records',
    sourceFiles: ['factura_cfdi'],
    workflow: 'gmail',
    actionHref: '/finanzas/facturas',
    actionLabel: 'Sincronizar',
  },
  {
    id: 'f7-overrides',
    sourceCode: 'F7',
    moduleId: 'finanzas',
    moduleLabel: 'Finanzas',
    label: 'Overrides Suite',
    channel: 'Solo /admin · captura manual',
    detail: 'presupuesto_ajuste · saldos_bancos_manual',
    sourceFiles: ['presupuesto_ajuste', 'saldos_bancos_manual'],
    fixedManual: true,
    forceManualStatus: true,
    actionHref: '/admin',
    actionLabel: 'Admin',
  },
  {
    id: 'v1-gmail-ventas',
    sourceCode: 'V1',
    moduleId: 'ventas',
    moduleLabel: 'Ventas',
    label: 'Infocaja + CORTE',
    channel: 'Gmail · sync-gmail (diario + Dom noche)',
    detail: 'infocaja · corte_caja',
    sourceFiles: ['infocaja', 'corte_caja'],
    workflow: 'gmail',
    actionHref: '/ventas',
    actionLabel: 'Sincronizar',
  },
  {
    id: 'v2-eventos',
    sourceCode: 'V2',
    moduleId: 'ventas',
    moduleLabel: 'Ventas',
    label: 'Ventas semana + Eventos legacy',
    channel: 'Drive Excel · sync-finanzas / manual eventos',
    detail:
      'ventas_semana (cloud 2×/día) · eventos (ingest puntual; módulo /eventos aparte)',
    sourceFiles: ['ventas_semana', 'eventos'],
    workflow: 'finanzas',
    actionHref: '/ventas',
    actionLabel: 'Ventas',
  },
  {
    id: 'h1-rrhh',
    sourceCode: 'H1',
    moduleId: 'rrhh',
    moduleLabel: 'RR.HH.',
    label: 'Soft-sync Drive',
    channel: 'Actions · diario 12:00 PM CDMX',
    detail: 'hr_* · hr_drive_sync_state',
    sourceFiles: [],
    areaId: 'rrhh',
    includeHr: true,
    workflow: 'hr',
    actionHref: '/rrhh',
    actionLabel: 'RR.HH.',
  },
  {
    id: 'a1-auth',
    sourceCode: 'A1',
    moduleId: 'master',
    moduleLabel: 'Master',
    label: 'Usuarios Suite',
    channel: 'Solo /admin · manual',
    detail: 'dashboard_auth',
    sourceFiles: ['dashboard_auth'],
    fixedManual: true,
    forceManualStatus: true,
    actionHref: '/admin',
    actionLabel: 'Usuarios',
  },
];

/**
 * Filas Master por módulo: agrega lastAt/regs desde detected + sonda RH.
 */
export function buildModuleSyncRows(
  detected: DetectedSourceFile[],
  hr: HrLastUpdateProbe,
  opts?: { canDispatch?: boolean },
): ModuleSyncRow[] {
  const bySource = new Map(detected.map((d) => [d.sourceFile, d] as const));
  const canDispatch = Boolean(opts?.canDispatch);

  return MODULE_SYNC_SOURCES.map((def) => {
    let lastAt: string | null = null;
    let records = 0;
    const parts: string[] = [];

    for (const sf of def.sourceFiles) {
      const hit = bySource.get(sf);
      if (!hit) continue;
      lastAt = maxIso(lastAt, hit.lastIngestedAt);
      records += hit.rowCount;
      if (hit.lastIngestedAt) {
        parts.push(`${sf}`);
      }
    }

    if (def.includeHr && hr.lastAt) {
      lastAt = maxIso(lastAt, hr.lastAt);
    }

    const neverAs: SyncStatusKind = def.fixedManual ? 'manual' : 'never';
    const status: SyncStatusKind = def.forceManualStatus
      ? 'manual'
      : statusFromAt(lastAt, neverAs);

    const detail =
      parts.length > 0
        ? `${def.detail} · ${records.toLocaleString('es-MX')} regs`
        : def.detail;

    return {
      id: def.id,
      sourceCode: def.sourceCode,
      moduleId: def.moduleId,
      moduleLabel: def.moduleLabel,
      label: def.label,
      channel: def.channel,
      lastAt,
      status,
      records: def.sourceFiles.length === 0 && !def.includeHr
        ? null
        : def.includeHr && def.sourceFiles.length === 0
          ? null
          : records > 0
            ? records
            : null,
      detail,
      workflow: def.workflow,
      canDispatch: Boolean(def.workflow && canDispatch),
      actionHref: def.actionHref,
      actionLabel: def.actionLabel,
    };
  });
}
