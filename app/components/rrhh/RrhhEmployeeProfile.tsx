'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  employeePayCadence,
  formatAntiguedad,
  formatHrDate,
  formatHrPuesto,
  isLeaveExemptEmployee,
  resolveSueldoQuincenal,
  type HrEmployee,
} from '@/app/lib/hr';
import {
  HR_DOC_TYPES,
  emptyChecklistStats,
  placeholderDocuments,
  statusLabelEs,
  type HrDocTypeDef,
  type HrEmployeeDocument,
  type HrEmployeeExam,
  type HrMedicalJustification,
  type HrMedicalReimbursement,
} from '@/app/lib/hr-employee-profile';
import {
  contractStatusLabelEs,
  pickDefaultContract,
  type HrEmployeeContract,
} from '@/app/lib/hr-employee-contracts';
import {
  HR_RESGUARDO_KIND_LABELS,
  HR_RESGUARDO_STATUS_LABELS,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';
import { RrhhResguardoForm } from '@/app/components/rrhh/RrhhResguardoForm';
import { formatHrListName } from '@/app/lib/hr-person-match';
import {
  HR_PUESTO_CATALOG,
  formatPlantillaPuestoLabel,
  hasDualLimpiezaServicio,
  normalizePuestoLabel,
  resolveEmployeeRoles,
} from '@/app/lib/hr-puestos';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

type ProfilePayload = {
  ready?: boolean;
  schemaMissing?: boolean;
  error?: string;
  hint?: string;
  detail?: string;
  employee: HrEmployee & {
    nss?: string | null;
    curp?: string | null;
    emergency_contact?: string | null;
    emergency_phone?: string | null;
  };
  documents: HrEmployeeDocument[];
  docTypes: HrDocTypeDef[];
  reimbursements: HrMedicalReimbursement[];
  justifications: HrMedicalJustification[];
  exams?: HrEmployeeExam[];
  contracts?: HrEmployeeContract[];
  defaultContractId?: string | null;
  resguardos?: HrResguardoRequest[];
  checklist: {
    requiredTotal: number;
    requiredUploaded: number;
    requiredVerified: number;
  };
  photoUrl: string | null;
  canVerify: boolean;
  canEditEmployee?: boolean;
};

export function RrhhEmployeeProfile({
  employeeId,
  onClose,
  onChanged,
  initialTab = 'docs',
}: {
  employeeId: string;
  onClose: () => void;
  onChanged?: () => void;
  /** Abrir directo en Datos (lápiz de plantilla). */
  initialTab?: 'docs' | 'medico' | 'resguardos' | 'datos';
}) {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<'docs' | 'medico' | 'resguardos' | 'datos'>(
    initialTab
  );
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{
    kind: string;
    doc_type?: string;
  } | null>(null);
  const [showResguardoForm, setShowResguardoForm] = useState(false);
  const [editingResguardo, setEditingResguardo] =
    useState<HrResguardoRequest | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(
    null
  );
  const [showBajaForm, setShowBajaForm] = useState(false);
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
    setTab(initialTab);
    setShowResguardoForm(false);
    setEditingResguardo(null);
    setSelectedContractId(null);
  }, [employeeId, initialTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setToast('');
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        cache: 'no-store',
      });
      const json = (await res.json()) as ProfilePayload;
      const docs =
        json.documents?.length > 0
          ? json.documents
          : placeholderDocuments(employeeId);
      const checklist =
        json.checklist?.requiredTotal > 0
          ? json.checklist
          : emptyChecklistStats();
      const contracts = json.contracts || [];
      const defaultId =
        json.defaultContractId ||
        pickDefaultContract(contracts)?.id ||
        null;
      setSelectedContractId((prev) => {
        if (prev && contracts.some((c) => c.id === prev)) return prev;
        return defaultId;
      });
      if (!res.ok) {
        setData({
          ...(json as ProfilePayload),
          employee:
            json.employee ||
            ({ id: employeeId, full_name: '—' } as HrEmployee),
          documents: docs,
          docTypes: json.docTypes?.length ? json.docTypes : HR_DOC_TYPES,
          reimbursements: json.reimbursements || [],
          justifications: json.justifications || [],
          exams: json.exams || [],
          contracts,
          defaultContractId: defaultId,
          resguardos: json.resguardos || [],
          checklist,
          photoUrl: json.photoUrl ?? null,
          canVerify: Boolean(json.canVerify),
          canEditEmployee: Boolean(json.canEditEmployee),
          schemaMissing: true,
          error: json.error || 'No se pudo cargar el perfil',
          hint:
            json.hint ||
            'Ejecuta supabase/hr_employee_documents.sql en Supabase SQL Editor',
        });
        return;
      }
      setData({
        ...json,
        documents: docs,
        docTypes: json.docTypes?.length ? json.docTypes : HR_DOC_TYPES,
        contracts,
        defaultContractId: defaultId,
        checklist,
      });
    } catch {
      setToast('Error de red');
      setData({
        employee: { id: employeeId, full_name: '—' } as HrEmployee,
        documents: placeholderDocuments(employeeId),
        docTypes: HR_DOC_TYPES,
        reimbursements: [],
        justifications: [],
        exams: [],
        contracts: [],
        resguardos: [],
        checklist: emptyChecklistStats(),
        photoUrl: null,
        canVerify: false,
        canEditEmployee: false,
        schemaMissing: true,
        error: 'Error de red al cargar el perfil',
        hint: 'Revisa la conexión e intenta de nuevo',
      });
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickFile(kind: string, doc_type?: string) {
    setUploadTarget({ kind, doc_type });
    fileRef.current?.click();
  }

  async function onFileChosen(file: File | null) {
    if (!file || !uploadTarget) return;
    setBusy(true);
    setToast('');
    try {
      const fd = new FormData();
      fd.set('kind', uploadTarget.kind);
      fd.set('file', file);
      if (uploadTarget.doc_type) fd.set('doc_type', uploadTarget.doc_type);
      if (uploadTarget.kind === 'reimbursement') {
        const amount = window.prompt('Monto del reembolso (MXN)', '0') || '0';
        const expense_date =
          window.prompt('Fecha del gasto (YYYY-MM-DD)', '') || '';
        const description =
          window.prompt('Descripción breve', '') || '';
        fd.set('amount', amount);
        if (expense_date) fd.set('expense_date', expense_date);
        if (description) fd.set('description', description);
      }
      if (uploadTarget.kind === 'justification') {
        const absence_date =
          window.prompt('Fecha de ausencia (YYYY-MM-DD)', '') || '';
        if (!absence_date) {
          setToast('Fecha de ausencia requerida');
          return;
        }
        fd.set('absence_date', absence_date);
        const description =
          window.prompt('Notas (opcional)', '') || '';
        if (description) fd.set('description', description);
      }
      if (uploadTarget.kind === 'contract') {
        const title =
          window.prompt('Título del contrato', file.name.replace(/\.[^.]+$/, '')) ||
          '';
        if (title.trim()) fd.set('title', title.trim());
        const effective_from =
          window.prompt('Vigencia desde (YYYY-MM-DD, opcional)', '') || '';
        if (effective_from) fd.set('effective_from', effective_from);
        fd.set('as_vigente', '1');
      }
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setToast([json.error, json.hint].filter(Boolean).join(' — '));
        return;
      }
      setToast(json.message || 'Guardado');
      await load();
      onChanged?.();
    } catch {
      setToast('Error al subir');
    } finally {
      setBusy(false);
      setUploadTarget(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function verifyDoc(docId: string, action: 'verify_doc' | 'reject_doc') {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, docId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo verificar');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setContractVigente(contractId: string) {
    setBusy(true);
    setToast('');
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_contract_vigente',
          contractId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast([json.error, json.hint].filter(Boolean).join(' — '));
        return;
      }
      setToast(json.message || 'Contrato vigente actualizado');
      setSelectedContractId(contractId);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function deleteContract(contractId: string) {
    if (!window.confirm('¿Eliminar este contrato del historial?')) return;
    setBusy(true);
    setToast('');
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_contract',
          contractId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast([json.error, json.hint].filter(Boolean).join(' — '));
        return;
      }
      setToast('Contrato eliminado');
      setSelectedContractId(null);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function setMedStatus(
    action: 'set_reimbursement_status' | 'set_justification_status',
    idKey: string,
    idVal: string,
    status: string
  ) {
    setBusy(true);
    try {
      const body: Record<string, string> = { action, status };
      body[idKey] = idVal;
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo actualizar');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveDatos(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const primary = String(fd.get('puesto') || '').trim() || null;
    const secondary = fd
      .getAll('puestos_secundarios')
      .map((v) => String(v).trim())
      .filter(Boolean)
      .filter((s) => !primary || s.toLowerCase() !== primary.toLowerCase());
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puesto: primary,
          puestos_secundarios: secondary,
          area: fd.get('area'),
          fecha_ingreso: fd.get('fecha_ingreso'),
          sueldo_diario: fd.get('sueldo_diario'),
          notes: fd.get('notes'),
          phone: fd.get('phone'),
          email: fd.get('email'),
          curp: fd.get('curp'),
          nss: fd.get('nss'),
          emergency_contact: fd.get('emergency_contact'),
          emergency_phone: fd.get('emergency_phone'),
          fecha_nacimiento: fd.get('fecha_nacimiento'),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(
          [json.error, json.hint].filter(Boolean).join(' — ') ||
            'No se pudo guardar'
        );
        return;
      }
      setToast('Datos actualizados');
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function submitBaja() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bajaFecha)) {
      setToast('Indica la fecha de baja (YYYY-MM-DD)');
      return;
    }
    if (
      !window.confirm(
        '¿Dar de baja a este colaborador? Sale de la plantilla vigente; el expediente se conserva.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/hr/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employeeId,
          action: 'baja',
          fecha_baja: bajaFecha,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast(json.error || 'No se pudo dar de baja');
        return;
      }
      setToast(json.message || 'Baja registrada');
      setShowBajaForm(false);
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const emp = data?.employee;
  const name = emp ? formatHrListName(emp.full_name) : '…';
  const canEdit = Boolean(data?.canEditEmployee);
  const isActivo = emp?.status !== 'baja' && !emp?.fecha_baja;
  const schemaBlocked = Boolean(data?.schemaMissing || data?.error);
  const docsList =
    data?.documents?.length
      ? data.documents
      : placeholderDocuments(employeeId);
  const contracts = data?.contracts || [];
  const selectedContract =
    contracts.find((c) => c.id === selectedContractId) ||
    pickDefaultContract(contracts);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40"
      role="dialog"
      aria-label={`Perfil ${name}`}
    >
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl"
        style={{ borderLeft: `4px solid ${SUITE.navy}` }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => void onFileChosen(e.target.files?.[0] || null)}
        />

        <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-4">
          <button
            type="button"
            onClick={() => pickFile('photo')}
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
            title="Subir foto (opcional)"
          >
            {data?.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.photoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full items-center justify-center text-[10px] font-semibold text-slate-400">
                Foto
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold" style={{ color: SUITE.navy }}>
              {name}
            </h2>
            <p className="text-xs text-slate-500">
              {[
                (() => {
                  if (!emp) return null;
                  const fmt = formatPlantillaPuestoLabel(emp);
                  const prim = formatHrPuesto(
                    fmt.primary !== '—' ? fmt.primary : emp.puesto || emp.area
                  );
                  return fmt.secondaryHint
                    ? `${prim} · + ${fmt.secondaryHint}`
                    : prim;
                })(),
                formatHrDate(emp?.fecha_ingreso),
                formatAntiguedad(emp?.fecha_ingreso ?? null, null),
                emp?.fecha_nacimiento
                  ? `Cumpleaños: ${formatHrDate(emp.fecha_nacimiento).replace(/\s+\d{4}$/, '')}`
                  : null,
              ]
                .filter((x) => x && x !== '—')
                .join(' · ')}
            </p>
            {data?.checklist ? (
              <p className="mt-1 text-[11px] font-semibold text-slate-600">
                Alta documental: {data.checklist.requiredUploaded}/
                {data.checklist.requiredTotal} · verificados{' '}
                {data.checklist.requiredVerified}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600"
          >
            Cerrar
          </button>
        </header>

        {!loading ? (
          <section
            className="border-b border-slate-100 px-4 py-3"
            aria-label="Contrato laboral"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3
                className="text-xs font-bold uppercase tracking-wide"
                style={{ color: SUITE.navy }}
              >
                Contrato
              </h3>
            </div>
            {contracts.length === 0 ? (
              <p className="text-xs text-slate-500">
                Sin contrato en sistema. Si hay archivo{' '}
                <span className="font-semibold">Contrato*</span> en el
                expediente Drive, se importa al abrir el perfil (PC admin).
              </p>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3">
                {contracts.length > 1 ? (
                  <label className="mb-2 block">
                    <span className="sr-only">Historial de contratos</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800"
                      value={selectedContract?.id || ''}
                      onChange={(e) => setSelectedContractId(e.target.value)}
                    >
                      {contracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {contractStatusLabelEs(c.status)}
                          {' · '}
                          {c.title}
                          {c.effective_from
                            ? ` · ${formatHrDate(c.effective_from)}`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {selectedContract ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: theme.title }}
                        >
                          {selectedContract.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          <span
                            className={
                              selectedContract.status === 'vigente'
                                ? 'font-bold text-teal-800'
                                : 'font-semibold text-slate-600'
                            }
                          >
                            {contractStatusLabelEs(selectedContract.status)}
                          </span>
                          {selectedContract.effective_from
                            ? ` · desde ${formatHrDate(selectedContract.effective_from)}`
                            : ''}
                          {selectedContract.effective_to
                            ? ` · hasta ${formatHrDate(selectedContract.effective_to)}`
                            : ''}
                          {contracts.length > 1
                            ? ` · ${contracts.length} en historial`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedContract.viewUrl ? (
                          <>
                            <button
                              type="button"
                              className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                              style={{ backgroundColor: SUITE.navy }}
                              onClick={() => {
                                setViewerUrl(selectedContract.viewUrl!);
                                setViewerTitle(selectedContract.title);
                              }}
                            >
                              Ver
                            </button>
                            <a
                              href={selectedContract.viewUrl}
                              download
                              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                            >
                              Descargar
                            </a>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            Sin archivo
                          </span>
                        )}
                        {canEdit &&
                        selectedContract.status !== 'vigente' ? (
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-900 disabled:opacity-50"
                            onClick={() =>
                              void setContractVigente(selectedContract.id)
                            }
                          >
                            Marcar vigente
                          </button>
                        ) : null}
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-900 disabled:opacity-50"
                            onClick={() =>
                              void deleteContract(selectedContract.id)
                            }
                          >
                            Eliminar
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        <div className="flex gap-1 border-b border-slate-100 px-2 pt-2">
          {(
            [
              ['docs', 'Documentos'],
              ['medico', 'Médico'],
              ['resguardos', 'Resguardos'],
              ['datos', 'Datos'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="rounded-t-lg px-3 py-2 text-xs font-bold"
              style={{
                color: tab === id ? SUITE.navy : theme.muted,
                backgroundColor: tab === id ? SUITE.orangeSoft : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {toast ? (
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {toast}
            </p>
          ) : null}
          {loading ? (
            <p className="text-sm text-slate-500">Cargando perfil…</p>
          ) : data?.error || data?.schemaMissing ? (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">
                {data.error || 'Falta schema de documentos'}
              </p>
              <p className="mt-1 text-xs">
                {data.hint || (
                  <>
                    En Supabase SQL Editor ejecuta{' '}
                    <code>supabase/hr_employee_documents.sql</code>
                    {' '}(tablas + bucket <code>hr-employee-docs</code> +{' '}
                    <code>fecha_baja</code>). Luego recarga este perfil.
                  </>
                )}
              </p>
            </div>
          ) : null}

          {!loading && tab === 'docs' ? (
            <div className="space-y-3">
            <ul className="space-y-2">
              {docsList.map((d) => (
                <li
                  key={d.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/80 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p
                        className="text-sm font-semibold"
                        style={{ color: theme.title }}
                      >
                        {d.title}
                        {d.required ? (
                          <span className="text-rose-600"> *</span>
                        ) : (
                          <span className="text-slate-400"> · opcional</span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {statusLabelEs(d.status)}
                        {d.notes ? ` · ${d.notes}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {d.viewUrl ? (
                        <button
                          type="button"
                          className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                          style={{ backgroundColor: SUITE.navy }}
                          onClick={() => {
                            setViewerUrl(d.viewUrl!);
                            setViewerTitle(d.title);
                          }}
                        >
                          Ver
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy || schemaBlocked}
                        title={
                          schemaBlocked
                            ? 'Primero ejecuta hr_employee_documents.sql en Supabase'
                            : undefined
                        }
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
                        onClick={() =>
                          pickFile(
                            d.doc_type === 'foto_perfil' ? 'photo' : 'document',
                            d.doc_type
                          )
                        }
                      >
                        {d.storage_path ? 'Reemplazar' : 'Subir'}
                      </button>
                      {data?.canVerify &&
                      !schemaBlocked &&
                      d.status === 'uploaded' ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                            style={{ backgroundColor: '#0f766e' }}
                            onClick={() => void verifyDoc(d.id, 'verify_doc')}
                          >
                            Verificar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-900 disabled:opacity-50"
                            onClick={() => void verifyDoc(d.id, 'reject_doc')}
                          >
                            Rechazar
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            </div>
          ) : null}

          {!loading && tab === 'medico' ? (
            <div className="space-y-4">
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold" style={{ color: SUITE.navy }}>
                    Documentos médicos del expediente
                  </h3>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">
                  Exámenes y archivos médicos importados de la carpeta del
                  empleado (p. ej. Examen.pdf).
                </p>
                <ul className="space-y-2">
                  {(data?.exams || []).filter((e) => e.viewUrl || e.storage_path)
                    .length === 0 ? (
                    <li className="text-xs text-slate-400">
                      Sin archivos médicos en el expediente
                    </li>
                  ) : (
                    (data?.exams || [])
                      .filter((e) => e.viewUrl || e.storage_path)
                      .map((e) => (
                        <li
                          key={e.id}
                          className="rounded-xl border border-slate-100 p-3 text-sm"
                        >
                          <p className="font-semibold">
                            {e.exam_type}
                            {e.test_date ? ` · ${e.test_date}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {[e.result !== 'En expediente' ? e.result : null, e.notes]
                              .filter(Boolean)
                              .join(' · ') || 'Desde expediente'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {e.viewUrl ? (
                              <button
                                type="button"
                                className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                                style={{ backgroundColor: SUITE.navy }}
                                onClick={() => {
                                  setViewerUrl(e.viewUrl!);
                                  setViewerTitle(e.exam_type || 'Documento médico');
                                }}
                              >
                                Ver
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))
                  )}
                </ul>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold" style={{ color: SUITE.navy }}>
                    Justificantes médicos
                  </h3>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    style={{ backgroundColor: SUITE.orangeDeep }}
                    onClick={() => pickFile('justification')}
                  >
                    + Justificante
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">
                  Sustento de falta · se liga a nómina al aceptar (pago de
                  ausencia).
                </p>
                <ul className="space-y-2">
                  {(data?.justifications || []).length === 0 ? (
                    <li className="text-xs text-slate-400">Sin registros</li>
                  ) : (
                    data?.justifications.map((j) => (
                      <li
                        key={j.id}
                        className="rounded-xl border border-slate-100 p-3 text-sm"
                      >
                        <p className="font-semibold">
                          {j.absence_date}
                          {j.absence_end_date
                            ? ` → ${j.absence_end_date}`
                            : ''}{' '}
                          · {statusLabelEs(j.status)}
                        </p>
                        {j.description ? (
                          <p className="text-xs text-slate-500">{j.description}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {j.viewUrl ? (
                            <button
                              type="button"
                              className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                              style={{ backgroundColor: SUITE.navy }}
                              onClick={() => {
                                setViewerUrl(j.viewUrl!);
                                setViewerTitle('Justificante médico');
                              }}
                            >
                              Ver
                            </button>
                          ) : null}
                          {data?.canVerify && j.status === 'pendiente' ? (
                            <>
                              <button
                                type="button"
                                className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                                style={{ backgroundColor: '#0f766e' }}
                                onClick={() =>
                                  void setMedStatus(
                                    'set_justification_status',
                                    'justificationId',
                                    j.id,
                                    'aceptado'
                                  )
                                }
                              >
                                Aceptar
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-900"
                                onClick={() =>
                                  void setMedStatus(
                                    'set_justification_status',
                                    'justificationId',
                                    j.id,
                                    'rechazado'
                                  )
                                }
                              >
                                Rechazar
                              </button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold" style={{ color: SUITE.navy }}>
                    Reembolsos médicos
                  </h3>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-full px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    style={{ backgroundColor: SUITE.orangeDeep }}
                    onClick={() => pickFile('reimbursement')}
                  >
                    + Reembolso
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">
                  Incluye comprobantes de la carpeta «Gastos médicos» del
                  expediente.
                </p>
                <ul className="space-y-2">
                  {(data?.reimbursements || []).length === 0 ? (
                    <li className="text-xs text-slate-400">Sin registros</li>
                  ) : (
                    data?.reimbursements.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-xl border border-slate-100 p-3 text-sm"
                      >
                        <p className="font-semibold">
                          ${Number(r.amount).toLocaleString('es-MX')} ·{' '}
                          {statusLabelEs(r.status)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {[r.expense_date, r.description]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.viewUrl ? (
                            <button
                              type="button"
                              className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                              style={{ backgroundColor: SUITE.navy }}
                              onClick={() => {
                                setViewerUrl(r.viewUrl!);
                                setViewerTitle('Comprobante reembolso');
                              }}
                            >
                              Ver
                            </button>
                          ) : null}
                          {data?.canVerify ? (
                            <>
                              <button
                                type="button"
                                className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold"
                                onClick={() =>
                                  void setMedStatus(
                                    'set_reimbursement_status',
                                    'reimbursementId',
                                    r.id,
                                    'aprobado'
                                  )
                                }
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold"
                                onClick={() =>
                                  void setMedStatus(
                                    'set_reimbursement_status',
                                    'reimbursementId',
                                    r.id,
                                    'pagado'
                                  )
                                }
                              >
                                Pagado
                              </button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </section>

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                Más adelante: reloj biométrico contrastará asistencia vs horario;
                estos justificantes serán el sustento de faltas pagadas.
              </p>
            </div>
          ) : null}

          {!loading && tab === 'resguardos' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  Cartas de resguardo C50 de esta ficha.
                </p>
                <button
                  type="button"
                  className="rounded-full px-3 py-1 text-[11px] font-bold text-white"
                  style={{ backgroundColor: SUITE.orangeDeep }}
                  onClick={() => {
                    if (showResguardoForm && !editingResguardo) {
                      setShowResguardoForm(false);
                      return;
                    }
                    setEditingResguardo(null);
                    setShowResguardoForm(true);
                  }}
                >
                  {showResguardoForm && !editingResguardo
                    ? 'Ocultar formulario'
                    : '+ Nuevo resguardo'}
                </button>
              </div>
              {showResguardoForm && emp ? (
                <div className="rounded-xl border border-slate-100 p-2">
                  <RrhhResguardoForm
                    key={editingResguardo?.id || 'new'}
                    employeeId={employeeId}
                    existing={editingResguardo}
                    defaultNombre={emp.full_name || ''}
                    defaultPuesto={
                      formatHrPuesto(emp.puesto || emp.area) !== '—'
                        ? formatHrPuesto(emp.puesto || emp.area)
                        : emp.puesto || emp.area || ''
                    }
                    onCreated={() => {
                      setShowResguardoForm(false);
                      setEditingResguardo(null);
                      void load();
                      onChanged?.();
                    }}
                    onCancel={() => {
                      setShowResguardoForm(false);
                      setEditingResguardo(null);
                    }}
                  />
                </div>
              ) : null}
              {(data?.resguardos || []).length === 0 ? (
                !showResguardoForm ? (
                  <p className="text-xs text-slate-400">Sin resguardos registrados</p>
                ) : null
              ) : (
                <ul className="space-y-2">
                  {(data?.resguardos || []).map((r) => (
                    <li
                      key={r.id}
                      className="rounded-xl border border-slate-100 bg-slate-50/80 p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p
                          className="text-sm font-semibold"
                          style={{ color: theme.title }}
                        >
                          {r.folio || r.id.slice(0, 8)} ·{' '}
                          {HR_RESGUARDO_KIND_LABELS[r.kind]}
                        </p>
                        <span
                          className="text-[11px] font-bold uppercase tracking-wide"
                          style={{ color: SUITE.orangeDeep }}
                        >
                          {HR_RESGUARDO_STATUS_LABELS[r.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {[
                          r.payload?.fecha_resguardo ||
                            r.payload?.fecha_asignacion ||
                            null,
                          r.items.length
                            ? `${r.items.length} ítem${r.items.length === 1 ? '' : 's'}`
                            : null,
                          r.requested_by ? `@${r.requested_by}` : null,
                          new Date(r.created_at).toLocaleDateString('es-MX'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {r.items.length > 0 ? (
                        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                          {r.items.map((it, idx) => (
                            <li
                              key={`${r.id}-${idx}`}
                              className="text-xs text-slate-700"
                            >
                              <span className="font-semibold">
                                {it.cantidad}× {it.concepto}
                              </span>
                              {[it.marca, it.modelo, it.numero_serie]
                                .filter(Boolean)
                                .length > 0
                                ? ` · ${[it.marca, it.modelo, it.numero_serie]
                                    .filter(Boolean)
                                    .join(' / ')}`
                                : ''}
                              {it.precio != null
                                ? ` · $${Number(it.precio).toLocaleString('es-MX')}`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {r.notes ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Notas: {r.notes}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <button
                          type="button"
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold"
                          onClick={() => {
                            setEditingResguardo(r);
                            setShowResguardoForm(true);
                          }}
                        >
                          Editar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {!loading && tab === 'datos' && emp ? (
            <form
              key={`${emp.id}-${emp.puesto ?? ''}-${(emp.puestos_secundarios || []).join(',')}-${emp.sueldo_diario ?? ''}-${emp.fecha_ingreso ?? ''}-${emp.phone ?? ''}-${emp.fecha_nacimiento ?? ''}`}
              onSubmit={(e) => void saveDatos(e)}
              className="space-y-4"
            >
              {!canEdit ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Solo lectura. Master puede otorgar «Edición de empleados» en
                  el panel de usuarios.
                </p>
              ) : null}
              <section className="space-y-3">
                <h3
                  className="text-sm font-bold"
                  style={{ color: SUITE.navy }}
                >
                  Empleo
                </h3>
                <p className="text-[11px] text-slate-500">
                  Posición principal (plantilla) + roles secundarios sin
                  duplicar ficha. Ingreso y sueldo diario igual que nómina.
                </p>
                <PuestoMultiSelect emp={emp} canEdit={canEdit} />
                <label className="block text-xs font-semibold text-slate-600">
                  Área
                  <input
                    name="area"
                    defaultValue={emp.area || ''}
                    placeholder="Piso, Cocina, Administrativo…"
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Fecha de ingreso
                  <input
                    type="date"
                    name="fecha_ingreso"
                    defaultValue={
                      emp.fecha_ingreso
                        ? String(emp.fecha_ingreso).slice(0, 10)
                        : ''
                    }
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Sueldo diario (MXN)
                  <input
                    name="sueldo_diario"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    defaultValue={
                      emp.sueldo_diario != null &&
                      Number.isFinite(Number(emp.sueldo_diario))
                        ? String(emp.sueldo_diario)
                        : ''
                    }
                    placeholder="0.00"
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                  {(() => {
                    const cadence = employeePayCadence(emp);
                    if (cadence === 'semanal') {
                      return (
                        <span className="mt-1 block text-[11px] font-normal text-slate-500">
                          Pago semanal (plantilla operativa).
                        </span>
                      );
                    }
                    const q = resolveSueldoQuincenal(emp);
                    if (q == null) {
                      return (
                        <span className="mt-1 block text-[11px] font-normal text-slate-500">
                          Pago quincenal (Administrativo).
                        </span>
                      );
                    }
                    return (
                      <span className="mt-1 block text-[11px] font-normal text-slate-500">
                        Pago quincenal: $
                        {q.toLocaleString('es-MX', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        (diario × 15)
                      </span>
                    );
                  })()}
                </label>
                {isLeaveExemptEmployee(emp) ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Sin control de vacaciones (Socios / flag{' '}
                    <code className="text-[11px]">sin_vacaciones</code>).
                  </p>
                ) : null}
                <label className="block text-xs font-semibold text-slate-600">
                  Notas
                  <input
                    name="notes"
                    defaultValue={emp.notes || ''}
                    placeholder="Flags u observaciones (opcional)"
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </label>
              </section>

              <section className="space-y-3 border-t border-slate-100 pt-3">
                <h3
                  className="text-sm font-bold"
                  style={{ color: SUITE.navy }}
                >
                  Contacto y personales
                </h3>
                {(
                  [
                    ['phone', 'Teléfono', emp.phone],
                    ['email', 'Email', emp.email],
                    ['curp', 'CURP', emp.curp],
                    ['nss', 'NSS', emp.nss],
                    [
                      'emergency_contact',
                      'Contacto emergencia',
                      emp.emergency_contact,
                    ],
                    [
                      'emergency_phone',
                      'Tel. emergencia',
                      emp.emergency_phone,
                    ],
                  ] as const
                ).map(([fieldName, label, val]) => (
                  <label
                    key={fieldName}
                    className="block text-xs font-semibold text-slate-600"
                  >
                    {label}
                    <input
                      name={fieldName}
                      defaultValue={val || ''}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                    />
                  </label>
                ))}
                <label className="block text-xs font-semibold text-slate-600">
                  Fecha de nacimiento
                  <input
                    type="date"
                    name="fecha_nacimiento"
                    defaultValue={
                      emp.fecha_nacimiento
                        ? String(emp.fecha_nacimiento).slice(0, 10)
                        : ''
                    }
                    disabled={!canEdit}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                </label>
              </section>

              {canEdit ? (
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: SUITE.orangeDeep }}
                >
                  Guardar datos
                </button>
              ) : null}

              {canEdit && isActivo ? (
                <section className="space-y-3 border-t border-rose-100 pt-4">
                  <h3 className="text-sm font-bold text-rose-900">Baja</h3>
                  {!showBajaForm ? (
                    <button
                      type="button"
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-900"
                      onClick={() => setShowBajaForm(true)}
                    >
                      Dar de baja…
                    </button>
                  ) : (
                    <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-3 space-y-3">
                      <p className="text-xs text-rose-800/90">
                        Sale de la plantilla vigente y pasa a Archivo / Bajas.
                        El expediente se conserva.
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
                          disabled={busy}
                          className="rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: '#be123c' }}
                          onClick={() => void submitBaja()}
                        >
                          {busy ? 'Guardando…' : 'Confirmar baja'}
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-rose-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600"
                          onClick={() => setShowBajaForm(false)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              ) : null}
            </form>
          ) : null}
        </div>

        {viewerUrl ? (
          <div className="absolute inset-0 z-10 flex flex-col bg-white">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
                {viewerTitle}
              </p>
              <button
                type="button"
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                onClick={() => setViewerUrl(null)}
              >
                Cerrar vista
              </button>
            </div>
            <iframe title={viewerTitle} src={viewerUrl} className="flex-1 w-full" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Multi-select: principal (select) + secundarios (checkboxes del catálogo). */
function PuestoMultiSelect({
  emp,
  canEdit,
}: {
  emp: HrEmployee & { puestos_secundarios?: string[] | null };
  canEdit: boolean;
}) {
  const initial = resolveEmployeeRoles(emp);
  const [primary, setPrimary] = useState(initial.primary || '');
  const [secondary, setSecondary] = useState<string[]>(initial.secondary);

  const legacy =
    emp.puesto &&
    !HR_PUESTO_CATALOG.some(
      (c) => c.toLowerCase() === (normalizePuestoLabel(emp.puesto) || '').toLowerCase()
    )
      ? emp.puesto
      : null;

  const dual = hasDualLimpiezaServicio({
    puesto: primary || null,
    puestos_secundarios: secondary,
    notes: emp.notes,
    full_name: emp.full_name,
  });

  function toggleSecondary(label: string) {
    setSecondary((prev) => {
      if (prev.includes(label)) return prev.filter((x) => x !== label);
      return [...prev, label];
    });
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-slate-600">
        Posición / puesto (principal)
        <select
          name="puesto"
          value={primary}
          disabled={!canEdit}
          onChange={(e) => {
            const next = e.target.value;
            setPrimary(next);
            setSecondary((prev) => prev.filter((s) => s !== next));
          }}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
        >
          <option value="">— Sin posición —</option>
          {legacy ? (
            <option value={legacy}>{legacy} (actual)</option>
          ) : null}
          {HR_PUESTO_CATALOG.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={!canEdit} className="space-y-1.5">
        <legend className="text-xs font-semibold text-slate-600">
          Roles secundarios
        </legend>
        <p className="text-[11px] text-slate-500">
          Ej. Román: principal Meserx Encargadx + Limpieza (una sola ficha).
        </p>
        <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2 sm:grid-cols-2">
          {HR_PUESTO_CATALOG.filter((p) => p !== primary).map((p) => {
            const checked = secondary.includes(p);
            return (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-white"
              >
                <input
                  type="checkbox"
                  name="puestos_secundarios"
                  value={p}
                  checked={checked}
                  disabled={!canEdit}
                  onChange={() => toggleSecondary(p)}
                  className="rounded border-slate-300"
                />
                <span>{p}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {dual ? (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          Rol dual Limpieza + servicio: en Horarios no se permiten turnos
          solapados el mismo día.
        </p>
      ) : null}
    </div>
  );
}
