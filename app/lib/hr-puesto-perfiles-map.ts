/**
 * Mapa Plantilla → Puesto (catálogo) → Perfiles/KPI en Drive.
 * Fuente de verdad operativa (respuestas RH 2026-08-03).
 * Carpeta raíz: I:\Mi unidad\RH\Perfiles por posición
 */

import { normalizePuestoLabel } from '@/app/lib/hr-puestos';

export type HrPerfilLinkStatus = 'ok' | 'parcial' | 'gap';

export type HrPuestoPerfilCoverage = {
  catalogo: string;
  equipo: 'Piso' | 'Cocina' | 'Admin' | 'Otros';
  /** Relativo a «Perfiles por posición». */
  driveRel: string | null;
  descripcion: HrPerfilLinkStatus;
  kpi: HrPerfilLinkStatus;
  actividades: HrPerfilLinkStatus;
  nota: string;
};

export type HrDriveOnlyPerfil = {
  driveRel: string;
  docs: string;
  estado: string;
  nota: string;
};

export const HR_PERFILES_DRIVE_ROOT =
  'I:\\Mi unidad\\RH\\Perfiles por posición';

/** Cobertura catálogo BMS ↔ carpeta Drive. */
export const HR_PUESTO_PERFIL_COVERAGE: HrPuestoPerfilCoverage[] = [
  {
    catalogo: 'Gerente',
    equipo: 'Admin',
    driveRel: 'Gerencia/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Perfil + KPIs + actividades + manual',
  },
  {
    catalogo: 'Capitan',
    equipo: 'Piso',
    driveRel: 'Piso/Capitán/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Match directo; también presta docs a Meserx Encargadx',
  },
  {
    catalogo: 'Meserx Encargadx',
    equipo: 'Piso',
    driveRel: 'Piso/Capitán/',
    descripcion: 'parcial',
    kpi: 'parcial',
    actividades: 'parcial',
    nota: 'Nivel entre Mesero y Capitán; sin perfil propio → ligue provisional a Capitán',
  },
  {
    catalogo: 'Meserx',
    equipo: 'Piso',
    driveRel: 'Piso/Mesero/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Match directo',
  },
  {
    catalogo: 'Hostess',
    equipo: 'Piso',
    driveRel: 'Piso/Hostes/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Alias Hostes → Hostess',
  },
  {
    catalogo: 'Bartender',
    equipo: 'Piso',
    driveRel: 'Piso/Barra/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Carpeta Barra / archivo Bar Tender',
  },
  {
    catalogo: 'Encargado de Cocina',
    equipo: 'Cocina',
    driveRel: 'Cocina/CHEF/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'parcial',
    nota: 'Confirmado: Chef (no Sub-Chef); cocinero responsable con funciones de chef',
  },
  {
    catalogo: 'Cocinero',
    equipo: 'Cocina',
    driveRel: 'Cocina/',
    descripcion: 'ok',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Solo perfil en raíz Cocina',
  },
  {
    catalogo: 'Lavaloza',
    equipo: 'Cocina',
    driveRel: 'Cocina/',
    descripcion: 'ok',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Solo perfil en raíz Cocina',
  },
  {
    catalogo: 'Practicante Cocina',
    equipo: 'Cocina',
    driveRel: null,
    descripcion: 'gap',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Sin perfil confirmado / pendiente',
  },
  {
    catalogo: 'Cajerx',
    equipo: 'Admin',
    driveRel: 'Administración/Caja/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Match directo',
  },
  {
    catalogo: 'Compras y Administración',
    equipo: 'Admin',
    driveRel: 'Administración/Administrador/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'ok',
    nota: 'Confirmado → Administrador',
  },
  {
    catalogo: 'Asistente Administrativo',
    equipo: 'Admin',
    driveRel: 'Administración/Asistente administrativo/',
    descripcion: 'ok',
    kpi: 'ok',
    actividades: 'parcial',
    nota: 'Perfil + KPI + plan de trabajo',
  },
  {
    catalogo: 'Practicante Administrativo',
    equipo: 'Admin',
    driveRel: null,
    descripcion: 'gap',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Sin perfil confirmado / pendiente',
  },
  {
    catalogo: 'Inventarios',
    equipo: 'Admin',
    driveRel: null,
    descripcion: 'gap',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Sin perfil confirmado / pendiente',
  },
  {
    catalogo: 'Limpieza',
    equipo: 'Otros',
    driveRel: null,
    descripcion: 'gap',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Sin perfil; sin documento (no inventar Runner u otro)',
  },
  {
    catalogo: 'Socios',
    equipo: 'Admin',
    driveRel: null,
    descripcion: 'gap',
    kpi: 'gap',
    actividades: 'gap',
    nota: 'Sin perfil; sin documento',
  },
];

