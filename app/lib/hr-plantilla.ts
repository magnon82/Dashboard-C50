/**
 * Plantilla vigente — resolución (unión):
 * 1) Última nómina conciliada (pagado → cerrado) con líneas → empleados
 * 2) Personas con turnos reales (no solo DESCANSO) en la última semana de
 *    horarios (último `publicado`, si no la última semana completada con turnos)
 * 3) Vista SQL hr_plantilla_vigente (mismo criterio de nómina) + (2)
 * 4) Seed local NOMINA C50 2026 (opcional, allowSeed / scripts) + (2)
 *
 * Match de horarios: `hr_schedule_shifts.employee_id` (creados/matcheados por
 * nombre en el import via `matchEmployeeId`); si hace falta, `ensureEmployeesFromNames`.
 *
 * Excluye: status=baja, force_exclude, fecha_baja < hoy (CDMX).
 * Compatible con archivo de bajas (p. ej. Luis Fernando Gallardo).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  formatAntiguedad,
  todayIsoCdmx,
  type HrEmployee,
} from '@/app/lib/hr';
import { normalizePersonName, todayIsoCdmxPayroll } from '@/app/lib/hr-payroll';
import { loadBaseDatosRows } from '@/app/lib/hr-payroll-drive';
import {
  importNominaFromLocal,
  resolveLocalNominaPath,
} from '@/app/lib/hr-payroll-local';
import {
  applyPaidSideEffects,
  enrichEmployeesFromBaseDatos,
  replacePeriodLines,
} from '@/app/lib/hr-payroll-sync';
import { matchEmployeeId } from '@/app/lib/hr-person-match';

export { formatAntiguedad };

const PERIOD_SELECT =
  'id, label, period_start, period_end, status, paid_at, notes, source_file, created_by, updated_by, created_at, updated_at';

/** Columnas mínimas para resolver última nómina conciliada. */
const PERIOD_SELECT_LEAN =
  'id, label, period_start, period_end, status, paid_at, source_file';

const WEEK_SELECT = 'id, week_start, week_end, status, notes';

const EMP_SELECT_BASE =
  'id, full_name, status, puesto, area, fecha_ingreso, email, phone, drive_folder_path, suite_username, force_include, force_exclude, notes';

const EMP_SELECT_BAJA = `${EMP_SELECT_BASE}, fecha_baja`;
const EMP_SELECT = `${EMP_SELECT_BAJA}, fecha_nacimiento`;

/** Elegible: no baja, no force_exclude, no fecha_baja antes de hoy. */
export function isEligibleForPlantilla(
  e: Pick<HrEmployee, 'status' | 'force_exclude' | 'fecha_baja'>,
  today: string = todayIsoCdmx()
): boolean {
  if (e.force_exclude) return false;
  if (e.status === 'baja') return false;
  const baja = e.fecha_baja ? String(e.fecha_baja).slice(0, 10) : null;
  if (baja && baja < today) return false;
  return true;
}

function filterEligible(
  employees: HrEmployee[],
  today: string = todayIsoCdmx()
): HrEmployee[] {
  return employees.filter((e) => isEligibleForPlantilla(e, today));
}

function missingFechaBajaColumn(message: string): boolean {
  return /fecha_baja|column .* does not exist|42703/i.test(message);
}

function missingFechaNacimientoColumn(message: string): boolean {
  return /fecha_nacimiento|column .* does not exist|42703/i.test(message);
}

export type HrPlantillaPeriod = {
  id: string;
  label: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  paid_at: string | null;
  source_file?: string | null;
};

export type HrPlantillaScheduleWeek = {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
};

export type HrPlantillaSeedCode =
  | 'ok'
  | 'file_missing'
  | 'parse_empty'
  | 'schema_missing'
  | 'seed_error'
  | 'empty';

export type HrPlantillaSource =
  | 'nomina_horarios'
  | 'periodo_transcurrido'
  | 'solo_horarios'
  | 'plantilla_vigente'
  | 'seed_local_2026'
  | 'empty';

export type HrPlantillaResult = {
  employees: HrEmployee[];
  period: HrPlantillaPeriod | null;
  scheduleWeek: HrPlantillaScheduleWeek | null;
  source: HrPlantillaSource;
  seeded: boolean;
  seedMessage: string | null;
  seedCode?: HrPlantillaSeedCode | null;
};

