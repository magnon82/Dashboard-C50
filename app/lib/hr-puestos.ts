/**
 * Catálogo de posiciones RR.HH. + roles múltiples (principal / secundarios).
 * Plantilla muestra el principal; secundarios son hint (sin fila duplicada).
 */

function notesHasFlag(notes: string | null | undefined, flag: string): boolean {
  const n = String(notes || '').toLowerCase();
  const f = String(flag || '')
    .toLowerCase()
    .trim();
  return Boolean(f) && n.includes(f);
}

/** Catálogo canónico (UI + almacenamiento preferido). */
export const HR_PUESTO_CATALOG = [
  'Socios',
  'Gerente',
  'Capitan',
  'Meserx Encargadx',
  'Meserx',
  'Hostess',
  'Bartender',
  'Encargado de Cocina',
  'Cocinero',
  'Lavaloza',
  'Practicante Cocina',
  'Cajerx',
  'Compras y Administración',
  'Asistente Administrativo',
  'Practicante Administrativo',
  'Inventarios',
  'Limpieza',
] as const;

export type HrPuestoCatalog = (typeof HR_PUESTO_CATALOG)[number];

export type HrEmployeeRoles = {
  /** Posición administrativa / principal (plantilla). */
  primary: string | null;
  /** Roles adicionales (sin duplicar perfil). */
  secondary: string[];
};

function foldKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Alias legados → etiqueta de catálogo. */
const PUESTO_ALIASES: Record<string, HrPuestoCatalog> = {
  socio: 'Socios',
  socios: 'Socios',
  colaborador: 'Socios',
  colaboradores: 'Socios',
  gerente: 'Gerente',
  gerencia: 'Gerente',
  capitan: 'Capitan',
  captain: 'Capitan',
  'mesero encargado': 'Meserx Encargadx',
  'mesera encargada': 'Meserx Encargadx',
  'meserx encargadx': 'Meserx Encargadx',
  'mesero encargadx': 'Meserx Encargadx',
  mesero: 'Meserx',
  mesera: 'Meserx',
  meserx: 'Meserx',
  hostess: 'Hostess',
  hosstes: 'Hostess',
  hosses: 'Hostess',
  hostes: 'Hostess',
  barra: 'Bartender',
  barman: 'Bartender',
  bartender: 'Bartender',
  'encargado de cocina': 'Encargado de Cocina',
  'encargada de cocina': 'Encargado de Cocina',
  cocinero: 'Cocinero',
  cocinera: 'Cocinero',
  lavaloza: 'Lavaloza',
  'lava loza': 'Lavaloza',
  'practicante cocina': 'Practicante Cocina',
  'practicante de cocina': 'Practicante Cocina',
  caja: 'Cajerx',
  cajero: 'Cajerx',
  cajera: 'Cajerx',
  cajerx: 'Cajerx',
  'compras y administracion': 'Compras y Administración',
  'compras y administración': 'Compras y Administración',
  compras: 'Compras y Administración',
  'asistente administrativo': 'Asistente Administrativo',
  'asistente administrativa': 'Asistente Administrativo',
  'practicante administrativo': 'Practicante Administrativo',
  'practicante administrativa': 'Practicante Administrativo',
  inventarios: 'Inventarios',
  inventario: 'Inventarios',
  'control de costos': 'Inventarios',
  limpieza: 'Limpieza',
};

/** Normaliza texto libre al catálogo si hay match; si no, Title-ish trim. */
export function normalizePuestoLabel(
  raw: string | null | undefined
): string | null {
  const cleaned = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const alias = PUESTO_ALIASES[foldKey(cleaned)];
  if (alias) return alias;
  const exact = HR_PUESTO_CATALOG.find((c) => foldKey(c) === foldKey(cleaned));
  if (exact) return exact;
  return cleaned;
}

export function isCatalogPuesto(raw: string | null | undefined): boolean {
  const n = normalizePuestoLabel(raw);
  if (!n) return false;
  return HR_PUESTO_CATALOG.some((c) => foldKey(c) === foldKey(n));
}

/** Rol de servicio de piso (no cocina/admin): no debe solapar Limpieza. */
export function isServicioPuesto(raw: string | null | undefined): boolean {
  const n = normalizePuestoLabel(raw);
  if (!n) return false;
  const k = foldKey(n);
  return (
    k === 'meserx' ||
    k === 'meserx encargadx' ||
    k === 'capitan' ||
    k === 'hostess' ||
    k === 'bartender' ||
    k === 'gerente'
  );
}

export function isLimpiezaPuesto(raw: string | null | undefined): boolean {
  const n = normalizePuestoLabel(raw);
  return n != null && foldKey(n) === 'limpieza';
}

