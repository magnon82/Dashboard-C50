/** Persistencia de periodos/líneas + sync plantilla/saldos al pagar. */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyPaidRestIfSingleOff,
  computePayrollImporte,
  emptyDiasSemana,
  normalizeDiasSemana,
  normalizePersonName,
  payrollDayIndexFromIso,
  payrollDayOnWeight,
  sumDiasSemana,
  todayIsoCdmxPayroll,
  type HrPayrollDiasSemana,
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
import { weekNumberForHorariosMonday } from '@/app/lib/hr-schedule-import';
import { isLeaveExemptEmployee } from '@/app/lib/hr';
import { normalizeCurp, normalizeNss } from '@/app/lib/hr-identity';

type EmpRow = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  fecha_ingreso: string | null;
  fecha_nacimiento?: string | null;
  sueldo_diario: number | null;
  email: string | null;
  phone: string | null;
  status: string;
  force_exclude?: boolean | null;
  fecha_baja?: string | null;
  drive_folder_path?: string | null;
  curp?: string | null;
  nss?: string | null;
};

const EMP_MAP_SELECT_FULL =
  'id, full_name, puesto, area, fecha_ingreso, fecha_nacimiento, sueldo_diario, email, phone, status, force_exclude, fecha_baja, drive_folder_path, curp, nss';
const EMP_MAP_SELECT_NO_ID =
  'id, full_name, puesto, area, fecha_ingreso, fecha_nacimiento, sueldo_diario, email, phone, status, force_exclude, fecha_baja, drive_folder_path';
const EMP_MAP_SELECT_NO_NAC =
  'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, force_exclude, fecha_baja, drive_folder_path';
const EMP_MAP_SELECT_MIN =
  'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, force_exclude';

