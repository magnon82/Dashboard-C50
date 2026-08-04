/** Tipos y helpers — Carta de resguardo C50 (Formato de resguardo_C50.xlsx). */

export type HrResguardoKind =
  | 'equipo'
  | 'herramientas'
  | 'uniforme'
  | 'llaves';

export type HrResguardoStatus =
  | 'pendiente'
  | 'entregado'
  | 'devuelto'
  | 'cancelado';

export type HrResguardoItem = {
  cantidad: number;
  concepto: string;
  marca?: string;
  modelo?: string;
  numero_serie?: string;
  precio?: number | null;
};

export type HrResguardoPayload = {
  form_version: string;
  lugar_fecha?: string;
  nombre: string;
  /** @deprecated Ya no se captura en UI; se conserva por cartas antiguas. */
  rfc?: string;
  puesto?: string;
  email?: string;
  telefono?: string;
  domicilio?: string;
  fecha_asignacion?: string;
  fecha_resguardo?: string;
  receptor_nombre?: string;
  receptor_puesto?: string;
  emisor_nombre?: string;
  emisor_puesto?: string;
  acepta_condiciones: boolean;
  acepta_danio_parcial?: boolean;
  acepta_perdida_total?: boolean;
  observaciones?: string;
  /** Fallback si columnas accepted_* no existen aún. */
  empleado_aceptado_at?: string;
  empleado_aceptado_por?: string;
};

