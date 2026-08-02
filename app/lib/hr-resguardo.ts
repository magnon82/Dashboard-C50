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
  notes: string | null;
  created_at: string;
  updated_at: string;
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
