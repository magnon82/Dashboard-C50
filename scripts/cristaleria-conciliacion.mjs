/**
 * CLI: conciliación INGRESO CRISTALERIA vs 2% venta Infocaja.
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types scripts/cristaleria-conciliacion.mjs 2026
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  CRISTALERIA_FORMULA_BLURB,
  buildCristaleriaConciliacion,
} from '../app/lib/cristaleria-conciliacion.ts';

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

function money(n) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

async function main() {
  const year = Number(process.argv[2] || new Date().getFullYear());
  const env = { ...process.env, ...loadEnv() };
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb
    .from('financial_records')
    .select('id, date, type, category, amount, description, source_file')
    .gte('date', `${year - 1}-12-01`)
    .lte('date', `${year}-12-31`)
    .in('source_file', ['infocaja', 'flujo_efectivo_mov']);
  if (error) throw error;

  const s = buildCristaleriaConciliacion(data || [], year);
  console.log(CRISTALERIA_FORMULA_BLURB);
  console.log('');
  console.log(`Venta ${year}: ${money(s.totals.ventaTotal)}`);
  console.log(`Abonos flujo: ${money(s.totals.abonoFlujo)} (${((s.totals.pctReal || 0) * 100).toFixed(3)}%)`);
  console.log(`Esperado 2%: ${money(s.totals.esperado2pct)}`);
  console.log(`Faltante: ${money(s.totals.deltaVs2pct)}`);
  console.log(`Excel (venta/1000×2): ${money(s.totals.excelActual)}`);
  console.log(`Semanas: OK ${s.counts.ok} · bajo ${s.counts.bajo} · sin abono ${s.counts.falta_abono}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
