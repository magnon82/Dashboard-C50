import { readFile, stat } from 'fs/promises';
import path from 'path';
import type { ActivityPayload } from '@/app/lib/eventos-activity';

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
