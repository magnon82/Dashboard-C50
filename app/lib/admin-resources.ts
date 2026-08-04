/**
 * Metadatos curados del inventario / mapa de orígenes.
 * — AdminDataMap: arquitectura curada a mano (actualizar al cambiar el pipeline).
 * — Inventario de datos: fusiona esto con detección en vivo (Supabase + Drive)
 *   vía /api/admin/data-inventory. source_file nuevos aparecen aunque no estén aquí.
 */

export type SourceFileGroup = {
  id: string;
  label: string;
  sources: string[];
};

/** Grupos de financial_records.source_file (checklist del mapa). */
export const SOURCE_FILE_GROUPS: SourceFileGroup[] = [
  {
    id: 'ventas',
    label: 'Ventas',
    sources: ['infocaja', 'corte_caja', 'eventos', 'ventas_semana'],
  },
  {
    id: 'flujo',
    label: 'Flujo de efectivo',
    sources: ['flujo_efectivo_saldo', 'flujo_efectivo_semana', 'flujo_efectivo_mov'],
  },
  {
    id: 'presupuesto',
    label: 'Presupuesto',
    sources: [
      'presupuesto_mensual',
      'presupuesto_saldos',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_sem_detalle',
      'presupuesto_ingreso',
      'presupuesto_ajuste',
    ],
  },
  {
    id: 'bancos',
    label: 'Bancos / estados',
    sources: [
      'estado_mifel',
      'estado_bbva',
      'estado_pdf_index',
      'estado_cuenta_pdf_index',
      'saldos_bancos_manual',
    ],
  },
  {
    id: 'cxp',
    label: 'Cuentas por pagar',
    sources: ['cxp_por_pagar', 'cxp', 'cxp_saldos'],
  },
  {
    id: 'facturas',
    label: 'Facturas CFDI',
    sources: ['factura_cfdi'],
  },
  {
    id: 'auth',
    label: 'Auth / usuarios',
    sources: ['dashboard_auth'],
  },
];

/** Lista plana (orden del checklist) para el nodo financial_records del mapa. */
export const ALL_SOURCE_FILES: string[] = SOURCE_FILE_GROUPS.flatMap((g) => g.sources);

/**
 * Frecuencia de actualización por source_file (texto UI en español).
 * Basado en sync-gmail.yml (lun–sáb 4:00 AM CDMX / domingo 8:00 PM; CFDI best-effort),
 * sync-saldos.yml (cada hora :07), sync-hr-drive.yml (diario 12:00 PM CDMX),
 * más ingestors manuales / Admin.
 */
export const SOURCE_FILE_UPDATE: Record<string, string> = {
  infocaja:
    'Función: venta diaria + efectivo/tarjetas/personas. Lun–sáb 4:00 AM · Dom 8:00 PM CDMX (Actions)',
  corte_caja:
    'Función: cancelaciones/descuentos/cortesías. Lun–sáb 4:00 AM · Dom 8:00 PM CDMX (Actions)',
  eventos: 'Función: WI vs Eventos histórico. Manual (ingest_eventos.py)',
  ventas_semana: 'Función: acumulado semanal Excel. Manual (ingest_ventas_semana.py)',
  flujo_efectivo_saldo: 'Función: saldo de caja chica. Cada hora (Actions)',
  flujo_efectivo_semana: 'Función: presupuesto efectivo por semana. Cada hora (Actions)',
  flujo_efectivo_mov: 'Función: movimientos de flujo. Cada hora (Actions)',
  presupuesto_mensual: 'Función: marco mensual. Manual (ingest_presupuesto.py)',
  presupuesto_saldos: 'Función: saldos presupuesto. Manual (ingest_presupuesto.py)',
  presupuesto_rubro: 'Función: gastos por rubro. Manual (ingest_presupuesto.py)',
  presupuesto_semana: 'Función: control semanal. Manual (ingest_presupuesto.py)',
  presupuesto_sem_detalle: 'Función: detalle SEM. Manual (ingest_presupuesto.py)',
  presupuesto_ingreso: 'Función: ingresos Mifel/BBVA tipados. Manual (ingest_presupuesto.py)',
  presupuesto_ajuste: 'Función: ajustes admin. Solo /admin (manual)',
  estado_mifel: 'Función: estado de cuenta Mifel. Manual / al reindexar',
  estado_bbva: 'Función: estado de cuenta BBVA. Manual / al reindexar',
  estado_pdf_index: 'Función: índice PDFs pagos. Manual / al reindexar',
  estado_cuenta_pdf_index: 'Función: índice PDFs estados. Manual / al reindexar',
  saldos_bancos_manual: 'Función: saldos bancarios capturados. Solo /admin (manual)',
  cxp_por_pagar: 'Función: saldo a la fecha proveedores. Cada hora (Actions · Sheets)',
  cxp: 'Función: líneas pagadas/retornos. Manual (ingest_cxp.py)',
  cxp_saldos: 'Función: encabezados CxP. Manual (ingest_cxp.py)',
  factura_cfdi: 'Función: índice CFDI → ERP (financial_records). Lun–sáb 4:00 AM · Dom 8:00 PM CDMX (Actions · best-effort)',
  dashboard_auth: 'Función: usuarios Suite + capabilities. Solo /admin (manual)',
};

