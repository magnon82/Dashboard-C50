'use client';

import { useMemo, useState } from 'react';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type IconKind =
  | 'gmail'
  | 'drive'
  | 'sheets'
  | 'github'
  | 'supabase'
  | 'vercel'
  | 'nextjs'
  | 'pc'
  | 'windows'
  | 'python'
  | 'browser'
  | 'hub'
  | 'ventas'
  | 'finanzas'
  | 'admin'
  | 'google'
  | 'db'
  | 'api'
  | 'eventos';

type MapNode = {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'system' | 'db' | 'ui' | 'runner';
  icon: IconKind;
  sources?: string[];
  files?: string[];
  detail?: string;
  /** Icon-above layout (Obsidian-style); default is icon-left card */
  stack?: boolean;
};

type MapEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  /** Absolute waypoints for orthogonal routing (excluding node anchors) */
  via?: Array<[number, number]>;
  /** Explicit label center; defaults to midpoint of path */
  labelAt?: [number, number];
  dashed?: boolean;
  accent?: boolean;
};

type Region = {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  icon: IconKind;
};

const VIEW_W = 1500;
const VIEW_H = 860;
const EDGE_R = 12;
const LINE = '#A8B0BD';
const LINE_ACCENT = SUITE.orangeDeep;
const PILL = '#6B7585';
const PILL_ACCENT = SUITE.orangeDeep;

