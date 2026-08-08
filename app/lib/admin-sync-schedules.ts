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
      'Lun–sáb 2:17–7:17 AM cada hora + 8:23 / 10:23 / 12:23 / 14:23 · Dom 7:17–11:17 PM (CDMX)',
    cronUtc: '17 8-13 * * 1-6 · 23 14,16,18,20 * * 1-6 · 17 1-5 * * 1',
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
    schedule: 'Cada hora a :07 CDMX',
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
    note: 'Última sync de área usa el más reciente entre flujo y cxp_por_pagar.',
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
    feeds: 'cxp + cxp_saldos + presupuesto_* + estado_mifel/bbva (Excel)',
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
    ],
    workflow: 'finanzas',
    canDispatch: true,
    actionsUrl: actionsUrlFor('finanzas'),
    note:
      'Descarga Excel de presupuesto y estados desde Drive; CxP histórico desde Sheets. Ajustes /admin (presupuesto_ajuste, saldos_bancos_manual) siguen manuales. Índices PDF: reindex en Suite o PC.',
  },
  {
    id: 'bancos-pdf',
    label: 'Bancos · índices PDF',
    feeds: 'estado_pdf_index, estado_cuenta_pdf_index',
    mode: 'manual',
    schedule: 'Manual / botón reindex en Suite',
    areaId: 'bancos',
    sourceFiles: ['estado_pdf_index', 'estado_cuenta_pdf_index'],
    note:
      'Índice de PDFs de comprobantes/estados. En nube: reindex desde Finanzas/Comprobantes. Excel Mifel/BBVA ya va en sync-finanzas.',
  },
  {
    id: 'eventos',
    label: 'Eventos (legacy) / ventas semana',
    feeds: 'eventos, ventas_semana',
    mode: 'manual',
    schedule: 'Manual (ingest_eventos.py / ingest_ventas_semana.py)',
    areaId: 'eventos',
    sourceFiles: ['eventos', 'ventas_semana'],
    note: 'Legacy; Eventos vivos usan módulo /eventos (Supabase), no este ingest.',
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
