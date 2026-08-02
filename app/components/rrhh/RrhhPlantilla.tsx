'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import {
  HrDocViewer,
  type HrViewerTarget,
} from '@/app/components/rrhh/HrDocViewer';
import { RrhhResguardosPanel } from '@/app/components/rrhh/RrhhResguardosPanel';
import {
  formatAntiguedad,
  formatHrDate,
  formatHrPuesto,
  groupPlantillaByTeam,
  isMergedDuplicateShell,
  isPlantillaExterno,
  plantillaPositionKey,
  type HrEmployee,
  type PlantillaTeamGroup,
} from '@/app/lib/hr';
import { formatHrListName } from '@/app/lib/hr-person-match';
import { suggestSuiteUsername } from '@/app/lib/hr-suite-user';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type Payload = {
  ready: boolean;
  source?: string;
  employees: HrEmployee[];
  count: number;
  periodLabel: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  periodStatus?: string | null;
  scheduleWeekStart?: string | null;
  scheduleWeekEnd?: string | null;
  scheduleWeekStatus?: string | null;
  seeded?: boolean;
  message?: string | null;
  error?: string;
  code?: string | null;
};

type ExpedienteFolder = {
  name: string;
  path: string;
  mtimeMs: number | null;
  employeeId?: string | null;
  matchedName?: string | null;
  linkStatus?: string;
  archiveStatus?: string | null;
  fechaBaja?: string | null;
  /** Desajuste Drive↔DB, p.ej. baja con carpeta aún en Altas. */
  archiveNote?: string | null;
};

type ArchivedDb = {
  id: string;
  full_name: string;
  status: string;
  fecha_ingreso?: string | null;
  fecha_baja: string | null;
  puesto: string | null;
  force_exclude: boolean;
  notes?: string | null;
  drive_folder_path?: string | null;
};

type ExpedienteIndex = {
  ready: boolean;
  source?: 'file_stream' | 'supabase' | 'none' | string;
  path?: string;
  exists?: boolean;
  rootExists?: boolean;
  driveUrl?: string | null;
  buckets?: { id: string; kind: 'altas' | 'bajas' | 'otros'; name: string; path: string }[];
  archivedFromDb?: ArchivedDb[];
  linkedCount?: number;
  message?: string;
  error?: string;
};

const EMPTY_HINT =
  'Abre Nómina (cierra/paga) o importa horarios con turnos reales';

/** Acento de sección por equipo — navy/orange + teal solo en cocina. */
const TEAM_ACCENT: Record<
  PlantillaTeamGroup,
  { accent: string; wash: string }
> = {
  piso: { accent: SUITE.orange, wash: SUITE.orangeSoft },
  cocina: { accent: '#0f766e', wash: '#ecf7f5' },
  admin: { accent: SUITE.navy, wash: '#e8eef8' },
  otros: { accent: SUITE.muted, wash: '#f1f5f9' },
};

function badgeText(data: Payload | null): string {
  const hasNomina =
    data?.source === 'nomina_horarios' ||
    data?.source === 'periodo_transcurrido' ||
    data?.source === 'plantilla_vigente' ||
    data?.source === 'seed_local_2026' ||
    data?.periodStatus === 'pagado' ||
    data?.periodStatus === 'cerrado' ||
    Boolean(data?.periodLabel || data?.periodEnd || data?.paidAt);
  const hasSchedule =
    data?.source === 'nomina_horarios' ||
    data?.source === 'solo_horarios' ||
    Boolean(data?.scheduleWeekStart || data?.scheduleWeekEnd);

  if (!hasNomina && !hasSchedule) {
    return 'Sin referencia de plantilla';
  }
  if (hasNomina && hasSchedule) {
    const periodo =
      data?.periodLabel || formatHrDate(data?.periodEnd || data?.paidAt);
    return periodo && periodo !== '—'
      ? `Conciliada con horarios · ${periodo}`
      : 'Conciliada con horarios';
  }
  if (hasSchedule) {
    const semana = formatHrDate(
      data?.scheduleWeekStart || data?.scheduleWeekEnd
    );
    return semana && semana !== '—'
      ? `Según última semana de horarios · ${semana}`
      : 'Según última semana de horarios';
  }
  const periodo =
    data?.periodLabel || formatHrDate(data?.periodEnd || data?.paidAt);
  return periodo && periodo !== '—'
    ? `Según nómina conciliada · ${periodo}`
    : 'Según nómina conciliada';
}

function normKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function currentYearCdmx(): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
    }).format(new Date())
  );
}