/** Simple Icons (v13) path data + brand hex — viewBox 0 0 24 24 */
const SI = {
  gmail: {
    color: '#EA4335',
    path: 'M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z',
  },
  drive: {
    color: '#4285F4',
    path: 'M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z',
  },
  sheets: {
    color: '#34A853',
    path: 'M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z',
  },
  github: {
    color: '#181717',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  supabase: {
    color: '#3FCF8E',
    path: 'M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z',
  },
  vercel: {
    color: '#000000',
    path: 'M24 22.525H0l12-21.05 12 21.05z',
  },
  nextjs: {
    color: '#000000',
    path: 'M18.665 21.978C16.758 23.255 14.465 24 12 24 5.377 24 0 18.623 0 12S5.377 0 12 0s12 5.377 12 12c0 3.583-1.574 6.801-4.067 9.001L9.219 7.2H7.2v9.596h1.615V9.251l9.85 12.727Zm-3.332-8.533 1.6 2.061V7.2h-1.6v6.245Z',
  },
  eventos: {
    color: '#4285F4',
    path: 'M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z',
  },
  google: {
    color: '#4285F4',
    path: 'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z',
  },
  windows: {
    color: '#0078D4',
    path: 'M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623',
  },
  python: {
    color: '#3776AB',
    path: 'M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z',
  },
} as const;

const REGIONS: Region[] = [
  { id: 'google', label: 'Google', sub: 'fuentes externas', x: 40, y: 40, w: 228, h: 740, icon: 'google' },
  { id: 'github', label: 'GitHub Actions', sub: 'orquestación cloud', x: 316, y: 40, w: 260, h: 392, icon: 'github' },
  { id: 'local', label: 'PC local', sub: 'manual / opcional', x: 316, y: 456, w: 260, h: 324, icon: 'pc' },
  { id: 'supabase', label: 'Supabase', sub: 'hub · persistencia', x: 640, y: 140, w: 280, h: 500, icon: 'supabase' },
  { id: 'vercel', label: 'Vercel', sub: 'dashboard-c50.vercel.app', x: 980, y: 40, w: 244, h: 740, icon: 'vercel' },
  { id: 'browser', label: 'Navegador', sub: 'módulos del suite', x: 1276, y: 40, w: 192, h: 740, icon: 'browser' },
];

const NODES: MapNode[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    sub: 'Infocaja + CORTE',
    x: 76,
    y: 100,
    w: 156,
    h: 108,
    kind: 'system',
    icon: 'gmail',
    stack: true,
    sources: ['infocaja', 'corte_caja'],
    files: ['ingest_infocaja_gmail.py', 'ingest_corte_gmail.py'],
    detail: 'Correos Infocaja Fin de Día y CORTE CARRANZA (adjunto XLS).',
  },
  {
    id: 'drive',
    label: 'Drive',
    sub: 'Presupuesto + Flujo + Estados',
    x: 76,
    y: 248,
    w: 156,
    h: 108,
    kind: 'system',
    icon: 'drive',
    stack: true,
    sources: [
      'presupuesto_*',
      'flujo_efectivo_saldo',
      'flujo_efectivo_semana',
      'flujo_efectivo_mov',
      'estado_mifel',
      'estado_bbva',
      'estado_pdf_index',
      'estado_cuenta_pdf_index',
    ],
    files: ['ingest_presupuesto.py', 'ingest_saldos_flujo.py', 'ingest_estados_cuenta.py'],
    detail:
      'PRESUPUESTO, FLUJO EFECTIVO, estados MIFEL/BBVA, COMPROBANTES BANCARIOS (pagos) y Administración\\Bancos (estados PDF).',
  },
  {
    id: 'sheets',
    label: 'Sheets',
    sub: 'CXP proveedores',
    x: 76,
    y: 396,
    w: 156,
    h: 108,
    kind: 'system',
    icon: 'sheets',
    stack: true,
    sources: ['cxp_por_pagar'],
    files: ['ingest_cxp_por_pagar.py'],
    detail: 'Google Sheet de cuentas por pagar (proveedores y servicios).',
  },
  {
    id: 'eventos',
    label: 'Eventos',
    sub: 'legacy / puntual',
    x: 76,
    y: 544,
    w: 156,
    h: 108,
    kind: 'system',
    icon: 'eventos',
    stack: true,
    sources: ['eventos'],
    files: ['ingest_eventos.py'],
    detail: 'Registros de eventos (WI vs Eventos en Ventas). Ingest puntual.',
  },
  {
    id: 'wf-gmail',
    label: 'sync-gmail.yml',
    sub: '~5:00 AM CDMX',
    x: 348,
    y: 100,
    w: 196,
    h: 72,
    kind: 'runner',
    icon: 'github',
    files: ['.github/workflows/sync-gmail.yml', 'sync_gmail_diario.py'],
    detail: 'GitHub Actions diario (11:00 UTC). Corre Infocaja + CORTE → Supabase.',
  },
  {
    id: 'wf-saldos',
    label: 'sync-saldos.yml',
    sub: 'cada 5 min',
    x: 348,
    y: 210,
    w: 196,
    h: 72,
    kind: 'runner',
    icon: 'github',
    files: ['.github/workflows/sync-saldos.yml', 'sync_saldos_al_dia.py'],
    detail:
      'GitHub Actions cada 5 min: efectivo saldo + semanas + movimientos línea por Concepto (Drive) + CXP (Sheets) → Supabase.',
  },
  {
    id: 'ingestor-cloud',
    label: 'ingestor/',
    sub: 'Python · OAuth',
    x: 348,
    y: 320,
    w: 196,
    h: 72,
    kind: 'runner',
    icon: 'python',
    files: ['google_auth.py', 'requirements.txt', 'sync_gmail_diario.py', 'sync_saldos_al_dia.py'],
    detail: 'Scripts Python en el runner ubuntu-latest con secrets del repo.',
  },
  {
    id: 'ingest-estados',
    label: 'ingest_estados',
    sub: 'carga manual PC',
    x: 348,
    y: 500,
    w: 196,
    h: 72,
    kind: 'runner',
    icon: 'python',
    sources: ['estado_mifel', 'estado_bbva', 'estado_pdf_index', 'estado_cuenta_pdf_index'],
    files: ['ingest_estados_cuenta.py'],
    detail:
      'Estados Excel MIFEL/BBVA; índice PDFs pagos (COMPROBANTES BANCARIOS → estado_pdf_index); índice PDFs estados (Administración\\Bancos → estado_cuenta_pdf_index).',
  },
  {
    id: 'ingest-prep',
    label: 'ingest_presupuesto',
    sub: 'carga manual',
    x: 348,
    y: 592,
    w: 196,
    h: 72,
    kind: 'runner',
    icon: 'python',
    sources: ['presupuesto_mensual', 'presupuesto_saldos', 'presupuesto_rubro', 'presupuesto_semana', 'presupuesto_sem_detalle', 'presupuesto_ingreso'],
    files: ['ingest_presupuesto.py'],
    detail: 'Lee Excel de presupuesto (Drive/local): rubros, saldos, semanas, detalle SEM y ingresos bancarios semanales Mifel/BBVA (TOTAL, llenado manual → presupuesto_ingreso).',
  },
  {
    id: 'win-tasks',
    label: 'Tareas Windows',
    sub: 'deshabilitadas',
    x: 348,
    y: 684,
    w: 196,
    h: 64,
    kind: 'system',
    icon: 'windows',
    files: ['run_sync_gmail_diario.bat', 'run_sync_saldos_al_dia.bat', 'CLOUD_SYNC.md'],
    detail: 'DashboardC50-Sync* quedaron deshabilitadas; el sync vive en Actions.',
  },
  {
    id: 'fr',
    label: 'financial_records',
    sub: 'tabla · source_file',
    x: 680,
    y: 230,
    w: 200,
    h: 136,
    kind: 'db',
    icon: 'db',
    stack: true,
    sources: [
      'infocaja',
      'corte_caja',
      'eventos',
      'flujo_efectivo_saldo',
      'flujo_efectivo_semana',
      'flujo_efectivo_mov',
      'cxp_por_pagar',
      'presupuesto_mensual',
      'presupuesto_saldos',
      'saldos_bancos_manual',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_sem_detalle',
      'presupuesto_ingreso',
      'presupuesto_ajuste',
      'estado_mifel',
      'estado_bbva',
      'dashboard_auth',
    ],
    detail: 'Almacén central. Cada fila lleva source_file para filtrar por dashboard.',
  },
  {
    id: 'sb-auth',
    label: 'Auth service role',
    sub: 'escritura / admin',
    x: 700,
    y: 430,
    w: 160,
    h: 108,
    kind: 'db',
    icon: 'supabase',
    stack: true,
    files: ['SUPABASE_SERVICE_ROLE_KEY'],
    detail: 'Los ingestors y rutas admin escriben con service role; el browser lee vía API.',
  },
  {
    id: 'api-fr',
    label: 'API records',
    sub: 'GET /api/…',
    x: 1016,
    y: 110,
    w: 172,
    h: 100,
    kind: 'system',
    icon: 'api',
    stack: true,
    files: ['app/api/financial-records/route.ts'],
    detail: 'Lee financial_records (excluye dashboard_auth). Finanzas filtra por sources=.',
  },
  {
    id: 'api-ajustes',
    label: 'API ajustes',
    sub: 'PUT / DELETE',
    x: 1016,
    y: 270,
    w: 172,
    h: 100,
    kind: 'system',
    icon: 'api',
    stack: true,
    sources: ['presupuesto_ajuste'],
    files: ['app/api/admin/presupuesto-ajustes/route.ts'],
    detail: 'Ajustes de licencias/montos fijos por mes. Solo sergio en /admin.',
  },
  {
    id: 'api-users',
    label: 'API users',
    sub: 'dashboard_auth',
    x: 1016,
    y: 430,
    w: 172,
    h: 100,
    kind: 'system',
    icon: 'api',
    stack: true,
    sources: ['dashboard_auth'],
    files: ['app/api/admin/users/route.ts', 'app/lib/users.ts'],
    detail: 'Usuarios del suite persistidos como filas source_file=dashboard_auth.',
  },
  {
    id: 'next',
    label: 'Next.js',
    sub: 'App Router',
    x: 1016,
    y: 590,
    w: 172,
    h: 100,
    kind: 'system',
    icon: 'nextjs',
    stack: true,
    files: ['app/layout.tsx', 'middleware.ts'],
    detail: 'App desplegada en Vercel. Auth de sesión y rutas por módulo.',
  },
  {
    id: 'hub',
    label: 'Hub',
    sub: '/',
    x: 1306,
    y: 110,
    w: 132,
    h: 100,
    kind: 'ui',
    icon: 'hub',
    stack: true,
    files: ['app/page.tsx'],
    detail: 'Entrada al suite: enlaces a Ventas, Finanzas y Admin.',
  },
  {
    id: 'ventas',
    label: 'Ventas',
    sub: '/ventas',
    x: 1306,
    y: 260,
    w: 132,
    h: 100,
    kind: 'ui',
    icon: 'ventas',
    stack: true,
    sources: ['infocaja', 'corte_caja', 'eventos', 'ventas_semana'],
    files: ['app/ventas/page.tsx', 'app/lib/ventas-semana.ts'],
    detail: 'Ventas diarias, WI vs Eventos, mix de pagos, cancelaciones/descuentos.',
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    sub: '/finanzas',
    x: 1306,
    y: 410,
    w: 132,
    h: 100,
    kind: 'ui',
    icon: 'finanzas',
    stack: true,
    sources: [
      'presupuesto_mensual',
      'presupuesto_saldos',
      'saldos_bancos_manual',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_sem_detalle',
      'presupuesto_ingreso',
      'presupuesto_ajuste',
      'flujo_efectivo_saldo',
      'flujo_efectivo_semana',
      'flujo_efectivo_mov',
      'cxp_por_pagar',
      'estado_mifel',
      'estado_bbva',
      'estado_pdf_index',
      'estado_cuenta_pdf_index',
    ],
    files: [
      'app/finanzas/page.tsx',
      'app/finanzas/gastos/page.tsx',
      'app/finanzas/comprobantes/page.tsx',
      'app/finanzas/estados-cuenta/page.tsx',
      'app/lib/presupuesto.ts',
      'app/lib/saldos.ts',
      'app/lib/estados-cuenta.ts',
      'app/components/EstadosCuenta.tsx',
      'app/components/ComprobantesIndex.tsx',
      'app/components/EstadosCuentaPdfIndex.tsx',
      'app/components/ResumenBancosSemanal.tsx',
    ],
    detail:
      'Saldos al día, resumen semanal bancos + efectivo, presupuesto vs real, consultas de comprobantes / estados de cuenta / gastos.',
  },
  {
    id: 'admin',
    label: 'Admin',
    sub: '/admin',
    x: 1306,
    y: 560,
    w: 132,
    h: 100,
    kind: 'ui',
    icon: 'admin',
    stack: true,
    sources: ['presupuesto_ajuste', 'saldos_bancos_manual', 'dashboard_auth'],
    files: [
      'app/admin/page.tsx',
      'AdminPresupuestoAjustes.tsx',
      'AdminSaldosBancos.tsx',
      'app/api/admin/saldos-bancos/route.ts',
    ],
    detail: 'Usuarios, saldos bancarios manuales, ajustes de presupuesto y este mapa de orígenes.',
  },
];

