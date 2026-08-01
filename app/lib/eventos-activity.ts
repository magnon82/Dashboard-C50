import { readFile, stat } from 'fs/promises';
import path from 'path';

export type ActivityTimelineItem = {
  date: string;
  event_date?: string | null;
  source: string;
  label?: string | null;
  detail?: string | null;
  folio?: string | null;
};

export type ActivityClientRow = {
  client_key: string;
  company_name: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  matched_seed?: boolean;
  last_activity_at: string | null;
  last_activity_source: string | null;
  activity_count: number;
  sources?: string[];
  timeline?: ActivityTimelineItem[];
};

export type ActivityPayload = {
  generated_at?: string;
  sources_note?: {
    readable?: string[];
    not_readable_local?: string[];
  };
  stats?: {
    clients: number;
    with_activity: number;
    matched_seed: number;
    events_total: number;
  };
  clients: ActivityClientRow[];
};

export function normalizeClientKey(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let cache: { mtimeMs: number; data: ActivityPayload } | null = null;

export async function loadEventClientActivity(): Promise<ActivityPayload | null> {
  const file = path.join(
    process.cwd(),
    'supabase',
    'seed_event_client_activity.json'
  );
  try {
    const st = await stat(file);
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.data;
    const raw = await readFile(file, 'utf-8');
    const data = JSON.parse(raw) as ActivityPayload;
    if (!data || !Array.isArray(data.clients)) return null;
    cache = { mtimeMs: st.mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

/** Índice por company_name normalizado + contact_name. */
export function indexActivityByName(
  payload: ActivityPayload
): Map<string, ActivityClientRow> {
  const map = new Map<string, ActivityClientRow>();
  for (const row of payload.clients) {
    const keys = [
      normalizeClientKey(row.company_name),
      normalizeClientKey(row.contact_name || undefined),
      row.client_key,
    ].filter(Boolean);
    for (const k of keys) {
      const prev = map.get(k);
      if (
        !prev ||
        (row.last_activity_at || '') > (prev.last_activity_at || '')
      ) {
        map.set(k, row);
      }
    }
  }
  return map;
}

/**
 * Empareja cliente CRM ↔ actividad (exacto, contención, solapamiento de tokens).
 * Misma heurística ligera que best_seed_match del ingestor Python.
 */
export function pickActivityForClient(
  index: Map<string, ActivityClientRow>,
  companyName: string,
  contactName?: string | null
): ActivityClientRow | null {
  const c = normalizeClientKey(companyName);
  const n = normalizeClientKey(contactName || undefined);
  const exact = index.get(c) || (n ? index.get(n) : undefined);
  if (exact) return exact;
  if (!c && !n) return null;

  const needles = [c, n].filter(Boolean);
  let best: ActivityClientRow | null = null;
  let bestScore = 0;

  for (const [key, row] of index) {
    if (!key) continue;
    for (const needle of needles) {
      if (needle === key) {
        return row;
      }
      if (needle.includes(key) || key.includes(needle)) {
        const score =
          Math.min(needle.length, key.length) /
          Math.max(needle.length, key.length);
        if (score > bestScore) {
          bestScore = score;
          best = row;
        }
        continue;
      }
      const nt = new Set(needle.split(' ').filter(Boolean));
      const kt = new Set(key.split(' ').filter(Boolean));
      if (!nt.size || !kt.size) continue;
      let inter = 0;
      for (const t of nt) if (kt.has(t)) inter += 1;
      if (
        inter >= 2 ||
        (inter === 1 && nt.size === 1 && kt.size <= 2)
      ) {
        const score = inter / Math.max(nt.size, kt.size);
        if (score > bestScore) {
          bestScore = score;
          best = row;
        }
      }
    }
  }
  return bestScore >= 0.45 ? best : null;
}
