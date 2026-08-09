'use client';

import { FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import { AdminAlmacenamientoRecursos } from '@/app/components/AdminAlmacenamientoRecursos';
import { AdminCajaTpv } from '@/app/components/AdminCajaTpv';
import { AdminDataMap } from '@/app/components/AdminDataMap';
import { AdminPresupuestoAjustes } from '@/app/components/AdminPresupuestoAjustes';
import { AdminSaldosBancos } from '@/app/components/AdminSaldosBancos';
import { AdminSyncSchedules } from '@/app/components/AdminSyncSchedules';
import { APP_CAPABILITIES } from '@/app/lib/capabilities';
import { APP_MODULES } from '@/app/lib/modules';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: 'admin' | 'viewer';
  modules: string[];
  capabilities: string[];
  active: boolean;
  canEdit: boolean;
  createdAt?: string;
  /** Contraseña recuperable (solo API admin). null en cuentas antiguas sin plaintext. */
  password?: string | null;
  linkedEmployee?: {
    id: string;
    full_name: string;
    puesto: string | null;
  } | null;
}

type HrLinkOption = {
  id: string;
  full_name: string;
  puesto: string | null;
  area: string | null;
  suite_username: string | null;
};

const emptyForm = {
  username: '',
  displayName: '',
  password: '',
  role: 'viewer' as 'admin' | 'viewer',
  modules: ['ventas'] as string[],
  capabilities: [] as string[],
};

/** Contraseña legible en cliente (sin caracteres ambiguos). */
function generateClientPassword(length = 10): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i]! % chars.length];
  return out;
}

