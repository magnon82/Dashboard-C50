/**
 * Rutas locales Drive del módulo Eventos (solo lectura).
 * No toca financial_records / ingest_eventos.py.
 */

import path from 'path';

const MI_UNIDAD = process.env.DRIVE_MI_UNIDAD_PATH?.trim() || 'I:\\Mi unidad';

export function getEventosRoot(): string {
  return process.env.EVENTOS_PATH?.trim() || path.join(MI_UNIDAD, 'Eventos');
}

/** Fecha civil hoy en CDMX (YYYY-MM-DD). */
export function todayMexicoIso(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Mexico_City',
  });
}

/** Hoy + N días (calendario civil CDMX), YYYY-MM-DD. */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function isPathUnderRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}
