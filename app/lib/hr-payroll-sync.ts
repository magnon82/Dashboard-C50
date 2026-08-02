/** Persistencia de periodos/líneas + sync plantilla/saldos al pagar. */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  emptyDiasSemana,
  normalizeDiasSemana,
  normalizePersonName,
  sumDiasSemana,
  todayIsoCdmxPayroll,
  type HrPayrollLineInput,
} from '@/app/lib/hr-payroll';
import {
  folderBasenameFromPath,
  matchPerson,
  preferCanonicalFullName,
  shouldKeepExistingFullName,
} from '@/app/lib/hr-person-match';
import {
  importNominaSheet,
  weekNumFromNominaSheetName,
  type BaseDatosRow,
} from '@/app/lib/hr-payroll-import';
import { listSheetsFromLocalFile } from '@/app/lib/hr-payroll-local';

type EmpRow = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  fecha_ingreso: string | null;
  sueldo_diario: number | null;
  email: string | null;
  phone: string | null;
  status: string;
  force_exclude?: boolean | null;
  fecha_baja?: string | null;
  drive_folder_path?: string | null;
};

export async function loadEmployeeNameMap(
  sb: SupabaseClient
): Promise<Map<string, EmpRow>> {
  const withPath = await sb
    .from('hr_employees')
    .select(
      'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, force_exclude, fecha_baja, drive_folder_path'
    );
  const withBaja =
    withPath.error && /drive_folder_path|column/i.test(withPath.error.message)
      ? await sb
          .from('hr_employees')
          .select(
            'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, force_exclude, fecha_baja'
          )
      : withPath;
  const { data, error } =
    withBaja.error && /fecha_baja|column/i.test(withBaja.error.message)
      ? await sb
          .from('hr_employees')
          .select(
            'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, force_exclude'
          )
      : withBaja;
  if (error) throw new Error(error.message);
  const map = new Map<string, EmpRow>();
  for (const row of data || []) {
    const e = row as EmpRow;
    map.set(normalizePersonName(e.full_name), e);
    const base = folderBasenameFromPath(e.drive_folder_path);
    if (base) {
      const bk = normalizePersonName(base);
      if (bk && !map.has(bk)) map.set(bk, e);
    }
  }
  return map;
}

/**
 * Resuelve o crea empleados a partir de líneas de nómina.
 * Actualiza puesto/SD/fecha_ingreso cuando vienen en la línea.
 */
