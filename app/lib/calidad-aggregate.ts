import type {
  CalidadCanal,
  CalidadComentarios,
  CalidadComentario,
  CalidadConteo,
  CalidadFiltro,
  CalidadMesero,
  CalidadPreguntaId,
  CalidadResumen,
  CalidadSeriePunto,
  CalidadTono,
} from '@/app/lib/calidad-types';

export interface StoredEncuesta {
  source_hash: string;
  folio: string | null;
  ticket: string | null;
  fecha: string | null;
  mesero: string | null;
  mesa: string | null;
  servicio: string | null;
  alimentos: string | null;
  bebidas: string | null;
  limpieza: string | null;
  precio: string | null;
  canal: string | null;
  otro: string | null;
  comentario: string | null;
}

export interface StoredEncuestasFile {
  syncedAt: string;
  rowsRead: number;
  rowsInserted: number;
  rows: StoredEncuesta[];
}

const PREGUNTAS: CalidadPreguntaId[] = ['servicio', 'alimentos', 'bebidas', 'limpieza'];
const NOTAS = ['EXCELENTE', 'BUENO', 'REGULAR', 'MALO'] as const;

function fold(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim();
}

function inScope(row: StoredEncuesta, filtro: CalidadFiltro, applyMesero: boolean): boolean {
  const open = !filtro.from && !filtro.to;
  const fecha = row.fecha;
  const dateOk =
    open ||
    (fecha != null &&
      (!filtro.from || fecha >= filtro.from) &&
      (!filtro.to || fecha <= filtro.to));
  if (!dateOk) return false;
  if (applyMesero && filtro.mesero && row.mesero !== filtro.mesero) return false;
  return true;
}

function conteoOf(rows: StoredEncuesta[], field: CalidadPreguntaId): Omit<CalidadConteo, 'serie'> {
  const conteo = { excelente: 0, bueno: 0, regular: 0, malo: 0 };
  for (const row of rows) {
    const value = row[field];
    if (value === 'EXCELENTE') conteo.excelente += 1;
    else if (value === 'BUENO') conteo.bueno += 1;
    else if (value === 'REGULAR') conteo.regular += 1;
    else if (value === 'MALO') conteo.malo += 1;
  }
  return conteo;
}

