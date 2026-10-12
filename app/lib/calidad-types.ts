export type CalidadPreguntaId = 'servicio' | 'alimentos' | 'bebidas' | 'limpieza';
export type CalidadTono = 'malo' | 'regular' | 'positivo' | 'sin';
export type CalidadGrain = 'month' | 'day';

export interface CalidadConteo {
  excelente: number;
  bueno: number;
  regular: number;
  malo: number;
  serie: CalidadSeriePunto[];
}

export interface CalidadSeriePunto {
  label: string;
  excelente: number;
  bueno: number;
  regular: number;
  malo: number;
}

export interface CalidadMesero {
  nombre: string;
  encuestas: number;
  servicioExcelente: number;
  servicioRespondidas: number;
}

export interface CalidadCanal {
  label: string;
  n: number;
}

export interface CalidadSync {
  lastSyncedAt?: string | null;
  rowsRead?: number | null;
  rowsInserted?: number | null;
  lastStatus?: string | null;
  lastMessage?: string | null;
}

export interface CalidadResumen {
  encuestas: number;
  preguntas: Record<CalidadPreguntaId, CalidadConteo>;
  precios: { justo: number; caro: number; barato: number };
  canales: CalidadCanal[];
  meseros: CalidadMesero[];
  rango: { min: string | null; max: string | null };
  anios: number[];
  grain: CalidadGrain;
  sync: CalidadSync;
}

export interface CalidadComentario {
  fecha: string | null;
  mesero: string | null;
  mesa: string | null;
  ticket: string | null;
  servicio: string | null;
  alimentos: string | null;
  bebidas: string | null;
  limpieza: string | null;
  comentario: string;
}

export interface CalidadComentarios {
  counts: Record<CalidadTono, number>;
  tono: CalidadTono;
  total: number;
  items: CalidadComentario[];
}

export const CALIDAD_PREGUNTAS: { id: CalidadPreguntaId; short: string; title: string }[] = [
  {
    id: 'servicio',
    short: 'Servicio',
    title: '¿Cómo calificarías el servicio y el trato del personal?',
  },
  {
    id: 'alimentos',
    short: 'Alimentos',
    title: '¿Cómo calificarías la calidad de los alimentos?',
  },
  {
    id: 'bebidas',
    short: 'Bebidas',
    title: '¿Cómo calificarías la calidad de las bebidas?',
  },
  {
    id: 'limpieza',
    short: 'Limpieza',
    title: '¿Cómo calificarías la limpieza del lugar?',
  },
];

export const CALIDAD_TONOS: { id: CalidadTono; label: string }[] = [
  { id: 'malo', label: 'Malos' },
  { id: 'regular', label: 'Regulares' },
  { id: 'positivo', label: 'Positivos' },
  { id: 'sin', label: 'Sin calificación' },
];