/**
 * Corredores L→R: Google→runners ~292 | runners→SB ~608 | SB→Vercel ~948 | Vercel→UI ~1250
 */
const EDGES: MapEdge[] = [
  {
    id: 'e-gmail-wf',
    from: 'gmail',
    to: 'wf-gmail',
    label: 'Gmail API',
    via: [
      [294, 154],
      [294, 136],
    ],
    labelAt: [294, 145],
  },
  {
    id: 'e-drive-wf',
    from: 'drive',
    to: 'wf-saldos',
    label: 'Drive API',
    via: [
      [294, 288],
      [294, 246],
    ],
    labelAt: [294, 267],
  },
  {
    id: 'e-sheets-wf',
    from: 'sheets',
    to: 'wf-saldos',
    label: 'Sheets API',
    via: [
      [278, 450],
      [278, 260],
      [348, 260],
    ],
    labelAt: [278, 355],
  },
  {
    id: 'e-drive-estados',
    from: 'drive',
    to: 'ingest-estados',
    label: 'estados xlsx',
    via: [
      [262, 318],
      [262, 536],
    ],
    labelAt: [262, 420],
  },
  {
    id: 'e-drive-prep',
    from: 'drive',
    to: 'ingest-prep',
    label: 'Excel',
    via: [
      [250, 330],
      [250, 628],
    ],
    labelAt: [250, 520],
  },
  {
    id: 'e-ing-fr',
    from: 'ingestor-cloud',
    to: 'fr',
    label: 'upsert',
    via: [
      [612, 356],
      [612, 280],
    ],
    labelAt: [612, 318],
    accent: true,
  },
  {
    id: 'e-estados-fr',
    from: 'ingest-estados',
    to: 'fr',
    label: 'estado_*',
    via: [
      [600, 536],
      [600, 320],
    ],
    labelAt: [600, 430],
    accent: true,
  },
  {
    id: 'e-prep-fr',
    from: 'ingest-prep',
    to: 'fr',
    label: 'presupuesto_*',
    via: [
      [588, 628],
      [588, 360],
    ],
    labelAt: [588, 500],
    accent: true,
  },
  {
    id: 'e-eventos-fr',
    from: 'eventos',
    to: 'fr',
    label: 'ingest_eventos',
    dashed: true,
    via: [
      [240, 598],
      [240, 790],
      [780, 790],
      [780, 366],
    ],
    labelAt: [510, 790],
  },
  {
    id: 'e-fr-api',
    from: 'fr',
    to: 'api-fr',
    label: 'SELECT',
    via: [
      [950, 278],
      [950, 160],
    ],
    labelAt: [950, 220],
  },
  {
    id: 'e-api-aj-fr',
    from: 'api-ajustes',
    to: 'fr',
    label: 'PUT ajuste',
    via: [
      [950, 320],
      [880, 320],
    ],
    labelAt: [915, 320],
    accent: true,
  },
  {
    id: 'e-api-users-fr',
    from: 'api-users',
    to: 'fr',
    label: 'dashboard_auth',
    via: [
      [962, 480],
      [962, 380],
      [880, 380],
    ],
    labelAt: [962, 430],
  },
  {
    id: 'e-api-hub',
    from: 'api-fr',
    to: 'hub',
    label: 'sesión',
    labelAt: [1250, 140],
  },
  {
    id: 'e-api-ventas',
    from: 'api-fr',
    to: 'ventas',
    label: 'GET',
    via: [
      [1240, 170],
      [1240, 310],
    ],
    labelAt: [1240, 240],
  },
  {
    id: 'e-api-fin',
    from: 'api-fr',
    to: 'finanzas',
    label: 'GET sources',
    via: [
      [1256, 175],
      [1256, 460],
    ],
    labelAt: [1256, 340],
  },
  {
    id: 'e-admin-aj',
    from: 'admin',
    to: 'api-ajustes',
    label: 'ajustes',
    via: [
      [1270, 610],
      [1270, 320],
      [1188, 320],
    ],
    labelAt: [1270, 465],
    accent: true,
  },
  {
    id: 'e-admin-users',
    from: 'admin',
    to: 'api-users',
    label: 'usuarios',
    via: [
      [1286, 630],
      [1286, 480],
      [1188, 480],
    ],
    labelAt: [1286, 555],
    accent: true,
  },
];

