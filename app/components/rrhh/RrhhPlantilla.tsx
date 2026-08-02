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
import { RrhhEmployeeProfile } from '@/app/components/rrhh/RrhhEmployeeProfile';
import { RrhhResguardosPanel } from '@/app/components/rrhh/RrhhResguardosPanel';
import {
  formatAntiguedad,
  formatHrDate,
  formatHrPuesto,
  groupPlantillaByTeam,
  isPlantillaExterno,
  plantillaPositionKey,
  type HrEmployee,
  type PlantillaTeamGroup,
} from '@/app/lib/hr';
import type { HrDocAlertSummary } from '@/app/lib/hr-employee-profile';
import { formatHrListName, matchPerson } from '@/app/lib/hr-person-match';
import {
  HR_PUESTO_CATALOG,
  formatPlantillaPuestoLabel,
} from '@/app/lib/hr-puestos';
import { suggestSuiteUsername } from '@/app/lib/hr-suite-user';
import { getTheme, SUITE } from '@/app/lib/themes';
import { canEditEmployees, useSession } from '@/app/lib/useSession';

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

function PlantillaPersonRow({
  employee,
  asOf,
  alt,
  folderPath,
  busy,
  canEdit,
  docAlert,
  onOpenExpediente,
  onOpenProfile,
  onEditProfile,
}: {
  employee: HrEmployee;
  asOf: string | null;
  alt: boolean;
  folderPath: string | null;
  busy: boolean;
  canEdit: boolean;
  docAlert: HrDocAlertSummary | null;
  onOpenExpediente: (employee: HrEmployee, path: string) => void;
  onOpenProfile: (employee: HrEmployee) => void;
  onEditProfile: (employee: HrEmployee) => void;
}) {
  const puestoFmt = formatPlantillaPuestoLabel(employee);
  const puestoPrimary =
    formatHrPuesto(
      puestoFmt.primary !== '—'
        ? puestoFmt.primary
        : plantillaPositionKey(employee) || employee.puesto || employee.area
    ) || '—';
  const missing = docAlert?.missingCount ?? 0;
  const missingTitles =
    docAlert?.missing.map((d) => d.title).join(', ') || '';
  return (
    <div
      className={`rrhh-plantilla__cols rrhh-plantilla__row${
        alt ? ' rrhh-plantilla__row--alt' : ''
      }`}
    >
      <div className="rrhh-plantilla__name">
        <button
          type="button"
          className="rrhh-plantilla__name-btn"
          onClick={() => onOpenProfile(employee)}
          title="Abrir perfil"
        >
          {formatHrListName(employee.full_name)}
        </button>
        {missing > 0 ? (
          <button
            type="button"
            className="rrhh-plantilla__doc-alert"
            onClick={() => onOpenProfile(employee)}
            title={`Documentos obligatorios faltantes: ${missingTitles}`}
          >
            <span className="rrhh-plantilla__doc-alert-icon" aria-hidden>
              !
            </span>
            <span className="rrhh-plantilla__doc-alert-text">
              {missing === 1
                ? `Falta ${missingTitles}`
                : `Faltan ${missing} docs`}
            </span>
          </button>
        ) : null}
      </div>
      <div>
        <span className="rrhh-plantilla__badge" title={puestoFmt.title}>
          {puestoPrimary}
        </span>
        {puestoFmt.secondaryHint ? (
          <span
            className="rrhh-plantilla__badge-sec"
            title={`También: ${puestoFmt.secondaryHint}`}
          >
            + {puestoFmt.secondaryHint}
          </span>
        ) : null}
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
        {canEdit ? (
          <button
            type="button"
            className="rrhh-plantilla__edit-btn"
            disabled={busy}
            onClick={() => onEditProfile(employee)}
            title="Editar perfil"
            aria-label={`Editar perfil de ${formatHrListName(employee.full_name)}`}
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
        ) : null}
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
  const { user } = useSession();
  const canEditEmp = canEditEmployees(user);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<Record<string, string>>({});
  const [createdCreds, setCreatedCreds] = useState<{
    username: string;
    password: string;
    displayName: string;
  } | null>(null);
  const [showCatalog] = useState(false);
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
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<
    'docs' | 'medico' | 'resguardos' | 'datos'
  >('docs');
  const [docAlerts, setDocAlerts] = useState<
    Record<string, HrDocAlertSummary>
  >({});
  const [docAlertsWithMissing, setDocAlertsWithMissing] = useState(0);

  useEffect(() => {
    if (initialShowResguardos) setShowResguardos(true);
  }, [initialShowResguardos]);

  const baseEmployees = data?.employees ?? [];
  const employees = showCatalog && catalog ? catalog : baseEmployees;
  const plantillaGroups = showCatalog ? [] : groupPlantillaByTeam(employees);
  const asOf = data?.periodEnd || data?.paidAt || null;
  const emptyPlantilla = !loading && !showCatalog && baseEmployees.length === 0;
  const plantillaIdsKey = useMemo(
    () =>
      showCatalog
        ? ''
        : (data?.employees ?? [])
            .map((e) => e.id)
            .sort()
            .join(','),
    [showCatalog, data?.employees]
  );
  const statusMessage =
    toast ||
    (emptyPlantilla && (data?.message || EMPTY_HINT)) ||
    (data?.ready === false && data?.message) ||
    null;

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

  const loadDocAlerts = useCallback(async (idsKey: string) => {
    if (!idsKey) {
      setDocAlerts({});
      setDocAlertsWithMissing(0);
      return;
    }
    try {
      const q = new URLSearchParams({ ids: idsKey });
      const res = await fetch(`/api/hr/employees/doc-alerts?${q}`, {
        cache: 'no-store',
      });
      const json = (await res.json()) as {
        ready?: boolean;
        alerts?: Record<string, HrDocAlertSummary>;
        withMissing?: number;
      };
      if (!res.ok || json.ready === false) {
        setDocAlerts({});
        setDocAlertsWithMissing(0);
        return;
      }
      setDocAlerts(json.alerts || {});
      setDocAlertsWithMissing(json.withMissing ?? 0);
    } catch {
      setDocAlerts({});
      setDocAlertsWithMissing(0);
    }
  }, []);

  useEffect(() => {
    void loadDocAlerts(plantillaIdsKey);
  }, [loadDocAlerts, plantillaIdsKey]);

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
      if (byName) return byName.path;
      // Nombre corto Excel ↔ carpeta Altas (p. ej. Elizabeth Torrijos ↔ TORRIJOS…JOANA ELIZABETH).
      for (const f of folders) {
        if (f.employeeId && f.employeeId !== emp.id) continue;
        const m = matchPerson(f.name, [
          { id: emp.id, full_name: emp.full_name },
        ]);
        if (
          m.employeeId === emp.id &&
          (m.autoLink ||
            m.confidence === 'exact' ||
            m.confidence === 'high')
        ) {
          return f.path;
        }
      }
      return null;
    },
    [folderByEmployeeId, folderByName, folders]
  );

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
        {canEditEmp ? (
          <button
            type="button"
            className="rounded-full px-3 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: SUITE.orangeDeep }}
            onClick={() => {
              setShowAlta((v) => !v);
            }}
          >
            {showAlta ? 'Cerrar alta' : 'Alta empleado'}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-full px-3 py-1 text-xs font-semibold border border-slate-200"
          style={{ color: theme.title }}
          title="Inventario por equipo/herramienta y quién lo tiene. Captura/edición: perfil → Resguardos."
          onClick={() => setShowResguardos((v) => !v)}
        >
          {showResguardos ? 'Ocultar inventario' : 'Ver resguardos'}
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

      {showAlta && canEditEmp ? (
        <div
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 max-w-2xl space-y-3"
          style={{ boxShadow: SUITE.shadow }}
        >
          <p className="text-sm font-semibold" style={{ color: theme.title }}>
            Alta de empleado
          </p>
          <p className="text-xs" style={{ color: theme.muted }}>
            Se agrega a la plantilla vigente. Luego abre el perfil (clic en el
            nombre) para documentos, médico, resguardos y datos.
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
                Posición (principal)
              </span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={altaPuesto}
                onChange={(e) => setAltaPuesto(e.target.value)}
              >
                <option value="">— Elegir —</option>
                {HR_PUESTO_CATALOG.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
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
                    canEdit={canEditEmp}
                    docAlert={docAlerts[e.id] ?? null}
                    onOpenExpediente={(emp, path) =>
                      openExpediente(emp, path)
                    }
                    onEditProfile={(emp) => {
                      setShowAlta(false);
                      setProfileTab('datos');
                      setProfileId(emp.id);
                    }}
                    onOpenProfile={(emp) => {
                      setShowAlta(false);
                      setProfileTab('docs');
                      setProfileId(emp.id);
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
                        canEdit={canEditEmp}
                        docAlert={docAlerts[e.id] ?? null}
                        onOpenExpediente={(emp, path) =>
                          openExpediente(emp, path)
                        }
                        onEditProfile={(emp) => {
                          setShowAlta(false);
                          setProfileTab('datos');
                          setProfileId(emp.id);
                        }}
                        onOpenProfile={(emp) => {
                          setShowAlta(false);
                          setProfileTab('docs');
                          setProfileId(emp.id);
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
            {docAlertsWithMissing > 0
              ? ` · ${docAlertsWithMissing} con docs obligatorios faltantes`
              : ''}
          </p>
        </div>
      )}

      {showResguardos ? <RrhhResguardosPanel /> : null}

      {profileId ? (
        <RrhhEmployeeProfile
          employeeId={profileId}
          initialTab={profileTab}
          onClose={() => {
            setProfileId(null);
            setProfileTab('docs');
          }}
          onChanged={() => {
            onChanged?.();
            void loadExpedientes();
            void loadDocAlerts(plantillaIdsKey);
          }}
        />
      ) : null}

      {viewer ? (
        <HrDocViewer target={viewer} onClose={() => setViewer(null)} />
      ) : null}
    </div>
  );
}