function serieOf(
  rows: StoredEncuesta[],
  field: CalidadPreguntaId,
  grain: 'month' | 'day'
): CalidadSeriePunto[] {
  const buckets = new Map<string, CalidadSeriePunto>();
  for (const row of rows) {
    if (!row.fecha) continue;
    const value = row[field];
    if (value !== 'EXCELENTE' && value !== 'BUENO' && value !== 'REGULAR' && value !== 'MALO') {
      continue;
    }
    const label = grain === 'day' ? row.fecha : row.fecha.slice(0, 7);
    let point = buckets.get(label);
    if (!point) {
      point = { label, excelente: 0, bueno: 0, regular: 0, malo: 0 };
      buckets.set(label, point);
    }
    if (value === 'EXCELENTE') point.excelente += 1;
    else if (value === 'BUENO') point.bueno += 1;
    else if (value === 'REGULAR') point.regular += 1;
    else point.malo += 1;
  }
  return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function canalGrupo(canal: string | null, otro: string | null): string | null {
  const c = fold(canal);
  const o = fold(otro);
  if (!c && !o) return null;
  if (c.includes('RECOMEND')) return 'Recomendación';
  if (c.includes('DE PASO')) return 'De paso';
  if (c.includes('VISIT')) return 'Ya nos visitó';
  if (
    c.includes('REDES') ||
    c.includes('INSTAGRAM') ||
    c.includes('TIK') ||
    c.includes('FACE') ||
    c === 'FB'
  ) {
    return 'Redes';
  }
  const blob = `${c} ${o}`;
  if (blob.includes('GOOGLE') || blob.includes('MAPS')) return 'Google / Maps';
  return 'Otro';
}

export function tonoDe(row: StoredEncuesta): CalidadTono | null {
  const comentario = (row.comentario || '').trim();
  if (!comentario) return null;
  const ratings = [row.servicio, row.alimentos, row.bebidas, row.limpieza];
  if (ratings.every((value) => !value)) return 'sin';
  if (ratings.includes('MALO')) return 'malo';
  if (ratings.includes('REGULAR')) return 'regular';
  return 'positivo';
}

export function buildCalidadResumen(
  file: StoredEncuestasFile,
  filtro: CalidadFiltro
): CalidadResumen {
  const filtered = file.rows.filter((row) => inScope(row, filtro, true));
  const period = file.rows.filter((row) => inScope(row, filtro, false));

  const preguntas = {} as Record<CalidadPreguntaId, CalidadConteo>;
  for (const field of PREGUNTAS) {
    preguntas[field] = {
      ...conteoOf(filtered, field),
      serie: serieOf(filtered, field, filtro.grain),
    };
  }

  const precios = { justo: 0, caro: 0, barato: 0 };
  for (const row of filtered) {
    if (row.precio === 'JUSTO') precios.justo += 1;
    else if (row.precio === 'CARO') precios.caro += 1;
    else if (row.precio === 'BARATO') precios.barato += 1;
  }

  const canalCounts = new Map<string, number>();
  for (const row of filtered) {
    const grupo = canalGrupo(row.canal, row.otro);
    if (!grupo) continue;
    canalCounts.set(grupo, (canalCounts.get(grupo) || 0) + 1);
  }
  const canales: CalidadCanal[] = Array.from(canalCounts, ([label, n]) => ({ label, n })).sort(
    (a, b) => b.n - a.n
  );

  const meseroCounts = new Map<string, CalidadMesero>();
  for (const row of period) {
    const nombre = (row.mesero || '').trim() || 'Sin mesero';
    let item = meseroCounts.get(nombre);
    if (!item) {
      item = { nombre, encuestas: 0, servicioExcelente: 0, servicioRespondidas: 0 };
      meseroCounts.set(nombre, item);
    }
    item.encuestas += 1;
    if (row.servicio === 'EXCELENTE') item.servicioExcelente += 1;
    if (row.servicio && (NOTAS as readonly string[]).includes(row.servicio)) {
      item.servicioRespondidas += 1;
    }
  }
  const meseros = Array.from(meseroCounts.values()).sort(
    (a, b) => b.encuestas - a.encuestas || a.nombre.localeCompare(b.nombre, 'es')
  );

  const yearCounts = new Map<number, number>();
  let min: string | null = null;
  let max: string | null = null;
  for (const row of file.rows) {
    if (!row.fecha) continue;
    if (!min || row.fecha < min) min = row.fecha;
    if (!max || row.fecha > max) max = row.fecha;
    const year = Number(row.fecha.slice(0, 4));
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
  }
  const anios = Array.from(yearCounts)
    .filter(([, n]) => n >= 20)
    .map(([year]) => year)
    .sort((a, b) => b - a);

  return {
    encuestas: filtered.length,
    preguntas,
    precios,
    canales,
    meseros,
    rango: { min, max },
    anios,
    grain: filtro.grain,
    sync: {
      lastSyncedAt: file.syncedAt,
      rowsRead: file.rowsRead,
      rowsInserted: file.rowsInserted,
      lastStatus: 'ok',
    },
  };
}

export function buildCalidadComentarios(
  file: StoredEncuestasFile,
  filtro: CalidadFiltro,
  tono: CalidadTono,
  limit = 120
): CalidadComentarios {
  const counts: Record<CalidadTono, number> = { malo: 0, regular: 0, positivo: 0, sin: 0 };
  const matched: StoredEncuesta[] = [];
  for (const row of file.rows) {
    if (!inScope(row, filtro, true)) continue;
    const tone = tonoDe(row);
    if (!tone) continue;
    counts[tone] += 1;
    if (tone === tono) matched.push(row);
  }
  matched.sort((a, b) => {
    const af = a.fecha || '';
    const bf = b.fecha || '';
    if (af !== bf) return bf.localeCompare(af);
    return a.source_hash.localeCompare(b.source_hash);
  });
  const items: CalidadComentario[] = matched.slice(0, limit).map((row) => ({
    fecha: row.fecha,
    mesero: row.mesero,
    mesa: row.mesa,
    ticket: row.ticket,
    servicio: row.servicio,
    alimentos: row.alimentos,
    bebidas: row.bebidas,
    limpieza: row.limpieza,
    comentario: (row.comentario || '').trim(),
  }));
  return { counts, tono, total: matched.length, items };
}
