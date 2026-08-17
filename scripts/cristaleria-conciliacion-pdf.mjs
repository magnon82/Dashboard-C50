/**
 * Genera PDF conciliación Cristalería (semanas Acumulado).
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/cristaleria-conciliacion-pdf.mjs [year] [fromWeek] [toWeek] [outPath]
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildCristaleriaConciliacion, fetchRecordsForCristaleriaConciliacion } from '../app/lib/cristaleria-conciliacion.ts';
import {
  buildCristaleriaConciliacionPdfBytes,
  cristaleriaConciliacionPdfFilename,
} from '../app/lib/cristaleria-conciliacion-pdf.ts';

function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

async function main() {
  const year = Number(process.argv[2] || new Date().getFullYear());
  const fromWeek = Number(process.argv[3] || 1);
  const toWeek = Number(process.argv[4] || 32);
  const outArg = process.argv[5];

  const env = { ...process.env, ...loadEnv() };
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const records = await fetchRecordsForCristaleriaConciliacion(sb, year);
  const summary = buildCristaleriaConciliacion(records || [], year);
  const bytes = await buildCristaleriaConciliacionPdfBytes({
    summary,
    fromWeek,
    toWeek,
  });

  const filename = cristaleriaConciliacionPdfFilename(year, fromWeek, toWeek);
  const outPath = outArg || join(process.cwd(), filename);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);
  console.log(`PDF: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