/** Tipo de chip / ítem copiable en el inventario. */
export type ResourceItemKind =
  | 'source_file'
  | 'path'
  | 'script'
  | 'route'
  | 'workflow'
  | 'file';

export type ResourceLeaf = {
  label: string;
  note?: string;
  /** Visual + copy semantics; default 'file'. */
  kind?: ResourceItemKind;
  /** Valor a copiar; por defecto = label. */
  copyValue?: string;
  /** Frecuencia de actualización (texto corto UI). */
  updateFrequency?: string;
};

export type ResourceBranch = {
  id: string;
  label: string;
  /** Rol en una línea (tarjeta / accordion). */
  role: string;
  note?: string;
  /** Resumen de frecuencia para el grupo (p.ej. "Cada hora"). */
  updateFrequency?: string;
  leaves?: ResourceLeaf[];
  /** Scripts relacionados (chips). */
  scripts?: string[];
  /** Rutas UI relacionadas (chips). */
  routes?: string[];
  /** source_file relacionados (chips adicionales al detalle). */
  sourceFiles?: string[];
};

export type ResourcePlatformId = 'supabase' | 'drive' | 'gmail' | 'repo' | 'vercel';

export type ResourcePlatform = {
  id: ResourcePlatformId;
  title: string;
  subtitle: string;
  /** Rol corto de la plataforma. */
  role: string;
  branches: ResourceBranch[];
};

const SOURCE_GROUP_META: Record<
  string,
  { role: string; updateFrequency: string; scripts?: string[]; routes?: string[] }
> = {
  ventas: {
    role: 'Función: alimentar /ventas (diario Infocaja/CORTE) y series WI/Eventos.',
    updateFrequency:
      'Cloud: lun–sáb 4:00 AM · dom 8:00 PM CDMX · CFDI ERP; eventos/ventas_semana manual (TODO automate)',
    scripts: [
      'ingest_infocaja_gmail.py',
      'ingest_corte_gmail.py',
      'ingest_eventos.py',
      'ingest_ventas_semana.py',
    ],
    routes: ['/ventas', '/finanzas'],
  },
  flujo: {
    role: 'Función: Saldos al día (caja chica / movimientos de efectivo).',
    updateFrequency: 'Cada hora (Actions · sync-saldos.yml)',
    scripts: ['ingest_saldos_flujo.py', 'sync_saldos_al_dia.py'],
    routes: ['/finanzas', '/finanzas/ingresos'],
  },
  // TODO(automate): presupuesto / ventas_semana / estados de cuenta — manual hasta Actions dedicados.
  presupuesto: {
    role: 'Función: control presupuestal e ingresos tipados Mifel/BBVA.',
    updateFrequency: 'Manual (ingest_presupuesto.py) · TODO automate · ajustes solo admin',
    scripts: ['ingest_presupuesto.py'],
    routes: ['/finanzas', '/finanzas/gastos', '/admin'],
  },
  bancos: {
    role: 'Función: conciliación bancaria e índices de comprobantes.',
    updateFrequency: 'Manual / al reindexar · TODO automate · saldos_bancos_manual solo admin',
    scripts: ['ingest_estados_cuenta.py'],
    routes: ['/finanzas/estados-cuenta', '/finanzas/comprobantes', '/admin'],
  },
  cxp: {
    role: 'Función: cuentas por pagar (saldo vivo + historial de pagos).',
    updateFrequency: 'Mixto · cxp_por_pagar cada hora; cxp/cxp_saldos manual',
    scripts: ['ingest_cxp_por_pagar.py', 'ingest_cxp.py', 'sync_saldos_al_dia.py'],
    routes: ['/finanzas/gastos'],
  },
  facturas: {
    role: 'Función: expediente fiscal CFDI recibido por correo.',
    updateFrequency: 'Cloud: mismo sync-gmail (CFDI → financial_records · best-effort)',
    scripts: ['ingest_facturas_gmail.py'],
    routes: ['/finanzas/facturas'],
  },
  auth: {
    role: 'Función: acceso Suite, módulos y capabilities (p.ej. staff.corte).',
    updateFrequency: 'Solo admin (manual)',
    routes: ['/admin'],
  },
};

/**
 * Inventario documentado (metadatos): dónde vive cada recurso.
 * La UI fusiona esto con detección en vivo; no es el grafo del mapa.
 */
/** Tablas RR.HH. (no van en financial_records.source_file). */
export const HR_TABLES: string[] = [
  'hr_employees',
  'hr_payroll_periods',
  'hr_payroll_lines',
  'hr_schedule_weeks',
  'hr_schedule_shifts',
  'hr_availability',
  'hr_leave_balances',
  'hr_leave_accrual_state',
  'hr_leave_renewal_alerts',
  'hr_leave_requests',
  'hr_doc_links',
  'hr_resguardo_requests',
  'hr_drive_sync_state',
];

