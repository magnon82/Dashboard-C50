/**
 * Soft-load / import de HORARIOS C50 → hr_schedule_weeks + shifts.
 * Usado por /api/hr/schedules/import (ensure_year) y scripts de verificación.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { mondayOfIsoWeek, todayIsoCdmx } from '@/app/lib/hr';
import { normalizePersonName } from '@/app/lib/hr-payroll';
import {
  folderBasenameFromPath,
  type NamedPerson,
} from '@/app/lib/hr-person-match';
import {
  matchEmployeeId,
  parseAllHorariosWeeks,
  statusForImportedWeek,
  type ParsedScheduleWeek,
} from '@/app/lib/hr-schedule-import';
import {
  formatLocalHorariosLabel,
  listLocalHorariosFiles,
  readLocalHorariosBuffer,
  resolveLocalHorariosPath,
} from '@/app/lib/hr-schedule-local';
import { isRomanSanchezName } from '@/app/lib/hr-puestos';

const WEEK_SELECT =
  'id, week_start, week_end, status, notes, created_by, published_by, published_at, created_at, updated_at';

export type EnsureYearSchedulesResult = {
  ready: boolean;
  message: string;
  label: string | null;
  year: number;
  weeksImported: number;
  weeksSkipped: number;
  weeksAlready: number;
  shiftsImported: number;
  shiftsSkippedUnmatched: number;
  matchedNames: number;
  createdEmployees: number;
  unmatchedNames: string[];
  fileMissing: boolean;
  weekResults: {
    week_start: string;
    status: string;
    shifts: number;
    action: 'created' | 'replaced' | 'skipped';
  }[];
};

type Emp = {
  id: string;
  full_name: string;
  area: string | null;
  puesto: string | null;
  status: string;
  drive_folder_path?: string | null;
};

export async function probeLocalHorariosYear(year: number): Promise<{
  fileOk: boolean;
  label: string | null;
  fileName: string | null;
}> {
  const resolved = await resolveLocalHorariosPath(year);
  if (!resolved) {
    const listed = await listLocalHorariosFiles();
    const hit = listed.find((f) => f.year === year);
    if (!hit) {
      return { fileOk: false, label: null, fileName: null };
    }
    return {
      fileOk: true,
      label: formatLocalHorariosLabel(hit),
      fileName: hit.fileName,
    };
  }
  return {
    fileOk: true,
    label: friendlyLabel(resolved.fileName, year),
    fileName: resolved.fileName,
  };
}

function friendlyLabel(fileName: string, year: number): string {
  const base = fileName.replace(/\.xlsx$/i, '').replace(/\s+/g, ' ').trim();
  return base || `HORARIOS C50 ${year}`;
}

async function resolveNameMap(
  sb: SupabaseClient,
  weeks: ParsedScheduleWeek[],
  createMissing: boolean
): Promise<{
  nameToId: Map<string, string>;
  matchedNames: number;
  createdEmployees: number;
  unmatchedNames: string[];
}> {
  const withPath = await sb
    .from('hr_employees')
    .select('id, full_name, area, puesto, status, drive_folder_path');
  const { data: empRows, error: empErr } =
    withPath.error && /drive_folder_path|column/i.test(withPath.error.message)
      ? await sb
          .from('hr_employees')
          .select('id, full_name, area, puesto, status')
      : withPath;

  if (empErr) {
    throw new Error(empErr.message);
  }

  const employees = (empRows || []) as Emp[];
  const byKey = new Map<string, Emp>();
  const namedForMatch: NamedPerson[] = employees.map((e) => {
    const base = folderBasenameFromPath(e.drive_folder_path);
    byKey.set(normalizePersonName(e.full_name), e);
    if (base) {
      const bk = normalizePersonName(base);
      if (bk && !byKey.has(bk)) byKey.set(bk, e);
    }
    return {
      id: e.id,
      full_name: e.full_name,
      aliases: base ? [base] : undefined,
    };
  });

  const allNames = new Set<string>();
  for (const w of weeks) {
    for (const p of w.people) allNames.add(p);
  }

  let createdEmployees = 0;
  let matchedNames = 0;
  const unmatchedNames: string[] = [];
  const nameToId = new Map<string, string>();

  for (const name of allNames) {
    // Match por full_name canónico (expediente); no sobrescribe el nombre con Excel corto.
    const id = matchEmployeeId(name, byKey, namedForMatch);
    if (id) {
      nameToId.set(name, id);
      matchedNames += 1;
      continue;
    }
    if (!createMissing) {
      unmatchedNames.push(name);
      continue;
    }
    const insert = {
      full_name: name,
      status: 'activo' as const,
      area: null as string | null,
      puesto: null as string | null,
      source: 'xlsx' as const,
    };
    for (const w of weeks) {
      const hit = w.shifts.find((s) => s.employee_name === name && s.area);
      if (hit?.area) {
        insert.area = hit.area;
        break;
      }
    }
    const { data: created, error: cErr } = await sb
      .from('hr_employees')
      .insert(insert)
      .select('id, full_name, area, puesto, status, drive_folder_path')
      .single();
    if (cErr || !created) {
      unmatchedNames.push(name);
      continue;
    }
    const e = created as Emp;
    employees.push(e);
    byKey.set(normalizePersonName(e.full_name), e);
    namedForMatch.push({
      id: e.id,
      full_name: e.full_name,
      aliases: undefined,
    });
    nameToId.set(name, e.id);
    createdEmployees += 1;
    matchedNames += 1;
  }

  return { nameToId, matchedNames, createdEmployees, unmatchedNames };
}

/** Soft-load: pasado + en curso (≤ lunes CDMX) en borrador/propuesta → publicado. */
export async function healPastAndCurrentWeekStatuses(
  sb: SupabaseClient,
  username: string,
  year: number,
  today = todayIsoCdmx()
): Promise<number> {
  const currentMon = mondayOfIsoWeek(today);
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('hr_schedule_weeks')
    .update({
      status: 'publicado',
      published_by: username,
      published_at: nowIso,
      updated_at: nowIso,
    })
    .gte('week_start', `${year}-01-01`)
    .lte('week_start', currentMon)
    .in('status', ['borrador', 'propuesta'])
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

async function upsertParsedWeek(
  sb: SupabaseClient,
  username: string,
  week: ParsedScheduleWeek,
  nameToId: Map<string, string>,
  label: string,
  replace: boolean
): Promise<{
  action: 'created' | 'replaced' | 'skipped';
  status: string;
  shifts: number;
  shiftsSkippedUnmatched: number;
}> {
  const status = statusForImportedWeek(week.week_start);
  const { data: existing } = await sb
    .from('hr_schedule_weeks')
    .select('id, status')
    .eq('week_start', week.week_start)
    .maybeSingle();

  if (existing) {
    const { count: shiftCount } = await sb
      .from('hr_schedule_shifts')
      .select('id', { count: 'exact', head: true })
      .eq('week_id', existing.id);
    const emptyButExcelHas =
      (shiftCount ?? 0) === 0 && week.shifts.length > 0;
    const shouldReplace = replace || emptyButExcelHas;

    if (!shouldReplace) {
      // Heal status without full reimport
      if (
        status === 'publicado' &&
        existing.status !== 'publicado'
      ) {
        const nowIso = new Date().toISOString();
        await sb
          .from('hr_schedule_weeks')
          .update({
            status: 'publicado',
            published_by: username,
            published_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', existing.id);
        return {
          action: 'skipped',
          status: 'publicado',
          shifts: 0,
          shiftsSkippedUnmatched: 0,
        };
      }
      return {
        action: 'skipped',
        status: String(existing.status),
        shifts: 0,
        shiftsSkippedUnmatched: 0,
      };
    }
    await sb.from('hr_schedule_weeks').delete().eq('id', existing.id);
  }

  const notes = [
    `Importado de ${label}`,
    week.periodLabel ? `Periodo sheet: ${week.periodLabel}` : null,
    `Hoja ${week.sheetName}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const nowIso = new Date().toISOString();
  const weekInsert: Record<string, unknown> = {
    week_start: week.week_start,
    week_end: week.week_end,
    status,
    notes,
    created_by: username,
    updated_at: nowIso,
  };
  if (status === 'publicado') {
    weekInsert.published_by = username;
    weekInsert.published_at = nowIso;
  }

  const { data: weekRow, error: wErr } = await sb
    .from('hr_schedule_weeks')
    .insert(weekInsert)
    .select(WEEK_SELECT)
    .single();

  if (wErr || !weekRow) {
    throw new Error(wErr?.message || `No se pudo crear semana ${week.week_start}`);
  }

  const shiftRows: Record<string, unknown>[] = [];
  let shiftsSkippedUnmatched = 0;
  for (const s of week.shifts) {
    const employee_id = nameToId.get(s.employee_name);
    if (!employee_id) {
      shiftsSkippedUnmatched += 1;
      continue;
    }
    const isLimp = s.area === 'Limpieza';
    const roman = isRomanSanchezName(s.employee_name);
    shiftRows.push({
      week_id: weekRow.id,
      employee_id,
      shift_date: s.shift_date,
      start_time: s.start_time,
      end_time: s.end_time,
      area: s.area,
      role_label: isLimp ? 'Limpieza' : null,
      origin: 'manual',
      notes:
        roman && isLimp
          ? 'dual_limpieza_mesero:limpieza'
          : roman && s.area === 'Meseros'
            ? 'dual_limpieza_mesero:mesero'
            : null,
    });
  }

  if (shiftRows.length > 0) {
    const chunk = 200;
    for (let i = 0; i < shiftRows.length; i += chunk) {
      const slice = shiftRows.slice(i, i + chunk);
      const { error: sErr } = await sb.from('hr_schedule_shifts').insert(slice);
      if (sErr) {
        throw new Error(sErr.message);
      }
    }
  }

  return {
    action: existing ? 'replaced' : 'created',
    status,
    shifts: shiftRows.length,
    shiftsSkippedUnmatched,
  };
}

/**
 * Soft-load: importa semanas faltantes desde xlsx local.
 * refreshExisting=true → reimporta (borra y recrea) todas las del archivo.
 */
export async function ensureYearSchedulesFromLocal(
  sb: SupabaseClient,
  username: string,
  year: number,
  opts?: { refreshExisting?: boolean; createMissing?: boolean }
): Promise<EnsureYearSchedulesResult> {
  const refreshExisting = opts?.refreshExisting === true;
  const createMissing = opts?.createMissing !== false;

  const resolved = await resolveLocalHorariosPath(year);
  if (!resolved) {
    return {
      ready: false,
      message: `No se encontró HORARIOS C50 ${year}.xlsx en Descargas. Colócalo y vuelve a intentar.`,
      label: null,
      year,
      weeksImported: 0,
      weeksSkipped: 0,
      weeksAlready: 0,
      shiftsImported: 0,
      shiftsSkippedUnmatched: 0,
      matchedNames: 0,
      createdEmployees: 0,
      unmatchedNames: [],
      fileMissing: true,
      weekResults: [],
    };
  }

  const { buffer, label, fileName } = await readLocalHorariosBuffer(year);
  const weeks = parseAllHorariosWeeks(buffer, year);
  if (weeks.length === 0) {
    return {
      ready: false,
      message: 'El archivo no tiene hojas SEMANA con turnos legibles.',
      label,
      year,
      weeksImported: 0,
      weeksSkipped: 0,
      weeksAlready: 0,
      shiftsImported: 0,
      shiftsSkippedUnmatched: 0,
      matchedNames: 0,
      createdEmployees: 0,
      unmatchedNames: [],
      fileMissing: false,
      weekResults: [],
    };
  }

  // Soft-load: si ya hay ≥ hojas SEMANA del año y no se pidió refresh,
  // sanear estatus (pasado+curso → publicado) y solo continuar si la
  // semana en curso está vacía pero el Excel trae turnos.
  if (!refreshExisting) {
    const { count, error: yErr } = await sb
      .from('hr_schedule_weeks')
      .select('id', { count: 'exact', head: true })
      .gte('week_start', `${year}-01-01`)
      .lte('week_start', `${year}-12-31`);
    if (yErr) throw new Error(yErr.message);
    const weeksAlready = count ?? 0;
    if (weeksAlready >= weeks.length) {
      const healed = await healPastAndCurrentWeekStatuses(sb, username, year);
      const currentMon = mondayOfIsoWeek(todayIsoCdmx());
      const excelCurrent = weeks.find((w) => w.week_start === currentMon);
      let needFillCurrent = false;
      if (excelCurrent && excelCurrent.shifts.length > 0) {
        const { data: curRow } = await sb
          .from('hr_schedule_weeks')
          .select('id')
          .eq('week_start', currentMon)
          .maybeSingle();
        if (!curRow) {
          needFillCurrent = true;
        } else {
          const { count: sc } = await sb
            .from('hr_schedule_shifts')
            .select('id', { count: 'exact', head: true })
            .eq('week_id', curRow.id);
          needFillCurrent = (sc ?? 0) === 0;
        }
      }
      if (!needFillCurrent) {
        return {
          ready: true,
          message:
            healed > 0
              ? `Ya hay ${weeksAlready} semanas en ${year}; ${healed} pasada(s)/en curso pasaron a publicado.`
              : `Ya hay ${weeksAlready} semanas en ${year} (sin cambios).`,
          label,
          year,
          weeksImported: 0,
          weeksSkipped: weeks.length,
          weeksAlready,
          shiftsImported: 0,
          shiftsSkippedUnmatched: 0,
          matchedNames: 0,
          createdEmployees: 0,
          unmatchedNames: [],
          fileMissing: false,
          weekResults: [],
        };
      }
      // Semana en curso vacía con datos en Excel → seguir al upsert.
    }
  }

  const { nameToId, matchedNames, createdEmployees, unmatchedNames } =
    await resolveNameMap(sb, weeks, createMissing);

  let weeksImported = 0;
  let weeksSkipped = 0;
  let shiftsImported = 0;
  let shiftsSkippedUnmatched = 0;
  const weekResults: EnsureYearSchedulesResult['weekResults'] = [];

  for (const week of weeks) {
    const result = await upsertParsedWeek(
      sb,
      username,
      week,
      nameToId,
      label,
      refreshExisting
    );
    if (result.action === 'skipped') {
      weeksSkipped += 1;
    } else {
      weeksImported += 1;
      shiftsImported += result.shifts;
    }
    shiftsSkippedUnmatched += result.shiftsSkippedUnmatched;
    weekResults.push({
      week_start: week.week_start,
      status: result.status,
      shifts: result.shifts,
      action: result.action,
    });
  }

  // Semanas manuales (vacías / no en Excel) pasadas o en curso → publicado.
  await healPastAndCurrentWeekStatuses(sb, username, year);

  const { count: weeksAlready } = await sb
    .from('hr_schedule_weeks')
    .select('id', { count: 'exact', head: true })
    .gte('week_start', `${year}-01-01`)
    .lte('week_start', `${year}-12-31`);

  const baseName = fileName.replace(/\.xlsx$/i, '');
  const message =
    weeksImported > 0
      ? `Importadas ${weeksImported} semanas · ${shiftsImported} turnos (${baseName})`
      : weeksSkipped > 0
        ? `Sin cambios: ${weeksSkipped} semanas ya estaban en la base.`
        : `No se importaron semanas desde ${baseName}.`;

  return {
    ready: true,
    message,
    label,
    year,
    weeksImported,
    weeksSkipped,
    weeksAlready: weeksAlready ?? 0,
    shiftsImported,
    shiftsSkippedUnmatched,
    matchedNames,
    createdEmployees,
    unmatchedNames: unmatchedNames.slice(0, 40),
    fileMissing: false,
    weekResults,
  };
}
