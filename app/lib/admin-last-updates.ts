/**
 * Última actualización por área (mapa Admin + inventario).
 * Fuente principal: max(financial_records.created_at) por source_file;
 * RR.HH.: hr_drive_sync_state.last_synced_at o max(updated_at) en hr_*.
 */

import { SOURCE_FILE_GROUPS } from '@/app/lib/admin-resources';
import type { DetectedSourceFile } from '@/app/lib/storage-format';

export type AreaUpdateMode = 'cloud' | 'manual' | 'mixed';

export type AdminUpdateAreaDef = {
  id: string;
  label: string;
  /** source_file de financial_records (vacío si solo RH). */
  sources: string[];
  mode: AreaUpdateMode;
  /** Nodos del AdminDataMap que muestran este timestamp. */
  mapNodeIds: string[];
  /** Incluir timestamp RR.HH. (sync state / tablas hr_*). */
  includeHr?: boolean;
};

/** Áreas operativas donde tiene sentido mostrar «última act.». */
export const ADMIN_UPDATE_AREAS: AdminUpdateAreaDef[] = [
  {
    id: 'ventas',
    label: 'Ventas (Infocaja · CORTE)',
    sources: ['infocaja', 'corte_caja'],
    mode: 'cloud',
    mapNodeIds: ['gmail', 'wf-gmail', 'ventas'],
  },
  {
    id: 'facturas',
    label: 'Facturas CFDI',
    sources: ['factura_cfdi'],
    mode: 'cloud',
    mapNodeIds: ['ingest-facturas'],
  },
  {
    id: 'flujo',
    label: 'Saldos / flujo',
    sources: ['flujo_efectivo_saldo', 'flujo_efectivo_semana', 'flujo_efectivo_mov'],
    mode: 'cloud',
    mapNodeIds: ['wf-saldos', 'drive'],
  },
  {
    id: 'cxp_vivo',
    label: 'CxP por pagar',
    sources: ['cxp_por_pagar'],
    mode: 'cloud',
    mapNodeIds: ['sheets'],
  },
  {
    id: 'cxp_hist',
    label: 'CxP líneas / saldos',
    sources: ['cxp', 'cxp_saldos'],
    mode: 'manual',
    mapNodeIds: ['ingest-cxp'],
  },
  {
    id: 'presupuesto',
    label: 'Presupuesto',
    sources:
      SOURCE_FILE_GROUPS.find((g) => g.id === 'presupuesto')?.sources ?? [],
    mode: 'manual',
    mapNodeIds: ['ingest-prep'],
  },
  {
    id: 'bancos',
    label: 'Bancos / estados',
    sources: SOURCE_FILE_GROUPS.find((g) => g.id === 'bancos')?.sources ?? [],
    mode: 'manual',
    mapNodeIds: ['ingest-estados'],
  },
  {
    id: 'eventos',
    label: 'Eventos (legacy)',
    sources: ['eventos'],
    mode: 'manual',
    mapNodeIds: ['eventos'],
  },
  {
    id: 'ventas_semana',
    label: 'Ventas semana',
    sources: ['ventas_semana'],
    mode: 'manual',
    mapNodeIds: [],
  },
  {
    id: 'rrhh',
    label: 'Recursos Humanos',
    sources: [],
    mode: 'cloud',
    includeHr: true,
    mapNodeIds: ['wf-hr', 'hr-db', 'hr-downloads', 'api-hr', 'rrhh'],
  },
  {
    id: 'auth',
    label: 'Auth / usuarios',
    sources: ['dashboard_auth'],
    mode: 'manual',
    mapNodeIds: ['api-users'],
  },
];

/** Inventario: branch.id → área de última act. */
export const INVENTORY_BRANCH_AREA: Record<string, string> = {
  'supabase-ventas': 'ventas',
  'supabase-flujo': 'flujo',
  'supabase-presupuesto': 'presupuesto',
  'supabase-bancos': 'bancos',
  'supabase-cxp': 'cxp_vivo',
  'supabase-facturas': 'facturas',
  'supabase-auth': 'auth',
  'supabase-hr': 'rrhh',
  'drive-admin': 'flujo',
  'drive-facturas': 'facturas',
  'drive-eventos': 'eventos',
  'drive-rh': 'rrhh',
  'drive-presupuestos': 'presupuesto',
  'gmail-infocaja': 'ventas',
  'gmail-corte': 'ventas',
  'gmail-facturas': 'facturas',
  'repo-workflows': 'ventas',
  'drive-sheets-cxp': 'cxp_vivo',
  'sheets-cxp': 'cxp_vivo',
};

export type AreaLastUpdate = {
  id: string;
  label: string;
  mode: AreaUpdateMode;
  /** ISO timestamptz de la última ingestión / sync, o null. */
  lastAt: string | null;
  /** Texto listo para UI (CDMX, es-MX). */
  display: string;
  /** Versión corta para nodos del mapa. */
  shortDisplay: string;
  source: 'financial_records.created_at' | 'hr_drive_sync_state' | 'hr_tables' | 'none';
};

const CDMX = 'America/Mexico_City';