/** Carpetas Drive sin puesto activo en catálogo / plantilla. */
export const HR_DRIVE_ONLY_PERFILES: HrDriveOnlyPerfil[] = [
  {
    driveRel: 'Piso/Runner/',
    docs: 'Perfil + KPI + actividades',
    estado: 'Drive-only',
    nota: 'Sin puesto activo en catálogo BMS; no ligar a Limpieza',
  },
  {
    driveRel: 'Cocina/Sub-Chef/',
    docs: 'Solo perfil',
    estado: 'Drive-only',
    nota: 'Sin puesto en catálogo; Encargado de Cocina usa CHEF, no Sub-Chef',
  },
  {
    driveRel: 'Administración/Director Administrativo/',
    docs: 'Solo perfil',
    estado: 'Drive-only',
    nota: 'Sin puesto activo en catálogo BMS',
  },
  {
    driveRel: 'Recursos Humanos/',
    docs: 'Perfil + actividades',
    estado: 'Drive-only',
    nota: 'Sin puesto activo en catálogo BMS',
  },
  {
    driveRel: 'RP - Eventos/',
    docs: 'Perfil + protocolo venta',
    estado: 'Inactivo / vacante',
    nota: 'Carpeta legacy; hoy no hay persona RP/eventos en plantilla',
  },
];

function foldKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function hrPerfilStatusLabel(s: HrPerfilLinkStatus): string {
  if (s === 'ok') return 'Ligado';
  if (s === 'parcial') return 'Parcial';
  return 'Hueco';
}

export function countHrPerfilStatus(
  field: 'descripcion' | 'kpi' | 'actividades',
  value: HrPerfilLinkStatus
): number {
  return HR_PUESTO_PERFIL_COVERAGE.filter((r) => r[field] === value).length;
}

export function hrPerfilDrivePath(driveRel: string | null): string | null {
  if (!driveRel) return null;
  const rel = driveRel.replace(/^[/\\]+/, '').replace(/[/\\]+$/g, '');
  return `${HR_PERFILES_DRIVE_ROOT}\\${rel.replace(/\//g, '\\')}`;
}

/** Resuelve cobertura por etiqueta de puesto (normalizada al catálogo). */
export function resolvePuestoPerfilCoverage(
  puesto: string | null | undefined
): HrPuestoPerfilCoverage | null {
  const n = normalizePuestoLabel(puesto);
  if (!n) return null;
  const key = foldKey(n);
  return (
    HR_PUESTO_PERFIL_COVERAGE.find((r) => foldKey(r.catalogo) === key) ?? null
  );
}

export function hrPerfilCoverageSummary() {
  const total = HR_PUESTO_PERFIL_COVERAGE.length;
  const conDrive = HR_PUESTO_PERFIL_COVERAGE.filter((r) => r.driveRel).length;
  const huecos = HR_PUESTO_PERFIL_COVERAGE.filter(
    (r) => r.descripcion === 'gap'
  ).length;
  const parciales = HR_PUESTO_PERFIL_COVERAGE.filter(
    (r) => r.descripcion === 'parcial'
  ).length;
  return { total, conDrive, huecos, parciales };
}