function EyeIcon({ open }: { open: boolean }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true as const,
  };
  if (open) {
    return (
      <svg {...common}>
        <path
          d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  required,
  placeholder,
  hint,
  onGenerate,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  onGenerate?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          required={required}
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
          aria-pressed={visible}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          <EyeIcon open={visible} />
        </button>
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            title="Generar contraseña aleatoria"
          >
            Generar
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function AdminSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-12">
      <header className="mb-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-4 text-left transition-shadow hover:shadow-sm"
          style={{ boxShadow: open ? SUITE.shadow : undefined }}
          aria-expanded={open}
        >
          <span
            className="mt-1 h-10 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: SUITE.orange }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold tracking-tight" style={{ color: theme.title }}>
              {title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: theme.muted }}>
              {description}
            </p>
          </div>
          <span
            className="mt-1 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: SUITE.navy }}
          >
            {open ? 'Ocultar' : 'Mostrar'}
          </span>
        </button>
      </header>
      {open ? <div className="space-y-6 [&>*]:!mb-0">{children}</div> : null}
    </section>
  );
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editHadPassword, setEditHadPassword] = useState(false);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editUsername, setEditUsername] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editCapabilities, setEditCapabilities] = useState<string[]>([]);
  const [editEmployeeId, setEditEmployeeId] = useState<string>('');
  const [hrEmployees, setHrEmployees] = useState<HrLinkOption[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [credsCopied, setCredsCopied] = useState(false);
  const [expAuditBusy, setExpAuditBusy] = useState(false);
  const [expAuditMsg, setExpAuditMsg] = useState<string | null>(null);
  const [expAuditRows, setExpAuditRows] = useState<
    Array<{
      id: string;
      full_name: string;
      kind: string;
      note: string;
      status: string;
      fecha_baja: string | null;
    }>
  >([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [usersRes, empRes] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/hr-employees', { cache: 'no-store' }),
      ]);
      const json = await usersRes.json();
      if (!usersRes.ok) {
        setError(json.error || 'No se pudieron cargar usuarios');
        setUsers([]);
        return;
      }
      setUsers(json.users || []);
      if (empRes.ok) {
        const empJson = await empRes.json();
        setHrEmployees(empJson.employees || []);
      }
    } catch {
      setError('Error de red al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setOkMsg('');
    setCreatedCreds(null);
    setCredsCopied(false);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo crear');
        return;
      }
      const createdUser = form.username.trim().toLowerCase();
      const createdPass = form.password;
      setOkMsg(`Usuario ${createdUser} creado`);
      setCreatedCreds({ username: createdUser, password: createdPass });
      setForm(emptyForm);
      await load();
    } catch {
      setError('Error de red al crear usuario');
    } finally {
      setSaving(false);
    }
  }

  function toggleCapability(id: string) {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(id)
        ? f.capabilities.filter((c) => c !== id)
        : [...f.capabilities, id],
    }));
  }

  function toggleEditCapability(id: string) {
    setEditCapabilities((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  async function copyCreatedCreds() {
    if (!createdCreds) return;
    const text = `Usuario: ${createdCreds.username}\nContraseña: ${createdCreds.password}\nEntrada: /login → Staff / Cortes TPV`;
    try {
      await navigator.clipboard.writeText(text);
      setCredsCopied(true);
    } catch {
      setCredsCopied(false);
      setError('No se pudo copiar al portapapeles');
    }
  }

  function openEdit(u: AdminUser) {
    setDeleteTarget(null);
    setDeleteConfirm('');
    setEditingId(u.id);
    const current = u.password?.trim() || '';
    setEditPassword(current);
    setEditHadPassword(Boolean(current));
    setEditUsername(u.username);
    setEditDisplayName(u.displayName || '');
    setEditModules((u.modules || []).filter((m) => m !== '*'));
    setEditCapabilities(u.capabilities || []);
    setEditEmployeeId(u.linkedEmployee?.id || '');
    setOkMsg('');
    setError('');
  }

  function toggleEditModule(id: string) {
    setEditModules((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true);
    setError('');
    setOkMsg('');
    try {
      const editing = users.find((u) => u.id === editingId);
      const body: Record<string, unknown> = {
        username: editUsername.trim().toLowerCase(),
        displayName: editDisplayName,
        employeeId: editEmployeeId.trim() || null,
      };
      if (editing?.role !== 'admin') {
        body.role = 'viewer';
        body.modules = editModules;
        body.capabilities = editCapabilities;
      }
      if (editPassword.trim()) body.password = editPassword.trim();

      const res = await fetch(`/api/admin/users/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo guardar');
        return;
      }
      setOkMsg('Usuario actualizado');
      setEditingId(null);
      await load();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    setError('');
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !u.active }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || 'No se pudo actualizar');
      return;
    }
    await load();
  }

  function openDelete(u: AdminUser) {
    if (u.role === 'admin') return;
    setEditingId(null);
    setDeleteTarget(u);
    setDeleteConfirm('');
    setError('');
    setOkMsg('');
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteConfirm('');
  }

  async function confirmDelete(e: FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;
    if (deleteConfirm.trim().toLowerCase() !== deleteTarget.username.toLowerCase()) {
      setError('Escribe el nombre de usuario exacto para confirmar');
      return;
    }
    setDeleting(true);
    setError('');
    setOkMsg('');
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo eliminar');
        return;
      }
      setOkMsg(`Usuario ${deleteTarget.username} eliminado permanentemente`);
      if (editingId === deleteTarget.id) setEditingId(null);
      closeDelete();
      await load();
    } catch {
      setError('Error de red al eliminar');
    } finally {
      setDeleting(false);
    }
  }

  function toggleModule(id: string) {
    setForm((f) => {
      const has = f.modules.includes(id);
      return {
        ...f,
        modules: has ? f.modules.filter((m) => m !== id) : [...f.modules, id],
      };
    });
  }

  const editingUser = users.find((u) => u.id === editingId) || null;

  return (
    <SuiteShell
      title="Master Panel"
      subtitle="Cortes TPV, financieros, RR.HH., usuarios, datos e inventario — herramientas de administración del suite."
    >
      {/* 1. Cortes TPV (operación · caja) — arriba, independiente de Financieros */}
      <AdminSection
        title="Cortes TPV"
        description="Reporte y carga de fotos por día operativo · misma compresión/OCR que Staff."
        defaultOpen
      >
        <AdminCajaTpv />
      </AdminSection>

      {/* 2. Financieros */}
      <AdminSection
        title="Financieros"
        description="Saldos bancarios y ajustes ligados al presupuesto."
      >
        <AdminSaldosBancos />
        <AdminPresupuestoAjustes />
      </AdminSection>

      {/* 3. RR.HH. · expedientes */}
      <AdminSection
        title="RR.HH. · expedientes"
        description="Auditoría Altas↔status (solo lista). No da de baja a activos. Corregir en /rrhh → Plantilla → Archivo / Bajas."
      >
        <div
          className="rounded-[24px] border border-slate-100 bg-white p-5 max-w-3xl"
          style={{ boxShadow: SUITE.shadow }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={expAuditBusy}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: SUITE.navy }}
              onClick={async () => {
                setExpAuditBusy(true);
                setExpAuditMsg(null);
                setExpAuditRows([]);
                try {
                  const res = await fetch('/api/hr/expedientes?audit=1', {
                    cache: 'no-store',
                  });
                  const json = (await res.json()) as {
                    error?: string;
                    message?: string;
                    mismatches?: typeof expAuditRows;
                  };
                  if (!res.ok) {
                    setExpAuditMsg(json.error || 'No se pudo auditar');
                    return;
                  }
                  setExpAuditRows(json.mismatches || []);
                  setExpAuditMsg(json.message || 'Listo');
                } catch {
                  setExpAuditMsg('Error de red al auditar expedientes');
                } finally {
                  setExpAuditBusy(false);
                }
              }}
            >
              {expAuditBusy ? 'Auditando…' : 'Reconciliar expedientes'}
            </button>
            <a
              href="/rrhh"
              className="text-sm font-semibold"
              style={{ color: SUITE.orangeDeep }}
            >
              Abrir RR.HH. →
            </a>
          </div>
          {expAuditMsg ? (
            <p className="mt-3 text-sm text-slate-600">{expAuditMsg}</p>
          ) : null}
          {expAuditRows.length > 0 ? (
            <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto text-sm">
              {expAuditRows.map((r) => (
                <li
                  key={`${r.id}-${r.kind}`}
                  className="rounded-lg border border-slate-100 px-3 py-2"
                >
                  <span className="font-semibold text-slate-800">
                    {r.full_name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {r.kind} · {r.note}
                    {r.fecha_baja ? ` · baja ${r.fecha_baja}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </AdminSection>

      {/* 4. Usuarios */}
      <AdminSection
        title="Usuarios"
        description="Cada cuenta del ERP tiene módulos (qué ve) y funciones (palomitas, p. ej. corte). Al instalar la app en el celular, el usuario entra con su sesión y solo ve lo asignado aquí."
      >
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {okMsg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {okMsg}
          </div>
        )}
        {createdCreds && (
          <div
            className="rounded-[24px] border border-emerald-200 bg-emerald-50/80 p-5"
            style={{ boxShadow: SUITE.shadow }}
          >
            <h3 className="text-lg font-bold text-emerald-900">
              Credenciales listas para entregar
            </h3>
            <p className="mt-1 text-sm text-emerald-800/80">
              Copia y envíalas al staff. También quedan recuperables en Editar.
            </p>
            <dl className="mt-3 space-y-2 font-mono text-sm text-emerald-950">
              <div className="flex flex-wrap gap-2">
                <dt className="font-sans font-semibold text-emerald-800">Usuario</dt>
                <dd>{createdCreds.username}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="font-sans font-semibold text-emerald-800">
                  Contraseña
                </dt>
                <dd>{createdCreds.password}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyCreatedCreds}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: SUITE.navy }}
              >
                {credsCopied ? 'Copiado' : 'Copiar usuario y contraseña'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedCreds(null);
                  setCredsCopied(false);
                }}
                className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <form
            onSubmit={onCreate}
            className="rounded-[24px] border border-slate-100 bg-white p-5 lg:col-span-2"
            style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${SUITE.orange}` }}
          >
            <h3 className="text-lg font-bold text-slate-900">Nuevo usuario</h3>
            <p className="mt-1 text-sm text-slate-500">
              Solo lectura en los módulos que les asignes. Solo tú gestionas cuentas.
            </p>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Usuario
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>

            <label className="mt-3 block text-sm font-semibold text-slate-700">
              Nombre
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>

            <PasswordField
              id="new-user-password"
              label="Contraseña"
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
              required
              onGenerate={() =>
                setForm((f) => ({ ...f, password: generateClientPassword() }))
              }
              hint="Usa Generar para una clave aleatoria legible (se muestra al crear)."
            />

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-slate-700">
                Módulos que puede ver (solo lectura)
              </legend>
              <div className="mt-2 space-y-2">
                {APP_MODULES.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.modules.includes(m.id)}
                      onChange={() => toggleModule(m.id)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-slate-700">
                Permisos de acceso
              </legend>
              <p className="mt-1 text-xs text-slate-500">
                Palomitas granulares (además de módulos). Se irán agregando más.
              </p>
              <div className="mt-2 space-y-2">
                {APP_CAPABILITIES.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.capabilities.includes(c.id)}
                      onChange={() => toggleCapability(c.id)}
                    />
                    <span>
                      <span className="font-medium">{c.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {c.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: SUITE.navy }}
            >
              {saving ? 'Guardando…' : 'Crear usuario'}
            </button>
          </form>

          <div
            className="rounded-[24px] border border-slate-100 bg-white p-5 lg:col-span-3"
            style={{ boxShadow: SUITE.shadow }}
          >
            <h3 className="text-lg font-bold text-slate-900">Cuentas</h3>
            {loading ? (
              <p className="mt-4 text-slate-500">Cargando…</p>
            ) : users.length === 0 ? (
              <p className="mt-4 text-slate-500">
                Aún no hay usuarios. Cierra sesión y vuelve a entrar como{' '}
                <strong>sergio</strong> para crear el admin automáticamente, o crea uno aquí.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-center text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 text-center">Usuario</th>
                      <th className="py-2 pr-3 text-center">Colaborador</th>
                      <th className="py-2 pr-3 text-center">Rol</th>
                      <th className="py-2 pr-3 text-center">Módulos</th>
                      <th className="py-2 pr-3 text-center">Estado</th>
                      <th className="py-2 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-t border-slate-100">
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-slate-800">{u.username}</p>
                          {u.displayName && (
                            <p className="text-xs text-slate-500">{u.displayName}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-left">
                          {u.linkedEmployee ? (
                            <div>
                              <p className="text-sm text-slate-800">
                                {u.linkedEmployee.full_name}
                              </p>
                              {u.linkedEmployee.puesto ? (
                                <p className="text-[11px] text-slate-500">
                                  {u.linkedEmployee.puesto}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Sin enlace</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              u.role === 'admin'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600">
                          {u.role === 'admin'
                            ? 'Todos'
                            : (u.modules || []).join(', ') || '—'}
                        </td>
                        <td className="py-2.5 pr-3">
                          {u.active ? (
                            <span className="text-emerald-700">Activo</span>
                          ) : (
                            <span className="text-rose-600">Inactivo</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(u)}
                              className="text-sm font-semibold text-blue-700 hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(u)}
                              className="text-sm font-semibold text-slate-600 hover:underline"
                            >
                              {u.active ? 'Desactivar' : 'Activar'}
                            </button>
                            {u.role !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => openDelete(u)}
                                className="text-sm font-semibold text-rose-700 hover:underline"
                              >
                                Eliminar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {deleteTarget && (
              <form
                onSubmit={confirmDelete}
                className="mt-6 rounded-lg border border-rose-200 bg-rose-50/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Eliminar permanentemente · {deleteTarget.username}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600">
                      Esta acción no se puede deshacer. Escribe{' '}
                      <strong className="font-semibold text-slate-800">
                        {deleteTarget.username}
                      </strong>{' '}
                      para confirmar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDelete}
                    className="text-sm font-semibold text-slate-500 hover:underline"
                  >
                    Cancelar
                  </button>
                </div>
                <label className="mt-3 block text-sm font-semibold text-slate-700">
                  Confirmar usuario
                  <input
                    required
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    autoComplete="off"
                    className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 outline-none focus:border-rose-500"
                    placeholder={deleteTarget.username}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    deleting ||
                    deleteConfirm.trim().toLowerCase() !==
                      deleteTarget.username.toLowerCase()
                  }
                  className="mt-4 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {deleting ? 'Eliminando…' : 'Eliminar permanentemente'}
                </button>
              </form>
            )}

            {editingUser && (
              <form
                onSubmit={saveEdit}
                className="mt-6 rounded-lg border border-amber-200 bg-amber-50/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Editar · {editingUser.username}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Cambia usuario, nombre, contraseña y/o módulos
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-sm font-semibold text-slate-500 hover:underline"
                  >
                    Cerrar
                  </button>
                </div>

                <label className="mt-3 block text-sm font-semibold text-slate-700">
                  Usuario
                  <input
                    required
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    disabled={editingUser.role === 'admin'}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {editingUser.role === 'admin' && (
                    <p className="mt-1 text-xs text-slate-500">
                      El usuario bootstrap (admin) no se puede renombrar.
                    </p>
                  )}
                </label>

                <label className="mt-3 block text-sm font-semibold text-slate-700">
                  Nombre
                  <input
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
                  />
                </label>

                <label className="mt-3 block text-sm font-semibold text-slate-700">
                  Colaborador RH
                  <select
                    value={editEmployeeId}
                    onChange={(e) => setEditEmployeeId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
                  >
                    <option value="">— Sin enlace —</option>
                    {hrEmployees.map((e) => {
                      const taken =
                        e.suite_username &&
                        e.suite_username !==
                          editUsername.trim().toLowerCase() &&
                        e.id !== editEmployeeId;
                      return (
                        <option key={e.id} value={e.id} disabled={Boolean(taken)}>
                          {e.full_name}
                          {e.puesto ? ` · ${e.puesto}` : ''}
                          {taken ? ` (ya: @${e.suite_username})` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Vincula este usuario Suite a la ficha (Staff / resguardos).
                  </span>
                </label>

                <PasswordField
                  key={editingUser.id}
                  id="edit-user-password"
                  label="Contraseña"
                  value={editPassword}
                  onChange={setEditPassword}
                  placeholder={
                    editHadPassword
                      ? undefined
                      : 'Sin contraseña recuperable — escribe una nueva'
                  }
                  hint={
                    editHadPassword
                      ? 'Contraseña vigente (oculta). Usa el ícono del ojo para revelarla.'
                      : 'Solo hay hash (no recuperable). Escribe una nueva para guardarla aquí.'
                  }
                  onGenerate={() => setEditPassword(generateClientPassword())}
                />

                {editingUser.role !== 'admin' && (
                  <>
                    <fieldset className="mt-3">
                      <legend className="text-sm font-semibold text-slate-700">
                        Módulos permitidos (solo lectura)
                      </legend>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {APP_MODULES.map((m) => (
                          <label
                            key={m.id}
                            className="flex items-center gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={editModules.includes(m.id)}
                              onChange={() => toggleEditModule(m.id)}
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="mt-3">
                      <legend className="text-sm font-semibold text-slate-700">
                        Permisos de acceso
                      </legend>
                      <div className="mt-2 space-y-2">
                        {APP_CAPABILITIES.map((c) => (
                          <label
                            key={c.id}
                            className="flex items-start gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={editCapabilities.includes(c.id)}
                              onChange={() => toggleEditCapability(c.id)}
                            />
                            <span>
                              <span className="font-medium">{c.label}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {c.hint}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}

                <button
                  type="submit"
                  disabled={editSaving}
                  className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: SUITE.navy }}
                >
                  {editSaving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </form>
            )}
          </div>
        </div>
      </AdminSection>


      {/* 5. Datos e inventario */}
      <AdminSection
        title="Datos e inventario"
        description="Mapa de orígenes y catálogo de lo que vive en almacenamiento, APIs y bases del suite."
      >
        <AdminDataMap />
        <AdminSyncSchedules />
        <AdminAlmacenamientoRecursos />
      </AdminSection>
    </SuiteShell>
  );
}
