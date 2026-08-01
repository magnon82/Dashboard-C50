/**
 * Inventario de datos / orígenes — fuente única para el mapa de
 * orígenes (AdminDataMap) y la sección «Inventario de datos».
 * Actualizar aquí al agregar source_file, path Drive, ingest o ruta UI.
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
 * Basado en .github/workflows/sync-gmail.yml (cron 0 11 * * * ≈ 5:00 AM CDMX,
 * --skip-facturas) y sync-saldos.yml (cada 5 min), más ingestors manuales / Admin.
 */
export const SOURCE_FILE_UPDATE: Record<string, string> = {
  infocaja: 'Diario ~5:17 AM CDMX (Actions)',
  corte_caja: 'Diario ~5:00 AM CDMX (Actions)',
  eventos: 'Manual (ingest_eventos.py)',
  ventas_semana: 'Manual (ingest_ventas_semana.py)',
  flujo_efectivo_saldo: 'Cada ~5 min (Actions)',
  flujo_efectivo_semana: 'Cada ~5 min (Actions)',
  flujo_efectivo_mov: 'Cada ~5 min (Actions)',
  presupuesto_mensual: 'Manual (ingest_presupuesto.py)',
  presupuesto_saldos: 'Manual (ingest_presupuesto.py)',
  presupuesto_rubro: 'Manual (ingest_presupuesto.py)',
  presupuesto_semana: 'Manual (ingest_presupuesto.py)',
  presupuesto_sem_detalle: 'Manual (ingest_presupuesto.py)',
  presupuesto_ingreso: 'Manual (ingest_presupuesto.py)',
  presupuesto_ajuste: 'Solo admin (manual)',
  estado_mifel: 'Manual / al reindexar',
  estado_bbva: 'Manual / al reindexar',
  estado_pdf_index: 'Manual / al reindexar',
  estado_cuenta_pdf_index: 'Manual / al reindexar',
  saldos_bancos_manual: 'Solo admin (manual)',
  cxp_por_pagar: 'Cada ~5 min (Actions · Sheets)',
  cxp: 'Manual (ingest_cxp.py)',
  cxp_saldos: 'Manual (ingest_cxp.py)',
  factura_cfdi: 'Manual local · CI omite (--skip-facturas)',
  dashboard_auth: 'Solo admin (manual)',
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
  /** Resumen de frecuencia para el grupo (p.ej. "Cada ~5 min"). */
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
    role: 'Tickets y cortes de venta diarios / semanales.',
    updateFrequency:
      'Mixto · Infocaja/CORTE diario ~5:00 AM; eventos y ventas_semana manual',
    scripts: [
      'ingest_infocaja_gmail.py',
      'ingest_corte_gmail.py',
      'ingest_eventos.py',
      'ingest_ventas_semana.py',
    ],
    routes: ['/ventas', '/finanzas'],
  },
  flujo: {
    role: 'Saldos y movimientos de flujo de efectivo.',
    updateFrequency: 'Cada ~5 min (Actions · sync-saldos.yml)',
    scripts: ['ingest_saldos_flujo.py', 'sync_saldos_al_dia.py'],
    routes: ['/finanzas', '/finanzas/ingresos'],
  },
  presupuesto: {
    role: 'Presupuesto mensual, rubros, semanas y ajustes.',
    updateFrequency: 'Manual (ingest_presupuesto.py) · ajustes solo admin',
    scripts: ['ingest_presupuesto.py'],
    routes: ['/finanzas', '/finanzas/gastos', '/admin'],
  },
  bancos: {
    role: 'Estados MIFEL/BBVA, índices PDF y saldos manuales.',
    updateFrequency: 'Manual / al reindexar · saldos_bancos_manual solo admin',
    scripts: ['ingest_estados_cuenta.py'],
    routes: ['/finanzas/estados-cuenta', '/finanzas/comprobantes', '/admin'],
  },
  cxp: {
    role: 'Proveedores por pagar y saldos CxP.',
    updateFrequency: 'Mixto · cxp_por_pagar cada ~5 min; cxp/cxp_saldos manual',
    scripts: ['ingest_cxp_por_pagar.py', 'ingest_cxp.py', 'sync_saldos_al_dia.py'],
    routes: ['/finanzas/gastos'],
  },
  facturas: {
    role: 'CFDI recibidos por correo (XML/PDF).',
    updateFrequency: 'Manual local · Actions omite (--skip-facturas)',
    scripts: ['ingest_facturas_gmail.py'],
    routes: ['/finanzas/facturas'],
  },
  auth: {
    role: 'Usuarios y permisos del suite.',
    updateFrequency: 'Solo admin (manual)',
    routes: ['/admin'],
  },
};

/**
 * Inventario scaneable: dónde vive cada recurso (no es el grafo del mapa).
 */
