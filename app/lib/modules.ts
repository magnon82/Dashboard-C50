export type ModuleId =
  | 'hub'
  | 'staff'
  | 'ventas'
  | 'finanzas'
  | 'rrhh'
  | 'eventos'
  | 'reportes-socios'
  | 'cocina'
  | 'barra'
  | 'calidad'
  | 'inventarios';

export interface AppModule {
  id: ModuleId;
  href: string;
  label: string;
  short: string;
  description: string;
  status: 'activo' | 'próximo';
}

export const APP_MODULES: AppModule[] = [
  {
    id: 'staff',
    href: '/staff',
    label: 'Staff',
    short: 'Staff',
    description: 'Herramientas operativas de piso · Cortes TPV y captura diaria',
    status: 'activo',
  },
  {
    id: 'ventas',
    href: '/ventas',
    label: 'Ventas',
    short: 'Ventas',
    description: 'Ventas diarias, comparativos, pagos y cancelaciones · Carranza 50',
    status: 'activo',
  },
  {
    id: 'reportes-socios',
    href: '/reportes-socios',
    label: 'Reportes Socios',
    short: 'Socios',
    description: 'Tablero de reportes para socios · indicadores y visión consolidada',
    status: 'activo',
  },
  {
    id: 'finanzas',
    href: '/finanzas',
    label: 'Finanzas',
    short: 'Finanzas',
    description: 'Saldos, flujo de efectivo, bancos y visión financiera consolidada',
    status: 'activo',
  },
  {
    id: 'rrhh',
    href: '/rrhh',
    label: 'Recursos Humanos',
    short: 'RR.HH.',
    description: 'Personal, nómina y gestión de equipo · próximamente',
    status: 'próximo',
  },
  {
    id: 'eventos',
    href: '/eventos',
    label: 'Eventos',
    short: 'Eventos',
    description: 'CRM, cotizador, pipeline y operación de eventos',
    status: 'activo',
  },
  {
    id: 'cocina',
    href: '/cocina',
    label: 'Cocina',
    short: 'Cocina',
    description: 'Operación y tablero de cocina · Carranza 50',
    status: 'activo',
  },
  {
    id: 'barra',
    href: '/barra',
    label: 'Barra',
    short: 'Barra',
    description: 'Operación y tablero de barra · Carranza 50',
    status: 'activo',
  },
  {
    id: 'calidad',
    href: '/calidad',
    label: 'Calidad',
    short: 'Calidad',
    description: 'Incidencias, motivos de cancelación y KPIs de servicio',
    status: 'próximo',
  },
  {
    id: 'inventarios',
    href: '/inventarios',
    label: 'Inventarios',
    short: 'Inventarios',
    description: 'Existencias, mermas y puntos de reorden',
    status: 'próximo',
  },
];

/**
 * Home after login / visiting `/`.
 * Exactly one shared module → that route; admin (`*`), multiple, or zero → hub `/`.
 */
export function homePathForModules(modules: string[]): string {
  if (modules.includes('*')) return '/';
  const allowed = APP_MODULES.filter((m) => modules.includes(m.id));
  if (allowed.length === 1) return allowed[0].href;
  return '/';
}