export async function resolveEmployeesForLines(
  sb: SupabaseClient,
  lines: HrPayrollLineInput[],
  source: 'manual' | 'nomina_import' | 'xlsx' | 'sheets' = 'nomina_import'
): Promise<{ employeeIdByKey: Map<string, string>; created: number; updated: number }> {
  const existing = await loadEmployeeNameMap(sb);
  const employeeIdByKey = new Map<string, string>();
  let created = 0;
  let updated = 0;

  const allExisting = [...new Map([...existing.values()].map((e) => [e.id, e])).values()];

  for (const line of lines) {
    const key = normalizePersonName(line.full_name);
    if (!key) continue;
    let found = existing.get(key) ?? null;
    if (!found) {
      const soft = matchPerson(
        line.full_name,
        allExisting.map((e) => ({
          id: e.id,
          full_name: e.full_name,
          aliases: (() => {
            const base = folderBasenameFromPath(e.drive_folder_path);
            return base ? [base] : undefined;
          })(),
        }))
      );
      if (soft.autoLink && soft.employeeId) {
        found = allExisting.find((e) => e.id === soft.employeeId) ?? null;
      }
    }
    if (found) {
      employeeIdByKey.set(key, found.id);
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      // Nunca degradar full_name canónico (expediente) con alias corto Excel.
      const excelName = line.full_name.replace(/\s+/g, ' ').trim();
      if (
        excelName &&
        !shouldKeepExistingFullName(
          found.full_name,
          excelName,
          found.drive_folder_path
        )
      ) {
        const next = preferCanonicalFullName(found.full_name, excelName);
        if (next !== found.full_name.replace(/\s+/g, ' ').trim()) {
          patch.full_name = next;
          found.full_name = next;
        }
      }
      if (line.puesto && line.puesto !== found.puesto) patch.puesto = line.puesto;
      if (line.area && line.area !== found.area) patch.area = line.area;
      if (
        line.sueldo_diario != null &&
        line.sueldo_diario !== Number(found.sueldo_diario)
      ) {
        patch.sueldo_diario = line.sueldo_diario;
      }
      if (line.fecha_ingreso && !found.fecha_ingreso) {
        patch.fecha_ingreso = line.fecha_ingreso;
      }
      if (line.phone && !found.phone) patch.phone = line.phone;
      if (line.email && !found.email) patch.email = line.email;
      // No reactivar bajas archivadas (force_exclude / fecha_baja)
      const archived =
        Boolean(found.force_exclude) || Boolean(found.fecha_baja);
      if (found.status === 'baja' && !archived) patch.status = 'activo';
      if (Object.keys(patch).length > 1) {
        const { error } = await sb
          .from('hr_employees')
          .update(patch)
          .eq('id', found.id);
        if (!error) updated += 1;
      }
      continue;
    }

    const insert = {
      full_name: line.full_name.replace(/\s+/g, ' ').trim(),
      status: 'activo' as const,
      puesto: line.puesto ?? null,
      area: line.area ?? null,
      fecha_ingreso: line.fecha_ingreso ?? null,
      sueldo_diario: line.sueldo_diario ?? null,
      email: line.email ?? null,
      phone: line.phone ?? null,
      source,
    };
    const { data, error } = await sb
      .from('hr_employees')
      .insert(insert)
      .select(
        'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status'
      )
      .single();
    if (error || !data) {
      throw new Error(error?.message || `No se pudo crear ${line.full_name}`);
    }
    const e = data as EmpRow;
    existing.set(key, e);
    employeeIdByKey.set(key, e.id);
    created += 1;
  }

  return { employeeIdByKey, created, updated };
}

export function linesToDbRows(
  periodId: string,
  lines: HrPayrollLineInput[],
  employeeIdByKey: Map<string, string>
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = normalizePersonName(line.full_name);
    const employee_id = employeeIdByKey.get(key);
    if (!employee_id || seen.has(employee_id)) continue;
    seen.add(employee_id);
    const noteParts: string[] = [];
    if (line.antiguedad) noteParts.push(`antigüedad:${line.antiguedad}`);
    if (line.vacaciones_entitled != null) {
      noteParts.push(`vac_entitled:${line.vacaciones_entitled}`);
    }
    if (line.notes) noteParts.push(line.notes);
    const diasSemana = normalizeDiasSemana(line.dias_semana);
    // Matriz activa (aunque quede en 0 tras desmarcar todo) si el cliente la envió
    const useMarks = line.dias_semana != null;
    const diasTrabajados = useMarks
      ? sumDiasSemana(diasSemana ?? emptyDiasSemana())
      : (line.dias_trabajados ?? 0);
    rows.push({
      period_id: periodId,
      employee_id,
      sueldo_diario: line.sueldo_diario ?? null,
      dias_trabajados: diasTrabajados,
      dias_semana: useMarks ? diasSemana ?? emptyDiasSemana() : null,
      horas_extra: line.horas_extra ?? 0,
      bonos: line.bonos ?? 0,
      retenciones: line.retenciones ?? 0,
      importe_pagado: line.importe_pagado ?? 0,
      vacaciones_tomadas: line.vacaciones_tomadas ?? null,
      vacaciones_restantes: line.vacaciones_restantes ?? null,
      puesto_snapshot: line.puesto ?? null,
      notes: noteParts.length ? noteParts.join(' · ') : null,
    });
  }
  return rows;
}