export const ADMIN_STORAGE_PLATFORMS: ResourcePlatform[] = [
  {
    id: 'supabase',
    title: 'Supabase',
    subtitle: 'financial_records (source_file) · tablas hr_* (RR.HH.)',
    role: 'Almacén central: filas financieras por origen + módulo RR.HH. en tablas propias.',
    branches: [
      ...SOURCE_FILE_GROUPS.map((g) => {
        const meta = SOURCE_GROUP_META[g.id] ?? { role: g.label, updateFrequency: '—' };
        return {
          id: `supabase-${g.id}`,
          label: g.label,
          role: meta.role,
          updateFrequency: meta.updateFrequency,
          leaves: g.sources.map((s) => ({
            label: s,
            kind: 'source_file' as const,
            updateFrequency: SOURCE_FILE_UPDATE[s],
          })),
          scripts: meta.scripts,
          routes: meta.routes,
        };
      }),
      {
        id: 'supabase-hr',
        label: 'Recursos Humanos (hr_*)',
        role: 'Plantilla, nómina, horarios, vacaciones, biblioteca y resguardos. No usa source_file.',
        note: 'Migración: supabase/hr_module.sql (+ hr_leave_accrual.sql / hr_resguardo.sql / hr_leave_request_form.sql si aplica)',
        updateFrequency: 'Suite + soft-sync Actions diario 12:00 PM CDMX',
        leaves: HR_TABLES.map((t) => ({
          label: t,
          kind: 'file' as const,
          note:
            t === 'hr_employees'
              ? 'Función: plantilla, suite_username, expedientes, alta/baja'
              : t === 'hr_payroll_periods' || t === 'hr_payroll_lines'
                ? 'Función: nómina (borrador al publicar horario → cerrado → pagado)'
                : t === 'hr_schedule_weeks' || t === 'hr_schedule_shifts'
                  ? 'Función: turnos (nueva semana copia previa; → publicado)'
                  : t === 'hr_leave_balances' || t === 'hr_leave_requests'
                    ? 'Función: saldos y solicitudes de vacaciones'
                    : t === 'hr_doc_links'
                      ? 'Función: catálogo biblioteca RH'
                      : t === 'hr_resguardo_requests'
                        ? 'Función: resguardos de equipo'
                        : t === 'hr_drive_sync_state'
                          ? 'Función: estado última sync Drive→DB'
                          : t === 'hr_availability'
                            ? 'Función: disponibilidad para propuestas'
                            : undefined,
          copyValue: t,
          updateFrequency: 'Solo Suite (/rrhh · /api/hr/*)',
        })),
        routes: [
          '/rrhh',
          '/staff/horario',
          '/api/hr/employees',
          '/api/hr/payroll',
          '/api/hr/schedules',
          '/api/hr/leave-requests',
          '/api/hr/leave-balances',
          '/api/hr/leave-balances/mine',
          '/api/hr/docs',
          '/api/hr/resguardo',
          '/api/hr/expedientes',
          '/api/hr/sync',
        ],
      },
    ],
  },
  {
    id: 'drive',
    title: 'Drive / I:',
    subtitle: 'Archivos locales (Google Drive File Stream), carpetas espejo y Descargas RH',
    role: 'Origen de Excel, PDFs y carpetas que alimentan los ingestors y el módulo RR.HH.',
    branches: [
      {
        id: 'drive-presupuestos',
        label: 'Presupuestos (por año)',
        role: 'Excel mensual → presupuesto_* en Supabase.',
        note: 'I:\\…\\PRESUPUESTOS…',
        updateFrequency: 'Archivos en Drive · carga a Supabase manual (ingest_presupuesto.py)',
        leaves: [
          {
            label: 'PRESUPUESTOS 2026 (y carpetas por año)',
            kind: 'path',
            note: 'Carpeta anual',
            copyValue: 'PRESUPUESTOS 2026',
          },
        ],
        scripts: ['ingest_presupuesto.py'],
        sourceFiles: [
          'presupuesto_mensual',
          'presupuesto_saldos',
          'presupuesto_rubro',
          'presupuesto_semana',
          'presupuesto_sem_detalle',
          'presupuesto_ingreso',
        ],
        routes: ['/finanzas', '/finanzas/gastos'],
      },
      {
        id: 'drive-admin',
        label: 'Administración',
        role: 'Flujo de efectivo, bancos y ventas semanales.',
        note: 'I:\\Mi unidad\\Administración',
        updateFrequency:
          'Mixto · flujo cada hora (Actions); Bancos PDF / ventas_semana manual (TODO automate)',
        leaves: [
          {
            label: 'FLUJO EFECTIVO CARRANZA 50.xlsx',
            kind: 'file',
            note: 'Función: Saldos al día (caja chica) · flujo_efectivo_saldo / semana / mov',
            updateFrequency: 'Cada hora (Actions · sync-saldos.yml)',
          },
          {
            label: 'Bancos\\…\\Estados de cuenta',
            kind: 'path',
            note: 'PDFs → estado_cuenta_pdf_index',
            updateFrequency: 'Manual / al reindexar',
          },
          {
            label: 'Controles\\Acumulado ventas x semana.xlsx',
            kind: 'file',
            note: 'ventas_semana',
            updateFrequency: 'Manual (ingest_ventas_semana.py)',
          },
        ],
        scripts: ['ingest_saldos_flujo.py', 'ingest_ventas_semana.py'],
        sourceFiles: [
          'flujo_efectivo_saldo',
          'flujo_efectivo_semana',
          'flujo_efectivo_mov',
          'estado_cuenta_pdf_index',
          'ventas_semana',
        ],
        routes: ['/finanzas', '/ventas', '/finanzas/estados-cuenta'],
      },
      {
        id: 'drive-comprobantes',
        label: 'Comprobantes bancarios',
        role: 'Estados Excel MIFEL/BBVA y PDFs de pagos.',
        note: 'I:\\Mi unidad\\COMPROBANTES BANCARIOS',
        updateFrequency: 'Manual / al reindexar (ingest_estados_cuenta.py)',
        leaves: [
          {
            label: '{año}\\Estado de cuenta MIFEL/BBVA.xlsx',
            kind: 'file',
            note: 'estado_mifel / estado_bbva',
            updateFrequency: 'Manual / al reindexar',
          },
          {
            label: 'PDFs de pagos',
            kind: 'path',
            note: 'estado_pdf_index',
            updateFrequency: 'Manual / al reindexar',
          },
        ],
        scripts: ['ingest_estados_cuenta.py'],
        sourceFiles: ['estado_mifel', 'estado_bbva', 'estado_pdf_index'],
        routes: ['/finanzas/estados-cuenta', '/finanzas/comprobantes'],
      },
      {
        id: 'drive-facturas',
        label: 'Facturas CFDI',
        role: 'Adjuntos XML/PDF guardados por ingest local.',
        note: 'I:\\Mi unidad\\FACTURAS CFDI',
        updateFrequency: 'Cloud: mismo sync-gmail (CFDI → financial_records · best-effort)',
        scripts: ['ingest_facturas_gmail.py'],
        sourceFiles: ['factura_cfdi'],
        routes: ['/finanzas/facturas'],
      },
      {
        id: 'drive-eventos',
        label: 'Eventos',
        role: 'Ventas e ingresos de eventos especiales.',
        note: 'I:\\Mi unidad\\Eventos',
        updateFrequency: 'Manual (ingest_eventos.py)',
        scripts: ['ingest_eventos.py'],
        sourceFiles: ['eventos'],
        routes: ['/ventas', '/finanzas'],
      },
      {
        id: 'drive-rh',
        label: 'Recursos Humanos (RH)',
        role: 'Módulo /rrhh: datos operativos en Supabase; File Stream/Drive API solo para refrescar o abrir binarios. GET/POST /api/hr/sync.',
        note: 'I:\\Mi unidad\\RH',
        updateFrequency:
          'Diario 12:00 PM CDMX (Actions · sync-hr-drive.yml soft-sync). Vercel no necesita File Stream.',
        leaves: [
          {
            label: 'Nóminas',
            kind: 'path',
            note: 'Persistido: hr_payroll_* · plantilla = nómina ∪ horarios',
            copyValue: 'I:\\Mi unidad\\RH\\Nóminas',
            updateFrequency: 'Diario 12:00 PM CDMX (Actions) · Import /rrhh → Nómina',
          },
          {
            label: 'Nóminas · Drive folder ID',
            kind: 'path',
            note: 'Drive API (sin File Stream) · HR_NOMINA_DRIVE_FOLDER_ID',
            copyValue: '1qIZq7O2lcvs5zxG6p5jjzh4wRMXoFK3J',
          },
          {
            label: 'Horarios',
            kind: 'path',
            note: 'Persistido: hr_schedule_* · import Descargas',
            copyValue: 'I:\\Mi unidad\\RH\\Horarios',
            updateFrequency: 'Diario 12:00 PM CDMX (Actions) · Import /rrhh → Horarios',
          },
          {
            label: 'Expedientes personal C50',
            kind: 'path',
            note: 'Índice en hr_employees.drive_folder_path · fallback sin File Stream',
            copyValue: 'I:\\Mi unidad\\RH\\Expedientes personal C50',
            updateFrequency: 'Diario 12:00 PM CDMX (Actions) · alta/baja Suite',
          },
          {
            label: 'Documentación vigente',
            kind: 'path',
            note: 'Metadatos hr_doc_links · Abrir local = File Stream',
            copyValue: 'I:\\Mi unidad\\RH\\Documentación vigente 2023',
            updateFrequency: 'Diario 12:00 PM CDMX (Actions soft-sync)',
          },
          {
            label: 'Cultura Organizacional',
            kind: 'path',
            note: 'Textos en app/lib/hr-cultura.ts (+ hr_doc_links)',
            copyValue: 'I:\\Mi unidad\\RH\\Cultura Organizacional',
            updateFrequency: 'Muy raro / deploy · soft-sync no pisa textos',
          },
          {
            label: 'Perfiles por posición',
            kind: 'path',
            note: 'Biblioteca · categoría perfiles',
            copyValue: 'I:\\Mi unidad\\RH\\Perfiles por posición',
          },
          {
            label: 'Exámenes piso',
            kind: 'path',
            note: 'Biblioteca · categoría examenes',
            copyValue: 'I:\\Mi unidad\\RH\\Exámenes piso',
          },
          {
            label: 'BASE DATOS PERSONAL C50.xlsx',
            kind: 'file',
            note: 'Enrich → hr_employees (HR_BASE_DATOS_XLSX)',
            copyValue: 'I:\\Mi unidad\\RH\\BASE DATOS PERSONAL C50.xlsx',
            updateFrequency: 'Diario 12:00 PM CDMX (Actions soft-sync)',
          },
          {
            label: 'Estado sync RH',
            kind: 'file',
            note: 'hr_drive_sync_state · SQL supabase/hr_drive_sync.sql · GET /api/hr/sync',
            copyValue: 'hr_drive_sync_state',
          },
        ],
        routes: [
          '/rrhh',
          '/staff/horario',
          '/api/hr/payroll',
          '/api/hr/schedules',
          '/api/hr/docs',
          '/api/hr/expedientes',
          '/api/hr/sync',
        ],
      },
      {
        id: 'local-hr-downloads',
        label: 'Descargas · import RR.HH.',
        role: 'Excel locales (fuente primaria de import nómina y horarios en el PC).',
        note: '%USERPROFILE%\\Downloads · env HR_NOMINA_LOCAL_DIR / HR_HORARIOS_LOCAL_DIR',
        updateFrequency: 'Manual en PC · botones Importar en /rrhh → Nómina / Horarios',
        leaves: [
          {
            label: 'NOMINA C50 2026 .xlsx',
            kind: 'file',
            note: 'También 2025…2022 · seed plantilla / períodos',
            copyValue: 'NOMINA C50 2026 .xlsx',
            updateFrequency: 'POST /api/hr/payroll/import',
          },
          {
            label: 'HORARIOS C50 2026.xlsx',
            kind: 'file',
            note: 'Hojas SEMANA N · pasado+curso→publicado, futuro→borrador (hasta Publicar)',
            copyValue: 'HORARIOS C50 2026.xlsx',
            updateFrequency: 'POST /api/hr/schedules/import',
          },
        ],
        routes: [
          '/rrhh',
          '/api/hr/payroll/import',
          '/api/hr/schedules/import',
        ],
      },
      {
        id: 'drive-sheets-cxp',
        label: 'Google Sheets · CxP',
        role: 'Hoja de proveedores Cluster (sync Actions + local).',
        note: 'C X P PROVEEDORES CLUSTER…',
        updateFrequency: 'Mixto · cxp_por_pagar cada hora; cxp/cxp_saldos manual',
        leaves: [
          {
            label: 'cxp_por_pagar',
            kind: 'source_file',
            note: 'Función: saldo a la fecha proveedores · Actions',
            updateFrequency: 'Cada hora (Actions · sync-saldos.yml)',
          },
          {
            label: 'cxp + cxp_saldos',
            kind: 'source_file',
            note: 'ingest_cxp.py (local)',
            updateFrequency: 'Manual (ingest_cxp.py)',
          },
        ],
        scripts: ['ingest_cxp_por_pagar.py', 'ingest_cxp.py', 'sync_saldos_al_dia.py'],
        sourceFiles: ['cxp_por_pagar', 'cxp', 'cxp_saldos'],
        routes: ['/finanzas/gastos'],
      },
    ],
  },
  {
    id: 'gmail',
    title: 'Gmail',
    subtitle: 'Correos → ingestors Python → financial_records',
    role: 'Bandeja de entrada automática para Infocaja, cortes y facturas.',
    branches: [
      {
        id: 'gmail-infocaja',
        label: 'Infocaja Fin de Día',
        role: 'Función: venta diaria + efectivo/tarjetas/personas → source_file=infocaja (/ventas).',
        updateFrequency:
          'Lun–sáb 4:00 AM · Dom 8:00 PM CDMX (Actions · sync-gmail.yml)',
        scripts: ['ingest_infocaja_gmail.py', 'sync_gmail_diario.py'],
        sourceFiles: ['infocaja'],
        routes: ['/ventas'],
      },
      {
        id: 'gmail-corte',
        label: 'CORTE CARRANZA (XLS)',
        role: 'Función: cancelaciones/descuentos/cortesías → source_file=corte_caja (/ventas).',
        updateFrequency:
          'Lun–sáb 4:00 AM · Dom 8:00 PM CDMX (Actions · sync-gmail.yml)',
        scripts: ['ingest_corte_gmail.py', 'sync_gmail_diario.py'],
        sourceFiles: ['corte_caja'],
        routes: ['/ventas'],
      },
      {
        id: 'gmail-facturas',
        label: 'Facturas CFDI (XML/PDF)',
        role: 'Función: índice CFDI → ERP (financial_records); cloud vía sync-gmail (best-effort).',
        updateFrequency: 'Cloud: sync-gmail (CFDI → financial_records · best-effort)',
        scripts: ['ingest_facturas_gmail.py'],
        sourceFiles: ['factura_cfdi'],
        routes: ['/finanzas/facturas'],
      },
    ],
  },
  {
    id: 'repo',
    title: 'Repo',
    subtitle: 'Scripts ingestor/ y orquestación en GitHub Actions',
    role: 'Código de ingestión y workflows que corren en CI o en el PC.',
    branches: [
      {
        id: 'repo-ingestors',
        label: 'ingestor/ (clave)',
        role: 'Scripts Python que leen orígenes y escriben en Supabase.',
        updateFrequency: 'Según script · ver sync_*.py y workflows',
        leaves: [
          {
            label: 'sync_gmail_diario.py',
            kind: 'script',
            note: 'Función: orquesta Infocaja + CORTE; CFDI en paso aparte (Actions)',
            updateFrequency: 'Lun–sáb 4:00 AM · Dom 8:00 PM CDMX (Actions)',
          },
          {
            label: 'sync_saldos_al_dia.py',
            kind: 'script',
            note: 'Función: flujo efectivo + cxp_por_pagar → Saldos al día',
            updateFrequency: 'Cada hora · cron 7 * * * * (:07 CDMX)',
          },
          {
            label: 'ingest_infocaja_gmail.py',
            kind: 'script',
            note: 'Función: venta diaria',
            updateFrequency: 'Vía sync-gmail (Actions)',
          },
          {
            label: 'ingest_corte_gmail.py',
            kind: 'script',
            note: 'Función: cancelaciones/descuentos/cortesías',
            updateFrequency: 'Vía sync-gmail (Actions)',
          },
          {
            label: 'ingest_facturas_gmail.py',
            kind: 'script',
            note: 'Función: índice CFDI',
            updateFrequency: 'Vía sync-gmail (Actions · best-effort → ERP)',
          },
          {
            label: 'ingest_saldos_flujo.py',
            kind: 'script',
            note: 'Función: caja chica / movimientos',
            updateFrequency: 'Cada hora (vía sync-saldos)',
          },
          { label: 'ingest_presupuesto.py', kind: 'script', updateFrequency: 'Manual' },
          {
            label: 'ingest_estados_cuenta.py',
            kind: 'script',
            updateFrequency: 'Manual / al reindexar',
          },
          { label: 'ingest_ventas_semana.py', kind: 'script', updateFrequency: 'Manual' },
          {
            label: 'ingest_cxp.py / ingest_cxp_por_pagar.py',
            kind: 'script',
            note: 'Función: CxP saldo vivo + historial',
            updateFrequency: 'cxp_por_pagar cada hora; cxp manual',
          },
          { label: 'ingest_eventos.py', kind: 'script', updateFrequency: 'Manual' },
          {
            label: 'sync_hr_drive_cloud.py',
            kind: 'script',
            note: 'Función: soft-sync hr_* → hr_drive_sync_state',
            updateFrequency: 'Diario 12:00 PM CDMX (Actions)',
          },
          { label: 'google_auth.py', kind: 'script', updateFrequency: 'Utilidad (bajo demanda)' },
        ],
        scripts: [
          'sync_gmail_diario.py',
          'sync_saldos_al_dia.py',
          'ingest_infocaja_gmail.py',
          'ingest_corte_gmail.py',
          'ingest_facturas_gmail.py',
          'ingest_saldos_flujo.py',
          'ingest_presupuesto.py',
          'ingest_estados_cuenta.py',
          'ingest_ventas_semana.py',
          'ingest_cxp.py',
          'ingest_cxp_por_pagar.py',
          'ingest_eventos.py',
          'google_auth.py',
        ],
      },
      {
        id: 'repo-hr',
        label: 'RR.HH. (SQL + libs)',
        role: 'Esquema Supabase y lógica Next del módulo rrhh (activo).',
        note: 'No usa ingestors Python · APIs /api/hr/*',
        updateFrequency: 'Operativo en Suite',
        leaves: [
          {
            label: 'supabase/hr_module.sql',
            kind: 'file',
            note: 'Tablas hr_* principales',
          },
          {
            label: 'supabase/hr_resguardo.sql',
            kind: 'file',
            note: 'hr_resguardo_requests',
          },
          {
            label: 'supabase/hr_leave_request_form.sql',
            kind: 'file',
            note: 'Patch vacaciones (payload / capturada_por_rh)',
          },
          {
            label: 'app/lib/hr*.ts · hr-payroll* · hr-schedule*',
            kind: 'file',
            note: 'Paths Drive, import Descargas, plantilla',
          },
          {
            label: 'app/api/hr/*',
            kind: 'route',
            note: 'Endpoints del módulo',
          },
        ],
        routes: ['/rrhh', '/staff/horario', '/api/hr/summary'],
      },
      {
        id: 'repo-workflows',
        label: '.github/workflows/',
        role: 'Automatización en GitHub Actions (horario CDMX).',
        updateFrequency:
          'Programado · sync-gmail L–S 4:00 AM / Dom 8:00 PM; sync-saldos cada hora; sync-hr-drive 12:00 PM',
        leaves: [
          {
            label: 'sync-gmail.yml',
            kind: 'workflow',
            note: 'Función: ventas diarias + CFDI → ERP (paso best-effort)',
            updateFrequency:
              'Lun–sáb 4:00 AM CDMX (0 10 * * 1-6) · Dom 8:00 PM (0 2 * * 1) · respaldo 17 11 * * 1-6',
          },
          {
            label: 'sync-saldos.yml',
            kind: 'workflow',
            note: 'Función: Saldos al día (flujo Drive + cxp_por_pagar Sheets)',
            updateFrequency: 'Cada hora · cron 7 * * * * (:07 CDMX)',
          },
          {
            label: 'sync-hr-drive.yml',
            kind: 'workflow',
            note: 'Función: soft-sync RR.HH. (hr_* + hr_drive_sync_state)',
            updateFrequency: 'Diario 12:00 PM CDMX · cron 0 18 * * *',
          },
        ],
        scripts: ['sync-gmail.yml', 'sync-saldos.yml', 'sync-hr-drive.yml'],
      },
    ],
  },
  {
    id: 'vercel',
    title: 'Vercel',
    subtitle: 'dashboard-c50.vercel.app · Next.js App Router',
    role: 'APIs de lectura/escritura y páginas del suite en producción.',
    branches: [
      {
        id: 'vercel-apis-read',
        label: 'APIs de lectura',
        role: 'Endpoints que el browser usa para consultar datos.',
        updateFrequency: 'En tiempo real (lectura de Supabase / disco)',
        leaves: [
          { label: '/api/financial-records', kind: 'route' },
          { label: '/api/facturas', kind: 'route' },
          { label: '/api/comprobantes', kind: 'route' },
          { label: '/api/estados-cuenta', kind: 'route' },
          { label: '/api/estados-cuenta-pdf', kind: 'route' },
        ],
        routes: [
          '/api/financial-records',
          '/api/facturas',
          '/api/comprobantes',
          '/api/estados-cuenta',
          '/api/estados-cuenta-pdf',
        ],
      },
      {
        id: 'vercel-apis-admin',
        label: 'APIs admin (escritura)',
        role: 'Mutaciones restringidas a Admin.',
        updateFrequency: 'Solo admin (manual)',
        leaves: [
          {
            label: '/api/admin/users',
            kind: 'route',
            note: 'dashboard_auth',
            updateFrequency: 'Solo admin',
          },
          {
            label: '/api/admin/presupuesto-ajustes',
            kind: 'route',
            note: 'presupuesto_ajuste',
            updateFrequency: 'Solo admin',
          },
          {
            label: '/api/admin/saldos-bancos',
            kind: 'route',
            note: 'saldos_bancos_manual',
            updateFrequency: 'Solo admin',
          },
          {
            label: '/api/admin/data-inventory',
            kind: 'route',
            note: 'Inventario híbrido documentado + Drive/Supabase',
            updateFrequency: 'Solo admin (lectura)',
          },
        ],
        routes: [
          '/api/admin/users',
          '/api/admin/presupuesto-ajustes',
          '/api/admin/saldos-bancos',
          '/api/admin/data-inventory',
        ],
        sourceFiles: [
          'dashboard_auth',
          'presupuesto_ajuste',
          'saldos_bancos_manual',
        ],
      },
      {
        id: 'vercel-apis-hr',
        label: 'APIs RR.HH. (/api/hr/*)',
        role: 'CRUD e import del módulo Recursos Humanos (permiso rrhh; Staff lee publicado).',
        note: 'Tablas hr_* · no financial_records',
        updateFrequency: 'En tiempo real (Suite) · import local bajo demanda',
        leaves: [
          {
            label: '/api/hr/employees',
            kind: 'route',
            note: 'Plantilla / empleados',
          },
          {
            label: '/api/hr/payroll',
            kind: 'route',
            note: 'GET/POST/PATCH períodos · borrador→cerrado→pagado',
          },
          {
            label: '/api/hr/payroll/import',
            kind: 'route',
            note: 'NOMINA C50 · Descargas / Drive / upload',
          },
          {
            label: '/api/hr/schedules',
            kind: 'route',
            note: 'Semanas · propose / [weekId] / mine / import',
          },
          {
            label: '/api/hr/schedules/mine',
            kind: 'route',
            note: 'Staff · solo publicado',
          },
          {
            label: '/api/hr/availability',
            kind: 'route',
            note: 'Offs / disponibilidad RH',
          },
          {
            label: '/api/hr/leave-requests',
            kind: 'route',
            note: 'Vacaciones · captura RH',
          },
          {
            label: '/api/hr/leave-balances',
            kind: 'route',
            note: 'Saldos · plantilla + soft-sync nómina',
          },
          {
            label: '/api/hr/leave-balances/mine',
            kind: 'route',
            note: 'Saldo del colaborador vinculado (Staff)',
          },
          {
            label: '/api/hr/docs',
            kind: 'route',
            note: 'Biblioteca · hr_doc_links',
          },
          {
            label: '/api/hr/expedientes',
            kind: 'route',
            note: 'Índice Altas/Bajas File Stream',
          },
          {
            label: '/api/hr/resguardo',
            kind: 'route',
            note: 'Resguardos en /rrhh → Plantilla',
          },
          {
            label: '/api/hr/summary',
            kind: 'route',
            note: 'KPIs / alertas (API; UI Tablero retirada)',
          },
        ],
        routes: [
          '/api/hr/employees',
          '/api/hr/payroll',
          '/api/hr/payroll/import',
          '/api/hr/schedules',
          '/api/hr/schedules/mine',
          '/api/hr/schedules/import',
          '/api/hr/availability',
          '/api/hr/leave-requests',
          '/api/hr/leave-balances',
          '/api/hr/leave-balances/mine',
          '/api/hr/docs',
          '/api/hr/expedientes',
          '/api/hr/resguardo',
          '/api/hr/summary',
          '/rrhh',
          '/staff/horario',
        ],
      },
      {
        id: 'vercel-pages',
        label: 'Páginas / consultas',
        role: 'Rutas del App Router visibles en el hub.',
        updateFrequency: 'UI en vivo (datos según origen)',
        leaves: [
          { label: '/', kind: 'route', note: 'Hub' },
          { label: '/ventas', kind: 'route' },
          { label: '/finanzas', kind: 'route' },
          { label: '/finanzas/gastos', kind: 'route' },
          { label: '/finanzas/ingresos', kind: 'route' },
          { label: '/finanzas/comprobantes', kind: 'route' },
          { label: '/finanzas/estados-cuenta', kind: 'route' },
          { label: '/finanzas/facturas', kind: 'route' },
          {
            label: '/rrhh',
            kind: 'route',
            note: 'Activo · Plantilla (expedientes), Horarios, Nómina, Vacaciones, Biblioteca',
          },
          {
            label: '/staff/horario',
            kind: 'route',
            note: 'Staff · solo semana publicada (vínculo suite_username)',
          },
          {
            label: '/staff/vacaciones',
            kind: 'route',
            note: 'oculto hasta usuarios por empleado · redirect /staff',
          },
          {
            label: '/staff/perfil',
            kind: 'route',
            note: 'oculto hasta usuarios por empleado · redirect /staff',
          },
          { label: '/reportes-socios', kind: 'route' },
          { label: '/cocina', kind: 'route', note: 'placeholder' },
          { label: '/barra', kind: 'route', note: 'placeholder' },
          { label: '/admin', kind: 'route', note: 'Mapa + Inventario de datos' },
        ],
        routes: [
          '/',
          '/ventas',
          '/finanzas',
          '/finanzas/gastos',
          '/finanzas/ingresos',
          '/finanzas/comprobantes',
          '/finanzas/estados-cuenta',
          '/finanzas/facturas',
          '/rrhh',
          '/staff/horario',
          '/staff/vacaciones',
          '/staff/perfil',
          '/reportes-socios',
          '/cocina',
          '/barra',
          '/admin',
        ],
      },
    ],
  },
];

/** Texto plano para búsqueda (source_file, path, script, ruta, labels). */
export function resourceBranchSearchText(branch: ResourceBranch): string {
  const parts = [
    branch.label,
    branch.role,
    branch.note ?? '',
    branch.updateFrequency ?? '',
    ...(branch.leaves ?? []).flatMap((l) => [
      l.label,
      l.note ?? '',
      l.copyValue ?? '',
      l.updateFrequency ?? '',
    ]),
    ...(branch.scripts ?? []),
    ...(branch.routes ?? []),
    ...(branch.sourceFiles ?? []),
  ];
  return parts.join(' ').toLowerCase();
}

export function resourcePlatformSearchText(platform: ResourcePlatform): string {
  return [
    platform.title,
    platform.subtitle,
    platform.role,
    ...platform.branches.map(resourceBranchSearchText),
  ]
    .join(' ')
    .toLowerCase();
}