function nodeCenter(n: MapNode): [number, number] {
  return [n.x + n.w / 2, n.y + n.h / 2];
}

function nodeAnchor(n: MapNode, towardX: number, towardY: number): [number, number] {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? [n.x + n.w, cy] : [n.x, cy];
  }
  return dy >= 0 ? [cx, n.y + n.h] : [cx, n.y];
}

/** Orthogonal path with rounded elbows (Obsidian-style). */
function roundedOrthoPath(points: Array<[number, number]>, radius = EDGE_R): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const dx1 = curr[0] - prev[0];
    const dy1 = curr[1] - prev[1];
    const dx2 = next[0] - curr[0];
    const dy2 = next[1] - curr[1];
    const len1 = Math.hypot(dx1, dy1) || 1;
    const len2 = Math.hypot(dx2, dy2) || 1;
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const x1 = curr[0] - (dx1 / len1) * r;
    const y1 = curr[1] - (dy1 / len1) * r;
    const x2 = curr[0] + (dx2 / len2) * r;
    const y2 = curr[1] + (dy2 / len2) * r;
    d += ` L ${x1} ${y1} Q ${curr[0]} ${curr[1]} ${x2} ${y2}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

function edgePoints(edge: MapEdge, byId: Map<string, MapNode>): Array<[number, number]> | null {
  const a = byId.get(edge.from);
  const b = byId.get(edge.to);
  if (!a || !b) return null;

  const via = edge.via ?? [];
  if (!via.length) {
    const [ax, ay] = nodeCenter(a);
    const [bx, by] = nodeCenter(b);
    const start = nodeAnchor(a, bx, by);
    const end = nodeAnchor(b, ax, ay);
    // Auto elbow when not aligned
    if (Math.abs(start[0] - end[0]) < 1 || Math.abs(start[1] - end[1]) < 1) {
      return [start, end];
    }
    const midX = (start[0] + end[0]) / 2;
    return [start, [midX, start[1]], [midX, end[1]], end];
  }

  const first = via[0];
  const last = via[via.length - 1];
  const start = nodeAnchor(a, first[0], first[1]);
  const end = nodeAnchor(b, last[0], last[1]);
  return [start, ...via, end];
}

function labelPoint(edge: MapEdge, pts: Array<[number, number]>): [number, number] {
  if (edge.labelAt) return edge.labelAt;
  if (pts.length === 0) return [0, 0];
  // Midpoint along polyline by segment count
  const mid = Math.floor((pts.length - 1) / 2);
  const a = pts[mid];
  const b = pts[Math.min(mid + 1, pts.length - 1)];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pillWidth(label: string): number {
  return Math.max(52, label.length * 6.4 + 18);
}

function BrandIcon({ kind, x, y, size = 14 }: { kind: IconKind; x: number; y: number; size?: number }) {
  const s = size;
  const brand = SI[kind as keyof typeof SI];
  if (brand) {
    return (
      <g transform={`translate(${x},${y}) scale(${s / 24})`}>
        <path d={brand.path} fill={brand.color} />
      </g>
    );
  }

  switch (kind) {
    case 'pc':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={s * 0.12} y={s * 0.18} width={s * 0.76} height={s * 0.52} rx={2} fill="none" stroke={SUITE.navy} strokeWidth={1.4} />
          <rect x={s * 0.2} y={s * 0.26} width={s * 0.6} height={s * 0.34} fill="#D6E0EF" />
          <path d={`M ${s * 0.28} ${s * 0.78} H ${s * 0.72} M ${s * 0.5} ${s * 0.7} V ${s * 0.78}`} stroke={SUITE.navy} strokeWidth={1.4} />
        </g>
      );
    case 'browser':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={0.5} y={s * 0.12} width={s - 1} height={s * 0.76} rx={3} fill="none" stroke={SUITE.navy} strokeWidth={1.4} />
          <path d={`M 0.5 ${s * 0.32} H ${s - 0.5}`} stroke={SUITE.navy} strokeWidth={1.4} />
          <circle cx={s * 0.22} cy={s * 0.22} r={s * 0.07} fill={SUITE.orange} />
          <circle cx={s * 0.38} cy={s * 0.22} r={s * 0.07} fill="#C5D0E3" />
          <circle cx={s * 0.54} cy={s * 0.22} r={s * 0.07} fill="#C5D0E3" />
        </g>
      );
    case 'db':
      return (
        <g transform={`translate(${x},${y})`}>
          <ellipse cx={s * 0.5} cy={s * 0.28} rx={s * 0.34} ry={s * 0.14} fill={SUITE.orange} />
          <path
            d={`M ${s * 0.16} ${s * 0.28} V ${s * 0.68}
              C ${s * 0.16} ${s * 0.8} ${s * 0.84} ${s * 0.8} ${s * 0.84} ${s * 0.68}
              V ${s * 0.28}`}
            fill={SUITE.orangeSoft}
            stroke={SUITE.orangeDeep}
            strokeWidth={1.2}
          />
          <ellipse cx={s * 0.5} cy={s * 0.28} rx={s * 0.34} ry={s * 0.14} fill="none" stroke={SUITE.orangeDeep} strokeWidth={1.2} />
        </g>
      );
    case 'api':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={s * 0.08} y={s * 0.18} width={s * 0.84} height={s * 0.64} rx={3} fill="#0B1220" />
          <path d={`M ${s * 0.28} ${s * 0.4} L ${s * 0.4} ${s * 0.5} L ${s * 0.28} ${s * 0.6}`} fill="none" stroke="#3FCF8E" strokeWidth={1.4} />
          <path d={`M ${s * 0.48} ${s * 0.6} H ${s * 0.72}`} stroke="#fff" strokeWidth={1.4} />
        </g>
      );
    case 'hub':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.2} fill={SUITE.navy} />
          <circle cx={s * 0.5} cy={s * 0.5} r={s * 0.18} fill={SUITE.orange} />
          <circle cx={s * 0.22} cy={s * 0.28} r={s * 0.08} fill="#fff" opacity={0.85} />
          <circle cx={s * 0.78} cy={s * 0.28} r={s * 0.08} fill="#fff" opacity={0.85} />
          <circle cx={s * 0.22} cy={s * 0.72} r={s * 0.08} fill="#fff" opacity={0.85} />
          <circle cx={s * 0.78} cy={s * 0.72} r={s * 0.08} fill="#fff" opacity={0.85} />
        </g>
      );
    case 'ventas':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.2} fill="#E8F5E9" stroke="#2E7D32" strokeWidth={1} />
          <path
            d={`M ${s * 0.22} ${s * 0.68} L ${s * 0.4} ${s * 0.48} L ${s * 0.55} ${s * 0.58} L ${s * 0.78} ${s * 0.3}`}
            fill="none"
            stroke="#2E7D32"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        </g>
      );
    case 'finanzas':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.2} fill="#FFF4DE" stroke={SUITE.orangeDeep} strokeWidth={1} />
          <text
            x={s / 2}
            y={s * 0.72}
            textAnchor="middle"
            fill={SUITE.orangeDeep}
            fontSize={s * 0.68}
            fontWeight={800}
            style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
          >
            $
          </text>
        </g>
      );
    case 'admin':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.2} fill={SUITE.navy} />
          <circle cx={s * 0.5} cy={s * 0.38} r={s * 0.16} fill="#fff" />
          <path
            d={`M ${s * 0.22} ${s * 0.78} C ${s * 0.22} ${s * 0.58} ${s * 0.78} ${s * 0.58} ${s * 0.78} ${s * 0.78}`}
            fill="#fff"
          />
        </g>
      );
    default:
      return null;
  }
}

function NodeBox({
  node,
  selected,
  onSelect,
}: {
  node: MapNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const fill =
    node.kind === 'db'
      ? '#FFFBF3'
      : node.kind === 'runner'
        ? '#F8FAFC'
        : '#FFFFFF';
  const stroke = selected ? SUITE.orange : node.kind === 'db' ? SUITE.orangeDeep : '#D0D7E2';
  const strokeW = selected ? 2.4 : node.kind === 'db' ? 1.8 : 1.2;
  const iconSize = node.stack ? (node.kind === 'db' ? 36 : 32) : 20;
  const font = { fontFamily: 'ui-sans-serif, system-ui, sans-serif' };

  return (
    <g
      role="button"
      tabIndex={0}
      onClick={() => onSelect(node.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={node.stack ? 14 : 10}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
        filter={selected ? 'url(#glow)' : 'url(#cardShadow)'}
      />
      {node.stack ? (
        <>
          <BrandIcon
            kind={node.icon}
            x={node.x + (node.w - iconSize) / 2}
            y={node.y + 14}
            size={iconSize}
          />
          <text
            x={node.x + node.w / 2}
            y={node.y + 14 + iconSize + 18}
            textAnchor="middle"
            fill={SUITE.navy}
            fontSize={12}
            fontWeight={700}
            style={font}
          >
            {node.label}
          </text>
          {node.sub ? (
            <text
              x={node.x + node.w / 2}
              y={node.y + 14 + iconSize + 34}
              textAnchor="middle"
              fill={SUITE.muted}
              fontSize={10}
              style={font}
            >
              {node.sub}
            </text>
          ) : null}
        </>
      ) : (
        <>
          <BrandIcon
            kind={node.icon}
            x={node.x + 14}
            y={node.y + (node.h - iconSize) / 2}
            size={iconSize}
          />
          <text
            x={node.x + 44}
            y={node.y + (node.sub ? node.h / 2 - 4 : node.h / 2 + 4)}
            textAnchor="start"
            fill={SUITE.navy}
            fontSize={12}
            fontWeight={700}
            style={font}
          >
            {node.label}
          </text>
          {node.sub ? (
            <text
              x={node.x + 44}
              y={node.y + node.h / 2 + 14}
              textAnchor="start"
              fill={SUITE.muted}
              fontSize={10}
              style={font}
            >
              {node.sub}
            </text>
          ) : null}
        </>
      )}
    </g>
  );
}

function EdgeLabel({
  x,
  y,
  label,
  accent,
}: {
  x: number;
  y: number;
  label: string;
  accent?: boolean;
}) {
  const w = pillWidth(label);
  const h = 20;
  const fill = accent ? PILL_ACCENT : PILL;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={fill} />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={10}
        fontWeight={600}
        style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
      >
        {label}
      </text>
    </g>
  );
}

export function AdminDataMap() {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>('fr');
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), []);
  const selected = selectedId ? byId.get(selectedId) : undefined;

  return (
    <section
      className="mb-8 overflow-hidden rounded-[20px] bg-white"
      style={{ boxShadow: SUITE.shadow }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-5">
        <div>
          <p
            className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{ color: theme.muted }}
          >
            Mapa de orígenes de datos
          </p>
          <p className="text-sm" style={{ color: theme.muted }}>
            Topología de plataformas, scripts y APIs: Google → GitHub Actions / PC → Supabase →
            Vercel → módulos. Haz clic en un nodo para ver{' '}
            <code className="text-xs">source_file</code> y archivos clave.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: SUITE.navy }}
        >
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {open && (
      <div className="relative">
        <div
          className="overflow-x-auto overflow-y-hidden"
          style={{
            backgroundImage: `radial-gradient(circle, #D8DEE8 0.9px, transparent 0.9px)`,
            backgroundSize: '18px 18px',
            backgroundColor: '#F4F6F9',
          }}
        >
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            width={VIEW_W}
            height={VIEW_H}
            className="min-w-[980px] max-w-none"
            role="img"
            aria-label="Mapa de topología de orígenes de datos del dashboard"
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth={7}
                markerHeight={7}
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE} />
              </marker>
              <marker
                id="arrow-accent"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth={7}
                markerHeight={7}
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE_ACCENT} />
              </marker>
              <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={SUITE.orange} floodOpacity="0.4" />
              </filter>
              <filter id="cardShadow" x="-15%" y="-15%" width="130%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1B2A4A" floodOpacity="0.06" />
              </filter>
            </defs>

            {REGIONS.map((r) => (
              <g key={r.id}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={22}
                  fill={r.id === 'supabase' ? 'rgba(63,207,142,0.08)' : 'rgba(255,255,255,0.75)'}
                  stroke={r.id === 'supabase' ? '#8FD4B0' : '#D5DCE8'}
                  strokeWidth={r.id === 'supabase' ? 1.8 : 1}
                />
                <BrandIcon kind={r.icon} x={r.x + 18} y={r.y + 16} size={18} />
                <text
                  x={r.x + 44}
                  y={r.y + 30}
                  textAnchor="start"
                  fill={SUITE.navy}
                  fontSize={13}
                  fontWeight={800}
                  style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
                >
                  {r.label}
                </text>
                {r.sub ? (
                  <text
                    x={r.x + 44}
                    y={r.y + 46}
                    textAnchor="start"
                    fill={SUITE.muted}
                    fontSize={10}
                    style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
                  >
                    {r.sub}
                  </text>
                ) : null}
              </g>
            ))}

            {EDGES.map((edge) => {
              const pts = edgePoints(edge, byId);
              if (!pts) return null;
              const d = roundedOrthoPath(pts);
              const [lx, ly] = labelPoint(edge, pts);
              const stroke = edge.accent ? LINE_ACCENT : LINE;
              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={edge.accent ? 3.2 : 2.8}
                    strokeDasharray={edge.dashed ? '7 5' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={edge.accent ? 'url(#arrow-accent)' : 'url(#arrow)'}
                    opacity={0.95}
                  />
                  <EdgeLabel x={lx} y={ly} label={edge.label} accent={edge.accent} />
                </g>
              );
            })}

            {NODES.map((node) => (
              <NodeBox
                key={node.id}
                node={node}
                selected={selectedId === node.id}
                onSelect={setSelectedId}
              />
            ))}

            <g>
              <rect x={40} y={812} width={540} height={32} rx={16} fill="#FFFFFF" stroke="#D5DCE8" />
              <circle cx={60} cy={828} r={4} fill={LINE} />
              <text
                x={72}
                y={832}
                fill={SUITE.muted}
                fontSize={11}
                style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
              >
                Flujo L→R · píldora naranja = escritura · punteada = opcional/legacy
              </text>
            </g>
          </svg>
        </div>

        <div className="border-t border-slate-100 bg-white px-5 py-3.5">
          {selected ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: theme.muted }}>
                  Nodo seleccionado
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden>
                    <BrandIcon kind={selected.icon} x={2} y={2} size={18} />
                  </svg>
                  <p className="text-base font-bold" style={{ color: SUITE.navy }}>
                    {selected.label}
                    {selected.sub ? (
                      <span className="ml-2 text-sm font-normal" style={{ color: theme.muted }}>
                        {selected.sub}
                      </span>
                    ) : null}
                  </p>
                </div>
                {selected.detail ? (
                  <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                    {selected.detail}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold" style={{ color: SUITE.navy }}>
                    source_file
                  </p>
                  {selected.sources?.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {selected.sources.map((s) => (
                        <li
                          key={s}
                          className="rounded-md px-2 py-0.5 font-mono text-[11px]"
                          style={{ background: SUITE.orangeSoft, color: SUITE.navy }}
                        >
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs" style={{ color: theme.muted }}>
                      —
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold" style={{ color: SUITE.navy }}>
                    Archivos / rutas
                  </p>
                  {selected.files?.length ? (
                    <ul className="space-y-0.5">
                      {selected.files.map((f) => (
                        <li key={f} className="font-mono text-[11px]" style={{ color: theme.muted }}>
                          {f}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs" style={{ color: theme.muted }}>
                      —
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: theme.muted }}>
              Selecciona un nodo del diagrama.
            </p>
          )}
        </div>
      </div>
      )}
    </section>
  );
}