/** «2 ago 2026, 4:02 a. m.» en CDMX. */
export function formatTimestampCdmx(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleString('es-MX', {
      timeZone: CDMX,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\u202f/g, ' ');
}

/** Corto: «2 ago, 4:02 a. m.» */
export function formatTimestampCdmxShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleString('es-MX', {
      timeZone: CDMX,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\u202f/g, ' ');
}

export function emptyLastUpdateLabel(mode: AreaUpdateMode): string {
  return mode === 'manual' || mode === 'mixed'
    ? 'Manual / sin sync cloud'
    : 'Sin registro';
}

export function formatUltimaAct(
  iso: string | null | undefined,
  mode: AreaUpdateMode = 'cloud',
): { display: string; shortDisplay: string } {
  if (!iso) {
    const empty = emptyLastUpdateLabel(mode);
    return { display: empty, shortDisplay: empty };
  }
  const full = formatTimestampCdmx(iso);
  const short = formatTimestampCdmxShort(iso);
  if (!full) {
    const empty = emptyLastUpdateLabel(mode);
    return { display: empty, shortDisplay: empty };
  }
  return {
    display: `Última act.: ${full}`,
    shortDisplay: short,
  };
}

function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b || null;
  if (!b) return a;
  return a >= b ? a : b;
}

export type HrLastUpdateProbe = {
  lastAt: string | null;
  source: 'hr_drive_sync_state' | 'hr_tables' | 'none';
};

/**
 * Agrega timestamps por área a partir de detección FR + sonda RH.
 */
export function buildAreaLastUpdates(
  detected: DetectedSourceFile[],
  hr: HrLastUpdateProbe,
): AreaLastUpdate[] {
  const bySource = new Map(
    detected.map((d) => [d.sourceFile, d] as const),
  );

  return ADMIN_UPDATE_AREAS.map((area) => {
    let lastAt: string | null = null;
    let source: AreaLastUpdate['source'] = 'none';

    for (const sf of area.sources) {
      const hit = bySource.get(sf);
      const ts = hit?.lastIngestedAt ?? null;
      if (ts && (!lastAt || ts > lastAt)) {
        lastAt = ts;
        source = 'financial_records.created_at';
      }
    }

    if (area.includeHr && hr.lastAt) {
      if (!lastAt || hr.lastAt > lastAt) {
        lastAt = hr.lastAt;
        source = hr.source === 'none' ? 'hr_tables' : hr.source;
      }
    }

    const { display, shortDisplay } = formatUltimaAct(lastAt, area.mode);
    return {
      id: area.id,
      label: area.label,
      mode: area.mode,
      lastAt,
      display,
      shortDisplay,
      source: lastAt ? source : 'none',
    };
  });
}

/** Mapa nodeId → área (primera coincidencia). */
export function areaByMapNodeId(): Map<string, string> {
  const m = new Map<string, string>();
  for (const area of ADMIN_UPDATE_AREAS) {
    for (const nid of area.mapNodeIds) {
      if (!m.has(nid)) m.set(nid, area.id);
    }
  }
  // wf-saldos alimenta flujo + cxp_vivo → usar el más reciente en UI vía compose
  return m;
}

/**
 * Para nodos que tocan varias áreas (p.ej. wf-saldos), toma el max lastAt.
 */
export function lastUpdateForMapNode(
  nodeId: string,
  areas: AreaLastUpdate[],
): AreaLastUpdate | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const multi: Record<string, string[]> = {
    'wf-saldos': ['flujo', 'cxp_vivo'],
    drive: ['flujo', 'presupuesto', 'bancos', 'rrhh'],
    gmail: ['ventas', 'facturas'],
    fr: areas.map((a) => a.id),
  };
  const ids = multi[nodeId] ?? (areaByMapNodeId().get(nodeId) ? [areaByMapNodeId().get(nodeId)!] : []);
  if (!ids.length) return null;

  let best: AreaLastUpdate | null = null;
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    if (!best) {
      best = a;
      continue;
    }
    const mergedAt = maxIso(best.lastAt, a.lastAt);
    if (mergedAt !== best.lastAt) {
      const fmt = formatUltimaAct(mergedAt, best.mode === 'manual' && a.mode === 'manual' ? 'manual' : 'mixed');
      best = {
        ...best,
        id: `${best.id}+${a.id}`,
        label: `${best.label} · ${a.label}`,
        mode: 'mixed',
        lastAt: mergedAt,
        display: fmt.display,
        shortDisplay: fmt.shortDisplay,
        source: a.source !== 'none' ? a.source : best.source,
      };
    } else if (!best.lastAt && a.lastAt) {
      best = a;
    }
  }
  return best;
}

export function lastUpdateForInventoryBranch(
  branchId: string,
  areas: AreaLastUpdate[],
): AreaLastUpdate | null {
  // CxP branch: vivo (cloud) gana si hay; si no, hist
  if (branchId === 'supabase-cxp' || branchId === 'sheets-cxp') {
    const vivo = areas.find((a) => a.id === 'cxp_vivo');
    const hist = areas.find((a) => a.id === 'cxp_hist');
    if (vivo?.lastAt && hist?.lastAt) {
      return vivo.lastAt >= hist.lastAt ? vivo : hist;
    }
    return vivo?.lastAt ? vivo : hist ?? vivo ?? null;
  }
  if (branchId === 'repo-workflows') {
    const cloud = ['ventas', 'flujo', 'cxp_vivo', 'facturas', 'rrhh']
      .map((id) => areas.find((a) => a.id === id))
      .filter((a): a is AreaLastUpdate => Boolean(a));
    let best: AreaLastUpdate | null = null;
    for (const a of cloud) {
      if (!best || (a.lastAt && (!best.lastAt || a.lastAt > best.lastAt))) best = a;
    }
    return best;
  }
  const areaId = INVENTORY_BRANCH_AREA[branchId];
  if (!areaId) return null;
  return areas.find((a) => a.id === areaId) ?? null;
}
