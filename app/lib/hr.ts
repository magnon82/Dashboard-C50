/** Tipos y constantes del módulo RR.HH. (Fase 0). */

export type HrEmployeeStatus = 'activo' | 'baja' | 'suspendido';

/** Relación laboral en plantilla (docs de alta suelen no aplicar a externos). */
export type HrTipoEmpleo = 'interno' | 'externo';

/** Cáscara de duplicado fusionado (no es baja operativa real). */
export function isMergedDuplicateShell(
  notes: string | null | undefined
): boolean {
  const n = String(notes || '');
  return n.includes('duplicado_fusionado') || /merged_into\s*:/i.test(n);
}

/**
 * Fallback cuando `fecha_baja` aún no existe en DB o viene null:
 * lee «dejó de laborar YYYY-MM-DD» desde notes (archivo Gmail / scripts).
 */
export function fechaBajaFromNotes(
  notes: string | null | undefined
): string | null {
  const m = String(notes || '').match(
    /dej[oó]\s+de\s+laborar\s+(\d{4}-\d{2}-\d{2})/i
  );
  return m?.[1] ?? null;
}

export type HrPayrollStatus = 'borrador' | 'cerrado' | 'pagado';

export type HrScheduleStatus = 'propuesta' | 'borrador' | 'publicado';

export type HrDocCategory =
  | 'cultura'
  | 'perfiles'
  | 'examenes'
  | 'expedientes'
  | 'politicas'
  | 'manuales'
  | 'nominas'
  | 'horarios'
  | 'otro';

export type HrEmployee = {
  id: string;
  full_name: string;
  status: HrEmployeeStatus;
  /** Posición administrativa / principal (plantilla). */
  puesto: string | null;
  /** Roles adicionales (catálogo); no duplica fila en plantilla. */
  puestos_secundarios?: string[] | null;
  area: string | null;
  fecha_ingreso: string | null;
  /** Último día laborado / fecha de baja (patch `hr_employee_baja.sql`). */
  fecha_baja?: string | null;
  /** Cumpleaños (patch `hr_employee_nacimiento.sql`). */
  fecha_nacimiento?: string | null;
  /** Sueldo diario vigente en ficha (también snapshot en líneas de nómina). */
  sueldo_diario?: number | null;
  email: string | null;
  phone: string | null;
  drive_folder_path: string | null;
  suite_username?: string | null;
  force_include?: boolean;
  force_exclude?: boolean;
  /** Flags libres (p. ej. `externo`, `remoto_1_dia`, `dual_limpieza_mesero`, `sin_vacaciones`, `sueldo_quincenal:N`). Admin=quincenal; resto=semanal. */
  notes?: string | null;
  /** interno | externo (patch `hr_employee_tipo_empleo.sql`). */
  tipo_empleo?: HrTipoEmpleo | null;
  /**
   * Si false, no alerta por docs de alta faltantes.
   * Default: true (interno) / false (externo). Patch `hr_employee_tipo_empleo.sql`.
   */
  requiere_documentacion?: boolean | null;
  plantilla_origen?: string | null;
  payroll_period_label?: string | null;
  payroll_period_end?: string | null;
  payroll_paid_at?: string | null;
};

/** Próximo cumpleaños en el ciclo anual (hoy → +365, Dec envuelve a ene). */
export type HrBirthdayUpcoming = {
  employee_id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  fecha_nacimiento: string;
  next_date: string;
  days_until: number;
};

export type HrDocLink = {
  id: string;
  category: HrDocCategory;
  title: string;
  description: string | null;
  local_path: string | null;
  drive_url: string | null;
  sort_order: number;
  active: boolean;
};

export type HrSummaryKpis = {
  plantilla: number;
  employeesTotal: number;
  leavePending: number;
  resguardoPending: number;
  scheduleDraft: number;
  schedulePublished: number;
  payrollOpen: number;
  lastPaidLabel: string | null;
  lastPaidEnd: string | null;
  /** Semana ISO (lunes) en curso — CDMX. */
  currentWeekStart: string | null;
  /** True si hay horario `publicado` para la semana en curso. */
  currentWeekPublished: boolean;
  /** Empleados con days_remaining ≤ umbral (año en curso). */
  leaveLowBalance: number;
  leaveLowThreshold: number;
};

/** Alertas accionables del Tablero RR.HH. */
export type HrSummaryAlert = {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  go?: 'vacaciones' | 'horarios' | 'expedientes' | 'resguardos' | 'plantilla';
};

export type HrAvailabilityKind =
  | 'preferencia'
  | 'off'
  | 'bloqueo'
  | 'permiso';

export type HrAvailability = {
  id: string;
  employee_id: string;
  weekday: number | null;
  date_from: string | null;
  date_to: string | null;
  kind: HrAvailabilityKind;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_by: string | null;
  employee_name?: string | null;
};

export type HrScheduleWeek = {
  id: string;
  week_start: string;
  week_end: string;
  status: HrScheduleStatus;
  notes: string | null;
  created_by: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  shift_count?: number;
  /** Horas totales de turnos (lista). */
  hours_total?: number;
  /** Nº SEMANA C50 / homologable (lista). */
  week_number?: number | null;
};

export type HrScheduleShift = {
  id?: string;
  week_id?: string;
  employee_id: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  area: string | null;
  role_label: string | null;
  origin: 'auto' | 'manual';
  notes: string | null;
  employee_name?: string | null;
  employee_area?: string | null;
  employee_puesto?: string | null;
  /** Notas de ficha (flags dual/externo) cuando el join las trae. */
  employee_notes?: string | null;
};