/** Cache corta + coalescing de lecturas concurrentes (summary / employees / balances). */
const PLANTILLA_TTL_MS = 20_000;
const plantillaCache = new Map<
  string,
  { at: number; value: HrPlantillaResult }
>();
const plantillaInflight = new Map<string, Promise<HrPlantillaResult>>();

export function invalidatePlantillaCache(): void {
  plantillaCache.clear();
}

type PeriodRow = HrPlantillaPeriod & Record<string, unknown>;

async function selectEmployees(
  sb: SupabaseClient,
  opts: { ids?: string[]; forceIncludeOnly?: boolean }
): Promise<HrEmployee[]> {
  if (opts.ids && opts.ids.length === 0 && !opts.forceIncludeOnly) {
    return [];
  }

  const run = async (cols: string) => {
    let q = sb.from('hr_employees').select(cols).eq('force_exclude', false);
    if (opts.forceIncludeOnly) q = q.eq('force_include', true);
    if (opts.ids?.length) q = q.in('id', opts.ids);
    return q.neq('status', 'baja').order('full_name', { ascending: true });
  };

  let res = await run(EMP_SELECT);
  if (res.error && missingFechaNacimientoColumn(res.error.message)) {
    res = await run(EMP_SELECT_BAJA);
  }
  if (res.error && missingFechaBajaColumn(res.error.message)) {
    res = await run(EMP_SELECT_BASE);
  }
  if (res.error || !res.data) return [];
  return filterEligible(res.data as unknown as HrEmployee[]);
}

/** Una query: periodos candidatos que ya tienen líneas. */
async function periodIdsWithLines(
  sb: SupabaseClient,
  periodIds: string[]
): Promise<Set<string>> {
  if (periodIds.length === 0) return new Set();
  const { data, error } = await sb
    .from('hr_payroll_lines')
    .select('period_id')
    .in('period_id', periodIds);
  if (error || !data) return new Set();
  return new Set(
    data.map((r) => String((r as { period_id: string }).period_id))
  );
}

/** Una query: semanas con al menos un turno real (Ent/Sal). */
async function weekIdsWithRealShifts(
  sb: SupabaseClient,
  weekIds: string[]
): Promise<Set<string>> {
  if (weekIds.length === 0) return new Set();
  const { data, error } = await sb
    .from('hr_schedule_shifts')
    .select('week_id')
    .in('week_id', weekIds)
    .not('start_time', 'is', null)
    .not('end_time', 'is', null);
  if (error || !data) return new Set();
  return new Set(
    data.map((r) => String((r as { week_id: string }).week_id))
  );
}

function asScheduleWeek(raw: {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
}): HrPlantillaScheduleWeek {
  return {
    id: String(raw.id),
    week_start: String(raw.week_start).slice(0, 10),
    week_end: String(raw.week_end).slice(0, 10),
    status: String(raw.status),
  };
}

/**
 * Última semana de horarios para plantilla:
 * 1) último `publicado` con turnos reales
 * 2) si no, última semana completada (`week_end` < hoy) con turnos reales
 */
export async function findLatestScheduleWeekForPlantilla(
  sb: SupabaseClient
): Promise<HrPlantillaScheduleWeek | null> {
  const published = await sb
    .from('hr_schedule_weeks')
    .select(WEEK_SELECT)
    .eq('status', 'publicado')
    .order('week_start', { ascending: false })
    .limit(16);

  if (!published.error && published.data?.length) {
    const weeks = published.data.map((raw) =>
      asScheduleWeek(raw as HrPlantillaScheduleWeek)
    );
    const withShifts = await weekIdsWithRealShifts(
      sb,
      weeks.map((w) => w.id)
    );
    for (const w of weeks) {
      if (withShifts.has(w.id)) return w;
    }
  }

  const today = todayIsoCdmx();
  const completed = await sb
    .from('hr_schedule_weeks')
    .select(WEEK_SELECT)
    .lt('week_end', today)
    .order('week_start', { ascending: false })
    .limit(16);

  if (!completed.error && completed.data?.length) {
    const weeks = completed.data.map((raw) =>
      asScheduleWeek(raw as HrPlantillaScheduleWeek)
    );
    const withShifts = await weekIdsWithRealShifts(
      sb,
      weeks.map((w) => w.id)
    );
    for (const w of weeks) {
      if (withShifts.has(w.id)) return w;
    }
  }

  return null;
}