function uniqLabels(labels: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const n = normalizePuestoLabel(raw);
    if (!n) continue;
    const k = foldKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/**
 * Resuelve roles desde ficha + flag legado `dual_limpieza_mesero` en notes.
 * No escribe en DB — solo lectura para UI / horarios.
 */
export function resolveEmployeeRoles(e: {
  puesto?: string | null;
  puestos_secundarios?: string[] | null;
  notes?: string | null;
}): HrEmployeeRoles {
  const primary = normalizePuestoLabel(e.puesto);
  let secondary = uniqLabels(
    Array.isArray(e.puestos_secundarios) ? e.puestos_secundarios : []
  ).filter((s) => !primary || foldKey(s) !== foldKey(primary));

  const dualFlag = notesHasFlag(e.notes, 'dual_limpieza_mesero');
  if (dualFlag) {
    const hasLimp = secondary.some((s) => isLimpiezaPuesto(s)) || isLimpiezaPuesto(primary);
    if (!hasLimp) secondary = [...secondary, 'Limpieza'];
    if (isLimpiezaPuesto(primary) && secondary.length === 0) {
      // Principal era Limpieza por error de import — hint mesero encargado
      return { primary: 'Meserx Encargadx', secondary: ['Limpieza'] };
    }
  }

  return { primary, secondary };
}

/** Todos los roles (principal primero). */
export function employeeRoleList(e: {
  puesto?: string | null;
  puestos_secundarios?: string[] | null;
  notes?: string | null;
}): string[] {
  const { primary, secondary } = resolveEmployeeRoles(e);
  return primary ? [primary, ...secondary] : [...secondary];
}

/** Limpieza + al menos un rol de servicio → candado de solape en horarios. */
export function hasDualLimpiezaServicio(e: {
  puesto?: string | null;
  puestos_secundarios?: string[] | null;
  notes?: string | null;
  full_name?: string | null;
}): boolean {
  const roles = employeeRoleList(e);
  const hasLimp = roles.some((r) => isLimpiezaPuesto(r));
  const hasServ = roles.some((r) => isServicioPuesto(r));
  if (hasLimp && hasServ) return true;
  if (notesHasFlag(e.notes, 'dual_limpieza_mesero')) return true;
  // Legado: Román Sánchez hardcodeado en propose
  const n = String(e.full_name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /\broman\b/.test(n) && /\bsanchez\b/.test(n);
}

/**
 * Parsea body de API: acepta `puestos`/`roles` array, o `puesto` + `puestos_secundarios`.
 * Primer elemento / `puesto` = principal.
 */
export function parseRolesFromBody(body: Record<string, unknown>): {
  ok: true;
  roles: HrEmployeeRoles;
} | { ok: false; error: string } {
  if (Array.isArray(body.puestos) || Array.isArray(body.roles)) {
    const arr = (Array.isArray(body.puestos) ? body.puestos : body.roles) as unknown[];
    const labels = uniqLabels(arr.map((x) => String(x ?? '')));
    if (labels.length === 0) {
      return { ok: true, roles: { primary: null, secondary: [] } };
    }
    return {
      ok: true,
      roles: { primary: labels[0]!, secondary: labels.slice(1) },
    };
  }

  if (body.puesto === undefined && body.puestos_secundarios === undefined) {
    return { ok: true, roles: { primary: null, secondary: [] } };
  }

  const primary =
    body.puesto === undefined
      ? null
      : normalizePuestoLabel(
          body.puesto == null ? null : String(body.puesto)
        );

  let secondary: string[] = [];
  if (Array.isArray(body.puestos_secundarios)) {
    secondary = uniqLabels(
      body.puestos_secundarios.map((x) => String(x ?? ''))
    );
  } else if (typeof body.puestos_secundarios === 'string') {
    secondary = uniqLabels(
      body.puestos_secundarios.split(/[,|;]/).map((s) => s.trim())
    );
  }

  if (primary) {
    secondary = secondary.filter((s) => foldKey(s) !== foldKey(primary));
  }

  return { ok: true, roles: { primary, secondary } };
}

/** Sync flag legado en notes al guardar roles duales. */
export function syncDualFlagInNotes(
  notes: string | null | undefined,
  dual: boolean
): string | null {
  const flag = 'dual_limpieza_mesero';
  let n = String(notes || '').trim();
  const has = notesHasFlag(n, flag);
  if (dual && !has) {
    n = n ? `${n}; ${flag}` : flag;
  } else if (!dual && has) {
    n = n
      .replace(new RegExp(`;?\\s*${flag}\\s*;?`, 'gi'), ';')
      .replace(/^;|;$/g, '')
      .replace(/;;+/g, ';')
      .trim();
  }
  return n || null;
}

/** Texto plantilla: principal; hint secundarios. */
export function formatPlantillaPuestoLabel(e: {
  puesto?: string | null;
  puestos_secundarios?: string[] | null;
  notes?: string | null;
  area?: string | null;
}): { primary: string; secondaryHint: string | null; title: string } {
  const { primary, secondary } = resolveEmployeeRoles(e);
  const prim =
    primary ||
    normalizePuestoLabel(e.area) ||
    '';
  const hint =
    secondary.length > 0
      ? secondary.map((s) => s).join(', ')
      : null;
  const title = hint ? `${prim || '—'} · también ${hint}` : prim || '—';
  return { primary: prim || '—', secondaryHint: hint, title };
}

/** Minutos desde medianoche; overnight end → +24h. */
function toAbsRange(
  start: string,
  end: string
): { s: number; e: number } | null {
  const sh = start.slice(0, 5);
  const eh = end.slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(sh) || !/^\d{2}:\d{2}$/.test(eh)) return null;
  const [a, b] = sh.split(':').map(Number);
  const [c, d] = eh.split(':').map(Number);
  let s = a * 60 + b;
  let e = c * 60 + d;
  if (e <= s) e += 24 * 60;
  return { s, e };
}

export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const a = toAbsRange(aStart, aEnd);
  const b = toAbsRange(bStart, bEnd);
  if (!a || !b) return false;
  return a.s < b.e && b.s < a.e;
}

