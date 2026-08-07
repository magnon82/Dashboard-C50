/**
 * Programación de sync por fuente (master panel /admin).
 * Horarios alineados a .github/workflows/*.yml (CDMX = UTC-6, sin DST).
 * Los cron de GitHub no se editan desde la UI; aquí solo se documentan + disparo manual.
 */

export type SyncScheduleMode = 'cloud' | 'manual' | 'mixed';

export type SyncWorkflowKey = 'gmail' | 'saldos' | 'hr';

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
    id: 'cxp-hist',
    label: 'CxP histórico',
    feeds: 'cxp, cxp_saldos',
    mode: 'manual',
    schedule: 'Manual (ingest_cxp.py)',
    areaId: 'cxp_hist',
    sourceFiles: ['cxp', 'cxp_saldos'],
    note: 'No hay workflow Actions; correr en PC admin.',
  },
  {
    id: 'presupuesto',
    label: 'Presupuesto',
    feeds: 'presupuesto_* (+ ajustes solo /admin)',
    mode: 'manual',
    schedule: 'Manual (ingest_presupuesto.py) · ajustes en /admin',
    areaId: 'presupuesto',
    sourceFiles: [
      'presupuesto_mensual',
      'presupuesto_saldos',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_sem_detalle',
      'presupuesto_ingreso',
      'presupuesto_ajuste',
    ],
    note:
      'Carga manual: no hay workflow Actions. Tras editar el Excel en Drive, correr ingest_presupuesto.py en PC admin. Ajustes en /admin no requieren re-ingest.',
  },
  {
    id: 'bancos',
    label: 'Bancos / estados de cuenta',
    feeds: 'estado_* + saldos_bancos_manual',
    mode: 'manual',
    schedule: 'Manual / al reindexar · saldos bancarios solo /admin',
    areaId: 'bancos',
    sourceFiles: [
      'estado_mifel',
      'estado_bbva',
      'estado_pdf_index',
      'estado_cuenta_pdf_index',
    ],
    note:
      'Comprobantes (estado_pdf_index) y estados Excel/PDF: sin workflow Actions. Tras subir PDFs a COMPROBANTES BANCARIOS, correr ingest_estados_cuenta.py --index-pdfs --pdf-only en PC admin. Saldos bancarios manuales solo en /admin.',
  },
  {
    id: 'eventos',
    label: 'Eventos (legacy) / ventas semana',
    feeds: 'eventos, ventas_semana',
    mode: 'manual',
    schedule: 'Manual (ingest_eventos.py / ingest_ventas_semana.py)',
    areaId: 'eventos',
    sourceFiles: ['eventos', 'ventas_semana'],
  },
  {
    id: 'auth',
    label: 'Auth / usuarios Suite',
    feeds: 'dashboard_auth',
    mode: 'manual',
    schedule: 'Solo /admin (manual)',
    areaId: 'auth',
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
