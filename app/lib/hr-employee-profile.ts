/** Perfil de empleado: checklist documental, foto, médico. */

export const HR_DOCS_BUCKET = 'hr-employee-docs';

export type HrDocStatus = 'pending' | 'uploaded' | 'verified' | 'rejected';

export type HrDocTypeId =
  | 'foto_perfil'
  | 'ine'
  | 'acta_nacimiento'
  | 'curp'
  | 'comprobante_domicilio'
  | 'cv'
  | 'cartas_recomendacion'
  | 'nss';

export type HrDocTypeDef = {
  id: HrDocTypeId;
  title: string;
  required: boolean;
  hint: string;
};

/** Checklist de contratación C50. */
export const HR_DOC_TYPES: HrDocTypeDef[] = [
  {
    id: 'foto_perfil',
    title: 'Foto de perfil',
    required: false,
    hint: 'Opcional · rostro para identificación en Suite',
  },
  {
    id: 'ine',
    title: 'INE',
    required: true,
    hint: 'Original para foto',
  },
  {
    id: 'acta_nacimiento',
    title: 'Acta de nacimiento',
    required: true,
    hint: 'Original · foto o escaneo',
  },
  {
    id: 'curp',
    title: 'CURP',
    required: true,
    hint: 'Documento CURP',
  },
  {
    id: 'comprobante_domicilio',
    title: 'Comprobante de domicilio',
    required: true,
    hint: '≤ 3 meses · solo agua, luz, gas o teléfono fijo',
  },
  {
    id: 'cv',
    title: 'CV',
    required: false,
    hint: 'Curriculum vitae · opcional',
  },
  {
    id: 'cartas_recomendacion',
    title: 'Cartas de recomendación',
    required: false,
    hint: 'Empleos anteriores · opcional',
  },
  {
    id: 'nss',
    title: 'NSS (IMSS)',
    required: false,
    hint: 'Número de Seguro Social · opcional',
  },
];

export type HrEmployeeDocument = {
  id: string;
  employee_id: string;
  doc_type: string;
  title: string;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  required: boolean;
  status: HrDocStatus;
  notes: string | null;
  uploaded_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at?: string;
  updated_at?: string;
  /** URL firmada para vista in-app (solo si hay archivo). */
  viewUrl?: string | null;
};

export type HrMedicalReimbursement = {
  id: string;
  employee_id: string;
  amount: number;
  expense_date: string | null;
  description: string | null;
  storage_path: string | null;
  mime_type: string | null;
  status: 'solicitado' | 'aprobado' | 'pagado' | 'rechazado';
  payroll_period_id: string | null;
  notes: string | null;
  created_by: string;
  viewUrl?: string | null;
};

export type HrMedicalJustification = {
  id: string;
  employee_id: string;
  absence_date: string;
  absence_end_date: string | null;
  description: string | null;
  storage_path: string | null;
  mime_type: string | null;
  status: 'pendiente' | 'aceptado' | 'rechazado';
  payroll_period_id: string | null;
  pays_absence: boolean;
  notes: string | null;
  created_by: string;
  verified_by: string | null;
  viewUrl?: string | null;
};

/** Resultado de examen (toxicológico, médico, etc.) en ficha del empleado. */
export type HrEmployeeExam = {
  id: string;
  employee_id: string;
  exam_type: string;
  test_date: string;
  result: string;
  notes: string | null;
  storage_path: string | null;
  mime_type: string | null;
  created_by: string;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  viewUrl?: string | null;
};

/** Sugerencias de tipo de examen (texto libre en API/UI). */
export const HR_EXAM_TYPE_SUGGESTIONS = [
  'Toxicológico',
  'Médico / aptitud',
  'Audiometría',
  'Vista',
  'COVID-19',
  'Otro',
] as const;

export function docTypeDef(id: string): HrDocTypeDef | undefined {
  return HR_DOC_TYPES.find((d) => d.id === id);
}

export function checklistSeedRows(employeeId: string): Omit<
  HrEmployeeDocument,
  'id' | 'viewUrl'
>[] {
  const now = new Date().toISOString();
  return HR_DOC_TYPES.map((d) => ({
    employee_id: employeeId,
    doc_type: d.id,
    title: d.title,
    storage_path: null,
    mime_type: null,
    byte_size: null,
    required: d.required,
    status: 'pending' as const,
    notes: d.hint,
    uploaded_by: null,
    verified_by: null,
    verified_at: null,
    created_at: now,
    updated_at: now,
  }));
}

/** Checklist local cuando falta schema SQL o aún no hay filas en DB. */
export function placeholderDocuments(
  employeeId: string
): HrEmployeeDocument[] {
  return checklistSeedRows(employeeId).map((r) => ({
    ...r,
    id: `local-${r.doc_type}`,
  }));
}

export function emptyChecklistStats() {
  const requiredTotal = HR_DOC_TYPES.filter((d) => d.required).length;
  return {
    requiredTotal,
    requiredUploaded: 0,
    requiredVerified: 0,
  };
}

/** Tipos obligatorios de alta: INE, acta, CURP, domicilio (no foto/CV/cartas/NSS). */
export const HR_REQUIRED_DOC_TYPES: HrDocTypeDef[] = HR_DOC_TYPES.filter(
  (d) => d.required
);

export function isRequiredDocSatisfied(
  status: string | null | undefined,
  storagePath?: string | null
): boolean {
  if (status === 'uploaded' || status === 'verified') return true;
  // Archivo ya en storage aunque el status quede pending (lag pull/repair)
  if (storagePath && status !== 'rejected') return true;
  return false;
}

export type HrMissingRequiredDoc = {
  id: HrDocTypeId;
  title: string;
};

/** Docs obligatorios sin archivo válido (pendiente / rechazado / sin fila). */
export function missingRequiredDocs(
  rows:
    | { doc_type: string; status: string; storage_path?: string | null }[]
    | null
    | undefined
): HrMissingRequiredDoc[] {
  const byType = new Map(
    (rows || []).map(
      (r) =>
        [r.doc_type, { status: r.status, storage_path: r.storage_path }] as const
    )
  );
  return HR_REQUIRED_DOC_TYPES.filter((d) => {
    const row = byType.get(d.id);
    if (row == null) return true;
    return !isRequiredDocSatisfied(row.status, row.storage_path);
  }).map((d) => ({ id: d.id, title: d.title }));
}

export type HrDocAlertSummary = {
  missingCount: number;
  missing: HrMissingRequiredDoc[];
  requiredTotal: number;
  requiredUploaded: number;
};

export function docAlertSummary(
  rows:
    | { doc_type: string; status: string; storage_path?: string | null }[]
    | null
    | undefined
): HrDocAlertSummary {
  const missing = missingRequiredDocs(rows);
  const requiredTotal = HR_REQUIRED_DOC_TYPES.length;
  return {
    missingCount: missing.length,
    missing,
    requiredTotal,
    requiredUploaded: requiredTotal - missing.length,
  };
}

export function statusLabelEs(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'uploaded':
      return 'Subido';
    case 'verified':
      return 'Verificado';
    case 'rejected':
      return 'Rechazado';
    case 'solicitado':
      return 'Solicitado';
    case 'aprobado':
      return 'Aprobado';
    case 'pagado':
      return 'Pagado';
    case 'aceptado':
      return 'Aceptado';
    case 'pendiente':
      return 'Pendiente';
    default:
      return status;
  }
}
