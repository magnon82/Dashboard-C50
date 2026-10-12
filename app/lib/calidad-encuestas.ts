import { getServiceSupabase } from '@/app/lib/users';
import type { CalidadComentarios, CalidadResumen, CalidadTono } from '@/app/lib/calidad-types';

export interface CalidadFiltro {
  from: string | null;
  to: string | null;
  mesero: string | null;
  grain: 'month' | 'day';
}

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

export async function loadCalidadResumen(filtro: CalidadFiltro): Promise<CalidadResumen> {
  const sb = getServiceSupabase();
  const { data, error } = await sb.rpc('calidad_resumen', {
    p_from: filtro.from,
    p_to: filtro.to,
    p_mesero: filtro.mesero,
    p_grain: filtro.grain,
  });
  if (error) throw new Error(error.message);
  return data as CalidadResumen;
}

export async function loadCalidadComentarios(
  filtro: CalidadFiltro,
  tono: CalidadTono
): Promise<CalidadComentarios> {
  const sb = getServiceSupabase();
  const { data, error } = await sb.rpc('calidad_comentarios', {
    p_from: filtro.from,
    p_to: filtro.to,
    p_mesero: filtro.mesero,
    p_tono: tono,
    p_limit: 120,
  });
  if (error) throw new Error(error.message);
  return data as CalidadComentarios;
}

export function parseCalidadTono(value: string | null): CalidadTono {
  if (value === 'regular' || value === 'positivo' || value === 'sin' || value === 'malo') {
    return value;
  }
  return 'malo';
}
