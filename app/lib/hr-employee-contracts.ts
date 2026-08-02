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

/** ¿Nombre de archivo parece contrato laboral? */
export function isContractFilename(filename: string): boolean {
  const n = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!/contrato/.test(n)) return false;
  // Evitar políticas / reglamento / contrato de eventos en expediente RH.
  if (/reglamento|politic|terraza|eventos?|renta/.test(n)) return false;
  return true;
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
  const n = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const ymd = n.match(/(20\d{2})[-_./](\d{1,2})[-_./](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const year = n.match(/\b(20\d{2})\b/);
  if (year) return `${year[1]}-01-01`;
  return null;
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
