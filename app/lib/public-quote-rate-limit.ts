/**
 * Rate limit ligero en memoria (por instancia) para APIs públicas de cotización.
 * No es un límite global en serverless multi-instancia; evita enumeración agresiva.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

/** true = permitir; false = demasiadas peticiones. */
export function allowPublicQuoteRequest(request: Request): boolean {
  const key = clientKey(request);
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now >= cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (cur.count >= MAX_PER_WINDOW) return false;
  cur.count += 1;
  return true;
}
