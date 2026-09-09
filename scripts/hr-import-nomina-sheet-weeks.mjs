/**
 * Importa/reimporta semanas de nómina desde un xlsx (export del Sheet Google)
 * y marca como pagado según martes siguiente al cierre (Lun–Dom).
 *
 * Uso:
 *   node --import ./scripts/register-ts-alias.mjs --experimental-strip-types \
 *     scripts/hr-import-nomina-sheet-weeks.mjs \
 *     --file=ingestor/_tmp_nomina_sheet_2026.xlsx --weeks=31-36 --today=2026-09-08
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { importNominaSheet } from '../app/lib/hr-payroll-import.ts';
import {
  applyPaidSideEffects,
  replacePeriodLines,
} from '../app/lib/hr-payroll-sync.ts';

function loadEnv() {
  const raw = readFileSync('.env.local', 'utf8');
  const env = {};
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
    env[k] = v;
  }
  return env;
}

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function parseWeeks(spec) {
  if (!spec) return [];
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    for (let w = Math.min(a, b); w <= Math.max(a, b); w++) out.add(w);
  }
  return [...out].sort((x, y) => x - y);
}

/** Martes de pago = martes siguiente al domingo de cierre. */
function payTuesday(periodEndIso) {
  const [y, m, d] = periodEndIso.slice(0, 10).split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const wd = end.getUTCDay(); // 0=dom
  const add = wd === 0 ? 2 : ((1 - wd + 7) % 7) || 7;
  end.setUTCDate(end.getUTCDate() + add);
  return end.toISOString().slice(0, 10);
}

/** Semana 1 · 2026 = 2026-01-05..01-11 (override si el xlsx trae mes stale). */
function c50WeekRange2026(weekNum) {
  const start = new Date(Date.UTC(2026, 0, 5 + (weekNum - 1) * 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

const env = { ...process.env, ...loadEnv() };
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Faltan credenciales Supabase en .env.local');
  process.exit(1);
}

const filePath = resolve(arg('file', 'ingestor/_tmp_nomina_sheet_2026.xlsx'));
const weeks = parseWeeks(arg('weeks', '31-36'));
const today = (arg('today') || new Date().toISOString().slice(0, 10)).slice(0, 10);
const username = arg('user', 'script-sheet-import');
const sourceBase = arg('source', 'Sheets:1Cf-2oseooHfrZ9Kup9_GfSXVrZ21i5A4n9gBhJgi1ls');

const sb = createClient(url, key, { auth: { persistSession: false } });
const buffer = readFileSync(filePath);

console.log({ filePath, weeks, today, bytes: buffer.length });

for (const w of weeks) {
  const sheetName = String(w);
  const parsed = importNominaSheet(buffer, sheetName);
  const cal = c50WeekRange2026(w);
  const period_start = cal.periodStart;
  const period_end = cal.periodEnd;
  const label = parsed.meta.weekLabel || `Semana ${w} · 2026`;
  const source_file = `${sourceBase}#${sheetName}`;
  const payTue = payTuesday(period_end);
  const shouldPaid = payTue <= today;
  if (
    parsed.meta.periodStart !== period_start ||
    parsed.meta.periodEnd !== period_end
  ) {
    console.log(
      `W${w}: calendar override ${parsed.meta.periodStart}..${parsed.meta.periodEnd} → ${period_start}..${period_end}`
    );
  }
  const total = parsed.lines.reduce(
    (s, l) => s + (Number(l.importe_pagado) || 0),
    0
  );

  const { data: existing } = await sb
    .from('hr_payroll_periods')
    .select('id,label,status,paid_at,period_start,period_end')
    .ilike('label', `%Semana ${w}%`)
    .gte('period_start', '2026-01-01')
    .lte('period_start', '2026-12-31')
    .order('period_start', { ascending: false });

  let periodId = existing?.[0]?.id || null;
  const prevStatus = existing?.[0]?.status || null;

  if (!periodId) {
    // también buscar por rango
    const byRange = await sb
      .from('hr_payroll_periods')
      .select('id,status')
      .eq('period_start', period_start)
      .eq('period_end', period_end)
      .maybeSingle();
    periodId = byRange.data?.id || null;
  }

  if (!periodId) {
    const ins = await sb
      .from('hr_payroll_periods')
      .insert({
        label,
        period_start,
        period_end,
        status: 'borrador',
        notes: 'Importado desde Google Sheet nómina (cotejo)',
        source_file,
        created_by: username,
        updated_by: username,
      })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      console.error(`W${w}: create fail`, ins.error?.message);
      continue;
    }
    periodId = ins.data.id;
    console.log(`W${w}: CREATED ${periodId}`);
  } else {
    console.log(`W${w}: UPDATE existing ${periodId} (was ${prevStatus})`);
  }

  const replaced = await replacePeriodLines(
    sb,
    periodId,
    parsed.lines,
    'sheets'
  );

  await sb
    .from('hr_payroll_periods')
    .update({
      label,
      period_start,
      period_end,
      source_file,
      updated_by: username,
      updated_at: new Date().toISOString(),
      notes: `Reimport Sheet ${today}; líneas=${replaced.lineCount}`,
    })
    .eq('id', periodId);

  if (shouldPaid) {
    const side = await applyPaidSideEffects(sb, periodId, payTue);
    await sb
      .from('hr_payroll_periods')
      .update({
        status: 'pagado',
        paid_at: side.paid_at,
        updated_by: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId);
    console.log(
      `W${w}: PAGADO paid_at=${side.paid_at} lines=${replaced.lineCount} total≈${total.toFixed(2)} bal=${side.balancesSynced} sd=${side.sueldoSynced}`
    );
  } else {
    await sb
      .from('hr_payroll_periods')
      .update({
        status: 'borrador',
        paid_at: null,
        updated_by: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId);
    console.log(
      `W${w}: BORRADOR (payTue=${payTue}) lines=${replaced.lineCount} total≈${total.toFixed(2)}`
    );
  }
}

console.log('Done.');