/**
 * Match / crea `hr_employees` por nombre (misma lógica que import de horarios).
 * Útil si llegan nombres sueltos; el camino DB usa `employee_id` en shifts.
 */
export async function ensureEmployeesFromNames(
  sb: SupabaseClient,
  people: { full_name: string; area?: string | null }[]
): Promise<{ id: string; full_name: string; created: boolean }[]> {
  type Emp = {
    id: string;
    full_name: string;
    area: string | null;
    puesto: string | null;
    status: string;
  };

  const { data: empRows } = await sb
    .from('hr_employees')
    .select('id, full_name, area, puesto, status');
  const employees = (empRows || []) as Emp[];
  const byKey = new Map<string, Emp>();
  for (const e of employees) {
    byKey.set(normalizePersonName(e.full_name), e);
  }

  const out: { id: string; full_name: string; created: boolean }[] = [];
  const seen = new Set<string>();

  for (const p of people) {
    const name = p.full_name.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = normalizePersonName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const existingId = matchEmployeeId(name, byKey, employees);
    if (existingId) {
      const existing = employees.find((e) => e.id === existingId);
      // Mostrar siempre el full_name de DB (canónico), no el alias Excel.
      out.push({
        id: existingId,
        full_name: existing?.full_name ?? name,
        created: false,
      });
      continue;
    }

    const insert = {
      full_name: name,
      status: 'activo' as const,
      area: p.area ?? null,
      puesto: null as string | null,
      source: 'xlsx' as const,
    };
    const { data: created, error } = await sb
      .from('hr_employees')
      .insert(insert)
      .select('id, full_name, area, puesto, status')
      .single();
    if (error || !created) continue;
    const e = created as Emp;
    employees.push(e);
    byKey.set(normalizePersonName(e.full_name), e);
    out.push({ id: e.id, full_name: e.full_name, created: true });
  }

  return out;
}

/** Empleados con al menos un turno real en la semana (excluye solo-DESCANSO). */
export async function buildPlantillaFromScheduleWeek(
  sb: SupabaseClient,
  week: HrPlantillaScheduleWeek
): Promise<HrEmployee[]> {
  const { data: shifts, error } = await sb
    .from('hr_schedule_shifts')
    .select('employee_id, area, role_label')
    .eq('week_id', week.id)
    .not('start_time', 'is', null)
    .not('end_time', 'is', null);

  if (error || !shifts?.length) return [];

  const areaByEmp = new Map<string, string>();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of shifts) {
    const id = String(
      (raw as { employee_id: string }).employee_id || ''
    ).trim();
    if (!id || seen.has(id)) {
      if (id && !areaByEmp.has(id)) {
        const area = (raw as { area?: string | null }).area;
        if (area) areaByEmp.set(id, String(area));
      }
      continue;
    }
    seen.add(id);
    ids.push(id);
    const area = (raw as { area?: string | null }).area;
    if (area) areaByEmp.set(id, String(area));
  }

  const byId = new Map<string, HrEmployee>();
  for (const e of await selectEmployees(sb, { ids })) {
    const areaHint = areaByEmp.get(e.id);
    const hintOk =
      areaHint &&
      !/^piso$/i.test(
        areaHint
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
      )
        ? areaHint
        : null;
    byId.set(e.id, {
      ...e,
      area: e.area || hintOk || null,
      // puesto primero; no copiar área genérica «Piso» al puesto
      puesto: e.puesto || hintOk || null,
      plantilla_origen: 'horario',
      payroll_period_label: null,
      payroll_period_end: null,
      payroll_paid_at: null,
    });
  }

  return [...byId.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, 'es')
  );
}

/** Última nómina conciliada: pagado con líneas, si no cerrado con líneas. */
export async function findLatestTranscurridaPeriod(
  sb: SupabaseClient
): Promise<HrPlantillaPeriod | null> {
  const paid = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT_LEAN)
    .eq('status', 'pagado')
    .order('period_end', { ascending: false })
    .order('paid_at', { ascending: false })
    .limit(8);

  if (!paid.error && paid.data?.length) {
    const rows = paid.data as PeriodRow[];
    const withLines = await periodIdsWithLines(
      sb,
      rows.map((p) => p.id)
    );
    for (const p of rows) {
      if (withLines.has(p.id)) return p;
    }
  }

  const closed = await sb
    .from('hr_payroll_periods')
    .select(PERIOD_SELECT_LEAN)
    .eq('status', 'cerrado')
    .order('period_end', { ascending: false })
    .limit(8);

  if (!closed.error && closed.data?.length) {
    const rows = closed.data as PeriodRow[];
    const withLines = await periodIdsWithLines(
      sb,
      rows.map((p) => p.id)
    );
    for (const p of rows) {
      if (withLines.has(p.id)) return p;
    }
  }

  return null;
}

