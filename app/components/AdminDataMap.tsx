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

const VIEW_W = 1480;
const VIEW_H = 820;
const EDGE_R = 14;
const LINE = '#A8B0BD';
const LINE_ACCENT = SUITE.orangeDeep;
const PILL = '#7A8494';
const PILL_ACCENT = SUITE.orangeDeep;

const REGIONS: Region[] = [
  { id: 'google', label: 'Google', sub: 'fuentes externas', x: 36, y: 48, w: 220, h: 700, icon: 'google' },
  { id: 'github', label: 'GitHub Actions', sub: 'orquestación cloud', x: 320, y: 48, w: 250, h: 400, icon: 'github' },
  { id: 'local', label: 'PC local', sub: 'manual / opcional', x: 320, y: 480, w: 250, h: 268, icon: 'pc' },
  { id: 'supabase', label: 'Supabase', sub: 'hub · persistencia', x: 650, y: 160, w: 260, h: 460, icon: 'supabase' },
  { id: 'vercel', label: 'Vercel', sub: 'dashboard-c50.vercel.app', x: 980, y: 48, w: 230, h: 700, icon: 'vercel' },
  { id: 'browser', label: 'Navegador', sub: 'módulos del suite', x: 1260, y: 48, w: 190, h: 700, icon: 'browser' },
];

const NODES: MapNode[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    sub: 'Infocaja + CORTE',
    x: 68,
    y: 110,
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
    sub: 'Presupuesto + Flujo',
    x: 68,
    y: 260,
    w: 156,
    h: 108,
    kind: 'system',
    icon: 'drive',
    stack: true,
    sources: ['presupuesto_*', 'flujo_efectivo_saldo'],
    files: ['ingest_presupuesto.py', 'ingest_saldos_flujo.py'],
    detail: 'PRESUPUESTO MENSUAL y FLUJO EFECTIVO CARRANZA 50.xlsx en Drive.',
  },
  {
    id: 'sheets',
    label: 'Sheets',
    sub: 'CXP proveedores',
    x: 68,
    y: 410,
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
    x: 68,
    y: 560,
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
    y: 110,
    w: 194,
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
    y: 220,
    w: 194,
    h: 72,
    kind: 'runner',
    icon: 'github',
    files: ['.github/workflows/sync-saldos.yml', 'sync_saldos_al_dia.py'],
    detail: 'GitHub Actions cada 5 min: efectivo (Drive) + CXP (Sheets) → Supabase.',
  },
  {
    id: 'ingestor-cloud',
    label: 'ingestor/',
    sub: 'Python · OAuth',
    x: 348,
    y: 330,
    w: 194,
    h: 72,
    kind: 'runner',
    icon: 'python',
    files: ['google_auth.py', 'requirements.txt', 'sync_gmail_diario.py', 'sync_saldos_al_dia.py'],
    detail: 'Scripts Python en el runner ubuntu-latest con secrets del repo.',
  },
  {
    id: 'ingest-prep',
    label: 'ingest_presupuesto',
    sub: 'carga manual',
    x: 348,
    y: 530,
    w: 194,
    h: 72,
    kind: 'runner',
    icon: 'python',
    sources: ['presupuesto_mensual', 'presupuesto_saldos', 'presupuesto_rubro', 'presupuesto_semana'],
    files: ['ingest_presupuesto.py'],
    detail: 'Lee Excel de presupuesto (Drive/local) y escribe rubros, saldos y semanas.',
  },
  {
    id: 'win-tasks',
    label: 'Tareas Windows',
    sub: 'deshabilitadas',
    x: 348,
    y: 640,
    w: 194,
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
    y: 250,
    w: 200,
    h: 130,
    kind: 'db',
    icon: 'db',
    stack: true,
    sources: [
      'infocaja',
      'corte_caja',
      'eventos',
      'flujo_efectivo_saldo',
      'cxp_por_pagar',
      'presupuesto_mensual',
      'presupuesto_saldos',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_ajuste',
      'dashboard_auth',
    ],
    detail: 'Almacén central. Cada fila lleva source_file para filtrar por dashboard.',
  },
  {
    id: 'sb-auth',
    label: 'Auth service role',
    sub: 'escritura / admin',
    x: 700,
    y: 450,
    w: 160,
    h: 100,
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
    x: 1010,
    y: 120,
    w: 170,
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
    x: 1010,
    y: 280,
    w: 170,
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
    x: 1010,
    y: 440,
    w: 170,
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
    x: 1010,
    y: 600,
    w: 170,
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
    x: 1290,
    y: 120,
    w: 130,
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
    x: 1290,
    y: 270,
    w: 130,
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
    x: 1290,
    y: 420,
    w: 130,
    h: 100,
    kind: 'ui',
    icon: 'finanzas',
    stack: true,
    sources: [
      'presupuesto_mensual',
      'presupuesto_saldos',
      'presupuesto_rubro',
      'presupuesto_semana',
      'presupuesto_ajuste',
      'flujo_efectivo_saldo',
      'cxp_por_pagar',
    ],
    files: ['app/finanzas/page.tsx', 'app/lib/presupuesto.ts', 'app/lib/saldos.ts'],
    detail: 'Saldos al día, resumen semanal bancos, presupuesto vs real por rubro.',
  },
  {
    id: 'admin',
    label: 'Admin',
    sub: '/admin',
    x: 1290,
    y: 570,
    w: 130,
    h: 100,
    kind: 'ui',
    icon: 'admin',
    stack: true,
    sources: ['presupuesto_ajuste', 'dashboard_auth'],
    files: ['app/admin/page.tsx', 'AdminPresupuestoAjustes.tsx'],
    detail: 'Usuarios, ajustes de presupuesto y este mapa de orígenes.',
  },
];

