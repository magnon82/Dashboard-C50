/** Contratos laborales en perfil de empleado (vigente + historial). */

export type HrContractStatus = 'vigente' | 'historico';

export type HrEmployeeContract = {
  id: string;
  employee_id: string;
  title: string;
  status: HrContractStatus;
  effective_from: string | null;
  effective_to: string | null;
  source_filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at?: string;
  updated_at?: string;
  viewUrl?: string | null;
};

export function contractStatusLabelEs(status: string): string {
  if (status === 'vigente') return 'Vigente';
  if (status === 'historico') return 'Histórico';
  return status;
}

function normalizeFilename(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** ¿Ruta bajo carpeta Contrato / CONTRATO / Contratos del expediente? */
export function isUnderContratoFolder(absolutePath: string): boolean {
  const n = normalizeFilename(absolutePath.replace(/\\/g, '/'));
  return /(?:^|\/)contratos?(?:\/|$)/.test(n);
}

/**
 * Archivos en carpeta Contrato que NO son el contrato laboral
 * (políticas, vacaciones, finiquitos, etc. suelen vivir ahí).
 */
function isNonContractSiblingFilename(n: string): boolean {
  return /vacacion|reglamento|politic|responsiva|resguardo|uniforme|vale\.|kit\s*20|justificant|incapacidad|examen|toxicolog|gastos?\s*medic|acta\s*administrativa|solicitud|finiquito|renuncia|privacidad|aviso\s*de|carta\s*compromiso|\bkpi\b|firma\s*de\s*activ|documentos\.pdf|\bdocs\b/.test(
    n
  );
}

/**
 * ¿Nombre/ruta parece contrato laboral del expediente?
 * · Nombre con contrato / contract / convenio / indeterminado
 * · O PDF/imagen bajo carpeta Contrato/ (p. ej. «Roman Sanchez . 2024.pdf»)
 */
export function isContractFilename(
  filename: string,
  absolutePath?: string | null
): boolean {
  const n = normalizeFilename(filename);
  if (!/\.(pdf|jpe?g|png|webp|heic|heif)$/.test(n)) return false;
  if (/desktop\.ini$/.test(n)) return false;
  if (isNonContractSiblingFilename(n)) return false;

  // Evitar políticas / reglamento / contrato de eventos en expediente RH.
  if (/terraza|eventos?|renta/.test(n)) return false;

  if (/contrato|contract|convenio/.test(n)) return true;
  // «Indeterminado 2024 Juan Pablo…» sin la palabra contrato.
  if (/\bindeterminado\b/.test(n)) return true;

  // Person-named PDFs live under Contrato/ (sin la palabra «Contrato»).
  if (absolutePath && isUnderContratoFolder(absolutePath)) {
    return true;
  }

  return false;
}

/** Título amigable desde el nombre del archivo. */
export function contractTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  if (!base) return 'Contrato';
  const cleaned = base
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Contrato';
}

/**
 * Año o fecha sugerida desde el nombre (p. ej. Contrato 2025.pdf → 2025-01-01).
 */
export function contractEffectiveFromFilename(
  filename: string
): string | null {
  const n = normalizeFilename(filename);
  const ymd = n.match(/(20\d{2})[-_./](\d{1,2})[-_./](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const year = n.match(/\b(20\d{2})\b/);
  if (year) return `${year[1]}-01-01`;
  // Mes en español + año (p. ej. «Junio 2022», «Mayo 2024»).
  const monthYear =
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/.exec(
      n
    );
  if (monthYear) {
    const months: Record<string, string> = {
      enero: '01',
      febrero: '02',
      marzo: '03',
      abril: '04',
      mayo: '05',
      junio: '06',
      julio: '07',
      agosto: '08',
      septiembre: '09',
      setiembre: '09',
      octubre: '10',
      noviembre: '11',
      diciembre: '12',
    };
    const mm = months[monthYear[1]];
    if (mm) return `${monthYear[2]}-${mm}-01`;
  }
  return null;
}

/** Prefijo de doc_type en hr_employee_documents cuando falta hr_employee_contracts. */
export const CONTRACT_DOC_TYPE_PREFIX = 'contrato__';

export function isContractDocType(docType: string): boolean {
  const t = String(docType || '');
  return t === 'contrato' || t.startsWith(CONTRACT_DOC_TYPE_PREFIX);
}

/** doc_type estable por nombre de archivo (único por empleado). */
export function contractDocTypeFromFilename(filename: string): string {
  const slug = normalizeFilename(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return `${CONTRACT_DOC_TYPE_PREFIX}${slug || 'archivo'}`;
}

/** Reconstruye contratos desde filas de hr_employee_documents (fallback). */
export function contractsFromDocumentRows(
  employeeId: string,
  rows: Array<{
    id: string;
    doc_type: string;
    title?: string | null;
    storage_path?: string | null;
    mime_type?: string | null;
    byte_size?: number | null;
    notes?: string | null;
    uploaded_by?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    viewUrl?: string | null;
  }>
): HrEmployeeContract[] {
  const contractRows = rows.filter((r) => isContractDocType(r.doc_type));
  if (!contractRows.length) return [];

  const mapped: HrEmployeeContract[] = contractRows.map((r) => {
    const fromNotes =
      String(r.notes || '').match(/Desde expediente:\s*(.+)$/i)?.[1]?.trim() ||
      null;
    const source = fromNotes || null;
    return {
      id: r.id,
      employee_id: employeeId,
      title: r.title || contractTitleFromFilename(source || r.doc_type),
      status: 'historico' as HrContractStatus,
      effective_from: source ? contractEffectiveFromFilename(source) : null,
      effective_to: null,
      source_filename: source,
      storage_path: r.storage_path ?? null,
      mime_type: r.mime_type ?? null,
      byte_size: r.byte_size ?? null,
      notes: r.notes ?? null,
      uploaded_by: r.uploaded_by ?? null,
      created_at: r.created_at || undefined,
      updated_at: r.updated_at || undefined,
      viewUrl: r.viewUrl ?? null,
    };
  });

  const sorted = sortContracts(mapped);
  if (sorted.length && !sorted.some((c) => c.status === 'vigente')) {
    sorted[0] = { ...sorted[0], status: 'vigente' };
  }
  return sorted;
}

/** Orden: vigente primero, luego fecha/más reciente. */
export function sortContracts(
  rows: HrEmployeeContract[]
): HrEmployeeContract[] {
  return [...rows].sort((a, b) => {
    if (a.status === 'vigente' && b.status !== 'vigente') return -1;
    if (b.status === 'vigente' && a.status !== 'vigente') return 1;
    const da = a.effective_from || a.created_at || '';
    const db = b.effective_from || b.created_at || '';
    return db.localeCompare(da);
  });
}

/** Contrato a mostrar por defecto (vigente, o el más reciente). */
export function pickDefaultContract(
  rows: HrEmployeeContract[]
): HrEmployeeContract | null {
  if (!rows.length) return null;
  const sorted = sortContracts(rows);
  return sorted.find((c) => c.status === 'vigente') || sorted[0] || null;
}