function formatFechaBaja(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Periodo trabajado: ingreso → baja + duración (p. ej. «2 años 6 meses»). */
function formatPeriodoTrabajado(
  ingreso: string | null | undefined,
  baja: string | null | undefined
): string {
  const desde = formatFechaBaja(ingreso);
  const hasta = formatFechaBaja(baja);
  const duracion =
    ingreso && baja ? formatAntiguedad(ingreso, baja) : null;
  const tenure =
    duracion && duracion !== '—' ? ` · ${duracion}` : '';
  if (desde && hasta) return `${desde} – ${hasta}${tenure}`;
  if (hasta) return `hasta ${hasta}`;
  if (desde) return `desde ${desde} · sin fecha de baja`;
  return 'sin fechas';
}

function isBajaDelAno(a: ArchivedDb, year: number): boolean {
  if (isMergedDuplicateShell(a.notes)) return false;
  if (a.status !== 'baja' && !a.fecha_baja) return false;
  if (a.fecha_baja) {
    return Number(String(a.fecha_baja).slice(0, 4)) === year;
  }
  // Baja operativa sin fecha: mostrar para no perder expediente
  return a.status === 'baja';
}

function PlantillaPersonRow({
  employee,
  asOf,
  alt,
  folderPath,
  busy,
  onOpenExpediente,
  onEdit,
}: {
  employee: HrEmployee;
  asOf: string | null;
  alt: boolean;
  folderPath: string | null;
  busy: boolean;
  onOpenExpediente: (employee: HrEmployee, path: string) => void;
  onEdit: (employee: HrEmployee) => void;
}) {
  const puesto =
    formatHrPuesto(
      plantillaPositionKey(employee) || employee.puesto || employee.area
    ) || '—';
  return (
    <div
      className={`rrhh-plantilla__cols rrhh-plantilla__row${
        alt ? ' rrhh-plantilla__row--alt' : ''
      }`}
    >
      <div className="rrhh-plantilla__name">
        {formatHrListName(employee.full_name)}
      </div>
      <div>
        <span className="rrhh-plantilla__badge" title={puesto}>
          {puesto}
        </span>
      </div>
      <div className="rrhh-plantilla__meta">
        <div className="rrhh-plantilla__date">
          {formatHrDate(employee.fecha_ingreso)}
        </div>
        <div className="rrhh-plantilla__tenure">
          {formatAntiguedad(employee.fecha_ingreso, asOf)}
        </div>
      </div>
      <div className="rrhh-plantilla__exp">
        {folderPath ? (
          <button
            type="button"
            className="rrhh-plantilla__exp-btn"
            onClick={() => onOpenExpediente(employee, folderPath)}
          >
            Expediente
          </button>
        ) : (
          <span className="rrhh-plantilla__exp-miss" title="Sin carpeta vinculada">
            —
          </span>
        )}
      </div>
      <div className="rrhh-plantilla__actions">
        <button
          type="button"
          className="rrhh-plantilla__edit-btn"
          disabled={busy}
          onClick={() => onEdit(employee)}
          title="Editar colaborador"
          aria-label={`Editar ${formatHrListName(employee.full_name)}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function RrhhPlantilla({
  data,
  loading,
  onChanged,
  onGoBiblioteca,
  initialShowResguardos = false,
}: {
  data: Payload | null;
  loading: boolean;
  onChanged?: () => void;
  onGoBiblioteca?: () => void;
  initialShowResguardos?: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<Record<string, string>>({});
  const [createdCreds, setCreatedCreds] = useState<{
    username: string;
    password: string;
    displayName: string;
  } | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalog, setCatalog] = useState<HrEmployee[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [expIndex, setExpIndex] = useState<ExpedienteIndex | null>(null);
  const [folders, setFolders] = useState<ExpedienteFolder[]>([]);
  const [viewer, setViewer] = useState<HrViewerTarget | null>(null);
  const [showResguardos, setShowResguardos] = useState(initialShowResguardos);
  const [showAlta, setShowAlta] = useState(false);
  const [altaName, setAltaName] = useState('');
  const [altaPuesto, setAltaPuesto] = useState('');
  const [altaIngreso, setAltaIngreso] = useState(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return '';
    }
  });
  /** Panel de ficha: editar / dar de baja (no botón rojo en la lista). */
  const [editTarget, setEditTarget] = useState<HrEmployee | null>(null);
  const [showBajaForm, setShowBajaForm] = useState(false);
  /** Archivo de bajas: fuera de la plantilla vigente (no como alerta). */
  const [showArchivoBajas, setShowArchivoBajas] = useState(false);
  const [bajaFecha, setBajaFecha] = useState(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (initialShowResguardos) setShowResguardos(true);
  }, [initialShowResguardos]);

  const baseEmployees = data?.employees ?? [];
  const employees = showCatalog && catalog ? catalog : baseEmployees;
  const plantillaGroups = showCatalog ? [] : groupPlantillaByTeam(employees);
  const asOf = data?.periodEnd || data?.paidAt || null;
  const emptyPlantilla = !loading && !showCatalog && baseEmployees.length === 0;
  const statusMessage =
    toast ||
    (emptyPlantilla && (data?.message || EMPTY_HINT)) ||
    (data?.ready === false && data?.message) ||
    null;

  const year = currentYearCdmx();

  const loadExpedientes = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/expedientes', { cache: 'no-store' });
      const json = (await res.json()) as ExpedienteIndex;
      setExpIndex(json);

      const buckets = json.buckets ?? [];
      const toLoad = buckets.filter(
        (b) => b.kind === 'altas' || b.kind === 'bajas'
      );
      if (!toLoad.length) {
        setFolders([]);
        return;
      }

      const lists = await Promise.all(
        toLoad.map(async (b) => {
          const q = new URLSearchParams({
            bucket: b.kind,
            path: b.path,
          });
          const r = await fetch(`/api/hr/expedientes?${q}`, {
            cache: 'no-store',
          });
          const body = (await r.json()) as { people?: ExpedienteFolder[] };
          return body.people || [];
        })
      );
      // Prefer path uniqueness; Altas first in toLoad order
      const byPath = new Map<string, ExpedienteFolder>();
      for (const list of lists) {
        for (const p of list) {
          if (!byPath.has(p.path)) byPath.set(p.path, p);
        }
      }
      setFolders([...byPath.values()]);
    } catch {
      setExpIndex({
        ready: false,
        error: 'Error de red al cargar expedientes',
        archivedFromDb: [],
      });
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    void loadExpedientes();
  }, [loadExpedientes, data?.count]);

  useEffect(() => {
    if (!showCatalog) return;
    let cancelled = false;
    setCatalogLoading(true);
    fetch('/api/hr/employees?source=activos', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: Payload) => {
        if (!cancelled) setCatalog(json.employees || []);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCatalog, data?.count]);

  const folderByEmployeeId = useMemo(() => {
    const m = new Map<string, ExpedienteFolder>();
    for (const f of folders) {
      if (f.employeeId && !m.has(f.employeeId)) m.set(f.employeeId, f);
    }
    return m;
  }, [folders]);

  const folderByName = useMemo(() => {
    const m = new Map<string, ExpedienteFolder>();
    for (const f of folders) {
      const keys = [f.name, f.matchedName].filter(Boolean) as string[];
      for (const k of keys) {
        const nk = normKey(k);
        if (nk && !m.has(nk)) m.set(nk, f);
      }
    }
    return m;
  }, [folders]);

  const resolveFolderPath = useCallback(
    (emp: {
      id: string;
      full_name: string;
      drive_folder_path?: string | null;
    }): string | null => {
      if (emp.drive_folder_path) return emp.drive_folder_path;
      const byId = folderByEmployeeId.get(emp.id);
      if (byId) return byId.path;
      const byName = folderByName.get(normKey(emp.full_name));
      return byName?.path ?? null;
    },
    [folderByEmployeeId, folderByName]
  );

  const bajasDelAno = useMemo(() => {
    const list = (expIndex?.archivedFromDb ?? []).filter((a) =>
      isBajaDelAno(a, year)
    );
    const byLabel = new Map<string, ArchivedDb>();
    for (const a of list) {
      const label = formatHrListName(a.full_name).toLocaleLowerCase('es-MX');
      const prev = byLabel.get(label);
      if (!prev) {
        byLabel.set(label, a);
        continue;
      }
      const aHas = Boolean(resolveFolderPath(a));
      const prevHas = Boolean(resolveFolderPath(prev));
      if (aHas && !prevHas) byLabel.set(label, a);
      else if (aHas === prevHas && a.full_name.length > prev.full_name.length) {
        byLabel.set(label, a);
      }
    }
    return [...byLabel.values()].sort((a, b) => {
      const da = a.fecha_baja || '';
      const db = b.fecha_baja || '';
      if (da !== db) return db.localeCompare(da);
      return formatHrListName(a.full_name).localeCompare(
        formatHrListName(b.full_name),
        'es',
        { sensitivity: 'base' }
      );
    });
  }, [expIndex?.archivedFromDb, year, resolveFolderPath]);

  /** Carpetas en Altas cuyo empleado ya está baja en sistema. */
  const expedienteMismatches = useMemo(() => {
    return folders.filter(
      (f) =>
        f.archiveStatus === 'baja' &&
        (f.archiveNote || '').toLowerCase().includes('altas')
    );
  }, [folders]);

  const openExpediente = useCallback(
    (
      emp: {
        full_name: string;
        fecha_ingreso?: string | null;
        fecha_baja?: string | null;
      },
      path: string,
      opts?: { baja?: boolean }
    ) => {
      const periodo = formatPeriodoTrabajado(emp.fecha_ingreso, emp.fecha_baja);
      setViewer({
        title: formatHrListName(emp.full_name),
        path,
        kind: 'folder',
        preview: 'folder',
        description: opts?.baja
          ? periodo !== 'sin fechas'
            ? `Expediente · Baja · ${periodo}`
            : 'Expediente · Baja'
          : 'Expediente personal',
        driveUrl: expIndex?.driveUrl,
      });
    },
    [expIndex?.driveUrl]
  );

  async function patchEmployee(
    id: string,
    body: Record<string, unknown>
  ): Promise<boolean> {
    setBusyId(id);
    setToast(null);
    try {
      const res = await fetch('/api/hr/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo actualizar');
        return false;
      }
      setToast(json.message || 'Actualizado');
      onChanged?.();
      return true;
    } catch {
      setToast('Error de red');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function submitAlta() {
    const name = altaName.trim().replace(/\s+/g, ' ');
    if (name.length < 3) {
      setToast('Escribe el nombre completo (mín. 3 caracteres)');
      return;
    }
    setBusyId('__alta__');
    setToast(null);
    try {
      const res = await fetch('/api/hr/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name,
          puesto: altaPuesto.trim() || null,
          fecha_ingreso: altaIngreso || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo dar de alta');
        return;
      }
      setToast(json.message || 'Alta registrada');
      setShowAlta(false);
      setAltaName('');
      setAltaPuesto('');
      onChanged?.();
      void loadExpedientes();
    } catch {
      setToast('Error de red al dar de alta');
    } finally {
      setBusyId(null);
    }
  }

  async function submitBaja() {
    if (!editTarget) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bajaFecha)) {
      setToast('Indica la fecha de baja (YYYY-MM-DD)');
      return;
    }
    const ok = await patchEmployee(editTarget.id, {
      action: 'baja',
      fecha_baja: bajaFecha,
    });
    if (ok) {
      setEditTarget(null);
      setShowBajaForm(false);
      void loadExpedientes();
    }
  }

  async function reactivarBaja(a: ArchivedDb) {
    if (
      !confirm(
        `¿Reactivar a ${formatHrListName(a.full_name)} en la plantilla vigente?`
      )
    ) {
      return;
    }
    const ok = await patchEmployee(a.id, { action: 'alta' });
    if (ok) void loadExpedientes();
  }

  async function createSuiteUser(emp: HrEmployee) {
    setBusyId(emp.id);
    setToast(null);
    setCreatedCreds(null);
    const suggested =
      (editUser[emp.id] ?? '').trim() ||
      emp.suite_username ||
      suggestSuiteUsername(emp.full_name);
    try {
      const res = await fetch('/api/hr/employees/suite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: emp.id,
          username: suggested,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo crear el usuario');
        return;
      }
      setToast(json.message || 'Usuario listo');
      if (json.username && json.password) {
        setCreatedCreds({
          username: json.username,
          password: json.password,
          displayName: json.displayName || formatHrListName(emp.full_name),
        });
      }
      if (json.username) {
        setEditUser((m) => ({ ...m, [emp.id]: json.username }));
      }
      onChanged?.();
      if (showCatalog) {
        setCatalog((prev) =>
          prev
            ? prev.map((row) =>
                row.id === emp.id
                  ? { ...row, suite_username: json.username || row.suite_username }
                  : row
              )
            : prev
        );
      }
    } catch {
      setToast('Error de red al crear usuario');
    } finally {
      setBusyId(null);
    }
  }

  async function resetSuitePassword(emp: HrEmployee) {
    setBusyId(emp.id);
    setToast(null);
    setCreatedCreds(null);
    try {
      const res = await fetch('/api/hr/employees/suite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: emp.id,
          action: 'reset_password',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo restablecer');
        return;
      }
      setToast(json.message || 'Contraseña restablecida');
      if (json.username && json.password) {
        setCreatedCreds({
          username: json.username,
          password: json.password,
          displayName: json.displayName || formatHrListName(emp.full_name),
        });
      }
    } catch {
      setToast('Error de red al restablecer');
    } finally {
      setBusyId(null);
    }
  }

  const dbBacked =
    expIndex?.source === 'supabase' ||
    (expIndex?.ready === true && (expIndex.linkedCount ?? 0) > 0) ||
    (expIndex?.archivedFromDb?.length ?? 0) > 0;
  const syncBanner = expIndex?.message || expIndex?.error;
  // Online: no banner de «Drive no montado» si ya hay índice/plantilla en servidor.
  const showSyncBanner = Boolean(syncBanner) && !dbBacked;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold" style={{ color: theme.title }}>
          Plantilla vigente
        </h3>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: SUITE.orangeSoft, color: SUITE.navy }}
        >
          {badgeText(data)}
        </span>
        <button
          type="button"
          className="rounded-full px-3 py-1 text-xs font-semibold text-white"
          style={{ backgroundColor: SUITE.orangeDeep }}
          onClick={() => {
            setShowAlta((v) => !v);
            setEditTarget(null);
            setShowBajaForm(false);
          }}
        >
          {showAlta ? 'Cerrar alta' : 'Alta empleado'}
        </button>
        <button
          type="button"
          className="rounded-full px-3 py-1 text-xs font-semibold border border-slate-200"
          style={{ color: theme.title }}
          onClick={() => setShowCatalog((v) => !v)}
        >
          {showCatalog ? 'Ver plantilla' : 'Overrides'}
        </button>
        <button
          type="button"
          className="rounded-full px-3 py-1 text-xs font-semibold border border-slate-200"
          style={{ color: theme.title }}
          onClick={() => setShowArchivoBajas((v) => !v)}
          title="Bajas y desajustes de expediente — fuera de la plantilla vigente"
        >
          {showArchivoBajas
            ? 'Ocultar archivo'
            : `Archivo / Bajas${
                bajasDelAno.length || expedienteMismatches.length
                  ? ` (${bajasDelAno.length}${
                      expedienteMismatches.length
                        ? ` · ${expedienteMismatches.length} desajuste${
                            expedienteMismatches.length === 1 ? '' : 's'
                          }`
                        : ''
                    })`
                  : ''
              }`}
        </button>
        <button
          type="button"
          className="rounded-full px-3 py-1 text-xs font-semibold text-white"
          style={{ backgroundColor: SUITE.navy }}
          onClick={() => setShowResguardos((v) => !v)}
        >
          {showResguardos ? 'Ocultar resguardo' : 'Nuevo resguardo'}
        </button>
        {onGoBiblioteca ? (
          <button
            type="button"
            className="rounded-full px-3 py-1 text-xs font-semibold border border-slate-200"
            style={{ color: theme.title }}
            onClick={onGoBiblioteca}
          >
            Biblioteca →
          </button>
        ) : null}
        {expIndex?.driveUrl ? (
          <a
            href={expIndex.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full px-3 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: SUITE.orangeDeep }}
          >
            Abrir en Drive
          </a>
        ) : null}
      </div>

      {statusMessage && (
        <p
          className="text-sm"
          style={{
            color:
              data?.ready === false ||
              data?.code === 'schema_missing' ||
              data?.code === 'empty' ||
              data?.code === 'file_missing'
                ? '#b45309'
                : theme.muted,
          }}
        >
          {statusMessage}
        </p>
      )}

      {showAlta ? (
        <div
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 max-w-2xl space-y-3"
          style={{ boxShadow: SUITE.shadow }}
        >
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            Alta de empleado
          </p>
          <p className="text-xs" style={{ color: theme.muted }}>
            Se agrega a la plantilla vigente (force_include). El usuario Suite se
            puede crear después en Overrides. Futuro: checklist de documentos
            (INE, contrato, etc.) subidos a la base —{' '}
            <code className="text-[10px]">supabase/hr_employee_documents.sql</code>
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600">
                Nombre completo *
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={altaName}
                onChange={(e) => setAltaName(e.target.value)}
                placeholder="Nombre y apellidos"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">
                Puesto
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={altaPuesto}
                onChange={(e) => setAltaPuesto(e.target.value)}
                placeholder="Ej. Mesero, Cocina, Caja…"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">
                Fecha de ingreso
              </span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={altaIngreso}
                onChange={(e) => setAltaIngreso(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId === '__alta__'}
              className="rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: SUITE.orangeDeep }}
              onClick={() => void submitAlta()}
            >
              {busyId === '__alta__' ? 'Guardando…' : 'Registrar alta'}
            </button>
            <button
              type="button"
              className="rounded-full px-4 py-1.5 text-xs font-semibold border border-slate-200"
              style={{ color: theme.muted }}
              onClick={() => setShowAlta(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <div
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 max-w-2xl space-y-3"
          role="dialog"
          aria-label="Ficha de colaborador"
          style={{ boxShadow: SUITE.shadow }}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold" style={{ color: theme.title }}>
                {formatHrListName(editTarget.full_name)}
              </p>
              <p className="text-xs text-slate-500">
                {[
                  formatHrPuesto(
                    plantillaPositionKey(editTarget) ||
                      editTarget.puesto ||
                      editTarget.area
                  ),
                  formatHrDate(editTarget.fecha_ingreso),
                  formatAntiguedad(editTarget.fecha_ingreso, asOf),
                ]
                  .filter((x) => x && x !== '—')
                  .join(' · ') || 'Ficha de colaborador'}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-semibold border border-slate-200"
              style={{ color: theme.muted }}
              onClick={() => {
                setEditTarget(null);
                setShowBajaForm(false);
              }}
            >
              Cerrar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {resolveFolderPath(editTarget) ? (
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: SUITE.orangeDeep }}
                onClick={() => {
                  const path = resolveFolderPath(editTarget);
                  if (path) openExpediente(editTarget, path);
                }}
              >
                Abrir expediente
              </button>
            ) : (
              <span className="text-xs text-slate-400 self-center">
                Sin carpeta de expediente vinculada
              </span>
            )}
            {!showBajaForm ? (
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-xs font-semibold border border-rose-200 bg-rose-50 text-rose-900"
                onClick={() => {
                  setShowBajaForm(true);
                  setBajaFecha((prev) => prev || altaIngreso);
                }}
              >
                Dar de baja…
              </button>
            ) : null}
          </div>

          {showBajaForm ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-3 space-y-3">
              <p className="text-xs text-rose-800/90">
                Sale de la plantilla vigente y pasa a Archivo / Bajas. El
                expediente se conserva.
              </p>
              <label className="block max-w-xs">
                <span className="text-xs font-semibold text-rose-900">
                  Último día laborado *
                </span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm"
                  value={bajaFecha}
                  onChange={(e) => setBajaFecha(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === editTarget.id}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#be123c' }}
                  onClick={() => void submitBaja()}
                >
                  {busyId === editTarget.id ? 'Guardando…' : 'Confirmar baja'}
                </button>
                <button
                  type="button"
                  className="rounded-full px-4 py-1.5 text-xs font-semibold border border-rose-200 bg-white"
                  style={{ color: theme.muted }}
                  onClick={() => setShowBajaForm(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showSyncBanner ? (
        <p className="text-sm rounded-lg px-3 py-2 max-w-3xl text-amber-800 bg-amber-50">
          {syncBanner ||
            'Sin índice de expedientes aún. Los datos de plantilla viven en Supabase; opcional: configura HR_EXPEDIENTES_DRIVE_FOLDER_ID para Abrir en Drive.'}
        </p>
      ) : null}

      {createdCreds ? (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 max-w-3xl"
          role="status"
        >
          <p className="text-sm font-semibold text-emerald-900">
            Credenciales · {createdCreds.displayName}
          </p>
          <p className="mt-1 text-sm text-emerald-900">
            Usuario:{' '}
            <span className="font-mono font-bold">{createdCreds.username}</span>
            {' · '}
            Contraseña:{' '}
            <span className="font-mono font-bold">{createdCreds.password}</span>
          </p>
          <p className="mt-1 text-xs text-emerald-800/80">
            Contraseña inicial = día+mes de ingreso (DDMM). Cópialas ahora; también
            quedan en Master → Editar usuario.
          </p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-emerald-900 underline"
            onClick={() => setCreatedCreds(null)}
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {loading || catalogLoading ? (
        <p className="text-sm" style={{ color: theme.muted }}>
          Cargando plantilla…
        </p>
      ) : employees.length === 0 ? (
        !statusMessage ? (
          <p className="text-sm" style={{ color: theme.muted }}>
            {EMPTY_HINT}
          </p>
        ) : null
      ) : showCatalog ? (
        <div
          className="overflow-x-auto rounded-2xl bg-white"
          style={{ boxShadow: SUITE.shadow }}
        >
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr
                className="border-b text-xs uppercase tracking-wide"
                style={{ color: theme.muted }}
              >
                <th className="px-4 py-3 font-semibold">Nombre</th>
                <th className="px-4 py-3 font-semibold">Suite user</th>
                <th className="px-4 py-3 font-semibold">Overrides</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const linked = Boolean(e.suite_username?.trim());
                const userVal =
                  editUser[e.id] ??
                  e.suite_username ??
                  suggestSuiteUsername(e.full_name);
                return (
                  <tr
                    key={e.id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td
                      className="px-4 py-3 font-medium"
                      style={{ color: theme.title }}
                    >
                      {formatHrListName(e.full_name)}
                      {e.fecha_ingreso ? (
                        <span
                          className="mt-0.5 block text-[11px] font-normal"
                          style={{ color: theme.muted }}
                        >
                          Ingreso {formatHrDate(e.fecha_ingreso)}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] font-normal text-amber-700">
                          Sin fecha de ingreso
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {linked ? (
                        <div className="flex min-w-[12rem] flex-wrap items-center gap-1.5">
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{
                              backgroundColor: '#ecfdf5',
                              color: '#065f46',
                            }}
                            title="Usuario Suite vinculado"
                          >
                            Ya tiene usuario · {e.suite_username}
                          </span>
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            className="rounded px-2 py-1 text-xs font-semibold border border-slate-200 disabled:opacity-50"
                            style={{ color: theme.title }}
                            onClick={() => resetSuitePassword(e)}
                            title="Restablecer a DDMM de fecha de ingreso"
                          >
                            Reset pass
                          </button>
                        </div>
                      ) : (
                        <div className="flex min-w-[12rem] flex-wrap items-center gap-1">
                          <input
                            className="w-28 rounded border border-slate-200 px-2 py-1 text-xs"
                            placeholder="usuario"
                            value={userVal}
                            onChange={(ev) =>
                              setEditUser((m) => ({
                                ...m,
                                [e.id]: ev.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            className="rounded px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                            style={{ backgroundColor: SUITE.navy }}
                            onClick={() => createSuiteUser(e)}
                            title="Crea usuario Suite + contraseña = DDMM de ingreso"
                          >
                            Crear usuario
                          </button>
                          <button
                            type="button"
                            disabled={busyId === e.id}
                            className="rounded px-2 py-1 text-xs font-semibold border border-slate-200 disabled:opacity-50"
                            style={{ color: theme.muted }}
                            onClick={() =>
                              patchEmployee(e.id, {
                                suite_username: userVal.trim() || null,
                              })
                            }
                            title="Solo vincular username existente (sin crear)"
                          >
                            Vincular
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busyId === e.id}
                          className="rounded-full px-2 py-0.5 text-xs font-semibold disabled:opacity-50"
                          style={{
                            backgroundColor: e.force_include
                              ? '#ecfdf5'
                              : '#f1f5f9',
                            color: e.force_include ? '#065f46' : '#475569',
                          }}
                          onClick={() =>
                            patchEmployee(e.id, {
                              force_include: !e.force_include,
                            })
                          }
                          title="Alta anticipada"
                        >
                          +incluir
                        </button>
                        <button
                          type="button"
                          disabled={busyId === e.id}
                          className="rounded-full px-2 py-0.5 text-xs font-semibold disabled:opacity-50"
                          style={{
                            backgroundColor: e.force_exclude
                              ? '#fef2f2'
                              : '#f1f5f9',
                            color: e.force_exclude ? '#991b1b' : '#475569',
                          }}
                          onClick={() =>
                            patchEmployee(e.id, {
                              force_exclude: !e.force_exclude,
                            })
                          }
                          title="Exclusión temporal"
                        >
                          −excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rrhh-plantilla">
          <div className="rrhh-plantilla__cols rrhh-plantilla__head">
            <div>Nombre</div>
            <div>Posición</div>
            <div>Fecha de inicio</div>
            <div>Antigüedad</div>
            <div>Expediente</div>
            <div>Acciones</div>
          </div>

          {plantillaGroups.map((bucket) => {
            const accent = TEAM_ACCENT[bucket.group] ?? TEAM_ACCENT.otros;
            const internos = bucket.employees.filter(
              (e) => !(bucket.group === 'admin' && isPlantillaExterno(e))
            );
            const externos =
              bucket.group === 'admin'
                ? bucket.employees.filter((e) => isPlantillaExterno(e))
                : [];

            return (
              <section
                key={bucket.group}
                className="rrhh-plantilla__team"
                style={
                  {
                    '--pp-accent': accent.accent,
                    '--pp-wash': accent.wash,
                  } as CSSProperties
                }
              >
                <div className="rrhh-plantilla__team-bar">
                  <span className="rrhh-plantilla__team-title">
                    {bucket.label}
                  </span>
                  <span className="rrhh-plantilla__count">
                    {bucket.employees.length}
                  </span>
                </div>

                {internos.map((e, i) => (
                  <PlantillaPersonRow
                    key={e.id}
                    employee={e}
                    asOf={asOf}
                    alt={i % 2 === 1}
                    folderPath={resolveFolderPath(e)}
                    busy={busyId === e.id}
                    onOpenExpediente={(emp, path) =>
                      openExpediente(emp, path)
                    }
                    onEdit={(emp) => {
                      setShowAlta(false);
                      setShowBajaForm(false);
                      setEditTarget(emp);
                    }}
                  />
                ))}

                {externos.length > 0 ? (
                  <div className="rrhh-plantilla__externos">
                    <div className="rrhh-plantilla__externos-bar">
                      <span className="rrhh-plantilla__externos-chip">
                        Externos
                      </span>
                      <span className="rrhh-plantilla__count">
                        {externos.length}
                      </span>
                    </div>
                    {externos.map((e, i) => (
                      <PlantillaPersonRow
                        key={e.id}
                        employee={e}
                        asOf={asOf}
                        alt={i % 2 === 1}
                        folderPath={resolveFolderPath(e)}
                        busy={busyId === e.id}
                        onOpenExpediente={(emp, path) =>
                          openExpediente(emp, path)
                        }
                        onEdit={(emp) => {
                          setShowAlta(false);
                          setShowBajaForm(false);
                          setEditTarget(emp);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          <p className="rrhh-plantilla__foot">
            {employees.length} colaborador
            {employees.length === 1 ? '' : 'es'}
            {data?.periodLabel ? ` · ${data.periodLabel}` : ''}
          </p>
        </div>
      )}

      {showArchivoBajas && !showCatalog ? (
        <section className="space-y-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-lg font-bold" style={{ color: theme.title }}>
              Archivo / Bajas
            </h3>
            <span className="text-xs text-slate-500">
              No forma parte de la plantilla vigente · {year}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Altas = vigentes; Bajas = archivo. Si una carpeta sigue en Altas con
            status baja en el sistema, aparece abajo como desajuste (mover
            carpeta en Drive o reactivar).
          </p>

          {expedienteMismatches.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                Reconciliar · mal marcados · {expedienteMismatches.length}{' '}
                desajuste
                {expedienteMismatches.length === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-[11px] text-amber-900/80">
                En sistema figuran como baja pero su carpeta sigue en Altas. Si
                siguen activos, usa «Corregir (reactivar)».
              </p>
              <ul className="mt-2 space-y-1.5">
                {expedienteMismatches.map((f) => (
                  <li
                    key={f.path}
                    className="flex flex-wrap items-center gap-2 text-sm text-amber-950"
                  >
                    <span className="font-semibold">
                      {formatHrListName(f.matchedName || f.name)}
                    </span>
                    <span className="text-[11px] text-amber-800/80">
                      {f.archiveNote || 'Baja con carpeta en Altas'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openExpediente(
                          {
                            full_name: f.matchedName || f.name,
                            fecha_baja: f.fechaBaja,
                          },
                          f.path,
                          { baja: true }
                        )
                      }
                      className="text-xs font-semibold"
                      style={{ color: SUITE.orangeDeep }}
                    >
                      Abrir carpeta
                    </button>
                    {f.employeeId ? (
                      <button
                        type="button"
                        disabled={busyId === f.employeeId}
                        onClick={() =>
                          void reactivarBaja({
                            id: f.employeeId!,
                            full_name: f.matchedName || f.name,
                            status: 'baja',
                            fecha_baja: f.fechaBaja ?? null,
                            puesto: null,
                            force_exclude: true,
                          })
                        }
                        className="text-xs font-semibold disabled:opacity-50"
                        style={{ color: SUITE.navy }}
                      >
                        Corregir (reactivar)
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Sin desajustes Altas↔baja detectados en el índice actual.
            </p>
          )}

          {bajasDelAno.length > 0 ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2 pt-1">
                <h4
                  className="text-sm font-bold"
                  style={{ color: theme.title }}
                >
                  Bajas del año
                </h4>
                <span className="text-xs text-slate-500">
                  {bajasDelAno.length} persona
                  {bajasDelAno.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul
                className="overflow-hidden rounded-2xl bg-white"
                style={{ boxShadow: SUITE.shadow }}
              >
                {bajasDelAno.map((a, i) => {
                  const path = resolveFolderPath(a);
                  const periodo = formatPeriodoTrabajado(
                    a.fecha_ingreso,
                    a.fecha_baja
                  );
                  const periodoMuted = periodo === 'sin fechas';
                  return (
                    <li
                      key={a.id}
                      className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${
                        i > 0 ? 'border-t border-slate-100' : ''
                      }`}
                      style={{
                        background:
                          i % 2 === 1 ? 'rgba(15, 23, 42, 0.03)' : undefined,
                      }}
                    >
                      <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                        Baja
                      </span>
                      <span
                        className="min-w-0 flex-1 text-sm font-semibold"
                        style={{ color: theme.title }}
                      >
                        {formatHrListName(a.full_name)}
                      </span>
                      {a.puesto ? (
                        <span className="text-[11px] text-slate-500">
                          {a.puesto}
                        </span>
                      ) : null}
                      <span
                        className={`text-[11px] ${
                          periodoMuted ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        {periodo}
                      </span>
                      {path ? (
                        <button
                          type="button"
                          onClick={() =>
                            openExpediente(
                              {
                                full_name: a.full_name,
                                fecha_ingreso: a.fecha_ingreso,
                                fecha_baja: a.fecha_baja,
                              },
                              path,
                              { baja: true }
                            )
                          }
                          className="text-xs font-semibold"
                          style={{ color: SUITE.orangeDeep }}
                        >
                          Abrir carpeta
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          Sin carpeta
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={busyId === a.id}
                        onClick={() => void reactivarBaja(a)}
                        className="text-xs font-semibold disabled:opacity-50"
                        style={{ color: SUITE.navy }}
                        title="Volver a plantilla vigente"
                      >
                        Reactivar
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              No hay bajas registradas en {year}.
            </p>
          )}
        </section>
      ) : null}

      {showResguardos ? <RrhhResguardosPanel /> : null}

      {viewer ? (
        <HrDocViewer target={viewer} onClose={() => setViewer(null)} />
      ) : null}
    </div>
  );
}
