'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { SuiteShell } from '@/app/components/SuiteShell';
import { AdminDataMap } from '@/app/components/AdminDataMap';
import { AdminPresupuestoAjustes } from '@/app/components/AdminPresupuestoAjustes';
import { AdminSaldosBancos } from '@/app/components/AdminSaldosBancos';
import { APP_MODULES } from '@/app/lib/modules';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: 'admin' | 'viewer';
  modules: string[];
  active: boolean;
  canEdit: boolean;
  createdAt?: string;
  /** Contraseña recuperable (solo API admin). null en cuentas antiguas sin plaintext. */
  password?: string | null;
}

const emptyForm = {
  username: '',
  displayName: '',
  password: '',
  role: 'viewer' as 'admin' | 'viewer',
  modules: ['ventas'] as string[],
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  required,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
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
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          aria-pressed={visible}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
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
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudieron cargar usuarios');
        setUsers([]);
        return;
      }
      setUsers(json.users || []);
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
      setOkMsg(`Usuario ${form.username} creado`);
      setForm(emptyForm);
      await load();
    } catch {
      setError('Error de red al crear usuario');
    } finally {
      setSaving(false);
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
      };
      if (editing?.role !== 'admin') {
        body.role = 'viewer';
        body.modules = editModules;
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
      title="Administración"
      subtitle="Mapa de datos, saldos bancarios, cuentas de solo lectura y ajustes de presupuesto."
    >
      {/* 1. Mapa de orígenes (colapsado por defecto) */}
      <AdminDataMap />

      {/* 2. Saldos bancarios manuales */}
      <AdminSaldosBancos />

      {/* 3. Administración de usuarios */}
      <section className="mb-8">
        <div className="mb-4">
          <h2 className="text-lg font-bold" style={{ color: theme.title }}>
            Administración de usuarios
          </h2>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            Solo tú gestionas cuentas. Los usuarios nuevos tienen{' '}
            <strong className="font-semibold text-slate-700">solo lectura</strong>{' '}
            en los módulos que les asignes.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {okMsg && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {okMsg}
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
            <h3 className="text-lg font-bold text-slate-900">Usuarios</h3>
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
                      ? 'Enmascarada por defecto. Usa Mostrar para revelarla.'
                      : 'Esta cuenta solo tenía hash; al guardar una nueva quedará recuperable aquí.'
                  }
                />

                {editingUser.role !== 'admin' && (
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
      </section>

      {/* 4. Ajustes de presupuesto (colapsado por defecto) */}
      <AdminPresupuestoAjustes />
    </SuiteShell>
  );
}
