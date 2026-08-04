'use client';

import { useState, type FormEvent } from 'react';
import { SuiteCard } from '@/app/components/SuiteShell';
import { SUITE } from '@/app/lib/themes';
import {
  HR_RESGUARDO_KIND_LABELS,
  HR_RESGUARDO_LEGAL,
  HR_RESGUARDO_STATUS_LABELS,
  defaultLugarFecha,
  emptyResguardoItem,
  type HrResguardoItem,
  type HrResguardoKind,
  type HrResguardoRequest,
  type HrResguardoStatus,
} from '@/app/lib/hr-resguardo';

const inputClass =
  'mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm';

const autoInputClass =
  'mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700';

const KINDS = Object.keys(HR_RESGUARDO_KIND_LABELS) as HrResguardoKind[];
const STATUSES = Object.keys(
  HR_RESGUARDO_STATUS_LABELS
) as HrResguardoStatus[];

const NO_DISPONIBLE = 'no disponible';

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Mexico_City',
  });
}

/** Perfil primero; si vacío → «no disponible». */
function autoFromProfile(
  profileVal?: string | null,
  fallbackPayload?: string | null
): string {
  for (const c of [profileVal, fallbackPayload]) {
    const t = String(c || '').trim();
    if (t && t.toLowerCase() !== NO_DISPONIBLE) return t;
  }
  return NO_DISPONIBLE;
}