export async function buildPlantillaFromPeriod(
  sb: SupabaseClient,
  period: HrPlantillaPeriod
): Promise<HrEmployee[]> {
  const { data: lines, error: linesErr } = await sb
    .from('hr_payroll_lines')
    .select('employee_id')
    .eq('period_id', period.id);

  if (linesErr) throw new Error(linesErr.message);

  const ids = [
    ...new Set(
      (lines || [])
        .map((l) => String((l as { employee_id: string }).employee_id || ''))
        .filter(Boolean)
    ),
  ];

  const byId = new Map<string, HrEmployee>();

  const [fromLines, forceInclude] = await Promise.all([
    selectEmployees(sb, { ids }),
    selectEmployees(sb, { forceIncludeOnly: true }),
  ]);

  for (const e of fromLines) {
    byId.set(e.id, {
      ...e,
      plantilla_origen:
        period.status === 'pagado' ? 'nomina_pagada' : 'nomina_transcurrida',
      payroll_period_label: period.label,
      payroll_period_end: period.period_end,
      payroll_paid_at: period.paid_at,
    });
  }

  for (const e of forceInclude) {
    if (byId.has(e.id)) continue;
    byId.set(e.id, {
      ...e,
      plantilla_origen: 'force_include',
      payroll_period_label: period.label,
      payroll_period_end: period.period_end,
      payroll_paid_at: period.paid_at,
    });
  }

  return [...byId.values()]
    .filter((e) => isEligibleForPlantilla(e))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'));
}

async function readViewPlantilla(
  sb: SupabaseClient
): Promise<HrEmployee[] | null> {
  const extras =
    'plantilla_origen, payroll_period_label, payroll_period_end, payroll_paid_at';
  const full = await sb
    .from('hr_plantilla_vigente')
    .select(`${EMP_SELECT}, ${extras}`)
    .order('full_name', { ascending: true });

  if (!full.error) {
    return filterEligible((full.data || []) as unknown as HrEmployee[]);
  }

  if (missingFechaNacimientoColumn(full.error.message)) {
    const mid = await sb
      .from('hr_plantilla_vigente')
      .select(`${EMP_SELECT_BAJA}, ${extras}`)
      .order('full_name', { ascending: true });
    if (!mid.error) {
      return filterEligible((mid.data || []) as unknown as HrEmployee[]);
    }
    if (!missingFechaBajaColumn(mid.error.message)) return null;
  } else if (!missingFechaBajaColumn(full.error.message)) {
    return null;
  }

  const fallback = await sb
    .from('hr_plantilla_vigente')
    .select(`${EMP_SELECT_BASE}, ${extras}`)
    .order('full_name', { ascending: true });
  if (fallback.error) return null;
  return filterEligible((fallback.data || []) as unknown as HrEmployee[]);
}

function classifySeedError(message: string): HrPlantillaSeedCode {
  if (/does not exist|schema cache|42P01/i.test(message)) {
    return 'schema_missing';
  }
  return 'seed_error';
}

const EMPTY_NOMINA_HINT =
  'Abre Nómina (cierra/paga la última semana) o importa horarios con turnos reales.';

async function emptyPlantillaHint(): Promise<string> {
  try {
    if (await resolveLocalNominaPath(2026)) {
      return `${EMPTY_NOMINA_HINT} (hay «NOMINA C50 2026» en Descargas: importa en RH → Nómina si aún no está).`;
    }
  } catch {
    /* ignore */
  }
  return EMPTY_NOMINA_HINT;
}