/**
 * Simplified topology: fewer crossings, dedicated corridors between columns.
 * Corridor X: Google→runners ~292 | runners→SB ~600 | SB→Vercel ~940 | Vercel→UI ~1235
 */
const EDGES: MapEdge[] = [
  {
    id: 'e-gmail-wf',
    from: 'gmail',
    to: 'wf-gmail',
    label: 'Gmail API',
    via: [
      [292, 164],
      [292, 146],
    ],
    labelAt: [292, 155],
  },
  {
    id: 'e-drive-wf',
    from: 'drive',
    to: 'wf-saldos',
    label: 'Drive API',
    via: [
      [292, 300],
      [292, 256],
    ],
    labelAt: [292, 278],
  },
  {
    id: 'e-sheets-wf',
    from: 'sheets',
    to: 'wf-saldos',
    label: 'Sheets API',
    via: [
      [280, 464],
      [280, 270],
      [348, 270],
    ],
    labelAt: [280, 370],
  },
  {
    id: 'e-drive-prep',
    from: 'drive',
    to: 'ingest-prep',
    label: 'Excel',
    via: [
      [268, 330],
      [268, 566],
    ],
    labelAt: [268, 450],
  },
  {
    id: 'e-ing-fr',
    from: 'ingestor-cloud',
    to: 'fr',
    label: 'upsert',
    via: [
      [610, 366],
      [610, 300],
    ],
    labelAt: [610, 333],
    accent: true,
  },
  {
    id: 'e-prep-fr',
    from: 'ingest-prep',
    to: 'fr',
    label: 'presupuesto_*',
    via: [
      [590, 566],
      [590, 380],
    ],
    labelAt: [590, 480],
    accent: true,
  },
  {
    id: 'e-eventos-fr',
    from: 'eventos',
    to: 'fr',
    label: 'ingest_eventos',
    dashed: true,
    via: [
      [250, 614],
      [250, 740],
      [780, 740],
      [780, 380],
    ],
    labelAt: [515, 740],
  },
  {
    id: 'e-fr-api',
    from: 'fr',
    to: 'api-fr',
    label: 'SELECT',
    via: [
      [945, 290],
      [945, 170],
    ],
    labelAt: [945, 230],
  },
  {
    id: 'e-api-aj-fr',
    from: 'api-ajustes',
    to: 'fr',
    label: 'PUT ajuste',
    via: [
      [945, 330],
      [880, 330],
    ],
    labelAt: [912, 330],
    accent: true,
  },
  {
    id: 'e-api-users-fr',
    from: 'api-users',
    to: 'fr',
    label: 'dashboard_auth',
    via: [
      [960, 490],
      [960, 390],
      [880, 390],
    ],
    labelAt: [960, 440],
  },
  {
    id: 'e-api-hub',
    from: 'api-fr',
    to: 'hub',
    label: 'sesión',
    labelAt: [1235, 150],
  },
  {
    id: 'e-api-ventas',
    from: 'api-fr',
    to: 'ventas',
    label: 'GET',
    via: [
      [1215, 180],
      [1215, 320],
    ],
    labelAt: [1215, 250],
  },
  {
    id: 'e-api-fin',
    from: 'api-fr',
    to: 'finanzas',
    label: 'GET sources',
    via: [
      [1238, 185],
      [1238, 470],
    ],
    labelAt: [1238, 360],
  },
  {
    id: 'e-admin-aj',
    from: 'admin',
    to: 'api-ajustes',
    label: 'ajustes',
    via: [
      [1260, 620],
      [1260, 330],
      [1180, 330],
    ],
    labelAt: [1260, 475],
    accent: true,
  },
  {
    id: 'e-admin-users',
    from: 'admin',
    to: 'api-users',
    label: 'usuarios',
    via: [
      [1275, 640],
      [1275, 490],
      [1180, 490],
    ],
    labelAt: [1275, 565],
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
  switch (kind) {
    case 'gmail':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.18} fill="#fff" stroke="#E8EAED" strokeWidth={0.8} />
          <path
            d={`M ${s * 0.18} ${s * 0.28} L ${s * 0.5} ${s * 0.52} L ${s * 0.82} ${s * 0.28}`}
            fill="none"
            stroke="#EA4335"
            strokeWidth={s * 0.1}
            strokeLinejoin="round"
          />
          <path
            d={`M ${s * 0.18} ${s * 0.28} V ${s * 0.72} H ${s * 0.82} V ${s * 0.28}`}
            fill="none"
            stroke="#4285F4"
            strokeWidth={s * 0.08}
          />
          <path d={`M ${s * 0.18} ${s * 0.28} L ${s * 0.5} ${s * 0.52}`} stroke="#34A853" strokeWidth={s * 0.08} />
          <path d={`M ${s * 0.82} ${s * 0.28} L ${s * 0.5} ${s * 0.52}`} stroke="#FBBC05" strokeWidth={s * 0.08} />
        </g>
      );
    case 'drive':
      return (
        <g transform={`translate(${x},${y})`}>
          <path d={`M ${s * 0.5} ${s * 0.08} L ${s * 0.88} ${s * 0.74} H ${s * 0.12} Z`} fill="#4285F4" opacity={0.9} />
          <path d={`M ${s * 0.5} ${s * 0.08} L ${s * 0.12} ${s * 0.74} L ${s * 0.5} ${s * 0.74} Z`} fill="#0F9D58" />
          <path d={`M ${s * 0.5} ${s * 0.08} L ${s * 0.88} ${s * 0.74} L ${s * 0.5} ${s * 0.74} Z`} fill="#F4B400" />
          <path d={`M ${s * 0.22} ${s * 0.74} H ${s * 0.78} L ${s * 0.5} ${s * 0.42} Z`} fill="#4285F4" />
        </g>
      );
    case 'sheets':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.14} fill="#0F9D58" />
          <rect x={s * 0.22} y={s * 0.2} width={s * 0.56} height={s * 0.6} rx={1} fill="#fff" />
          <path
            d={`M ${s * 0.22} ${s * 0.4} H ${s * 0.78} M ${s * 0.22} ${s * 0.55} H ${s * 0.78} M ${s * 0.5} ${s * 0.2} V ${s * 0.8}`}
            stroke="#0F9D58"
            strokeWidth={s * 0.07}
          />
        </g>
      );
    case 'eventos':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect width={s} height={s} rx={s * 0.14} fill="#1A73E8" />
          <rect x={s * 0.2} y={s * 0.28} width={s * 0.6} height={s * 0.52} rx={1.5} fill="#fff" />
          <rect x={s * 0.2} y={s * 0.18} width={s * 0.6} height={s * 0.14} fill="#174EA6" />
          <circle cx={s * 0.35} cy={s * 0.48} r={s * 0.06} fill="#1A73E8" />
          <circle cx={s * 0.5} cy={s * 0.48} r={s * 0.06} fill="#1A73E8" />
          <circle cx={s * 0.65} cy={s * 0.48} r={s * 0.06} fill="#1A73E8" />
          <circle cx={s * 0.35} cy={s * 0.64} r={s * 0.06} fill="#1A73E8" />
          <circle cx={s * 0.5} cy={s * 0.64} r={s * 0.06} fill="#1A73E8" />
        </g>
      );
    case 'github':
      return (
        <g transform={`translate(${x},${y}) scale(${s / 16})`}>
          <circle cx={8} cy={8} r={8} fill="#24292F" />
          <path
            fill="#fff"
            d="M8 3.2c-2.65 0-4.8 2.15-4.8 4.8 0 2.12 1.38 3.92 3.28 4.55.24.04.33-.1.33-.23v-.9c-1.34.29-1.62-.57-1.62-.57-.22-.55-.53-.7-.53-.7-.44-.3.03-.29.03-.29.48.03.73.5.73.5.43.73 1.12.52 1.4.4.04-.31.17-.52.3-.64-1.07-.12-2.2-.53-2.2-2.38 0-.52.19-.95.5-1.29-.05-.12-.22-.62.05-1.28 0 0 .4-.13 1.32.49.38-.1.79-.16 1.2-.16s.82.06 1.2.16c.91-.62 1.31-.49 1.31-.49.27.66.1 1.16.05 1.28.31.34.5.77.5 1.29 0 1.85-1.13 2.26-2.21 2.38.17.15.33.44.33.88v1.31c0 .13.09.27.33.23A4.8 4.8 0 0012.8 8c0-2.65-2.15-4.8-4.8-4.8z"
          />
        </g>
      );
    case 'supabase':
      return (
        <g transform={`translate(${x},${y})`}>
          <path
            d={`M ${s * 0.72} ${s * 0.08}
              C ${s * 0.78} ${s * 0.08} ${s * 0.82} ${s * 0.15} ${s * 0.78} ${s * 0.2}
              L ${s * 0.3} ${s * 0.88}
              C ${s * 0.25} ${s * 0.96} ${s * 0.12} ${s * 0.92} ${s * 0.14} ${s * 0.82}
              L ${s * 0.28} ${s * 0.42} H ${s * 0.62}
              C ${s * 0.7} ${s * 0.42} ${s * 0.74} ${s * 0.32} ${s * 0.68} ${s * 0.26}
              L ${s * 0.72} ${s * 0.08} Z`}
            fill="#3ECF8E"
          />
          <path
            d={`M ${s * 0.62} ${s * 0.42} H ${s * 0.28} L ${s * 0.36} ${s * 0.08}
              C ${s * 0.38} ${s * 0.02} ${s * 0.48} ${s * 0.02} ${s * 0.5} ${s * 0.08}
              L ${s * 0.68} ${s * 0.26}
              C ${s * 0.74} ${s * 0.32} ${s * 0.7} ${s * 0.42} ${s * 0.62} ${s * 0.42} Z`}
            fill="#3ECF8E"
            opacity={0.55}
          />
        </g>
      );
    case 'vercel':
      return (
        <g transform={`translate(${x},${y})`}>
          <path d={`M ${s * 0.5} ${s * 0.12} L ${s * 0.9} ${s * 0.88} H ${s * 0.1} Z`} fill="#000" />
        </g>
      );
    case 'nextjs':
      return (
        <g transform={`translate(${x},${y})`}>
          <circle cx={s / 2} cy={s / 2} r={s / 2} fill="#000" />
          <path
            d={`M ${s * 0.32} ${s * 0.28} V ${s * 0.72} H ${s * 0.42} V ${s * 0.48}
              L ${s * 0.68} ${s * 0.72} H ${s * 0.8} L ${s * 0.48} ${s * 0.4}
              V ${s * 0.28} Z`}
            fill="#fff"
          />
        </g>
      );
    case 'google':
      return (
        <g transform={`translate(${x},${y})`}>
          <circle cx={s * 0.5} cy={s * 0.5} r={s * 0.42} fill="#fff" stroke="#E8EAED" strokeWidth={0.8} />
          <path d={`M ${s * 0.72} ${s * 0.5} H ${s * 0.5} V ${s * 0.38} H ${s * 0.78}`} fill="none" stroke="#4285F4" strokeWidth={s * 0.1} />
          <path d={`M ${s * 0.5} ${s * 0.72} A ${s * 0.22} ${s * 0.22} 0 1 1 ${s * 0.68} ${s * 0.36}`} fill="none" stroke="#EA4335" strokeWidth={s * 0.1} />
          <path d={`M ${s * 0.32} ${s * 0.62} A ${s * 0.22} ${s * 0.22} 0 0 1 ${s * 0.5} ${s * 0.28}`} fill="none" stroke="#FBBC05" strokeWidth={s * 0.1} />
          <path d={`M ${s * 0.32} ${s * 0.38} A ${s * 0.22} ${s * 0.22} 0 0 0 ${s * 0.5} ${s * 0.72}`} fill="none" stroke="#34A853" strokeWidth={s * 0.1} />
        </g>
      );
    case 'pc':
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={s * 0.12} y={s * 0.18} width={s * 0.76} height={s * 0.52} rx={2} fill="none" stroke={SUITE.navy} strokeWidth={1.4} />
          <rect x={s * 0.2} y={s * 0.26} width={s * 0.6} height={s * 0.34} fill="#D6E0EF" />
          <path d={`M ${s * 0.28} ${s * 0.78} H ${s * 0.72} M ${s * 0.5} ${s * 0.7} V ${s * 0.78}`} stroke={SUITE.navy} strokeWidth={1.4} />
        </g>
      );
    case 'windows':
      return (
        <g transform={`translate(${x},${y})`}>
          <path d={`M ${s * 0.14} ${s * 0.22} H ${s * 0.46} V ${s * 0.48} H ${s * 0.14} Z`} fill="#0078D4" />
          <path d={`M ${s * 0.52} ${s * 0.22} H ${s * 0.86} V ${s * 0.48} H ${s * 0.52} Z`} fill="#00A4EF" />
          <path d={`M ${s * 0.14} ${s * 0.54} H ${s * 0.46} V ${s * 0.8} H ${s * 0.14} Z`} fill="#FFB900" />
          <path d={`M ${s * 0.52} ${s * 0.54} H ${s * 0.86} V ${s * 0.8} H ${s * 0.52} Z`} fill="#7FBA00" />
        </g>
      );
    case 'python':
      return (
        <g transform={`translate(${x},${y})`}>
          <path
            d={`M ${s * 0.5} ${s * 0.1}
              C ${s * 0.28} ${s * 0.1} ${s * 0.28} ${s * 0.28} ${s * 0.28} ${s * 0.28}
              V ${s * 0.42} H ${s * 0.58} V ${s * 0.46} H ${s * 0.22}
              C ${s * 0.1} ${s * 0.46} ${s * 0.1} ${s * 0.62} ${s * 0.22} ${s * 0.62}
              H ${s * 0.34} V ${s * 0.52} H ${s * 0.72}
              C ${s * 0.86} ${s * 0.52} ${s * 0.86} ${s * 0.36} ${s * 0.72} ${s * 0.36}
              H ${s * 0.5} V ${s * 0.28}
              C ${s * 0.5} ${s * 0.18} ${s * 0.62} ${s * 0.18} ${s * 0.72} ${s * 0.18}
              H ${s * 0.78} V ${s * 0.1} Z`}
            fill="#3776AB"
          />
          <circle cx={s * 0.4} cy={s * 0.22} r={Math.max(1.2, s * 0.06)} fill="#FFD43B" />
          <path
            d={`M ${s * 0.5} ${s * 0.9}
              C ${s * 0.72} ${s * 0.9} ${s * 0.72} ${s * 0.72} ${s * 0.72} ${s * 0.72}
              V ${s * 0.58} H ${s * 0.42} V ${s * 0.54} H ${s * 0.78}
              C ${s * 0.9} ${s * 0.54} ${s * 0.9} ${s * 0.38} ${s * 0.78} ${s * 0.38}
              H ${s * 0.66} V ${s * 0.48} H ${s * 0.28}
              C ${s * 0.14} ${s * 0.48} ${s * 0.14} ${s * 0.64} ${s * 0.28} ${s * 0.64}
              H ${s * 0.5} V ${s * 0.72}
              C ${s * 0.5} ${s * 0.82} ${s * 0.38} ${s * 0.82} ${s * 0.28} ${s * 0.82}
              H ${s * 0.22} V ${s * 0.9} Z`}
            fill="#FFD43B"
          />
          <circle cx={s * 0.6} cy={s * 0.78} r={Math.max(1.2, s * 0.06)} fill="#3776AB" />
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
          <path d={`M ${s * 0.28} ${s * 0.4} L ${s * 0.4} ${s * 0.5} L ${s * 0.28} ${s * 0.6}`} fill="none" stroke="#3ECF8E" strokeWidth={1.4} />
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
  const [selectedId, setSelectedId] = useState<string | null>('fr');
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), []);
  const selected = selectedId ? byId.get(selectedId) : undefined;

  return (
    <section
      className="mb-8 overflow-hidden rounded-[20px] bg-white"
      style={{ boxShadow: SUITE.shadow }}
    >
      <div className="border-b border-slate-100 px-5 pb-3 pt-5">
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
                  fill={r.id === 'supabase' ? 'rgba(62,207,142,0.06)' : 'rgba(255,255,255,0.72)'}
                  stroke={r.id === 'supabase' ? '#9DD9BE' : '#D5DCE8'}
                  strokeWidth={r.id === 'supabase' ? 1.6 : 1}
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
              <rect x={36} y={770} width={520} height={32} rx={16} fill="#FFFFFF" stroke="#D5DCE8" />
              <circle cx={56} cy={786} r={4} fill={LINE} />
              <text
                x={68}
                y={790}
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
    </section>
  );
}