export type HrResguardoRequest = {
  id: string;
  folio: string | null;
  employee_id: string | null;
  kind: HrResguardoKind;
  status: HrResguardoStatus;
  payload: HrResguardoPayload;
  items: HrResguardoItem[];
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** Aceptación del colaborador (Staff). Null = pendiente de aceptar. */
  accepted_at: string | null;
  accepted_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const HR_RESGUARDO_SELECT =
  'id, folio, employee_id, kind, status, payload, items, requested_by, reviewed_by, reviewed_at, accepted_at, accepted_by, notes, created_at, updated_at';

export const HR_RESGUARDO_SELECT_LEGACY =
  'id, folio, employee_id, kind, status, payload, items, requested_by, reviewed_by, reviewed_at, notes, created_at, updated_at';

export function asResguardoRequest(row: Record<string, unknown>): HrResguardoRequest {
  const payload = (row.payload || {}) as HrResguardoPayload;
  const acceptedAtCol =
    row.accepted_at != null ? String(row.accepted_at) : null;
  const acceptedByCol =
    row.accepted_by != null ? String(row.accepted_by) : null;
  const acceptedAtFallback =
    payload.empleado_aceptado_at != null
      ? String(payload.empleado_aceptado_at)
      : null;
  const acceptedByFallback =
    payload.empleado_aceptado_por != null
      ? String(payload.empleado_aceptado_por)
      : null;
  return {
    id: String(row.id),
    folio: row.folio != null ? String(row.folio) : null,
    employee_id: row.employee_id != null ? String(row.employee_id) : null,
    kind: (row.kind as HrResguardoKind) || 'equipo',
    status: (row.status as HrResguardoStatus) || 'pendiente',
    payload,
    items: normalizeResguardoItems(row.items),
    requested_by: row.requested_by != null ? String(row.requested_by) : null,
    reviewed_by: row.reviewed_by != null ? String(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at != null ? String(row.reviewed_at) : null,
    accepted_at: acceptedAtCol || acceptedAtFallback,
    accepted_by: acceptedByCol || acceptedByFallback,
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** Pendiente de aceptación del colaborador (asignado por RH, aún no aceptado). */
export function isResguardoAwaitingAcceptance(req: HrResguardoRequest): boolean {
  if (req.accepted_at) return false;
  if (req.status === 'cancelado' || req.status === 'devuelto') return false;
  return true;
}

export function isResguardoAcceptedByEmployee(req: HrResguardoRequest): boolean {
  return Boolean(req.accepted_at);
}

/** Badge RH/Staff: Recibido | Pendiente (aceptación del colaborador). */
export type HrResguardoAcceptBadge = 'recibido' | 'pendiente' | 'cancelado' | 'devuelto';

export function resguardoAcceptBadge(
  req: HrResguardoRequest
): HrResguardoAcceptBadge {
  if (req.status === 'cancelado') return 'cancelado';
  if (req.status === 'devuelto') return 'devuelto';
  if (isResguardoAcceptedByEmployee(req)) return 'recibido';
  return 'pendiente';
}

export const HR_RESGUARDO_ACCEPT_LABELS: Record<HrResguardoAcceptBadge, string> =
  {
    recibido: 'Recibido',
    pendiente: 'Pendiente',
    cancelado: 'Cancelado',
    devuelto: 'Devuelto',
  };

export const HR_RESGUARDO_FORM_VERSION = 'c50-resguardo-xlsx-2023';

export const HR_RESGUARDO_KIND_LABELS: Record<HrResguardoKind, string> = {
  equipo: 'Equipo',
  herramientas: 'Herramientas',
  uniforme: 'Uniforme',
  llaves: 'Llaves',
};

export const HR_RESGUARDO_STATUS_LABELS: Record<HrResguardoStatus, string> = {
  pendiente: 'Pendiente',
  entregado: 'Entregado',
  devuelto: 'Devuelto',
  cancelado: 'Cancelado',
};

/** Etiqueta de UI en perfil/Staff: Recibido / Pendiente. */
export function resguardoDisplayStatus(req: HrResguardoRequest): string {
  return HR_RESGUARDO_ACCEPT_LABELS[resguardoAcceptBadge(req)];
}

/** Vigentes para inventario: pendientes de entrega + ya entregados (no devueltos/cancelados). */
export const HR_RESGUARDO_ACTIVE_STATUSES: readonly HrResguardoStatus[] = [
  'pendiente',
  'entregado',
] as const;

export function isResguardoActive(status: HrResguardoStatus): boolean {
  return status === 'pendiente' || status === 'entregado';
}

/** Fila de inventario: un ítem (equipo/herramienta) → quién lo tiene. */
export type HrResguardoInventoryRow = {
  key: string;
  concepto: string;
  cantidad: number;
  marca?: string;
  modelo?: string;
  numero_serie?: string;
  holderName: string;
  holderPuesto?: string;
  employeeId: string | null;
  folio: string | null;
  kind: HrResguardoKind;
  status: HrResguardoStatus;
  fechaResguardo?: string;
  requestId: string;
  created_at: string;
};

function sortEs(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

/** Aplana cartas vigentes a filas por concepto (equipo → colaborador). */
export function flattenResguardoInventory(
  requests: HrResguardoRequest[],
  opts?: { activeOnly?: boolean }
): HrResguardoInventoryRow[] {
  const activeOnly = opts?.activeOnly !== false;
  const rows: HrResguardoInventoryRow[] = [];
  for (const req of requests) {
    if (activeOnly && !isResguardoActive(req.status)) continue;
    const holderName =
      String(req.payload?.nombre || '').trim() ||
      String(req.payload?.receptor_nombre || '').trim() ||
      '—';
    const holderPuesto = String(req.payload?.puesto || '').trim() || undefined;
    const fechaResguardo =
      String(req.payload?.fecha_resguardo || '').trim() ||
      String(req.payload?.fecha_asignacion || '').trim() ||
      undefined;
    const items = Array.isArray(req.items) ? req.items : [];
    items.forEach((item, idx) => {
      const concepto = String(item.concepto || '').trim();
      if (!concepto) return;
      rows.push({
        key: `${req.id}:${idx}`,
        concepto,
        cantidad: item.cantidad > 0 ? item.cantidad : 1,
        marca: item.marca,
        modelo: item.modelo,
        numero_serie: item.numero_serie,
        holderName,
        holderPuesto,
        employeeId: req.employee_id,
        folio: req.folio,
        kind: req.kind,
        status: req.status,
        fechaResguardo,
        requestId: req.id,
        created_at: req.created_at,
      });
    });
  }
  rows.sort((a, b) => {
    const byConcepto = sortEs(a.concepto, b.concepto);
    if (byConcepto !== 0) return byConcepto;
    const byHolder = sortEs(a.holderName, b.holderName);
    if (byHolder !== 0) return byHolder;
    return sortEs(a.folio || '', b.folio || '');
  });
  return rows;
}

export function formatResguardoSpec(row: {
  marca?: string;
  modelo?: string;
  numero_serie?: string;
}): string {
  const parts = [row.marca, row.modelo].filter(Boolean);
  const base = parts.join(' · ');
  if (row.numero_serie) {
    return base ? `${base} · S/N ${row.numero_serie}` : `S/N ${row.numero_serie}`;
  }
  return base || '—';
}

/** Texto legal del formato (hoja Resguardo de Equipo / Para editar). */
export const HR_RESGUARDO_LEGAL = {
  recibo:
    'Por medio de este documento hago constar que recibo en buenas condiciones el siguiente equipo / material:',
  cuidado:
    'El cual se me hace entrega en óptimas condiciones para su debido uso, comprometiéndome a cuidarlo, mantener en buen estado, utilizar única y exclusivamente para asuntos relacionados con mi actividad laboral. En caso de su extravío, daño o uso inadecuado, me responsabilizo del costo total de reparación o la reposición del equipo resguardado al precio actual.',
  software:
    'Asimismo, se hace de mi conocimiento que no podré modificar la configuración del equipo ni instalar software sin ser previamente autorizado.',
  llaves_copia:
    'Asimismo, se hace de mi conocimiento que no podré modificar o hacer una copia de estas llaves sin ser previamente autorizado.',
  danio_parcial:
    'Daño parcial: compostura pagada por el colaborador que tiene a resguardo.',
  perdida_total:
    'Pérdida o daño total: según política vigente (p. ej. porcentaje del valor del bien).',
} as const;

export function emptyResguardoItem(): HrResguardoItem {
  return {
    cantidad: 1,
    concepto: '',
    marca: '',
    modelo: '',
    numero_serie: '',
    precio: null,
  };
}

export function defaultLugarFecha(): string {
  const d = new Date().toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Mexico_City',
  });
  return `Santiago de Querétaro, Querétaro a ${d}`;
}

export function normalizeResguardoItems(raw: unknown): HrResguardoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HrResguardoItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const concepto = String(r.concepto ?? r.equipo ?? r.seccion ?? '').trim();
    if (!concepto) continue;
    const cantidadRaw = Number(r.cantidad ?? r.item ?? 1);
    const cantidad =
      Number.isFinite(cantidadRaw) && cantidadRaw > 0 ? cantidadRaw : 1;
    let precio: number | null = null;
    if (r.precio !== undefined && r.precio !== null && r.precio !== '') {
      const p = Number(r.precio);
      if (Number.isFinite(p)) precio = p;
    }
    out.push({
      cantidad,
      concepto,
      marca: String(r.marca ?? '').trim() || undefined,
      modelo: String(r.modelo ?? '').trim() || undefined,
      numero_serie: String(r.numero_serie ?? r.serie ?? '').trim() || undefined,
      precio,
    });
  }
  return out;
}

export function buildResguardoFolio(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RES-${y}${m}${d}-${suffix}`;
}