export async function replacePeriodLines(
  sb: SupabaseClient,
  periodId: string,
  lines: HrPayrollLineInput[],
  source: 'manual' | 'nomina_import' | 'xlsx' | 'sheets' = 'nomina_import'
): Promise<{ lineCount: number; employeesCreated: number; employeesUpdated: number }> {
  const { employeeIdByKey, created, updated } = await resolveEmployeesForLines(
    sb,
    lines,
    source
  );
  const rows = linesToDbRows(periodId, lines, employeeIdByKey);

  const del = await sb.from('hr_payroll_lines').delete().eq('period_id', periodId);
  if (del.error) throw new Error(del.error.message);

  if (rows.length > 0) {
    const ins = await sb.from('hr_payroll_lines').insert(rows);
    if (ins.error && /dias_semana/i.test(ins.error.message || '')) {
      // Patch pendiente: supabase/hr_payroll_dias_semana.sql
      const stripped = rows.map((r) => {
        const { dias_semana: _d, ...rest } = r;
        return rest;
      });
      const retry = await sb.from('hr_payroll_lines').insert(stripped);
      if (retry.error) throw new Error(retry.error.message);
    } else if (ins.error) {
      throw new Error(ins.error.message);
    }
  }

  return {
    lineCount: rows.length,
    employeesCreated: created,
    employeesUpdated: updated,
  };
}

export type NominaEnCursoPeriod = {
  id: string;
  label: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
};