export type ScheduleShiftLike = {
  employee_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  area?: string | null;
  role_label?: string | null;
  notes?: string | null;
};

export type LimpiezaServicioConflict = {
  employee_id: string;
  shift_date: string;
  message: string;
};

/**
 * Candado: quien tiene Limpieza + servicio no puede tener turnos solapados
 * el mismo día (mañana Limpieza + tarde Meserx OK si no se cruzan).
 * Preferencia: solo alerta cuando un turno de Limpieza cruza con uno de servicio;
 * si no se puede clasificar, cualquier solape del mismo día se bloquea.
 */
export function findLimpiezaServicioConflicts(
  shifts: ScheduleShiftLike[],
  dualEmployeeIds: Set<string>
): LimpiezaServicioConflict[] {
  const byKey = new Map<string, ScheduleShiftLike[]>();
  for (const s of shifts) {
    if (!dualEmployeeIds.has(s.employee_id)) continue;
    if (!s.start_time || !s.end_time) continue;
    const key = `${s.employee_id}|${s.shift_date.slice(0, 10)}`;
    const list = byKey.get(key) || [];
    list.push(s);
    byKey.set(key, list);
  }

  const classify = (s: ScheduleShiftLike): 'limpieza' | 'servicio' | 'unknown' => {
    const notes = String(s.notes || '').toLowerCase();
    if (/dual_limpieza_mesero\s*:\s*limpieza/.test(notes)) return 'limpieza';
    if (/dual_limpieza_mesero\s*:\s*mesero/.test(notes)) return 'servicio';
    if (isLimpiezaPuesto(s.role_label) || isLimpiezaPuesto(s.area)) return 'limpieza';
    if (s.role_label && isServicioPuesto(s.role_label)) return 'servicio';
    const area = String(s.area || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (area.includes('limpieza')) return 'limpieza';
    const start = String(s.start_time || '').slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(start) && start < '12:00') return 'limpieza';
    if (/^\d{2}:\d{2}$/.test(start)) return 'servicio';
    return 'unknown';
  };

  const out: LimpiezaServicioConflict[] = [];
  const seen = new Set<string>();
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const [empId, date] = key.split('|');
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (
          !timeRangesOverlap(
            a.start_time!.slice(0, 5),
            a.end_time!.slice(0, 5),
            b.start_time!.slice(0, 5),
            b.end_time!.slice(0, 5)
          )
        ) {
          continue;
        }
        const ca = classify(a);
        const cb = classify(b);
        // Mismo rol clasificado → no es el candado Limpieza↔servicio
        if (ca !== 'unknown' && cb !== 'unknown' && ca === cb) {
          continue;
        }
        const conflictKey = `${empId}|${date}`;
        if (seen.has(conflictKey)) continue;
        seen.add(conflictKey);
        out.push({
          employee_id: empId!,
          shift_date: date!,
          message: `Turnos solapados el ${date}: Limpieza y servicio no pueden coincidir en horario.`,
        });
      }
    }
  }
  return out;
}

/** ¿Los segmentos de un día (HH:mm) se solapan? */
export function daySegmentsOverlap(
  segments: Array<{ start: string; end: string }>
): boolean {
  const valid = segments.filter(
    (s) => /^\d{2}:\d{2}$/.test(s.start) && /^\d{2}:\d{2}$/.test(s.end)
  );
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      if (
        timeRangesOverlap(
          valid[i]!.start,
          valid[i]!.end,
          valid[j]!.start,
          valid[j]!.end
        )
      ) {
        return true;
      }
    }
  }
  return false;
}