/** Une nómina + horarios; horarios no pisan origen de nómina. */
function mergePlantillaEmployees(
  fromNomina: HrEmployee[],
  fromSchedule: HrEmployee[]
): HrEmployee[] {
  const byId = new Map<string, HrEmployee>();
  for (const e of fromNomina) byId.set(e.id, e);
  for (const e of fromSchedule) {
    const prev = byId.get(e.id);
    if (!prev) {
      byId.set(e.id, e);
      continue;
    }
    byId.set(e.id, {
      ...prev,
      area: prev.area || e.area || null,
      puesto: prev.puesto || e.puesto || e.area || null,
      plantilla_origen:
        prev.plantilla_origen && prev.plantilla_origen !== 'horario'
          ? `${prev.plantilla_origen}+horario`
          : prev.plantilla_origen || 'horario',
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, 'es')
  );
}

function pickSource(
  hasNomina: boolean,
  hasSchedule: boolean,
  nominaKind: 'periodo' | 'view' | 'seed' | null
): HrPlantillaSource {
  if (hasNomina && hasSchedule) {
    if (nominaKind === 'seed') return 'seed_local_2026';
    if (nominaKind === 'view') return 'plantilla_vigente';
    return 'nomina_horarios';
  }
  if (hasSchedule) return 'solo_horarios';
  if (nominaKind === 'seed') return 'seed_local_2026';
  if (nominaKind === 'view') return 'plantilla_vigente';
  if (hasNomina) return 'periodo_transcurrido';
  return 'empty';
}

/** Script / allowSeed: importa última SEM del xlsx 2026 y marca pagado. */
export async function seedPlantillaFromLocal2026(
  sb: SupabaseClient,
  username: string
): Promise<{
  ok: boolean;
  period: HrPlantillaPeriod | null;
  employees: HrEmployee[];
  message: string;
  code: HrPlantillaSeedCode;
}> {
  const resolved = await resolveLocalNominaPath(2026);
  if (!resolved) {
    return {
      ok: false,
      period: null,
      employees: [],
      code: 'file_missing',
      message:
        'No se encontró «NOMINA C50 2026 .xlsx» en Descargas. Abre RH → Nómina y marca/cierra la última semana.',
    };
  }

  try {
    const parsed = await importNominaFromLocal(2026, '');
    if (!parsed.lines.length) {
      return {
        ok: false,
        period: null,
        employees: [],
        code: 'parse_empty',
        message: 'Ninguna hoja SEM del archivo 2026 tiene líneas legibles.',
      };
    }

    try {
      const { rows } = await loadBaseDatosRows();
      await enrichEmployeesFromBaseDatos(sb, rows);
    } catch {
      /* optional */
    }

    const label =
      parsed.meta.weekLabel || parsed.meta.name || 'SEM importada 2026';
    const period_start =
      parsed.meta.periodStart || todayIsoCdmxPayroll();
    const period_end = parsed.meta.periodEnd || todayIsoCdmxPayroll();

    const { data: period, error } = await sb
      .from('hr_payroll_periods')
      .insert({
        label,
        period_start,
        period_end,
        status: 'borrador',
        notes: 'Seed Plantilla desde NOMINA C50 2026 (última SEM)',
        source_file: parsed.sourceLabel,
        created_by: username,
        updated_by: username,
      })
      .select(PERIOD_SELECT)
      .single();

    if (error || !period) {
      const msg = error?.message || 'No se pudo crear el periodo de nómina';
      return {
        ok: false,
        period: null,
        employees: [],
        code: classifySeedError(msg),
        message:
          classifySeedError(msg) === 'schema_missing'
            ? 'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.'
            : msg,
      };
    }

    const periodId = String((period as HrPlantillaPeriod).id);
    await replacePeriodLines(sb, periodId, parsed.lines, 'nomina_import');
    const side = await applyPaidSideEffects(sb, periodId, period_end);
    await sb
      .from('hr_payroll_periods')
      .update({
        status: 'pagado',
        paid_at: side.paid_at,
        updated_by: username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', periodId);

    const refreshed: HrPlantillaPeriod = {
      ...(period as HrPlantillaPeriod),
      status: 'pagado',
      paid_at: side.paid_at,
    };
    const employees = await buildPlantillaFromPeriod(sb, refreshed);

    return {
      ok: employees.length > 0,
      period: refreshed,
      employees,
      code: employees.length > 0 ? 'ok' : 'parse_empty',
      message: `Plantilla armada desde ${parsed.sourceLabel} (${employees.length} colaboradores).`,
    };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : 'No se pudo importar la nómina local 2026';
    const code = classifySeedError(msg);
    return {
      ok: false,
      period: null,
      employees: [],
      code,
      message:
        code === 'schema_missing'
          ? 'Tablas RR.HH. no migradas. Ejecuta supabase/hr_module.sql en Supabase.'
          : msg,
    };
  }
}

async function resolvePlantillaVigenteUncached(
  sb: SupabaseClient,
  opts?: { allowSeed?: boolean; username?: string }
): Promise<HrPlantillaResult> {
  let nominaEmployees: HrEmployee[] = [];
  let period: HrPlantillaPeriod | null = null;
  let nominaKind: 'periodo' | 'view' | 'seed' | null = null;
  let seeded = false;
  let seedMessage: string | null = null;
  let seedCode: HrPlantillaSeedCode | null = null;

  // Nómina + semana de horarios en paralelo; armado de horarios solapa el resto.
  const [transcurrida, scheduleWeek] = await Promise.all([
    findLatestTranscurridaPeriod(sb),
    findLatestScheduleWeekForPlantilla(sb),
  ]);
  const scheduleBuildP = scheduleWeek
    ? buildPlantillaFromScheduleWeek(sb, scheduleWeek)
    : Promise.resolve([] as HrEmployee[]);

  if (transcurrida) {
    const employees = await buildPlantillaFromPeriod(sb, transcurrida);
    if (employees.length > 0) {
      nominaEmployees = employees;
      period = transcurrida;
      nominaKind = 'periodo';
      seedCode = 'ok';
    }
  }

  if (nominaEmployees.length === 0) {
    const fromView = await readViewPlantilla(sb);
    if (fromView && fromView.length > 0) {
      nominaEmployees = fromView;
      nominaKind = 'view';
      seedCode = 'ok';
      const periodLabel =
        fromView.find((e) => e.payroll_period_label)?.payroll_period_label ??
        null;
      const periodEnd =
        fromView.find((e) => e.payroll_period_end)?.payroll_period_end ?? null;
      const paidAt =
        fromView.find((e) => e.payroll_paid_at)?.payroll_paid_at ?? null;
      period = periodLabel
        ? {
            id: '',
            label: periodLabel,
            period_start: null,
            period_end: periodEnd,
            status: 'pagado',
            paid_at: paidAt,
          }
        : null;
    }
  }

  if (nominaEmployees.length === 0 && opts?.allowSeed && opts.username) {
    const seed = await seedPlantillaFromLocal2026(sb, opts.username);
    if (seed.ok) {
      nominaEmployees = seed.employees;
      period = seed.period;
      nominaKind = 'seed';
      seeded = true;
      seedMessage = seed.message;
      seedCode = 'ok';
      invalidatePlantillaCache();
    } else {
      seedMessage = `${await emptyPlantillaHint()} ${seed.message}`;
      seedCode = seed.code === 'file_missing' ? 'empty' : seed.code;
    }
  }

  const scheduleEmployees = await scheduleBuildP;

  const employees = mergePlantillaEmployees(
    nominaEmployees,
    scheduleEmployees
  );

  const hasNomina = nominaEmployees.length > 0;
  const hasSchedule = scheduleEmployees.length > 0;
  const source = pickSource(hasNomina, hasSchedule, nominaKind);

  if (employees.length === 0) {
    return {
      employees: [],
      period: null,
      scheduleWeek: null,
      source: 'empty',
      seeded: false,
      seedMessage: seedMessage || (await emptyPlantillaHint()),
      seedCode: seedCode ?? 'empty',
    };
  }

  return {
    employees,
    period,
    scheduleWeek: hasSchedule ? scheduleWeek : null,
    source,
    seeded,
    seedMessage,
    seedCode: seedCode ?? 'ok',
  };
}

export async function resolvePlantillaVigente(
  sb: SupabaseClient,
  opts?: { allowSeed?: boolean; username?: string }
): Promise<HrPlantillaResult> {
  // Lecturas puras: TTL + coalescing. Seed (mutación) no se cachea.
  const cacheable = !opts?.allowSeed;
  const key = cacheable ? 'read' : `seed:${opts?.username || 'anon'}`;

  if (cacheable) {
    const hit = plantillaCache.get(key);
    if (hit && Date.now() - hit.at < PLANTILLA_TTL_MS) {
      return hit.value;
    }
  }

  const inflight = plantillaInflight.get(key);
  if (inflight) return inflight;

  const promise = resolvePlantillaVigenteUncached(sb, opts)
    .then((value) => {
      if (cacheable || (value.employees.length > 0 && !value.seeded)) {
        plantillaCache.set('read', { at: Date.now(), value });
      }
      plantillaInflight.delete(key);
      return value;
    })
    .catch((err) => {
      plantillaInflight.delete(key);
      throw err;
    });

  plantillaInflight.set(key, promise);
  return promise;
}