export function RrhhResguardoForm({
  employeeId,
  defaultNombre,
  defaultPuesto,
  defaultEmail,
  defaultPhone,
  defaultDomicilio,
  existing,
  onCreated,
  onCancel,
}: {
  /** Si se abre desde un perfil, enlaza la carta a esa ficha. */
  employeeId?: string | null;
  defaultNombre?: string;
  defaultPuesto?: string;
  /** Desde hr_employees.email (ficha Datos). */
  defaultEmail?: string | null;
  /** Desde hr_employees.phone (ficha Datos). */
  defaultPhone?: string | null;
  /** Desde hr_employees.domicilio (ficha Datos). */
  defaultDomicilio?: string | null;
  /** Si se pasa, el formulario edita esa carta (PATCH). */
  existing?: HrResguardoRequest | null;
  onCreated?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(existing?.id);
  const p = existing?.payload;
  const [kind, setKind] = useState<HrResguardoKind>(
    existing?.kind || 'equipo'
  );
  const [status, setStatus] = useState<HrResguardoStatus>(
    existing?.status || 'pendiente'
  );
  const [lugarFecha, setLugarFecha] = useState(
    () => p?.lugar_fecha || defaultLugarFecha()
  );
  const [nombre, setNombre] = useState(
    () => p?.nombre || defaultNombre || ''
  );
  const [puesto, setPuesto] = useState(
    () => p?.puesto || defaultPuesto || ''
  );
  const email = autoFromProfile(defaultEmail, p?.email);
  const telefono = autoFromProfile(defaultPhone, p?.telefono);
  const domicilio = autoFromProfile(defaultDomicilio, p?.domicilio);
  const [fechaAsignacion, setFechaAsignacion] = useState(
    () => p?.fecha_asignacion || todayIso()
  );
  const [fechaResguardo, setFechaResguardo] = useState(
    () => p?.fecha_resguardo || todayIso()
  );
  const [emisorNombre, setEmisorNombre] = useState(
    () => p?.emisor_nombre || ''
  );
  const [emisorPuesto, setEmisorPuesto] = useState(
    () => p?.emisor_puesto || ''
  );
  const [items, setItems] = useState<HrResguardoItem[]>(() =>
    existing?.items?.length
      ? existing.items.map((it) => ({ ...it }))
      : [emptyResguardoItem()]
  );
  const [acepta, setAcepta] = useState(() =>
    isEdit ? Boolean(p?.acepta_condiciones) : false
  );
  const [aceptaDanio, setAceptaDanio] = useState(() =>
    Boolean(p?.acepta_danio_parcial)
  );
  const [aceptaPerdida, setAceptaPerdida] = useState(() =>
    Boolean(p?.acepta_perdida_total)
  );
  const [observaciones, setObservaciones] = useState(
    () => p?.observaciones || existing?.notes || ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function updateItem(idx: number, patch: Partial<HrResguardoItem>) {
    setItems((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyResguardoItem()]);
  }

  function removeItem(idx: number) {
    setItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  function resetForm() {
    setKind('equipo');
    setLugarFecha(defaultLugarFecha());
    setNombre(defaultNombre || '');
    setPuesto(defaultPuesto || '');
    setFechaAsignacion(todayIso());
    setFechaResguardo(todayIso());
    setEmisorNombre('');
    setEmisorPuesto('');
    setItems([emptyResguardoItem()]);
    setAcepta(false);
    setAceptaDanio(false);
    setAceptaPerdida(false);
    setObservaciones('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const payload = {
        lugar_fecha: lugarFecha,
        nombre,
        puesto,
        email,
        telefono,
        domicilio,
        fecha_asignacion: fechaAsignacion,
        fecha_resguardo: fechaResguardo,
        receptor_nombre: nombre,
        receptor_puesto: puesto,
        emisor_nombre: emisorNombre,
        emisor_puesto: emisorPuesto,
        acepta_condiciones: acepta,
        acepta_danio_parcial: aceptaDanio,
        acepta_perdida_total: aceptaPerdida,
        observaciones,
      };
      const res = await fetch('/api/hr/resguardo', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? {
                id: existing!.id,
                kind,
                status,
                items,
                notes: observaciones || null,
                payload,
              }
            : {
                kind,
                items,
                ...(employeeId ? { employee_id: employeeId } : {}),
                payload,
              }
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'No se pudo guardar');
        return;
      }
      const folio = json.request?.folio;
      setOkMsg(
        isEdit
          ? `Resguardo actualizado${folio ? ` · Folio ${folio}` : ''}`
          : `Resguardo registrado${folio ? ` · Folio ${folio}` : ''}`
      );
      if (!isEdit) resetForm();
      onCreated?.();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 max-w-3xl">
      <SuiteCard accent>
        <p
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Cluster Culinario · Carranza 50
        </p>
        <h3 className="mt-2 text-xl font-bold" style={{ color: SUITE.navy }}>
          {isEdit
            ? `Editar resguardo${existing?.folio ? ` · ${existing.folio}` : ''}`
            : 'Nuevo resguardo'}
        </h3>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: SUITE.muted }}>
          Carta de resguardo y responsiva (formato C50). Equipo, herramientas,
          uniforme o llaves.
        </p>
      </SuiteCard>

      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Tipo de resguardo
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {KINDS.map((k) => {
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="min-h-11 rounded-xl px-4 text-sm font-bold transition-colors"
                style={{
                  backgroundColor: active ? SUITE.navy : SUITE.pageBg,
                  color: active ? '#fff' : SUITE.navy,
                  border: `1px solid ${active ? SUITE.navy : SUITE.border}`,
                }}
              >
                {HR_RESGUARDO_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
        {isEdit ? (
          <label className="mt-4 block">
            <span className="text-sm font-semibold text-slate-700">Estado</span>
            <select
              className={inputClass}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as HrResguardoStatus)
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {HR_RESGUARDO_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-slate-700">
            Lugar y fecha
          </span>
          <input
            className={inputClass}
            value={lugarFecha}
            onChange={(e) => setLugarFecha(e.target.value)}
            required
          />
        </label>
      </SuiteCard>

      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Datos del responsable del resguardo
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Nombre</span>
            <input
              className={inputClass}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Puesto</span>
            <input
              className={inputClass}
              value={puesto}
              onChange={(e) => setPuesto(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Correo electrónico
            </span>
            <input
              type="text"
              className={autoInputClass}
              value={email}
              readOnly
              aria-readonly="true"
              title="Se toma de la ficha del empleado (Datos)"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Teléfono</span>
            <input
              type="text"
              className={autoInputClass}
              value={telefono}
              readOnly
              aria-readonly="true"
              title="Se toma de la ficha del empleado (Datos)"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-semibold text-slate-700">
              Domicilio
            </span>
            <input
              type="text"
              className={autoInputClass}
              value={domicilio}
              readOnly
              aria-readonly="true"
              title="Se toma de la ficha del empleado (Datos)"
            />
          </label>
        </div>
      </SuiteCard>

      <SuiteCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
              Ítems a resguardar
            </h3>
            <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
              {HR_RESGUARDO_LEGAL.recibo}
            </p>
          </div>
          <button
            type="button"
            onClick={addItem}
            className="rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ backgroundColor: SUITE.orangeSoft, color: SUITE.navy }}
          >
            + Agregar
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {items.map((row, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className="text-xs font-bold uppercase tracking-wide"
                  style={{ color: SUITE.muted }}
                >
                  Ítem {idx + 1}
                </span>
                {items.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-xs font-semibold text-red-700"
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-6">
                <label className="block sm:col-span-1">
                  <span className="text-xs font-semibold text-slate-600">
                    Cantidad
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={inputClass}
                    value={row.cantidad}
                    onChange={(e) =>
                      updateItem(idx, {
                        cantidad: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    required
                  />
                </label>
                <label className="block sm:col-span-5">
                  <span className="text-xs font-semibold text-slate-600">
                    Concepto / equipo
                  </span>
                  <input
                    className={inputClass}
                    value={row.concepto}
                    onChange={(e) =>
                      updateItem(idx, { concepto: e.target.value })
                    }
                    required
                    placeholder={
                      kind === 'llaves'
                        ? 'Ej. Llave y candado refrigerador 2'
                        : kind === 'uniforme'
                          ? 'Ej. Playera polo talla M'
                          : 'Ej. Laptop Lenovo'
                    }
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">
                    Marca
                  </span>
                  <input
                    className={inputClass}
                    value={row.marca || ''}
                    onChange={(e) =>
                      updateItem(idx, { marca: e.target.value })
                    }
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-600">
                    Modelo
                  </span>
                  <input
                    className={inputClass}
                    value={row.modelo || ''}
                    onChange={(e) =>
                      updateItem(idx, { modelo: e.target.value })
                    }
                  />
                </label>
                <label className="block sm:col-span-1">
                  <span className="text-xs font-semibold text-slate-600">
                    No. serie
                  </span>
                  <input
                    className={inputClass}
                    value={row.numero_serie || ''}
                    onChange={(e) =>
                      updateItem(idx, { numero_serie: e.target.value })
                    }
                  />
                </label>
                <label className="block sm:col-span-1">
                  <span className="text-xs font-semibold text-slate-600">
                    Precio
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    value={row.precio ?? ''}
                    onChange={(e) =>
                      updateItem(idx, {
                        precio:
                          e.target.value === ''
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </SuiteCard>

      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Condiciones y fechas
        </h3>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: SUITE.muted }}>
          {HR_RESGUARDO_LEGAL.cuidado}
        </p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: SUITE.muted }}>
          {kind === 'llaves'
            ? HR_RESGUARDO_LEGAL.llaves_copia
            : HR_RESGUARDO_LEGAL.software}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Fecha de asignación
            </span>
            <input
              type="date"
              className={inputClass}
              value={fechaAsignacion}
              onChange={(e) => setFechaAsignacion(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">
              Fecha de resguardo
            </span>
            <input
              type="date"
              className={inputClass}
              value={fechaResguardo}
              onChange={(e) => setFechaResguardo(e.target.value)}
            />
          </label>
        </div>

        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={acepta}
            onChange={(e) => setAcepta(e.target.checked)}
            required
          />
          <span>
            Se aceptan las condiciones de resguardo y responsiva del material
            listado.
          </span>
        </label>
        <label className="mt-2 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={aceptaDanio}
            onChange={(e) => setAceptaDanio(e.target.checked)}
          />
          <span>{HR_RESGUARDO_LEGAL.danio_parcial}</span>
        </label>
        <label className="mt-2 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={aceptaPerdida}
            onChange={(e) => setAceptaPerdida(e.target.checked)}
          />
          <span>{HR_RESGUARDO_LEGAL.perdida_total}</span>
        </label>
      </SuiteCard>

      <SuiteCard>
        <h3 className="text-base font-bold" style={{ color: SUITE.navy }}>
          Firmas (nombre y puesto)
        </h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: SUITE.muted }}
            >
              Receptor y responsable
            </p>
            <p className="mt-2 text-sm font-semibold" style={{ color: SUITE.navy }}>
              {nombre || '—'}
            </p>
            <p className="text-sm" style={{ color: SUITE.muted }}>
              {puesto || 'Puesto'}
            </p>
          </div>
          <div className="space-y-2">
            <p
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: SUITE.muted }}
            >
              Emisor / jefe directo
            </p>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">
                Nombre
              </span>
              <input
                className={inputClass}
                value={emisorNombre}
                onChange={(e) => setEmisorNombre(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">
                Puesto
              </span>
              <input
                className={inputClass}
                value={emisorPuesto}
                onChange={(e) => setEmisorPuesto(e.target.value)}
              />
            </label>
          </div>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-slate-700">
            Observaciones
          </span>
          <textarea
            className={`${inputClass} min-h-[88px] py-2`}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </label>
      </SuiteCard>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {okMsg}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="min-h-12 rounded-xl px-8 text-sm font-bold text-white disabled:opacity-60"
          style={{ backgroundColor: SUITE.navy }}
        >
          {saving
            ? 'Guardando…'
            : isEdit
              ? 'Guardar cambios'
              : 'Registrar resguardo'}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
