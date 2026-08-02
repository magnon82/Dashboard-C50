/**
 * Limpia cáscaras de duplicado en BAJA + reasigna turnos huérfanos.
 *
 * - Gallardo: LUIS FERNANDO GALLARDO → GALLARDO ÁVILA LUIS FERNANDO
 * - Juan Pablo Soltero (activo huérfano) → SOLTERO ALEGRIA JUAN PABLO
 * - Reasigna hr_schedule_shifts de cáscaras a su survivor (notes)
 *
 * Uso:
 *   node scripts/hr-cleanup-baja-shells.mjs --dry-run
 *   node scripts/hr-cleanup-baja-shells.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry-run');
const MERGE_NOTE = 'duplicado_fusionado';

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

function isShell(notes) {
  const n = String(notes || '');
  return n.includes(MERGE_NOTE) || /merged_into\s*:/i.test(n);
}

function survivorFromNotes(notes) {
  const n = String(notes || '');
  const m1 = n.match(/duplicado_fusionado→([0-9a-f-]{36})/i);
  if (m1) return m1[1];
  const m2 = n.match(/merged_into\s*:\s*([0-9a-f-]{36})/i);
  if (m2) return m2[1];
  return null;
}

async function reassignShifts(sb, loserId, survivorId) {
  const { data: rows, error } = await sb
    .from('hr_schedule_shifts')
    .select('id, week_id, shift_date')
    .eq('employee_id', loserId);
  if (error || !rows?.length) return { moved: 0, dropped: 0 };

  let moved = 0;
  let dropped = 0;
  for (const row of rows) {
    const { data: conflict } = await sb
      .from('hr_schedule_shifts')
      .select('id')
      .eq('employee_id', survivorId)
      .eq('week_id', row.week_id)
      .eq('shift_date', row.shift_date)
      .maybeSingle();
    if (conflict) {
      if (!DRY) await sb.from('hr_schedule_shifts').delete().eq('id', row.id);
      dropped += 1;
    } else if (!DRY) {
      await sb
        .from('hr_schedule_shifts')
        .update({ employee_id: survivorId })
        .eq('id', row.id);
      moved += 1;
    } else {
      moved += 1;
    }
  }
  return { moved, dropped };
}

async function markMergedLoser(sb, loser, survivorId, extraNote) {
  const noteBits = [
    loser.notes,
    `${MERGE_NOTE}→${survivorId}`,
    extraNote,
  ]
    .filter(Boolean)
    .join(' | ');
  const patch = {
    status: 'baja',
    force_exclude: true,
    force_include: false,
    notes: noteBits,
    updated_at: new Date().toISOString(),
  };
  if (!DRY) {
    await sb.from('hr_employees').update(patch).eq('id', loser.id);
  }
  console.log(
    DRY ? '[dry]' : '[ok]',
    'merge loser',
    loser.full_name,
    '→',
    survivorId.slice(0, 8)
  );
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan env Supabase');
    process.exit(1);
  }
  if (DRY) console.log('(dry-run)\n');

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from('hr_employees')
    .select(
      'id, full_name, status, puesto, force_exclude, force_include, notes, drive_folder_path'
    )
    .order('full_name');
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  const byId = new Map(data.map((e) => [e.id, e]));

  // 1) Reassign leftover shifts on merge shells
  console.log('=== Reasignar turnos de cáscaras ===');
  for (const e of data) {
    if (!isShell(e.notes)) continue;
    const survivorId = survivorFromNotes(e.notes);
    if (!survivorId || !byId.has(survivorId)) {
      console.log('skip (sin survivor):', e.full_name);
      continue;
    }
    const r = await reassignShifts(sb, e.id, survivorId);
    if (r.moved || r.dropped) {
      console.log(
        e.full_name,
        '→',
        byId.get(survivorId).full_name,
        `moved=${r.moved} dropped=${r.dropped}`
      );
    }
  }

  // 2) Gallardo duplicate: keep ÁVILA (has drive folder)
  console.log('\n=== Gallardo ===');
  const gallardoCanon = data.find(
    (e) => e.full_name === 'GALLARDO ÁVILA LUIS FERNANDO'
  );
  const gallardoDup = data.find(
    (e) => e.full_name === 'LUIS FERNANDO GALLARDO'
  );
  if (
    gallardoCanon &&
    gallardoDup &&
    gallardoDup.id !== gallardoCanon.id &&
    !isShell(gallardoDup.notes)
  ) {
    const r = await reassignShifts(sb, gallardoDup.id, gallardoCanon.id);
    console.log('shifts', r);
    await markMergedLoser(
      sb,
      gallardoDup,
      gallardoCanon.id,
      'duplicado nómina Gallardo (misma baja 2026-07-20)'
    );
  } else {
    console.log(
      gallardoDup && isShell(gallardoDup.notes)
        ? 'already shell (hidden in UI)'
        : 'no pair found / already merged'
    );
  }

  // 3) Juan Pablo Soltero (activo huérfano) → SOLTERO ALEGRIA (baja real)
  console.log('\n=== Juan Pablo Soltero ===');
  const solteroCanon = data.find(
    (e) => e.full_name === 'SOLTERO ALEGRIA JUAN PABLO'
  );
  const solteroShort = data.find(
    (e) => e.full_name === 'Juan Pablo Soltero'
  );
  if (
    solteroCanon &&
    solteroShort &&
    solteroShort.id !== solteroCanon.id &&
    !isShell(solteroShort.notes)
  ) {
    const r = await reassignShifts(sb, solteroShort.id, solteroCanon.id);
    console.log('shifts', r);
    await markMergedLoser(
      sb,
      solteroShort,
      solteroCanon.id,
      'huérfano activo; misma persona que SOLTERO ALEGRIA (baja 2026-04-26)'
    );
    // Repoint Juan Pablo shell if it pointed at short name
    const juanPablo = data.find((e) => e.full_name === 'Juan Pablo');
    if (juanPablo && isShell(juanPablo.notes)) {
      const already = String(juanPablo.notes || '').includes(solteroCanon.id);
      if (!already) {
        const patch = {
          notes: `${MERGE_NOTE}→${solteroCanon.id} | repointed to SOLTERO ALEGRIA JUAN PABLO`,
          updated_at: new Date().toISOString(),
        };
        if (!DRY) {
          await sb.from('hr_employees').update(patch).eq('id', juanPablo.id);
        }
        console.log(
          DRY ? '[dry]' : '[ok]',
          'repoint Juan Pablo notes → SOLTERO'
        );
      }
    }
  } else {
    console.log(
      solteroShort && isShell(solteroShort.notes)
        ? 'already shell (hidden in UI)'
        : 'no pair found / already merged'
    );
  }

  // 4) Summary of what UI will show
  const { data: after } = await sb
    .from('hr_employees')
    .select('id, full_name, status, notes, puesto')
    .eq('status', 'baja')
    .order('full_name');
  const operational = (after || []).filter((e) => !isShell(e.notes));
  const shells = (after || []).filter((e) => isShell(e.notes));
  console.log('\n=== BAJA operativa (UI) ===');
  for (const e of operational) {
    console.log('-', e.full_name, '|', e.puesto || '-');
  }
  console.log('\n=== Cáscaras ocultas ===');
  for (const e of shells) {
    console.log('-', e.full_name, '→', survivorFromNotes(e.notes)?.slice(0, 8));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
