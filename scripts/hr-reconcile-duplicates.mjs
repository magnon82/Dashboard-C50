/**
 * Reconcilia duplicados hr_employees (CURP/INE + nombres + expedientes).
 *
 * Uso:
 *   node --experimental-strip-types scripts/hr-reconcile-duplicates.mjs --dry-run
 *   node --experimental-strip-types scripts/hr-reconcile-duplicates.mjs
 *   npm run hr:reconcile-dupes -- --dry-run
 *
 * Requiere .env.local (Supabase). Expedientes opcionales en
 *   I:\Mi unidad\RH\Expedientes personal C50\Altas  (o HR_EXPEDIENTES_DIR).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { formatHrListName } from '../app/lib/hr-person-match.ts';
import { runEmployeeReconcile } from '../app/lib/hr-employee-reconcile.ts';

const DRY = process.argv.includes('--dry-run');
const NO_CURP_EXTRACT = process.argv.includes('--no-curp-extract');

function loadEnv() {
  const env = { ...process.env };
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (env[k] === undefined) env[k] = v;
    }
  }
  return env;
}

function resolveExpedientesRoot(env) {
  if (env.HR_EXPEDIENTES_DIR && existsSync(env.HR_EXPEDIENTES_DIR)) {
    return env.HR_EXPEDIENTES_DIR;
  }
  const candidates = [
    'I:\\Mi unidad\\RH\\Expedientes personal C50',
    'I:\\Mi unidad\\RH\\Expedientes',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key);
const root = resolveExpedientesRoot(env);

if (DRY) console.log('(dry-run: no escribe en Supabase)\n');

const report = await runEmployeeReconcile(sb, {
  dryRun: DRY,
  expedientesRoot: root,
  extractCurpFromDocs: !NO_CURP_EXTRACT,
});

console.log('=== Reconcile hr_employees ===');
console.log(
  `Plantilla vigente: ${report.plantillaBefore}${DRY ? ' (dry-run)' : ''}`
);
console.log(`Activos (no baja/exclude): ${report.activeBefore}`);
console.log(`Semana horarios: ${report.scheduleWeekId || '—'}`);
console.log(
  `Empleados en horarios recientes: ${report.scheduleEmployeeIds.length}`
);
console.log(`Carpetas expediente: ${report.expedienteFolders}`);
console.log(`Clusters a fusionar: ${report.clusters.length}`);
console.log('');

for (const m of report.merges) {
  const c = m.cluster;
  const display = formatHrListName(c.canonicalName);
  console.log(`• Survivor: ${c.survivorName}`);
  console.log(`  → canónico: ${c.canonicalName}  (lista: ${display})`);
  console.log(`  Losers: ${c.loserNames.join(' | ')}`);
  console.log(`  score=${c.scoreHint.toFixed(3)} reason=${c.reason}`);
  console.log(
    `  moves: payroll=${m.payrollLinesMoved}/${m.payrollLinesDropped} drops, shifts=${m.scheduleShiftsMoved}, avail=${m.availabilityMoved}, leaveBal=${m.leaveBalancesMoved}, leaveReq=${m.leaveRequestsMoved}, resguardo=${m.resguardoMoved}, docs=${m.documentsMoved}/${m.documentsDropped}`
  );
  console.log('');
}

if (!DRY && report.plantillaAfter != null) {
  console.log(
    `Plantilla vigente: ${report.plantillaBefore} → ${report.plantillaAfter}`
  );
}

if (report.skippedAmbiguous.length) {
  console.log(`Ambiguos / CURP conflicto: ${report.skippedAmbiguous.length}`);
  for (const s of report.skippedAmbiguous.slice(0, 20)) {
    console.log(`  ~ ${s.a} ↔ ${s.b} (${s.score.toFixed(3)} ${s.reason})`);
  }
}

const spotlight = report.clusters.filter((c) => {
  const blob =
    `${c.survivorName} ${c.loserNames.join(' ')} ${c.canonicalName}`.toLowerCase();
  return (
    blob.includes('paula') ||
    blob.includes('villar') ||
    blob.includes('gael') ||
    blob.includes('cristian') ||
    blob.includes('suarez') ||
    blob.includes('resendiz') ||
    blob.includes('eduardo')
  );
});
console.log('\n--- Spotlight (Cristian / Eduardo / Paula / Gael) ---');
if (spotlight.length) {
  for (const c of spotlight) {
    console.log(
      `OK merge: [${c.loserNames.join(', ')}] → ${formatHrListName(c.canonicalName) || c.canonicalName}`
    );
  }
} else {
  console.log('(Sin clusters en spotlight)');
}

console.log(DRY ? '\nDry-run listo. Quita --dry-run para aplicar.' : '\nListo.');
console.log(
  JSON.stringify({
    dryRun: DRY,
    plantillaBefore: report.plantillaBefore,
    plantillaAfter: report.plantillaAfter,
    activeBefore: report.activeBefore,
    clusterCount: report.clusters.length,
    merges: report.merges.map((m) => ({
      survivor: m.cluster.canonicalName,
      losers: m.cluster.loserNames,
      display: formatHrListName(m.cluster.canonicalName),
      docsMoved: m.documentsMoved,
    })),
  })
);