export const ADMIN_STORAGE_PLATFORMS: ResourcePlatform[] = [
  {
    id: 'supabase',
    title: 'Supabase',
    subtitle: 'Tabla financial_records · columna source_file',
    role: 'Almacén central de filas financieras filtrables por origen.',
    branches: SOURCE_FILE_GROUPS.map((g) => {
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
  },
  {
    id: 'drive',
    title: 'Drive / I:',
    subtitle: 'Archivos locales (Google Drive File Stream) y carpetas espejo',
    role: 'Origen de Excel, PDFs y carpetas que alimentan los ingestors.',
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
          'Mixto · flujo cada ~5 min; Bancos PDF e índice manual; ventas_semana manual',
        leaves: [
          {
            label: 'FLUJO EFECTIVO CARRANZA 50.xlsx',
            kind: 'file',
            note: 'flujo_efectivo_saldo / semana / mov',
            updateFrequency: 'Cada ~5 min (Actions)',
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
        updateFrequency: 'Manual local · Actions omite (--skip-facturas)',
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
        id: 'drive-sheets-cxp',
        label: 'Google Sheets · CxP',
        role: 'Hoja de proveedores Cluster (sync Actions + local).',
        note: 'C X P PROVEEDORES CLUSTER…',
        updateFrequency: 'Mixto · cxp_por_pagar cada ~5 min; cxp/cxp_saldos manual',
        leaves: [
          {
            label: 'cxp_por_pagar',
            kind: 'source_file',
            note: 'Actions cada 5 min',
            updateFrequency: 'Cada ~5 min (Actions)',
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
        role: 'Correo diario de caja → source_file=infocaja.',
        updateFrequency: 'Diario ~5:00 AM CDMX (Actions · sync-gmail.yml)',
        scripts: ['ingest_infocaja_gmail.py', 'sync_gmail_diario.py'],
        sourceFiles: ['infocaja'],
        routes: ['/ventas'],
      },
      {
        id: 'gmail-corte',
        label: 'CORTE CARRANZA (XLS)',
        role: 'Adjunto de corte de caja → source_file=corte_caja.',
        updateFrequency: 'Diario ~5:00 AM CDMX (Actions · sync-gmail.yml)',
        scripts: ['ingest_corte_gmail.py', 'sync_gmail_diario.py'],
        sourceFiles: ['corte_caja'],
        routes: ['/ventas'],
      },
      {
        id: 'gmail-facturas',
        label: 'Facturas CFDI (XML/PDF)',
        role: 'Adjuntos fiscales; local completo, Actions con --skip-facturas.',
        updateFrequency: 'Manual local · CI omite (--skip-facturas)',
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
            note: 'orquesta Infocaja + CORTE (+ facturas local)',
            updateFrequency: 'Diario ~5:00 AM en Actions',
          },
          {
            label: 'sync_saldos_al_dia.py',
            kind: 'script',
            note: 'flujo + cxp_por_pagar',
            updateFrequency: 'Cada ~5 min en Actions',
          },
          {
            label: 'ingest_infocaja_gmail.py',
            kind: 'script',
            updateFrequency: 'Diario (vía sync-gmail)',
          },
          {
            label: 'ingest_corte_gmail.py',
            kind: 'script',
            updateFrequency: 'Diario (vía sync-gmail)',
          },
          {
            label: 'ingest_facturas_gmail.py',
            kind: 'script',
            updateFrequency: 'Manual local · omitido en CI',
          },
          {
            label: 'ingest_saldos_flujo.py',
            kind: 'script',
            updateFrequency: 'Cada ~5 min (vía sync-saldos)',
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
            updateFrequency: 'cxp_por_pagar ~5 min; cxp manual',
          },
          { label: 'ingest_eventos.py', kind: 'script', updateFrequency: 'Manual' },
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
        id: 'repo-workflows',
        label: '.github/workflows/',
        role: 'Automatización en GitHub Actions (horario CDMX).',
        updateFrequency: 'Programado · sync-gmail diario; sync-saldos cada 5 min',
        leaves: [
          {
            label: 'sync-gmail.yml',
            kind: 'workflow',
            note: '~5:00 AM CDMX · Infocaja + CORTE · --skip-facturas',
            updateFrequency: 'Diario · cron 0 11 * * * UTC',
          },
          {
            label: 'sync-saldos.yml',
            kind: 'workflow',
            note: 'cada 5 min · flujo + cxp_por_pagar',
            updateFrequency: 'Cada 5 min · cron */5 * * * *',
          },
        ],
        scripts: ['sync-gmail.yml', 'sync-saldos.yml'],
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
        ],
        routes: [
          '/api/admin/users',
          '/api/admin/presupuesto-ajustes',
          '/api/admin/saldos-bancos',
        ],
        sourceFiles: [
          'dashboard_auth',
          'presupuesto_ajuste',
          'saldos_bancos_manual',
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
          { label: '/rrhh', kind: 'route', note: 'placeholder' },
          { label: '/reportes-socios', kind: 'route' },
          { label: '/cocina', kind: 'route', note: 'placeholder' },
          { label: '/barra', kind: 'route', note: 'placeholder' },
          { label: '/admin', kind: 'route' },
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