export const HR_SCHEDULE_STATUS_LABELS: Record<HrScheduleStatus, string> = {
  propuesta: 'Propuesta',
  borrador: 'Borrador',
  publicado: 'Publicado',
};

/** Lunes ISO de la semana que contiene `iso` (noon local-friendly). */
export function mondayOfIsoWeek(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  const day = d.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** True si `weekStart` es el lunes de la semana en curso (CDMX). */
export function isCurrentScheduleWeek(
  weekStart: string,
  today: string = todayIsoCdmx()
): boolean {
  return weekStart.slice(0, 10) === mondayOfIsoWeek(today);
}

/** True si la semana ya terminó (`week_end` &lt; hoy CDMX) — histórico solo lectura. */
export function isPastScheduleWeek(
  weekEnd: string,
  today: string = todayIsoCdmx()
): boolean {
  return weekEnd.slice(0, 10) < today.slice(0, 10);
}

/**
 * Etiqueta de UI: pasada → «Publicado»; en curso → «En curso»;
 * futura → Borrador/Publicado según status (solo Publicar pasa a publicado).
 */
export function scheduleWeekStatusLabel(
  status: HrScheduleStatus,
  weekStart: string,
  today: string = todayIsoCdmx(),
  weekEnd?: string
): string {
  if (isCurrentScheduleWeek(weekStart, today)) return 'En curso';
  const end =
    weekEnd?.slice(0, 10) ||
    addIsoDays(weekStart.slice(0, 10), 6);
  if (isPastScheduleWeek(end, today)) return HR_SCHEDULE_STATUS_LABELS.publicado;
  return HR_SCHEDULE_STATUS_LABELS[status];
}

export const HR_AVAILABILITY_KIND_LABELS: Record<HrAvailabilityKind, string> = {
  preferencia: 'Preferencia',
  off: 'Día libre / off',
  bloqueo: 'Bloqueo',
  permiso: 'Permiso',
};

/** Estatus de solicitud de vacaciones. */
export type HrLeaveStatus =
  | 'pendiente'
  | 'aprobada'
  | 'rechazada'
  | 'cancelada';

/** Pago de vacaciones según formato Word C50. */
export type HrLeavePago = 'inmediato' | 'nomina';

/**
 * Campos del FORMATO-SOLICITUD DE VACACIONES. C50.docx
 * (además de date_from / date_to / days en columnas).
 */
export type HrLeaveRequestPayload = {
  form_version: 'formato-c50-v1';
  fecha_solicitud: string;
  solicitada_a: string;
  nombre_empleado: string;
  curp: string;
  puesto: string;
  ultimo_dia_laborado: string;
  fecha_reingreso: string;
  pago_vacaciones: HrLeavePago;
  observaciones: string;
  /** True cuando RH captura la solicitud en nombre del colaborador. */
  capturada_por_rh?: boolean;
};

export type HrLeaveRequest = {
  id: string;
  employee_id: string | null;
  date_from: string;
  date_to: string;
  days: number;
  status: HrLeaveStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  payload: HrLeaveRequestPayload | Record<string, unknown>;
  created_at: string;
  updated_at: string;
  employee_name?: string | null;
  employee_puesto?: string | null;
};

export const HR_LEAVE_STATUS_LABELS: Record<HrLeaveStatus, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

/**
 * Etiqueta de UI para historial: vacaciones aprobadas cuyo periodo ya
 * terminó (date_to < hoy CDMX) se muestran como «Tomadas» sin cambiar
 * el estatus en BD.
 */
export function hrLeaveDisplayLabel(
  status: HrLeaveStatus,
  dateTo: string,
  today: string = todayIsoCdmx()
): string {
  if (status === 'aprobada' && dateTo.slice(0, 10) < today) {
    return 'Tomadas';
  }
  return HR_LEAVE_STATUS_LABELS[status];
}

/** True si el periodo aprobado ya cerró (clasificación «Tomadas»). */
export function isLeaveTomada(
  status: HrLeaveStatus,
  dateTo: string,
  today: string = todayIsoCdmx()
): boolean {
  return status === 'aprobada' && dateTo.slice(0, 10) < today;
}

/** Saldo de vacaciones por colaborador (año en curso · plantilla vigente). */
export type HrLeaveBalanceRow = {
  employee_id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  days_taken: number | null;
  days_remaining: number | null;
  days_entitled: number | null;
  source: string | null;
  updated_at: string | null;
};

/** Carpeta Drive File Stream · Documentación vigente (nombre en disco aún incluye 2023). */
export const HR_DOCS_VIGENTE_DIR =
  'I:\\Mi unidad\\RH\\Documentación vigente 2023';

/** Bóveda de expedientes por colaborador (Altas / Bajas). Solo módulo `rrhh`. */
export const HR_EXPEDIENTES_DIR =
  'I:\\Mi unidad\\RH\\Expedientes personal C50';

export const HR_NOMINAS_DIR = 'I:\\Mi unidad\\RH\\Nóminas';

/** Carpeta Drive de nóminas (misma ID que `hr-payroll.ts` / import). */
export const HR_NOMINA_DRIVE_FOLDER_ID =
  process.env.HR_NOMINA_DRIVE_FOLDER_ID?.trim() ||
  '1qIZq7O2lcvs5zxG6p5jjzh4wRMXoFK3J';

/** Opcional: ID de carpeta Drive de expedientes (env). */
export const HR_EXPEDIENTES_DRIVE_FOLDER_ID =
  process.env.HR_EXPEDIENTES_DRIVE_FOLDER_ID?.trim() || '';

/** Opcional: ID de carpeta Drive de documentación vigente (env). */
export const HR_DOCS_VIGENTE_DRIVE_FOLDER_ID =
  process.env.HR_DOCS_VIGENTE_DRIVE_FOLDER_ID?.trim() || '';

export function hrDriveFolderUrl(
  folderId: string | null | undefined
): string | null {
  const id = (folderId || '').trim();
  if (!id) return null;
  return `https://drive.google.com/drive/folders/${id}`;
}

/** Umbral Tablero: saldo de vacaciones bajo (días restantes). */
export const HR_LEAVE_LOW_THRESHOLD = 3;

export const HR_VACACIONES_FORM_PATH =
  `${HR_DOCS_VIGENTE_DIR}\\FORMATO-SOLICITUD DE VACACIONES. C50.docx`;

export const HR_VACACIONES_POLITICA_PATH =
  `${HR_DOCS_VIGENTE_DIR}\\Política de vacaciones.docx`;

export const HR_PUNTUALIDAD_POLITICA_PATH =
  `${HR_DOCS_VIGENTE_DIR}\\Política de puntualidad y asistencia.docx`;

export const HR_RIT_PATH =
  `${HR_DOCS_VIGENTE_DIR}\\Reglamento Interior de Trabajo.docx`;

/** Políticas clave para Staff (no toda la biblioteca RH). */
export const HR_STAFF_POLICY_LINKS: {
  title: string;
  local_path: string;
  surfaces: Array<'vacaciones' | 'perfil'>;
}[] = [
  {
    title: 'Política de vacaciones',
    local_path: HR_VACACIONES_POLITICA_PATH,
    surfaces: ['vacaciones'],
  },
  {
    title: 'Política de puntualidad y asistencia',
    local_path: HR_PUNTUALIDAD_POLITICA_PATH,
    surfaces: ['perfil'],
  },
  {
    title: 'Reglamento Interior de Trabajo',
    local_path: HR_RIT_PATH,
    surfaces: ['perfil'],
  },
];

/** Días calendario inclusivos entre dos ISO YYYY-MM-DD. */
export function leaveInclusiveDays(from: string, to: string): number {
  const a = new Date(from.slice(0, 10) + 'T12:00:00');
  const b = new Date(to.slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

/** Suma/resta días a ISO date (UTC noon). */
export function addIsoDays(iso: string, delta: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayIsoCdmx(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const HR_DOC_CATEGORY_LABELS: Record<HrDocCategory, string> = {
  cultura: 'Cultura',
  perfiles: 'Perfiles',
  examenes: 'Exámenes',
  expedientes: 'Expedientes',
  politicas: 'Políticas',
  manuales: 'Manuales',
  nominas: 'Nóminas',
  horarios: 'Horarios',
  otro: 'Otro',
};

/**
 * Carpetas con pestaña propia en /rrhh (Expedientes, Horarios, Nómina).
 * No deben aparecer en Biblioteca aunque existan en hr_doc_links.
 */
export const HR_BIBLIOTECA_HIDDEN_TITLES = new Set([
  'Expedientes personal C50',
  'Horarios históricos',
  'Nóminas (Drive)',
]);

const HR_BIBLIOTECA_HIDDEN_CATEGORIES = new Set<HrDocCategory>([
  'expedientes',
  'horarios',
  'nominas',
]);

/** True si el ítem es carpeta operativa (otra pestaña), no doc de Biblioteca. */
export function isHrBibliotecaHiddenDoc(doc: {
  title?: string | null;
  category?: string | null;
}): boolean {
  if (doc.title && HR_BIBLIOTECA_HIDDEN_TITLES.has(doc.title)) return true;
  return Boolean(
    doc.category && HR_BIBLIOTECA_HIDDEN_CATEGORIES.has(doc.category as HrDocCategory)
  );
}

/** Paths por defecto si la tabla aún no tiene seed (mismo inventario que hr_module.sql). */
export const HR_DOC_LINK_DEFAULTS: Omit<HrDocLink, 'id' | 'active'>[] = [
  {
    category: 'cultura',
    title: 'Cultura organizacional',
    description: 'Misión, visión y valores C50 · consulta en la Suite',
    local_path: 'I:\\Mi unidad\\RH\\Cultura Organizacional',
    drive_url: null,
    sort_order: 10,
  },
  {
    category: 'cultura',
    title: 'Misión, Visión y Valores',
    description: 'Guía de cultura organizacional · misma consulta in-app',
    local_path: `${HR_DOCS_VIGENTE_DIR}\\Misión, Visión y Valores.docx`,
    drive_url: null,
    sort_order: 12,
  },
  {
    category: 'perfiles',
    title: 'Perfiles por posición',
    description: 'Perfiles, KPI y protocolos por puesto',
    local_path: 'I:\\Mi unidad\\RH\\Perfiles por posición',
    drive_url: null,
    sort_order: 20,
  },
  {
    category: 'examenes',
    title: 'Exámenes de piso',
    description: 'Exámenes y evaluaciones de piso',
    local_path: 'I:\\Mi unidad\\RH\\Exámenes piso',
    drive_url: null,
    sort_order: 30,
  },
  {
    category: 'manuales',
    title: 'Manual de contratación y baja de personal',
    description: 'Proceso de alta y baja de colaboradores',
    local_path: `${HR_DOCS_VIGENTE_DIR}\\Manual de contratación y baja de personal.docx`,
    drive_url: null,
    sort_order: 45,
  },
  {
    category: 'manuales',
    title: 'Manual para postular vacantes',
    description: 'Guía para publicar y postular vacantes',
    local_path: `${HR_DOCS_VIGENTE_DIR}\\Manual para postular vacantes.docx`,
    drive_url: null,
    sort_order: 46,
  },
  {
    category: 'politicas',
    title: 'Documentación vigente',
    description: 'Carpeta: políticas, reglamentos, formatos y antigüedad',
    local_path: HR_DOCS_VIGENTE_DIR,
    drive_url: hrDriveFolderUrl(HR_DOCS_VIGENTE_DRIVE_FOLDER_ID),
    sort_order: 50,
  },
  {
    category: 'politicas',
    title: 'Política de vacaciones',
    description: 'Anticipación, tope de días y reglas de goce',
    local_path: HR_VACACIONES_POLITICA_PATH,
    drive_url: null,
    sort_order: 51,
  },
  {
    category: 'politicas',
    title: 'Política de puntualidad y asistencia',
    description: 'Asistencia, retardos y faltas',
    local_path: HR_PUNTUALIDAD_POLITICA_PATH,
    drive_url: null,
    sort_order: 52,
  },
  {
    category: 'politicas',
    title: 'Reglamento Interior de Trabajo',
    description: 'RIT vigente C50',
    local_path: HR_RIT_PATH,
    drive_url: null,
    sort_order: 53,
  },
  {
    category: 'politicas',
    title: 'Reglamento C50 No fumar',
    description: 'Espacios libres de humo (archivo: «NO  FUMAR», doble espacio)',
    local_path: `${HR_DOCS_VIGENTE_DIR}\\Reglamento C50 NO  FUMAR.docx`,
    drive_url: null,
    sort_order: 54,
  },
];

export function formatHrDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Fecha de calendario válida YYYY-MM-DD (ajusta 29-feb en no bisiesto → 28-feb). */
function calendarDateIso(year: number, month: number, day: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  const d = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Próxima ocurrencia de cumpleaños a partir de hoy (CDMX).
 * Si ya pasó este año, envuelve al siguiente.
 */
export function nextBirthdayIso(
  fechaNacimiento: string,
  today: string = todayIsoCdmx()
): string | null {
  const dob = String(fechaNacimiento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const month = Number(dob.slice(5, 7));
  const day = Number(dob.slice(8, 10));
  if (!month || !day || month > 12 || day > 31) return null;
  const y = Number(today.slice(0, 4));
  let next = calendarDateIso(y, month, day);
  if (next < today.slice(0, 10)) {
    next = calendarDateIso(y + 1, month, day);
  }
  return next;
}

/** Días enteros desde `from` hasta `to` (ISO fechas, mediodía local). */
export function daysBetweenIso(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T12:00:00`);
  const b = new Date(`${to.slice(0, 10)}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Etiqueta relativa: «Hoy», «Mañana», «En 3 días». */
export function formatBirthdayCountdown(daysUntil: number): string {
  if (daysUntil <= 0) return 'Hoy';
  if (daysUntil === 1) return 'Mañana';
  return `En ${daysUntil} días`;
}

/**
 * Plantilla con fecha_nacimiento → lista ordenada próximo → más lejano (ciclo anual).
 */
export function upcomingBirthdays(
  employees: Pick<
    HrEmployee,
    'id' | 'full_name' | 'puesto' | 'area' | 'fecha_nacimiento'
  >[],
  today: string = todayIsoCdmx()
): HrBirthdayUpcoming[] {
  const out: HrBirthdayUpcoming[] = [];
  for (const e of employees) {
    const dob = e.fecha_nacimiento ? String(e.fecha_nacimiento).slice(0, 10) : '';
    if (!dob) continue;
    const next = nextBirthdayIso(dob, today);
    if (!next) continue;
    out.push({
      employee_id: e.id,
      full_name: e.full_name,
      puesto: e.puesto ?? null,
      area: e.area ?? null,
      fecha_nacimiento: dob,
      next_date: next,
      days_until: daysBetweenIso(today, next),
    });
  }
  out.sort((a, b) => {
    if (a.days_until !== b.days_until) return a.days_until - b.days_until;
    return a.full_name.localeCompare(b.full_name, 'es');
  });
  return out;
}

/** Antigüedad legible: «2 años 3 meses» / «5 meses» / «12 días». */
export function formatAntiguedad(
  fechaIngreso: string | null | undefined,
  asOf?: string | Date | null
): string {
  if (!fechaIngreso) return '—';
  const start = new Date(`${fechaIngreso.slice(0, 10)}T12:00:00`);
  const end =
    asOf == null
      ? new Date()
      : typeof asOf === 'string'
        ? new Date(`${asOf.slice(0, 10)}T12:00:00`)
        : asOf;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  if (end < start) return '—';

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  if (end.getDate() < start.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} año${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} mes${months === 1 ? '' : 'es'}`);
  if (parts.length) return parts.join(' ');

  const days = Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  );
  if (days <= 0) return 'Recién ingresado';
  return `${days} día${days === 1 ? '' : 's'}`;
}

/** Equipos de la plantilla vigente (agrupación por puesto). */
export type PlantillaTeamGroup = 'piso' | 'cocina' | 'admin' | 'otros';

export const PLANTILLA_TEAM_GROUP_LABELS: Record<PlantillaTeamGroup, string> = {
  piso: 'Equipo de piso',
  cocina: 'Equipo de cocina',
  admin: 'Administrativo',
  otros: 'Otros',
};

export const PLANTILLA_TEAM_GROUP_ORDER: PlantillaTeamGroup[] = [
  'piso',
  'cocina',
  'admin',
  'otros',
];

/** Normaliza puesto: minúsculas, sin acentos, espacios colapsados. */
function foldPuestoKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Partículas en minúscula (salvo al inicio) para Title Case de puestos. */
const PUESTO_TITLE_PARTICLES = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'e',
  'o',
  'u',
  'a',
  'en',
  'para',
  'por',
  'al',
]);

/** Siglas que se mantienen en mayúsculas. */
const PUESTO_ACRONYMS = new Set(['rh', 'rrhh']);

/**
 * Correcciones de display (typos / grafía canónica) por clave foldPuestoKey.
 * Solo presentación — no escribe en DB.
 */
const PUESTO_DISPLAY_FIXES: Record<string, string> = {
  socio: 'Socios',
  socios: 'Socios',
  hosstes: 'Hostess',
  hosses: 'Hostess',
  hostes: 'Hostess',
  hostess: 'Hostess',
  'lava loza': 'Lavaloza',
  lavaloza: 'Lavaloza',
  capitan: 'Capitan',
  captain: 'Capitan',
  barra: 'Bartender',
  barman: 'Bartender',
  bartender: 'Bartender',
  'mesero encargado': 'Meserx Encargadx',
  'mesera encargada': 'Meserx Encargadx',
  'meserx encargadx': 'Meserx Encargadx',
  mesero: 'Meserx',
  mesera: 'Meserx',
  meserx: 'Meserx',
  cajero: 'Cajerx',
  cajera: 'Cajerx',
  cajerx: 'Cajerx',
  'sub chef': 'Sub chef',
  subchef: 'Sub chef',
};

/**
 * Title Case ES para puesto/posición (solo display).
 * «MESERO ENCARGADO» → «Mesero Encargado»; «HOSSTES» → «Hostess»;
 * «LAVA LOZA» → «Lava loza»; «ENCARGADO DE COCINA» → «Encargado de Cocina».
 */
export function formatHrPuesto(puesto: string | null | undefined): string {
  const cleaned = String(puesto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const fix = PUESTO_DISPLAY_FIXES[foldPuestoKey(cleaned)];
  if (fix) return fix;

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((tok, i) => {
      const lower = tok.toLocaleLowerCase('es-MX');
      const folded = foldPuestoKey(tok);
      if (PUESTO_ACRONYMS.has(folded)) return folded.toUpperCase();
      if (i > 0 && PUESTO_TITLE_PARTICLES.has(folded)) return lower;
      if (!lower) return tok;
      return lower.charAt(0).toLocaleUpperCase('es-MX') + lower.slice(1);
    })
    .join(' ');
}

/**
 * Clasifica un puesto en equipo de piso / cocina / administrativo.
 * Desconocidos → `otros`. Acentos y mayúsculas flexibles; typos comunes (HOSSTES).
 */
export function plantillaTeamGroup(
  puesto: string | null | undefined
): PlantillaTeamGroup {
  const p = foldPuestoKey(puesto ?? '');
  if (!p) return 'otros';

  // Administrativo (antes de cocina: evita “encargado” genérico mal clasificado)
  if (
    /\bsocio/.test(p) ||
    /\binventario/.test(p) ||
    /\bcontrol(\s+de)?\s+costo/.test(p) ||
    /\bcaja\b/.test(p) ||
    /\bcajera?\b/.test(p) ||
    /\badmin/.test(p) ||
    /\bcompras\b/.test(p) ||
    /\basistente\b/.test(p) ||
    /\bgerente\b/.test(p) ||
    /\brh\b/.test(p) ||
    /\brrhh\b/.test(p) ||
    /\brecursos\s+humanos\b/.test(p) ||
    /\bcontabilidad\b/.test(p) ||
    /\boficina\b/.test(p) ||
    /\brecepcion\b/.test(p)
  ) {
    return 'admin';
  }

  // Cocina
  if (
    /\blava\s*loza\b/.test(p) ||
    /\blavaloza\b/.test(p) ||
    /\bencargado\s+(de\s+)?cocina\b/.test(p) ||
    /\bcocinero\b/.test(p) ||
    /\bcocinera\b/.test(p) ||
    /\bsub\s*chef\b/.test(p) ||
    /\bchef\b/.test(p) ||
    /\bcocina\b/.test(p) ||
    /\bpizzero\b/.test(p) ||
    /\btortero\b/.test(p) ||
    /\bayudante\s+(de\s+)?cocina\b/.test(p)
  ) {
    return 'cocina';
  }

  // Equipo de piso (incluye «Mesero encargado», hostess, barra, limpieza, …)
  if (
    /\bhoss?te+s+\b/.test(p) ||
    /\bhoste+s+\b/.test(p) ||
    /\bmesero\b/.test(p) ||
    /\bmesera\b/.test(p) ||
    /\brunner\b/.test(p) ||
    /\bbarra\b/.test(p) ||
    /\bbarman\b/.test(p) ||
    /\bbartender\b/.test(p) ||
    /\blimpieza\b/.test(p) ||
    /\bgarrotero\b/.test(p) ||
    /\bgarrotera\b/.test(p) ||
    /\bcapitan\b/.test(p) ||
    /\bcaptain\b/.test(p) ||
    /\bpiso\b/.test(p) ||
    /\bbusboy\b/.test(p) ||
    /\bsommelier\b/.test(p)
  ) {
    return 'piso';
  }

  return 'otros';
}

/** Familia de posición para ordenar puestos similares juntos dentro de un equipo. */
export type PlantillaPositionFamilyId =
  | 'mesero'
  | 'hostess'
  | 'barra'
  | 'runner'
  | 'limpieza'
  | 'chef'
  | 'encargado_cocina'
  | 'cocinero'
  | 'lavaloza'
  | 'estacion_cocina'
  | 'gerente'
  | 'rh'
  | 'caja'
  | 'costos'
  | 'admin'
  | 'otros';

export type PlantillaPositionFamily = {
  id: PlantillaPositionFamilyId;
  label: string;
  /** Menor = aparece primero dentro del equipo. */
  order: number;
};

const POSITION_FAMILY_META: Record<
  PlantillaPositionFamilyId,
  Omit<PlantillaPositionFamily, 'id'>
> = {
  mesero: { label: 'Mesero', order: 10 },
  hostess: { label: 'Hostess', order: 20 },
  barra: { label: 'Bartender', order: 30 },
  runner: { label: 'Runner', order: 40 },
  limpieza: { label: 'Limpieza', order: 50 },
  chef: { label: 'Chef', order: 60 },
  encargado_cocina: { label: 'Encargado cocina', order: 70 },
  cocinero: { label: 'Cocinero', order: 80 },
  lavaloza: { label: 'Lavaloza', order: 90 },
  estacion_cocina: { label: 'Cocina', order: 100 },
  gerente: { label: 'Gerencia', order: 110 },
  rh: { label: 'RH', order: 120 },
  caja: { label: 'Caja', order: 130 },
  costos: { label: 'Costos / inventario', order: 140 },
  admin: { label: 'Admin', order: 150 },
  otros: { label: 'Otros', order: 900 },
};

/**
 * Rango dentro de familia mesero: capitán / encargado primero, luego mesero/mesera.
 * Menor = aparece primero.
 */
export function meseroWithinFamilyRank(
  puesto: string | null | undefined
): number {
  const p = foldPuestoKey(puesto ?? '');
  if (/\bcapitan\b/.test(p) || /\bcaptain\b/.test(p)) return 0;
  if (/\bencargado\b/.test(p)) return 1;
  return 2;
}

/**
 * Área genérica de piso (no es sección Excel). Preferir `puesto` para agrupar.
 * «Piso» solo indica equipo; no debe crear encabezado huérfano.
 */
export function isGenericPisoArea(raw: string | null | undefined): boolean {
  const p = foldPuestoKey(raw ?? '');
  return p === 'piso' || p === 'equipo de piso' || p === 'floor';
}

/**
 * Clave de posición para plantilla/horarios: puesto, o área si no es «Piso» vacío.
 */
export function plantillaPositionKey(
  e: Pick<HrEmployee, 'puesto' | 'area' | 'notes' | 'puestos_secundarios'>
): string | null {
  const puesto = String(e.puesto || '').trim();
  if (puesto) return puesto;
  if (employeeNotesHasFlag(e.notes, 'dual_limpieza_mesero')) {
    return 'Meserx Encargadx';
  }
  const area = String(e.area || '').trim();
  if (!area || isGenericPisoArea(area)) return null;
  return area;
}

/**
 * Sección tipo Excel de horarios a partir de puesto/área/familia.
 * Orden canónico: Hostess → Caja → Bartender → Meseros → Runner → Cocina → …
 */
export function scheduleSectionFromPosition(
  puestoOrArea: string | null | undefined
): string {
  const raw = String(puestoOrArea || '').trim();
  if (!raw || isGenericPisoArea(raw)) return 'Otros';

  const folded = foldPuestoKey(raw);
  // Headers Excel directos (Barra legado → Bartender)
  const direct: Record<string, string> = {
    gerencia: 'Gerencia',
    socio: 'Administración',
    socios: 'Administración',
    hostess: 'Hostess',
    caja: 'Caja',
    barra: 'Bartender',
    bartender: 'Bartender',
    meseros: 'Meseros',
    mesero: 'Meseros',
    mesera: 'Meseros',
    meserx: 'Meseros',
    runner: 'Runner',
    cocina: 'Cocina',
    limpieza: 'Limpieza',
    mantenimiento: 'Mantenimiento',
    administracion: 'Administración',
    admin: 'Administración',
  };
  if (direct[folded]) return direct[folded]!;

  const fam = plantillaPositionFamily(raw);
  switch (fam.id) {
    case 'hostess':
      return 'Hostess';
    case 'caja':
      return 'Caja';
    case 'barra':
      return 'Bartender';
    case 'mesero':
      return 'Meseros';
    case 'runner':
      return 'Runner';
    case 'limpieza':
      return 'Limpieza';
    case 'chef':
    case 'encargado_cocina':
    case 'cocinero':
    case 'lavaloza':
    case 'estacion_cocina':
      return 'Cocina';
    case 'gerente':
      return 'Gerencia';
    case 'rh':
    case 'costos':
    case 'admin':
      return 'Administración';
    default:
      return raw;
  }
}

/**
 * Familia normalizada de un puesto (MESERO / Mesero encargado / CAPITAN → mesero, etc.).
 * Usa `puesto` o, si vacío, `area` (como en horarios).
 */
export function plantillaPositionFamily(
  puesto: string | null | undefined
): PlantillaPositionFamily {
  const p = foldPuestoKey(puesto ?? '');
  let id: PlantillaPositionFamilyId = 'otros';
  if (!p) {
    id = 'otros';
  } else if (/\bhoss?te+s+\b/.test(p) || /\bhoste+s+\b/.test(p)) {
    id = 'hostess';
  } else if (
    /\bmesero\b/.test(p) ||
    /\bmesera\b/.test(p) ||
    /\bcapitan\b/.test(p) ||
    /\bcaptain\b/.test(p)
  ) {
    id = 'mesero';
  } else if (
    /\bbarra\b/.test(p) ||
    /\bbarman\b/.test(p) ||
    /\bbartender\b/.test(p)
  ) {
    id = 'barra';
  } else if (
    /\brunner\b/.test(p) ||
    /\bgarrotero\b/.test(p) ||
    /\bgarrotera\b/.test(p) ||
    /\bbusboy\b/.test(p)
  ) {
    id = 'runner';
  } else if (/\blimpieza\b/.test(p)) {
    id = 'limpieza';
  } else if (/\bsub\s*chef\b/.test(p) || /\bchef\b/.test(p)) {
    id = 'chef';
  } else if (/\bencargado\s+(de\s+)?cocina\b/.test(p)) {
    id = 'encargado_cocina';
  } else if (/\bcocinero\b/.test(p) || /\bcocinera\b/.test(p)) {
    id = 'cocinero';
  } else if (/\blava\s*loza\b/.test(p) || /\blavaloza\b/.test(p)) {
    id = 'lavaloza';
  } else if (
    /\bpizzero\b/.test(p) ||
    /\btortero\b/.test(p) ||
    /\bayudante\s+(de\s+)?cocina\b/.test(p) ||
    /\bcocina\b/.test(p)
  ) {
    id = 'estacion_cocina';
  } else if (/\bsocio/.test(p)) {
    id = 'gerente';
  } else if (/\bgerente\b/.test(p)) {
    id = 'gerente';
  } else if (
    /\brh\b/.test(p) ||
    /\brrhh\b/.test(p) ||
    /\brecursos\s+humanos\b/.test(p)
  ) {
    id = 'rh';
  } else if (/\bcaja\b/.test(p)) {
    id = 'caja';
  } else if (
    /\binventario/.test(p) ||
    /\bcontrol(\s+de)?\s+costo/.test(p)
  ) {
    id = 'costos';
  } else if (
    /\badmin/.test(p) ||
    /\bcompras\b/.test(p) ||
    /\basistente\b/.test(p) ||
    /\bcontabilidad\b/.test(p) ||
    /\boficina\b/.test(p) ||
    /\brecepcion\b/.test(p)
  ) {
    id = 'admin';
  }
  const meta = POSITION_FAMILY_META[id];
  return { id, label: meta.label, order: meta.order };
}

/** True si `notes` contiene el token/flag (case-insensitive). */
export function employeeNotesHasFlag(
  notes: string | null | undefined,
  flag: string
): boolean {
  const n = String(notes || '').toLowerCase();
  const f = String(flag || '')
    .toLowerCase()
    .trim();
  if (!f) return false;
  return n.includes(f);
}

function foldNameTokenSet(fullName: string | null | undefined): Set<string> {
  return new Set(
    String(fullName || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Admin principal en plantilla (arriba en Administrativo):
 * Socios / Gerencia / Compras y Administración / Rodrigo.
 */
export function isPlantillaAdminPrincipal(
  e: Pick<HrEmployee, 'full_name' | 'puesto' | 'area'>
): boolean {
  const key = foldPuestoKey(e.puesto || e.area || '');
  if (/\bsocio/.test(key)) return true;
  if (/\bgerente\b/.test(key)) return true;
  if (/\bcompras\b/.test(key)) return true;
  const tokens = foldNameTokenSet(e.full_name);
  if (
    tokens.has('rodrigo') &&
    (tokens.has('leon') || tokens.has('gonzalez') || tokens.has('glez'))
  ) {
    return true;
  }
  return false;
}

/**
 * Socios / colaboradores sin control de vacaciones.
 * Flag `sin_vacaciones` en notes, o puesto Socios.
 */
export function isLeaveExemptEmployee(
  e: Pick<HrEmployee, 'puesto' | 'notes' | 'area'>
): boolean {
  if (employeeNotesHasFlag(e.notes, 'sin_vacaciones')) return true;
  const key = foldPuestoKey(e.puesto || e.area || '');
  return /\bsocio/.test(key);
}

/** Lee `sueldo_quincenal:N` desde notes (pago quincenal documentado). */
export function parseSueldoQuincenalFromNotes(
  notes: string | null | undefined
): number | null {
  const m = String(notes || '').match(/sueldo_quincenal\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export type HrPayCadence = 'quincenal' | 'semanal';

/**
 * Cadencia de pago: Administrativo (sección/área/puesto admin) → quincenal;
 * resto de plantilla → semanal. Flag `sueldo_quincenal:N` en notes fuerza quincenal.
 */
export function employeePayCadence(
  e: Pick<HrEmployee, 'puesto' | 'area' | 'notes' | 'puestos_secundarios'>
): HrPayCadence {
  if (parseSueldoQuincenalFromNotes(e.notes) != null) return 'quincenal';
  const key = plantillaPositionKey(e);
  if (plantillaTeamGroup(key) === 'admin') return 'quincenal';
  const areaKey = foldPuestoKey(e.area || '');
  if (/\badmin/.test(areaKey) || /\badministraci/.test(areaKey)) {
    return 'quincenal';
  }
  return 'semanal';
}

/**
 * Equivalente quincenal documentado.
 * Prioridad: `sueldo_quincenal:N` en notes; si no, diario × 15 solo para
 * socios/leave-exempt (patrón admin documentado). No inventa montos para
 * otros administrativos sin flag en notes.
 */
export function resolveSueldoQuincenal(e: {
  sueldo_diario?: number | null;
  notes?: string | null;
  puesto?: string | null;
  area?: string | null;
  puestos_secundarios?: string[] | null;
}): number | null {
  const fromNotes = parseSueldoQuincenalFromNotes(e.notes);
  if (fromNotes != null) return fromNotes;
  const roleFields = {
    puesto: e.puesto ?? null,
    area: e.area ?? null,
    notes: e.notes ?? null,
    puestos_secundarios: e.puestos_secundarios ?? null,
  };
  if (employeePayCadence(roleFields) !== 'quincenal') return null;
  if (!isLeaveExemptEmployee(roleFields)) return null;
  const sd =
    e.sueldo_diario != null && Number.isFinite(Number(e.sueldo_diario))
      ? Number(e.sueldo_diario)
      : null;
  if (sd == null || sd < 0) return null;
  return Math.round(sd * 15 * 100) / 100;
}

/**
 * Externo / remoto en plantilla (abajo en Administrativo).
 * `tipo_empleo=externo`, flags en notes (`externo`, `remoto_1_dia`) o nombres
 * conocidos (Alexis / Diego Olvera) si aún no hay columna.
 */
export function isPlantillaExterno(
  e: Pick<HrEmployee, 'full_name' | 'notes' | 'tipo_empleo'>
): boolean {
  if (e.tipo_empleo === 'externo') return true;
  if (employeeNotesHasFlag(e.notes, 'externo')) return true;
  if (employeeNotesHasFlag(e.notes, 'remoto_1_dia')) return true;
  const tokens = foldNameTokenSet(e.full_name);
  if (tokens.has('alexis') && (tokens.has('zuniga') || tokens.has('alvarez'))) {
    return true;
  }
  if (tokens.has('diego') && tokens.has('olvera')) return true;
  return false;
}

/** Sync flag legado `externo` en notes al guardar tipo_empleo. */
export function syncExternoFlagInNotes(
  notes: string | null | undefined,
  isExterno: boolean
): string | null {
  const flag = 'externo';
  let n = String(notes || '').trim();
  const has = employeeNotesHasFlag(n, flag);
  if (isExterno && !has) {
    n = n ? `${flag}; ${n}` : `${flag}.`;
  } else if (!isExterno && has) {
    n = n
      .replace(new RegExp(`;?\\s*${flag}\\.?\\s*;?`, 'gi'), ';')
      .replace(/^;|;$/g, '')
      .replace(/;;+/g, ';')
      .trim();
  }
  return n || null;
}

/**
 * ¿Debe alertar / exigir docs de alta (INE, acta, CURP, domicilio)?
 * Prioridad: `requiere_documentacion` → `tipo_empleo` → legado externo (notes/nombre).
 */
export function employeeRequiresDocumentation(
  e: Pick<
    HrEmployee,
    'requiere_documentacion' | 'tipo_empleo' | 'full_name' | 'notes'
  >
): boolean {
  if (e.requiere_documentacion === false) return false;
  if (e.requiere_documentacion === true) return true;
  if (e.tipo_empleo === 'externo') return false;
  if (e.tipo_empleo === 'interno') return true;
  if (isPlantillaExterno(e)) return false;
  return true;
}

/** Default de requiere_documentacion según tipo. */
export function defaultRequiereDocumentacion(
  tipo: HrTipoEmpleo | null | undefined
): boolean {
  return tipo !== 'externo';
}

/** 0 = principal · 1 = interno · 2 = externo (solo grupo admin). */
function adminWithinGroupRank(
  e: Pick<HrEmployee, 'full_name' | 'puesto' | 'area' | 'notes'>
): number {
  if (isPlantillaExterno(e)) return 2;
  if (isPlantillaAdminPrincipal(e)) return 0;
  return 1;
}

export type PlantillaTeamBucket = {
  group: PlantillaTeamGroup;
  label: string;
  employees: HrEmployee[];
};

/** Agrupa plantilla por equipo; dentro de cada grupo: familia, rango mesero, luego nombre. */
export function groupPlantillaByTeam(
  employees: HrEmployee[]
): PlantillaTeamBucket[] {
  const buckets: Record<PlantillaTeamGroup, HrEmployee[]> = {
    piso: [],
    cocina: [],
    admin: [],
    otros: [],
  };
  for (const e of employees) {
    // puesto primero; área «Piso» no cuenta (dual_limpieza_mesero → Mesero encargado)
    const key = plantillaPositionKey(e);
    buckets[plantillaTeamGroup(key)].push(e);
  }
  const collator = new Intl.Collator('es', { sensitivity: 'base' });
  for (const g of PLANTILLA_TEAM_GROUP_ORDER) {
    buckets[g].sort((a, b) => {
      if (g === 'admin') {
        const tierA = adminWithinGroupRank(a);
        const tierB = adminWithinGroupRank(b);
        if (tierA !== tierB) return tierA - tierB;
      }
      const keyA = plantillaPositionKey(a);
      const keyB = plantillaPositionKey(b);
      const famA = plantillaPositionFamily(keyA);
      const famB = plantillaPositionFamily(keyB);
      if (famA.order !== famB.order) return famA.order - famB.order;
      if (famA.id === 'mesero' && famB.id === 'mesero') {
        const rankA = meseroWithinFamilyRank(keyA);
        const rankB = meseroWithinFamilyRank(keyB);
        if (rankA !== rankB) return rankA - rankB;
      }
      return collator.compare(a.full_name || '', b.full_name || '');
    });
  }
  return PLANTILLA_TEAM_GROUP_ORDER.filter((g) => buckets[g].length > 0).map(
    (g) => ({
      group: g,
      label: PLANTILLA_TEAM_GROUP_LABELS[g],
      employees: buckets[g],
    })
  );
}