async function periodIdsWithPayrollLines(
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

async function periodIdsWithVacationFields(
  sb: SupabaseClient,
  periodIds: string[]
): Promise<Set<string>> {
  if (periodIds.length === 0) return new Set();
  const { data, error } = await sb
    .from('hr_payroll_lines')
    .select('period_id')
    .in('period_id', periodIds)
    .or(
      'vacaciones_tomadas.not.is.null,vacaciones_restantes.not.is.null'
    );
  if (error || !data) return new Set();
  return new Set(
    data.map((r) => String((r as { period_id: string }).period_id))
  );
}

/**
 * Nómina en curso para saldos de vacaciones:
 * 1) borrador con líneas (prioriza la que cubre hoy CDMX),
 * 2) si no, cerrado con líneas,
 * 3) si no, último periodo con campos vacaciones_* (incl. pagado).
 */
export async function findNominaEnCursoPeriod(
  sb: SupabaseClient,
  today: string = todayIsoCdmxPayroll()
): Promise<NominaEnCursoPeriod | null> {
  const select =
    'id, label, period_start, period_end, status';

  async function firstWithLines(
    status: 'borrador' | 'cerrado'
  ): Promise<NominaEnCursoPeriod | null> {
    const { data, error } = await sb
      .from('hr_payroll_periods')
      .select(select)
      .eq('status', status)
      .order('period_end', { ascending: false })
      .order('period_start', { ascending: false })
      .limit(12);
    if (error || !data?.length) return null;

    const rows = data as NominaEnCursoPeriod[];
    const withLines = await periodIdsWithPayrollLines(
      sb,
      rows.map((p) => p.id)
    );
    const covering: NominaEnCursoPeriod[] = [];
    const started: NominaEnCursoPeriod[] = [];
    for (const p of rows) {
      if (!withLines.has(p.id)) continue;
      const start = p.period_start
        ? String(p.period_start).slice(0, 10)
        : null;
      const end = p.period_end ? String(p.period_end).slice(0, 10) : null;
      if (start && end && start <= today && today <= end) covering.push(p);
      else if (start && start <= today) started.push(p);
    }

    // Hoy → ya iniciada (no futura) → resto (futuras solo si no hay otra).
    for (const p of [...covering, ...started, ...rows]) {
      if (withLines.has(p.id)) return p;
    }
    return null;
  }

  const [borrador, cerrado] = await Promise.all([
    firstWithLines('borrador'),
    firstWithLines('cerrado'),
  ]);
  if (borrador) return borrador;
  if (cerrado) return cerrado;

  const { data: anyPeriods, error: anyErr } = await sb
    .from('hr_payroll_periods')
    .select(select)
    .order('period_end', { ascending: false })
    .order('period_start', { ascending: false })
    .limit(16);
  if (anyErr || !anyPeriods?.length) return null;

  const candidates = anyPeriods as NominaEnCursoPeriod[];
  const withVac = await periodIdsWithVacationFields(
    sb,
    candidates.map((p) => p.id)
  );
  for (const p of candidates) {
    if (withVac.has(p.id)) return p;
  }
  return null;
}

/** Etiqueta corta UI: «Semana N» desde label de periodo. */
export function shortNominaWeekLabel(
  label: string | null | undefined
): string | null {
  if (!label) return null;
  const m = String(label).match(/Semana\s+(\d+)/i);
  if (m) return `Semana ${m[1]}`;
  const trimmed = String(label).trim();
  return trimmed || null;
}

/**
 * Sincroniza saldos de vacaciones desde líneas con datos (nómina en curso / al pagar).
 */
export async function syncLeaveBalancesFromPeriod(
  sb: SupabaseClient,
  periodId: string,
  year?: number
): Promise<number> {
  const y = year ?? new Date().getFullYear();
  const { data: lines, error } = await sb
    .from('hr_payroll_lines')
    .select(
      'employee_id, vacaciones_tomadas, vacaciones_restantes, notes'
    )
    .eq('period_id', periodId);
  if (error) throw new Error(error.message);

  let n = 0;
  for (const raw of lines || []) {
    const line = raw as {
      employee_id: string;
      vacaciones_tomadas: number | null;
      vacaciones_restantes: number | null;
      notes: string | null;
    };
    const taken = line.vacaciones_tomadas;
    const remaining = line.vacaciones_restantes;
    let entitled: number | null = null;
    const m = line.notes?.match(/vac_entitled:([0-9.]+)/);
    if (m) entitled = Number(m[1]);
    if (taken == null && remaining == null && entitled == null) continue;

    const days_taken = taken ?? 0;
    const days_remaining = remaining ?? 0;
    const days_entitled =
      entitled ??
      (Number.isFinite(days_taken + days_remaining)
        ? days_taken + days_remaining
        : 0);

    const { error: upErr } = await sb.from('hr_leave_balances').upsert(
      {
        employee_id: line.employee_id,
        year: y,
        days_entitled,
        days_taken,
        days_remaining,
        source: 'nomina_import',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,year' }
    );
    if (!upErr) n += 1;
  }
  return n;
}

/** Enriquece empleados existentes con BASE DATOS PERSONAL (match por nombre). */
export async function enrichEmployeesFromBaseDatos(
  sb: SupabaseClient,
  rows: BaseDatosRow[]
): Promise<{ matched: number; updated: number; created: number }> {
  const existing = await loadEmployeeNameMap(sb);
  let matched = 0;
  let updated = 0;
  let created = 0;

  const allExisting = [
    ...new Map([...existing.values()].map((e) => [e.id, e])).values(),
  ];

  for (const row of rows) {
    const key = normalizePersonName(row.full_name);
    let found = existing.get(key) ?? null;
    if (!found) {
      const soft = matchPerson(
        row.full_name,
        allExisting.map((e) => ({
          id: e.id,
          full_name: e.full_name,
          aliases: (() => {
            const base = folderBasenameFromPath(e.drive_folder_path);
            return base ? [base] : undefined;
          })(),
        }))
      );
      if (soft.autoLink && soft.employeeId) {
        found = allExisting.find((e) => e.id === soft.employeeId) ?? null;
      }
    }
    if (!found) {
      // Solo crea si está activo en base y queremos seed ligero
      if (row.status !== 'activo') continue;
      const { data, error } = await sb
        .from('hr_employees')
        .insert({
          full_name: row.full_name,
          status: 'activo',
          puesto: row.puesto,
          area: row.area,
          fecha_ingreso: row.fecha_ingreso,
          sueldo_diario: row.sueldo_diario,
          phone: row.phone,
          email: row.email,
          source: 'xlsx',
        })
        .select(
          'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, drive_folder_path'
        )
        .single();
      if (!error && data) {
        const e = data as EmpRow;
        existing.set(key, e);
        allExisting.push(e);
        created += 1;
      }
      continue;
    }
    matched += 1;
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    // Conservar nombre de expediente; no pisar con alias corto de BASE DATOS.
    const excelName = row.full_name.replace(/\s+/g, ' ').trim();
    if (
      excelName &&
      !shouldKeepExistingFullName(
        found.full_name,
        excelName,
        found.drive_folder_path
      )
    ) {
      const next = preferCanonicalFullName(found.full_name, excelName);
      if (next !== found.full_name.replace(/\s+/g, ' ').trim()) {
        patch.full_name = next;
        found.full_name = next;
      }
    }
    if (row.puesto && !found.puesto) patch.puesto = row.puesto;
    if (row.area && !found.area) patch.area = row.area;
    if (row.fecha_ingreso && !found.fecha_ingreso) {
      patch.fecha_ingreso = row.fecha_ingreso;
    }
    if (row.phone && !found.phone) patch.phone = row.phone;
    if (
      row.sueldo_diario != null &&
      (found.sueldo_diario == null || Number(found.sueldo_diario) === 0)
    ) {
      patch.sueldo_diario = row.sueldo_diario;
    }
    if (Object.keys(patch).length > 1) {
      const { error } = await sb
        .from('hr_employees')
        .update(patch)
        .eq('id', found.id);
      if (!error) updated += 1;
    }
  }

  return { matched, updated, created };
}

export async function applyPaidSideEffects(
  sb: SupabaseClient,
  periodId: string,
  paidAt?: string | null
): Promise<{ balancesSynced: number; paid_at: string }> {
  const paid_at = paidAt || todayIsoCdmxPayroll();
  const year = Number(paid_at.slice(0, 4));
  const balancesSynced = await syncLeaveBalancesFromPeriod(sb, periodId, year);
  return { balancesSynced, paid_at };
}

function sheetNameFromSource(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = /#(.+)$/.exec(source);
  return m ? m[1].trim() : null;
}

function weekNumFromSheetName(name: string): number {
  return weekNumFromNominaSheetName(name) ?? 0;
}

const PAYROLL_STATUS_RANK: Record<string, number> = {
  pagado: 3,
  cerrado: 2,
  borrador: 1,
};

type PeriodDupRow = {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  status: string;
  source_file: string | null;
  paid_at: string | null;
  line_count: number;
};

/**
 * Conserva un periodo por period_start (y por hoja de origen).
 * Prefiere pagado → más líneas → status más avanzado.
 */
export async function dedupePayrollPeriodsForYear(
  sb: SupabaseClient,
  year: number
): Promise<{ removed: number; kept: number }> {
  const { data: existingRows, error } = await sb
    .from('hr_payroll_periods')
    .select('id, label, period_start, period_end, status, source_file, paid_at')
    .gte('period_start', `${year}-01-01`)
    .lte('period_start', `${year}-12-31`);
  if (error) throw new Error(error.message);

  const rows = (existingRows || []) as Omit<PeriodDupRow, 'line_count'>[];
  if (!rows.length) return { removed: 0, kept: 0 };

  const ids = rows.map((r) => r.id);
  const lineCounts = new Map<string, number>();
  const { data: lineRows } = await sb
    .from('hr_payroll_lines')
    .select('period_id')
    .in('period_id', ids);
  for (const lr of lineRows || []) {
    const pid = String((lr as { period_id: string }).period_id);
    lineCounts.set(pid, (lineCounts.get(pid) || 0) + 1);
  }

  const enriched: PeriodDupRow[] = rows.map((r) => ({
    ...r,
    period_start: String(r.period_start).slice(0, 10),
    period_end: String(r.period_end).slice(0, 10),
    line_count: lineCounts.get(r.id) || 0,
  }));

  const better = (a: PeriodDupRow, b: PeriodDupRow): PeriodDupRow => {
    const ra = PAYROLL_STATUS_RANK[a.status] || 0;
    const rb = PAYROLL_STATUS_RANK[b.status] || 0;
    if (ra !== rb) return ra > rb ? a : b;
    if (a.line_count !== b.line_count) {
      return a.line_count > b.line_count ? a : b;
    }
    return a.id <= b.id ? a : b;
  };

  const removeIds = new Set<string>();

  // 1) Mismo period_start
  const byStart = new Map<string, PeriodDupRow[]>();
  for (const r of enriched) {
    const list = byStart.get(r.period_start) || [];
    list.push(r);
    byStart.set(r.period_start, list);
  }
  for (const group of byStart.values()) {
    if (group.length < 2) continue;
    const keep = group.reduce(better);
    for (const g of group) {
      if (g.id !== keep.id) removeIds.add(g.id);
    }
  }

  // 2) Misma hoja de origen (Local:…#30) — tras borrar por start
  const survivors = enriched.filter((r) => !removeIds.has(r.id));
  const bySheet = new Map<string, PeriodDupRow[]>();
  for (const r of survivors) {
    const sheet = sheetNameFromSource(r.source_file);
    if (!sheet) continue;
    const key = sheet.toLowerCase();
    const list = bySheet.get(key) || [];
    list.push(r);
    bySheet.set(key, list);
  }
  for (const group of bySheet.values()) {
    if (group.length < 2) continue;
    const keep = group.reduce(better);
    for (const g of group) {
      if (g.id !== keep.id) removeIds.add(g.id);
    }
  }

  if (removeIds.size > 0) {
    const { error: delErr } = await sb
      .from('hr_payroll_periods')
      .delete()
      .in('id', [...removeIds]);
    if (delErr) throw new Error(delErr.message);
  }

  return {
    removed: removeIds.size,
    kept: enriched.length - removeIds.size,
  };
}

/** Semanas pasadas → pagado; actual/futura → borrador (histórico Excel). */
export function statusForImportedPayrollWeek(
  periodEnd: string | null,
  today = todayIsoCdmxPayroll()
): 'pagado' | 'borrador' {
  if (!periodEnd) return 'borrador';
  return periodEnd < today ? 'pagado' : 'borrador';
}

export type EnsureYearPayrollResult = {
  year: number;
  created: number;
  skipped: number;
  refreshed: number;
  repaired: number;
  deduped: number;
  sheetCount: number;
  latestPaidId: string | null;
  balancesSynced: number;
  message: string;
};

/**
 * Soft-load: lee el xlsx local del año y crea periodos faltantes en DB.
 * Repara etiqueta/fechas de existentes (mes real del Excel).
 * Deduplica por period_start / hoja. refreshExisting reemplaza líneas
 * de no-pagados.
 */
export async function ensureYearPayrollFromLocal(
  sb: SupabaseClient,
  username: string,
  year: number,
  opts?: { refreshExisting?: boolean; enrichBase?: boolean }
): Promise<EnsureYearPayrollResult> {
  const listed = await listSheetsFromLocalFile(year);
  const sheets = [...listed.sheets].sort(
    (a, b) => weekNumFromSheetName(a.name) - weekNumFromSheetName(b.name)
  );

  // Primero limpia duplicados históricos (mismo start / misma hoja).
  const dedupe = await dedupePayrollPeriodsForYear(sb, year);

  const { data: existingRows } = await sb
    .from('hr_payroll_periods')
    .select(
      'id, label, period_start, period_end, status, source_file, paid_at'
    )
    .gte('period_start', `${year}-01-01`)
    .lte('period_start', `${year}-12-31`);

  type Hit = {
    id: string;
    status: string;
    label: string;
    period_start: string;
    period_end: string;
    source_file: string | null;
  };
  const bySheet = new Map<string, Hit>();
  const byRange = new Map<string, Hit>();
  const byStart = new Map<string, Hit>();
  for (const raw of existingRows || []) {
    const r = raw as {
      id: string;
      status: string;
      label: string;
      source_file: string | null;
      period_start: string;
      period_end: string;
    };
    const hit: Hit = {
      id: r.id,
      status: r.status,
      label: r.label,
      period_start: String(r.period_start).slice(0, 10),
      period_end: String(r.period_end).slice(0, 10),
      source_file: r.source_file,
    };
    const sheet = sheetNameFromSource(r.source_file);
    if (sheet) bySheet.set(sheet.toLowerCase(), hit);
    byRange.set(`${hit.period_start}|${hit.period_end}`, hit);
    byStart.set(hit.period_start, hit);
  }

  // Soft-load: si el año ya está cubierto y sin meta sucia, no relee BASE DATOS ni reescribe.
  const nonEmptySheets = sheets.filter((s) => s.rowCount > 0);
  if (!opts?.refreshExisting && nonEmptySheets.length > 0) {
    let needsWork = false;
    for (const sheet of nonEmptySheets) {
      const period_start = sheet.periodStart || `${year}-01-01`;
      const period_end = sheet.periodEnd || period_start;
      const rangeKey = `${period_start}|${period_end}`;
      const hit =
        bySheet.get(sheet.name.toLowerCase()) ||
        byRange.get(rangeKey) ||
        byStart.get(period_start);
      if (!hit) {
        needsWork = true;
        break;
      }
      const label = sheet.weekLabel || `Semana ${sheet.name} · ${year}`;
      const metaDirty =
        hit.label !== label ||
        hit.period_start !== period_start ||
        hit.period_end !== period_end ||
        sheetNameFromSource(hit.source_file)?.toLowerCase() !==
          sheet.name.toLowerCase();
      if (metaDirty) {
        needsWork = true;
        break;
      }
    }
    if (!needsWork) {
      let latestPaidId: string | null = null;
      let latestPaidEnd = '';
      for (const hit of byStart.values()) {
        if (hit.status !== 'pagado') continue;
        if (hit.period_end >= latestPaidEnd) {
          latestPaidEnd = hit.period_end;
          latestPaidId = hit.id;
        }
      }
      return {
        year,
        created: 0,
        skipped: nonEmptySheets.length,
        refreshed: 0,
        repaired: 0,
        deduped: dedupe.removed,
        sheetCount: sheets.length,
        latestPaidId,
        balancesSynced: 0,
        message:
          dedupe.removed > 0
            ? `Año ${year}: historial listo (${nonEmptySheets.length} semanas); ${dedupe.removed} duplicados eliminados.`
            : `Año ${year}: historial listo (${nonEmptySheets.length} semanas en archivo).`,
      };
    }
  }

  if (opts?.enrichBase !== false) {
    try {
      const { loadBaseDatosRows } = await import('@/app/lib/hr-payroll-drive');
      const { rows } = await loadBaseDatosRows();
      await enrichEmployeesFromBaseDatos(sb, rows);
    } catch {
      /* BASE DATOS opcional */
    }
  }

  let created = 0;
  let skipped = 0;
  let refreshed = 0;
  let repaired = 0;
  let latestPaidId: string | null = null;
  let latestPaidEnd = '';

  for (const sheet of sheets) {
    // Saltar SEM vacías al final del libro (sin líneas legibles).
    if (!(sheet.rowCount > 0)) {
      skipped += 1;
      continue;
    }

    const period_start = sheet.periodStart || `${year}-01-01`;
    const period_end = sheet.periodEnd || period_start;
    const rangeKey = `${period_start}|${period_end}`;
    const hit =
      bySheet.get(sheet.name.toLowerCase()) ||
      byRange.get(rangeKey) ||
      byStart.get(period_start);

    const sourceLabel = `Local:${listed.file.label}#${sheet.name}`;
    const wantStatus = statusForImportedPayrollWeek(sheet.periodEnd);
    const label = sheet.weekLabel || `Semana ${sheet.name} · ${year}`;

    if (hit) {
      const metaDirty =
        hit.label !== label ||
        hit.period_start !== period_start ||
        hit.period_end !== period_end ||
        sheetNameFromSource(hit.source_file)?.toLowerCase() !==
          sheet.name.toLowerCase();

      if (opts?.refreshExisting && hit.status !== 'pagado') {
        const parsed = importNominaSheet(listed.buffer, sheet.name);
        await replacePeriodLines(sb, hit.id, parsed.lines, 'nomina_import');
        await sb
          .from('hr_payroll_periods')
          .update({
            label,
            period_start,
            period_end,
            source_file: sourceLabel,
            updated_by: username,
            updated_at: new Date().toISOString(),
          })
          .eq('id', hit.id);
        refreshed += 1;
      } else if (metaDirty) {
        // Siempre alinea etiqueta/fechas con el Excel (corrige Semana 29×3, jun↔jul).
        await sb
          .from('hr_payroll_periods')
          .update({
            label,
            period_start,
            period_end,
            source_file: sourceLabel,
            updated_by: username,
            updated_at: new Date().toISOString(),
          })
          .eq('id', hit.id);
        repaired += 1;
      } else {
        skipped += 1;
      }

      // Actualiza índices tras posible cambio de fechas
      const nextHit: Hit = {
        id: hit.id,
        status: hit.status,
        label,
        period_start,
        period_end,
        source_file: sourceLabel,
      };
      bySheet.set(sheet.name.toLowerCase(), nextHit);
      byRange.set(rangeKey, nextHit);
      byStart.set(period_start, nextHit);

      if (hit.status === 'pagado' || wantStatus === 'pagado') {
        if (period_end >= latestPaidEnd) {
          latestPaidEnd = period_end;
          latestPaidId = hit.id;
        }
      }
      continue;
    }

    const parsed = importNominaSheet(listed.buffer, sheet.name);
    const { data: period, error } = await sb
      .from('hr_payroll_periods')
      .insert({
        label,
        period_start,
        period_end,
        status: 'borrador',
        notes: 'Cargado desde archivo local (histórico)',
        source_file: sourceLabel,
        created_by: username,
        updated_by: username,
      })
      .select('id')
      .single();

    if (error || !period) {
      skipped += 1;
      continue;
    }

    const periodId = String((period as { id: string }).id);
    await replacePeriodLines(sb, periodId, parsed.lines, 'nomina_import');

    if (wantStatus === 'pagado') {
      await sb
        .from('hr_payroll_periods')
        .update({
          status: 'pagado',
          paid_at: period_end,
          updated_by: username,
          updated_at: new Date().toISOString(),
        })
        .eq('id', periodId);
      if (period_end >= latestPaidEnd) {
        latestPaidEnd = period_end;
        latestPaidId = periodId;
      }
    }

    const nextHit: Hit = {
      id: periodId,
      status: wantStatus,
      label,
      period_start,
      period_end,
      source_file: sourceLabel,
    };
    bySheet.set(sheet.name.toLowerCase(), nextHit);
    byRange.set(rangeKey, nextHit);
    byStart.set(period_start, nextHit);
    created += 1;
  }

  // Segunda pasada: fechas reparadas pueden haber creado colisiones de start.
  const dedupeAfter = await dedupePayrollPeriodsForYear(sb, year);

  let balancesSynced = 0;
  if (latestPaidId) {
    const side = await applyPaidSideEffects(sb, latestPaidId, latestPaidEnd);
    balancesSynced = side.balancesSynced;
  }

  const deduped = dedupe.removed + dedupeAfter.removed;
  return {
    year,
    created,
    skipped,
    refreshed,
    repaired,
    deduped,
    sheetCount: sheets.length,
    latestPaidId,
    balancesSynced,
    message:
      created > 0 || refreshed > 0 || repaired > 0 || deduped > 0
        ? `Año ${year}: ${created} nuevas, ${repaired} etiquetas/fechas corregidas, ${refreshed} líneas actualizadas, ${deduped} duplicados eliminados, ${skipped} ok.`
        : sheets.length
          ? `Año ${year}: historial listo (${sheets.length} semanas en archivo).`
          : `No hay hojas SEM en el archivo de ${year}.`,
  };
}
