export type ModuleId =
  | 'hub'
  | 'ventas'
  | 'finanzas'
  | 'eventos'
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
    id: 'ventas',
    href: '/ventas',
    label: 'Ventas',
    short: 'Ventas',
    description: 'Ventas diarias, comparativos, pagos y cancelaciones · Carranza 50',
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
    id: 'eventos',
    href: '/eventos',
    label: 'Eventos',
    short: 'Eventos',
    description: 'Calendarización, venta de eventos y margen',
    status: 'próximo',
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
