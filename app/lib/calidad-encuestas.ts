import { getServiceSupabase } from '@/app/lib/users';
import {
  buildCalidadComentarios,
  buildCalidadResumen,
  type StoredEncuestasFile,
} from '@/app/lib/calidad-aggregate';
import type { CalidadComentarios, CalidadFiltro, CalidadResumen, CalidadTono } from '@/app/lib/calidad-types';

const BUCKET = 'calidad-encuestas';
const OBJECT = 'encuestas.json';
const CACHE_MS = 60_000;

let cache: { at: number; file: StoredEncuestasFile } | null = null;

function clean(value: string | null): string | null {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

/** year vacío = todo el histórico. month solo aplica si hay año. */
export function calidadFiltroFromSearch(url: URL): CalidadFiltro {
  const yearRaw = clean(url.searchParams.get('year'));
  const monthRaw = clean(url.searchParams.get('month'));
  const mesero = clean(url.searchParams.get('mesero'));
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
  const month = monthRaw && /^\d{1,2}$/.test(monthRaw) ? Number(monthRaw) : null;

  if (!year) {
    return { from: null, to: null, mesero, grain: 'month' };
  }
  if (!month || month < 1 || month > 12) {
    return { from: `${year}-01-01`, to: `${year}-12-31`, mesero, grain: 'month' };
  }
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(last).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${dd}`, mesero, grain: 'day' };
}

async function loadStoredEncuestas(): Promise<StoredEncuestasFile> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.file;
  const sb = getServiceSupabase();
  const { data, error } = await sb.storage.from(BUCKET).download(OBJECT);
  if (error || !data) {
    throw new Error(error?.message || 'Aún no hay encuestas importadas.');
  }
  const file = JSON.parse(await data.text()) as StoredEncuestasFile;
  if (!Array.isArray(file.rows)) {
    throw new Error('El archivo de encuestas no tiene filas.');
  }
  cache = { at: Date.now(), file };
  return file;
}

export async function loadCalidadResumen(filtro: CalidadFiltro): Promise<CalidadResumen> {
  return buildCalidadResumen(await loadStoredEncuestas(), filtro);
}

export async function loadCalidadComentarios(
  filtro: CalidadFiltro,
  tono: CalidadTono
): Promise<CalidadComentarios> {
  return buildCalidadComentarios(await loadStoredEncuestas(), filtro, tono);
}

export function parseCalidadTono(value: string | null): CalidadTono {
  if (value === 'regular' || value === 'positivo' || value === 'sin' || value === 'malo') {
    return value;
  }
  return 'malo';
}