export async function loadEmployeeNameMap(
  sb: SupabaseClient
): Promise<Map<string, EmpRow>> {
  let res = await sb.from('hr_employees').select(EMP_MAP_SELECT_FULL);
  if (res.error && /curp|nss|column/i.test(res.error.message)) {
    res = await sb.from('hr_employees').select(EMP_MAP_SELECT_NO_ID);
  }
  if (res.error && /fecha_nacimiento|column/i.test(res.error.message)) {
    res = await sb.from('hr_employees').select(EMP_MAP_SELECT_NO_NAC);
  }
  if (res.error && /drive_folder_path|column/i.test(res.error.message)) {
    res = await sb
      .from('hr_employees')
      .select(
        'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, force_exclude, fecha_baja'
      );
  }
  if (res.error && /fecha_baja|column/i.test(res.error.message)) {
    res = await sb.from('hr_employees').select(EMP_MAP_SELECT_MIN);
  }
  const { data, error } = res;
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
 * Omite empleados con flag/puesto sin vacaciones (Socios).
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

  const empIds = [
    ...new Set(
      (lines || [])
        .map((l: { employee_id: string }) => String(l.employee_id))
        .filter(Boolean)
    ),
  ];
  const exemptIds = new Set<string>();
  if (empIds.length > 0) {
    const { data: emps } = await sb
      .from('hr_employees')
      .select('id, puesto, area, notes')
      .in('id', empIds);
    for (const raw of emps || []) {
      const e = raw as {
        id: string;
        puesto: string | null;
        area: string | null;
        notes: string | null;
      };
      if (isLeaveExemptEmployee(e)) exemptIds.add(String(e.id));
    }
  }

  let n = 0;
  for (const raw of lines || []) {
    const line = raw as {
      employee_id: string;
      vacaciones_tomadas: number | null;
      vacaciones_restantes: number | null;
      notes: string | null;
    };
    if (exemptIds.has(String(line.employee_id))) continue;
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
      const insertRow: Record<string, unknown> = {
        full_name: row.full_name,
        status: 'activo',
        puesto: row.puesto,
        area: row.area,
        fecha_ingreso: row.fecha_ingreso,
        sueldo_diario: row.sueldo_diario,
        phone: row.phone,
        email: row.email,
        source: 'xlsx',
      };
      if (row.fecha_nacimiento) {
        insertRow.fecha_nacimiento = row.fecha_nacimiento;
      }
      let inserted = await sb
        .from('hr_employees')
        .insert(insertRow)
        .select(
          'id, full_name, puesto, area, fecha_ingreso, fecha_nacimiento, sueldo_diario, email, phone, status, drive_folder_path'
        )
        .single();
      if (
        inserted.error &&
        /fecha_nacimiento|column/i.test(inserted.error.message)
      ) {
        delete insertRow.fecha_nacimiento;
        inserted = await sb
          .from('hr_employees')
          .insert(insertRow)
          .select(
            'id, full_name, puesto, area, fecha_ingreso, sueldo_diario, email, phone, status, drive_folder_path'
          )
          .single();
      }
      if (!inserted.error && inserted.data) {
        const e = inserted.data as EmpRow;
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
    if (row.fecha_nacimiento && !found.fecha_nacimiento) {
      patch.fecha_nacimiento = row.fecha_nacimiento;
      found.fecha_nacimiento = row.fecha_nacimiento;
    }
    if (row.phone && !found.phone) patch.phone = row.phone;
    const curp = normalizeCurp(row.curp);
    if (curp && !normalizeCurp(found.curp)) {
      patch.curp = curp;
      found.curp = curp;
    }
    const nss = normalizeNss(row.nss);
    if (nss && !normalizeNss(found.nss)) {
      patch.nss = nss;
      found.nss = nss;
    }
    if (
      row.sueldo_diario != null &&
      (found.sueldo_diario == null || Number(found.sueldo_diario) === 0)
    ) {
      patch.sueldo_diario = row.sueldo_diario;
    }
    if (Object.keys(patch).length > 1) {
      let { error } = await sb
        .from('hr_employees')
        .update(patch)
        .eq('id', found.id);
      if (error && /curp|nss|column/i.test(error.message)) {
        delete patch.curp;
        delete patch.nss;
        if (Object.keys(patch).length > 1) {
          ({ error } = await sb
            .from('hr_employees')
            .update(patch)
            .eq('id', found.id));
        } else {
          error = null;
        }
      }
      if (error && /fecha_nacimiento|column/i.test(error.message)) {
        delete patch.fecha_nacimiento;
        if (Object.keys(patch).length > 1) {
          ({ error } = await sb
            .from('hr_employees')
            .update(patch)
            .eq('id', found.id));
        } else {
          error = null;
        }
      }
      if (!error) updated += 1;
    }
  }

  return { matched, updated, created };
}

/**
 * Copia sueldo_diario de líneas de un periodo a la ficha (`hr_employees`).
 * Solo escribe cuando la línea trae SD > 0 y difiere del valor actual (o está vacío).
 * Operativa: nómina se paga martes ~19:00 CDMX y el periodo se marca `pagado`
 * (paid_at = fecha de ese día); la ficha debe reflejar la última semana pagada.
 */
export async function syncSueldoDiarioFromPeriod(
  sb: SupabaseClient,
  periodId: string,
  opts?: { onlyIfEmpty?: boolean }
): Promise<{ updated: number; skipped: number; linesWithSd: number }> {
  const onlyIfEmpty = opts?.onlyIfEmpty === true;
  const { data: lines, error } = await sb
    .from('hr_payroll_lines')
    .select('employee_id, sueldo_diario')
    .eq('period_id', periodId);
  if (error) throw new Error(error.message);

  const byEmp = new Map<string, number>();
  for (const raw of lines || []) {
    const l = raw as { employee_id: string; sueldo_diario: number | null };
    const sd = l.sueldo_diario != null ? Number(l.sueldo_diario) : NaN;
    if (!l.employee_id || !Number.isFinite(sd) || sd <= 0) continue;
    byEmp.set(String(l.employee_id), Math.round(sd * 100) / 100);
  }

  const ids = [...byEmp.keys()];
  if (ids.length === 0) {
    return { updated: 0, skipped: 0, linesWithSd: 0 };
  }

  const { data: emps, error: eErr } = await sb
    .from('hr_employees')
    .select('id, sueldo_diario')
    .in('id', ids);
  if (eErr) {
    if (/sueldo_diario|column .* does not exist|42703/i.test(eErr.message)) {
      throw new Error(
        'Falta columna sueldo_diario. Ejecuta supabase/hr_employee_sueldo.sql en Supabase.'
      );
    }
    throw new Error(eErr.message);
  }

  const curById = new Map<string, number | null>();
  for (const raw of emps || []) {
    const e = raw as { id: string; sueldo_diario: number | null };
    curById.set(
      String(e.id),
      e.sueldo_diario != null ? Number(e.sueldo_diario) : null
    );
  }

  let updated = 0;
  let skipped = 0;
  for (const [employeeId, sueldo] of byEmp) {
    if (!curById.has(employeeId)) {
      skipped += 1;
      continue;
    }
    const cur = curById.get(employeeId) ?? null;
    const empty = cur == null || !Number.isFinite(cur) || cur === 0;
    if (onlyIfEmpty && !empty) {
      skipped += 1;
      continue;
    }
    if (!empty && cur === sueldo) {
      skipped += 1;
      continue;
    }
    const { error: uErr } = await sb
      .from('hr_employees')
      .update({ sueldo_diario: sueldo })
      .eq('id', employeeId);
    if (uErr) {
      if (/sueldo_diario|column .* does not exist|42703/i.test(uErr.message)) {
        throw new Error(
          'Falta columna sueldo_diario. Ejecuta supabase/hr_employee_sueldo.sql en Supabase.'
        );
      }
      skipped += 1;
      continue;
    }
    updated += 1;
  }

  return { updated, skipped, linesWithSd: byEmp.size };
}

/**
 * Última nómina pagada con líneas (semana transcurrida); si no, cerrado.
 * Con `allPaid`, recorre periodos pagados (period_end desc) y escribe el SD
 * más reciente por empleado (útil si alguien no salió en la última semana).
 */
export async function syncSueldoDiarioFromLatestPaid(
  sb: SupabaseClient,
  opts?: {
    onlyIfEmpty?: boolean;
    preferClosed?: boolean;
    allPaid?: boolean;
  }
): Promise<{
  periodId: string | null;
  periodLabel: string | null;
  periodEnd: string | null;
  status: string | null;
  updated: number;
  skipped: number;
  linesWithSd: number;
}> {
  if (opts?.allPaid) {
    const { data: periods, error } = await sb
      .from('hr_payroll_periods')
      .select('id, label, period_end, status, paid_at')
      .eq('status', 'pagado')
      .order('period_end', { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);

    const seen = new Set<string>();
    let updated = 0;
    let skipped = 0;
    let linesWithSd = 0;
    let first: {
      id: string;
      label: string;
      period_end: string;
      status: string;
    } | null = null;

    for (const raw of periods || []) {
      const p = raw as {
        id: string;
        label: string;
        period_end: string;
        status: string;
      };
      if (!first) first = p;
      const { data: lines } = await sb
        .from('hr_payroll_lines')
        .select('employee_id, sueldo_diario')
        .eq('period_id', p.id);
      const fresh: { employee_id: string; sueldo_diario: number }[] = [];
      for (const l of lines || []) {
        const row = l as { employee_id: string; sueldo_diario: number | null };
        const id = String(row.employee_id || '');
        const sd = row.sueldo_diario != null ? Number(row.sueldo_diario) : NaN;
        if (!id || seen.has(id) || !Number.isFinite(sd) || sd <= 0) continue;
        seen.add(id);
        fresh.push({ employee_id: id, sueldo_diario: Math.round(sd * 100) / 100 });
      }
      if (!fresh.length) continue;
      // Sync solo estos employee_ids vía update directo (periodo ya “virtual”)
      linesWithSd += fresh.length;
      const ids = fresh.map((f) => f.employee_id);
      const { data: emps } = await sb
        .from('hr_employees')
        .select('id, sueldo_diario')
        .in('id', ids);
      const curById = new Map(
        (emps || []).map((e) => {
          const er = e as { id: string; sueldo_diario: number | null };
          return [
            String(er.id),
            er.sueldo_diario != null ? Number(er.sueldo_diario) : null,
          ] as const;
        })
      );
      const onlyIfEmpty = opts?.onlyIfEmpty === true;
      for (const f of fresh) {
        if (!curById.has(f.employee_id)) {
          skipped += 1;
          continue;
        }
        const cur = curById.get(f.employee_id) ?? null;
        const empty = cur == null || !Number.isFinite(cur) || cur === 0;
        if (onlyIfEmpty && !empty) {
          skipped += 1;
          continue;
        }
        if (!empty && cur === f.sueldo_diario) {
          skipped += 1;
          continue;
        }
        const { error: uErr } = await sb
          .from('hr_employees')
          .update({ sueldo_diario: f.sueldo_diario })
          .eq('id', f.employee_id);
        if (uErr) skipped += 1;
        else updated += 1;
      }
    }

    return {
      periodId: first?.id ?? null,
      periodLabel: first?.label ?? null,
      periodEnd: first?.period_end
        ? String(first.period_end).slice(0, 10)
        : null,
      status: first?.status ?? null,
      updated,
      skipped,
      linesWithSd,
    };
  }

  const statuses = opts?.preferClosed
    ? (['cerrado', 'pagado'] as const)
    : (['pagado', 'cerrado'] as const);

  for (const status of statuses) {
    const { data, error } = await sb
      .from('hr_payroll_periods')
      .select('id, label, period_end, status, paid_at')
      .eq('status', status)
      .order('period_end', { ascending: false })
      .order('paid_at', { ascending: false })
      .limit(8);
    if (error || !data?.length) continue;
    const rows = data as {
      id: string;
      label: string;
      period_end: string;
      status: string;
      paid_at: string | null;
    }[];
    const withLines = await periodIdsWithPayrollLines(
      sb,
      rows.map((p) => p.id)
    );
    for (const p of rows) {
      if (!withLines.has(p.id)) continue;
      const stats = await syncSueldoDiarioFromPeriod(sb, p.id, opts);
      return {
        periodId: p.id,
        periodLabel: p.label,
        periodEnd: p.period_end ? String(p.period_end).slice(0, 10) : null,
        status: p.status,
        ...stats,
      };
    }
  }

  return {
    periodId: null,
    periodLabel: null,
    periodEnd: null,
    status: null,
    updated: 0,
    skipped: 0,
    linesWithSd: 0,
  };
}

export async function applyPaidSideEffects(
  sb: SupabaseClient,
  periodId: string,
  paidAt?: string | null
): Promise<{
  balancesSynced: number;
  sueldoSynced: number;
  paid_at: string;
}> {
  const paid_at = paidAt || todayIsoCdmxPayroll();
  const year = Number(paid_at.slice(0, 4));
  const balancesSynced = await syncLeaveBalancesFromPeriod(sb, periodId, year);
  let sueldoSynced = 0;
  try {
    const sd = await syncSueldoDiarioFromPeriod(sb, periodId);
    sueldoSynced = sd.updated;
  } catch {
    /* columna ausente u otro — no bloquea marcar pagado */
  }
  return { balancesSynced, sueldoSynced, paid_at };
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
  // Solo semanal: no tocar quincenas (cadence=quincenal).
  let existingQuery = sb
    .from('hr_payroll_periods')
    .select(
      'id, label, period_start, period_end, status, source_file, paid_at, cadence'
    )
    .gte('period_start', `${year}-01-01`)
    .lte('period_start', `${year}-12-31`);

  let { data: existingRows, error } = await existingQuery;
  if (error && /cadence|column .* does not exist|42703/i.test(error.message)) {
    const retry = await sb
      .from('hr_payroll_periods')
      .select('id, label, period_start, period_end, status, source_file, paid_at')
      .gte('period_start', `${year}-01-01`)
      .lte('period_start', `${year}-12-31`);
    existingRows = retry.data as typeof existingRows;
    error = retry.error;
  }
  if (error) throw new Error(error.message);

  const rows = (
    (existingRows || []) as Array<
      Omit<PeriodDupRow, 'line_count'> & { cadence?: string | null }
    >
  ).filter((r) => (r.cadence || 'semanal') !== 'quincenal');
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
 * de no-pagados; con refreshPaid también reescribe líneas de periodos `pagado`
 * (útil tras corregir el parseo de SUELDO DIARIO).
 */
export async function ensureYearPayrollFromLocal(
  sb: SupabaseClient,
  username: string,
  year: number,
  opts?: {
    refreshExisting?: boolean;
    refreshPaid?: boolean;
    enrichBase?: boolean;
  }
): Promise<EnsureYearPayrollResult> {
  // Primero limpia duplicados históricos (mismo start / misma hoja).
  const dedupe = await dedupePayrollPeriodsForYear(sb, year);

  const { data: existingRows } = await sb
    .from('hr_payroll_periods')
    .select(
      'id, label, period_start, period_end, status, source_file, paid_at'
    )
    .gte('period_start', `${year}-01-01`)
    .lte('period_start', `${year}-12-31`);

  let listed: Awaited<ReturnType<typeof listSheetsFromLocalFile>> | null =
    null;
  try {
    listed = await listSheetsFromLocalFile(year);
  } catch {
    const existingCount = (existingRows || []).length;
    if (existingCount > 0) {
      let latestPaidId: string | null = null;
      let latestPaidEnd = '';
      for (const raw of existingRows || []) {
        const r = raw as { id: string; status: string; period_end: string };
        if (r.status !== 'pagado') continue;
        const end = String(r.period_end).slice(0, 10);
        if (end >= latestPaidEnd) {
          latestPaidEnd = end;
          latestPaidId = r.id;
        }
      }
      return {
        year,
        created: 0,
        skipped: existingCount,
        refreshed: 0,
        repaired: 0,
        deduped: dedupe.removed,
        sheetCount: 0,
        latestPaidId,
        balancesSynced: 0,
        message: `Año ${year}: ${existingCount} semanas en servidor (xlsx local/Drive opcional para nuevas).`,
      };
    }
    throw new Error(
      `Sin xlsx local de nómina ${year} y sin periodos en servidor. Usa sync Drive API (HR_NOMINA_DRIVE_FOLDER_ID) o importa desde el PC de admin.`
    );
  }

  const sheets = [...listed.sheets].sort(
    (a, b) => weekNumFromSheetName(a.name) - weekNumFromSheetName(b.name)
  );

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

      const canRefreshLines =
        opts?.refreshExisting &&
        (hit.status !== 'pagado' || opts?.refreshPaid === true);
      if (canRefreshLines) {
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

export type PreparePayrollFromScheduleResult = {
  skipped: boolean;
  reason?: string;
  periodId?: string;
  created?: boolean;
  refreshed?: boolean;
  lineCount?: number;
  message?: string;
};

type PriorLineExtras = {
  horas_extra: number;
  bonos: number;
  retenciones: number;
  vacaciones_tomadas: number | null;
  vacaciones_restantes: number | null;
  sueldo_diario: number | null;
  notes: string | null;
};

/**
 * Al publicar un horario: crea/actualiza el periodo de nómina de esa semana
 * como borrador editable. Días trabajados = turnos con Ent/Sal;
 * el único día sin turno (DESCANSO) → descanso pagado (−1 → Σ +1);
 * Dom trabajado = 1.25 (prima). No pisa periodos pagado/cerrado.
 */
export async function preparePayrollFromSchedule(
  sb: SupabaseClient,
  opts: {
    weekId: string;
    username: string;
  }
): Promise<PreparePayrollFromScheduleResult> {
  const weekId = String(opts.weekId || '').trim();
  if (!weekId) {
    return { skipped: true, reason: 'weekId requerido' };
  }

  const { data: week, error: weekErr } = await sb
    .from('hr_schedule_weeks')
    .select('id, week_start, week_end, status')
    .eq('id', weekId)
    .maybeSingle();

  if (weekErr || !week) {
    return {
      skipped: true,
      reason: weekErr?.message || 'Semana de horario no encontrada',
    };
  }

  const weekStart = String(week.week_start).slice(0, 10);
  const weekEnd = String(week.week_end).slice(0, 10);
  const year = Number(weekStart.slice(0, 4));
  const weekNum = weekNumberForHorariosMonday(weekStart);
  const label =
    weekNum != null
      ? `Semana ${weekNum} · ${year}`
      : `Semana ${weekStart} · ${year}`;

  const { data: lockedPeriod, error: lockedErr } = await sb
    .from('hr_payroll_periods')
    .select('id, status')
    .eq('period_start', weekStart)
    .in('status', ['pagado', 'cerrado'])
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lockedErr) {
    return { skipped: true, reason: lockedErr.message };
  }
  if (lockedPeriod) {
    const st = String(lockedPeriod.status);
    return {
      skipped: true,
      reason: `Periodo ${st} — no se sobrescribe`,
      periodId: String(lockedPeriod.id),
      message: `Nómina ${label} ya está ${st}; se conserva.`,
    };
  }

  const { data: existingPeriod, error: findErr } = await sb
    .from('hr_payroll_periods')
    .select(
      'id, label, period_start, period_end, status, source_file, notes'
    )
    .eq('period_start', weekStart)
    .eq('status', 'borrador')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    return { skipped: true, reason: findErr.message };
  }

  const { data: shifts, error: shiftErr } = await sb
    .from('hr_schedule_shifts')
    .select('employee_id, shift_date, start_time, end_time, area, role_label')
    .eq('week_id', weekId);

  if (shiftErr) {
    return { skipped: true, reason: shiftErr.message };
  }

  // Día trabajado = Ent+Sal presentes (DESCANSO no tiene ambos).
  const diasByEmp = new Map<string, HrPayrollDiasSemana>();
  const areaByEmp = new Map<string, string>();
  for (const raw of shifts || []) {
    const s = raw as {
      employee_id: string;
      shift_date: string;
      start_time: string | null;
      end_time: string | null;
      area?: string | null;
      role_label?: string | null;
    };
    if (!s.start_time || !s.end_time) continue;
    const empId = String(s.employee_id || '').trim();
    if (!empId) continue;
    const dayIdx = payrollDayIndexFromIso(String(s.shift_date).slice(0, 10));
    if (dayIdx == null || dayIdx < 0 || dayIdx > 6) continue;
    const days = diasByEmp.get(empId) ?? emptyDiasSemana();
    days[dayIdx] = payrollDayOnWeight(dayIdx);
    diasByEmp.set(empId, days);
    if (s.area && !areaByEmp.has(empId)) {
      areaByEmp.set(empId, String(s.area));
    } else if (s.role_label && !areaByEmp.has(empId)) {
      areaByEmp.set(empId, String(s.role_label));
    }
  }

  const employeeIds = [...diasByEmp.keys()];
  if (employeeIds.length === 0) {
    // Semana publicada sin turnos reales: aún así asegura periodo borrador vacío.
    const periodId = await upsertDraftPayrollPeriod(sb, {
      existingId: existingPeriod ? String(existingPeriod.id) : null,
      label,
      period_start: weekStart,
      period_end: weekEnd,
      weekId,
      username: opts.username,
    });
    if (existingPeriod) {
      await sb.from('hr_payroll_lines').delete().eq('period_id', periodId);
    }
    return {
      skipped: false,
      created: !existingPeriod,
      refreshed: Boolean(existingPeriod),
      periodId,
      lineCount: 0,
      message: `${label}: borrador sin líneas (sin turnos Ent/Sal).`,
    };
  }

  const { data: empRows, error: empErr } = await sb
    .from('hr_employees')
    .select('id, full_name, puesto, area, sueldo_diario, status')
    .in('id', employeeIds);

  if (empErr) {
    return { skipped: true, reason: empErr.message };
  }

  const empById = new Map<
    string,
    {
      id: string;
      full_name: string;
      puesto: string | null;
      area: string | null;
      sueldo_diario: number | null;
      status: string;
    }
  >();
  for (const row of empRows || []) {
    const e = row as {
      id: string;
      full_name: string;
      puesto: string | null;
      area: string | null;
      sueldo_diario: number | null;
      status: string;
    };
    empById.set(String(e.id), {
      ...e,
      sueldo_diario:
        e.sueldo_diario != null ? Number(e.sueldo_diario) : null,
    });
  }

  // SD desde última nómina conciliada (pagado → cerrado).
  const sdFromPayroll = new Map<string, number>();
  const puestoFromPayroll = new Map<string, string>();
  try {
    const latestId = await findLatestConciliadaPeriodId(sb);
    if (latestId) {
      const { data: paidLines } = await sb
        .from('hr_payroll_lines')
        .select('employee_id, sueldo_diario, puesto_snapshot')
        .eq('period_id', latestId)
        .in('employee_id', employeeIds);
      for (const raw of paidLines || []) {
        const l = raw as {
          employee_id: string;
          sueldo_diario: number | null;
          puesto_snapshot: string | null;
        };
        if (l.sueldo_diario != null && Number(l.sueldo_diario) > 0) {
          sdFromPayroll.set(String(l.employee_id), Number(l.sueldo_diario));
        }
        if (l.puesto_snapshot) {
          puestoFromPayroll.set(
            String(l.employee_id),
            String(l.puesto_snapshot)
          );
        }
      }
    }
  } catch {
    /* opcional */
  }

  // Extras previos del borrador (si se refresca).
  const priorByEmp = new Map<string, PriorLineExtras>();
  if (existingPeriod) {
    const { data: priorLines } = await sb
      .from('hr_payroll_lines')
      .select(
        'employee_id, sueldo_diario, horas_extra, bonos, retenciones, vacaciones_tomadas, vacaciones_restantes, notes'
      )
      .eq('period_id', String(existingPeriod.id));
    for (const raw of priorLines || []) {
      const l = raw as {
        employee_id: string;
        sueldo_diario: number | null;
        horas_extra: number | null;
        bonos: number | null;
        retenciones: number | null;
        vacaciones_tomadas: number | null;
        vacaciones_restantes: number | null;
        notes: string | null;
      };
      priorByEmp.set(String(l.employee_id), {
        horas_extra: Number(l.horas_extra) || 0,
        bonos: Number(l.bonos) || 0,
        retenciones: Number(l.retenciones) || 0,
        vacaciones_tomadas:
          l.vacaciones_tomadas != null ? Number(l.vacaciones_tomadas) : null,
        vacaciones_restantes:
          l.vacaciones_restantes != null
            ? Number(l.vacaciones_restantes)
            : null,
        sueldo_diario:
          l.sueldo_diario != null ? Number(l.sueldo_diario) : null,
        notes: l.notes,
      });
    }
  }

  const lines: HrPayrollLineInput[] = [];
  for (const empId of employeeIds) {
    const emp = empById.get(empId);
    if (!emp) continue;
    if (emp.status === 'baja') continue;

    const diasRaw = diasByEmp.get(empId) ?? emptyDiasSemana();
    // Jornada 48h: 6 turnos + 1 hueco → ese hueco es descanso pagado (Σ=7).
    const dias = applyPaidRestIfSingleOff(diasRaw);
    const diasTrabajados = sumDiasSemana(dias);
    if (diasTrabajados <= 0) continue;

    const prior = priorByEmp.get(empId);
    const sueldo =
      sdFromPayroll.get(empId) ??
      (emp.sueldo_diario != null && emp.sueldo_diario > 0
        ? emp.sueldo_diario
        : null) ??
      prior?.sueldo_diario ??
      null;

    const he = prior?.horas_extra ?? 0;
    const bonos = prior?.bonos ?? 0;
    const ret = prior?.retenciones ?? 0;
    const importe = computePayrollImporte({
      sueldo_diario: sueldo,
      dias_trabajados: diasTrabajados,
      horas_extra: he,
      bonos,
      retenciones: ret,
    });

    const puesto =
      emp.puesto ||
      puestoFromPayroll.get(empId) ||
      areaByEmp.get(empId) ||
      emp.area ||
      null;

    lines.push({
      full_name: emp.full_name,
      puesto,
      area: emp.area,
      sueldo_diario: sueldo,
      dias_trabajados: diasTrabajados,
      dias_semana: dias,
      horas_extra: he,
      bonos,
      retenciones: ret,
      importe_pagado: importe,
      vacaciones_tomadas: prior?.vacaciones_tomadas ?? null,
      vacaciones_restantes: prior?.vacaciones_restantes ?? null,
      notes: null,
    });
  }

  lines.sort((a, b) =>
    a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' })
  );

  const periodId = await upsertDraftPayrollPeriod(sb, {
    existingId: existingPeriod ? String(existingPeriod.id) : null,
    label,
    period_start: weekStart,
    period_end: weekEnd,
    weekId,
    username: opts.username,
  });

  const stats = await replacePeriodLines(sb, periodId, lines, 'manual');

  return {
    skipped: false,
    created: !existingPeriod,
    refreshed: Boolean(existingPeriod),
    periodId,
    lineCount: stats.lineCount,
    message: existingPeriod
      ? `${label}: borrador actualizado desde horario (${stats.lineCount} líneas).`
      : `${label}: borrador creado desde horario (${stats.lineCount} líneas).`,
  };
}

/** Último periodo pagado con líneas; si no, cerrado con líneas. */
async function findLatestConciliadaPeriodId(
  sb: SupabaseClient
): Promise<string | null> {
  for (const status of ['pagado', 'cerrado'] as const) {
    const { data, error } = await sb
      .from('hr_payroll_periods')
      .select('id')
      .eq('status', status)
      .order('period_end', { ascending: false })
      .limit(8);
    if (error || !data?.length) continue;
    const ids = data.map((r) => String((r as { id: string }).id));
    const withLines = await periodIdsWithPayrollLines(sb, ids);
    for (const id of ids) {
      if (withLines.has(id)) return id;
    }
  }
  return null;
}

async function upsertDraftPayrollPeriod(
  sb: SupabaseClient,
  opts: {
    existingId: string | null;
    label: string;
    period_start: string;
    period_end: string;
    weekId: string;
    username: string;
  }
): Promise<string> {
  const source_file = `Horario:${opts.weekId}`;
  const notes =
    'Calculada desde horario publicado (Dom = 1.25 prima dominical). Editable.';
  const now = new Date().toISOString();

  if (opts.existingId) {
    const { error } = await sb
      .from('hr_payroll_periods')
      .update({
        label: opts.label,
        period_start: opts.period_start,
        period_end: opts.period_end,
        status: 'borrador',
        source_file,
        notes,
        updated_by: opts.username,
        updated_at: now,
      })
      .eq('id', opts.existingId);
    if (error) throw new Error(error.message);
    return opts.existingId;
  }

  const { data, error } = await sb
    .from('hr_payroll_periods')
    .insert({
      label: opts.label,
      period_start: opts.period_start,
      period_end: opts.period_end,
      status: 'borrador',
      source_file,
      notes,
      created_by: opts.username,
      updated_by: opts.username,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'No se pudo crear periodo de nómina');
  }
  return String((data as { id: string }).id);
}
