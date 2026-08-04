/**
 * Pure OS helpers safe for any bundle (no Node fs).
 * Keep Drive scanning / listEventOs in `eventos-os.ts` (server-only).
 */

/**
 * Folio desde nombre/etiqueta:
 * - «FOLIO 12 …», «G7», «G1-26»
 * - leading «01 ORDEN DE SERVICIO …» (sin prefijo FOLIO)
 * - trailing «ORDEN DE SERVICIO 02» (numérico, no G-codes)
 */
export function parseFolio(stem: string): string | null {
  const folioM = stem.match(/FOLIO\s*(\d+)/i);
  if (folioM) return folioM[1];
  const gM = stem.match(/\bG\s*[-]?\s*(\d+(?:-\d+)?)\b/i);
  if (gM) return `G${gM[1]}`.toUpperCase();
  const lead = stem.match(/^\s*(\d{1,2})\s+(?:ORDEN|FOLIO)\b/i);
  if (lead) return lead[1];
  const trail = stem.match(/orden\s*de?\s*servicio\s+(\d{1,2})\b/i);
  if (trail) return trail[1];
  return null;
}

/** Clave estable de folio: «02»/«2»/«2-2027» → «2»; «G7» → «G7». */
export function normalizeFolioKey(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^G\d+(?:-\d+)?$/i.test(s)) return s.toUpperCase();
  const parsed = parseFolio(s);
  if (parsed && /^G/i.test(parsed)) return parsed.toUpperCase();
  const num = (parsed || s).match(/^(\d{1,4})(?:-\d{4})?$/);
  if (num) return String(Number(num[1]));
  return parsed ? parsed.toUpperCase() : null;
}
