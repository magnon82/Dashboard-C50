/**
 * Identidad de empleado vía CURP / NSS / fecha_nacimiento
 * (campo, BASE DATOS, docs INE·CURP·Acta·NSS).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearlyActaSignals,
  clearlyCurpConstanciaSignals,
  extractPdfTextWithOcr,
  extractTextFromPdfBytes,
} from './hr-docs-pack-split';
import { HR_DOCS_BUCKET } from './hr-employee-profile';

/** Folio CURP (18) normalizado a mayúsculas sin espacios. */
const CURP_RE = /[A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d/;

/** Diccionario dígito verificador CURP (RENAPO). */
const CURP_CHECK_DICT = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/** NSS IMSS: 11 dígitos. */
const NSS_DIGITS_RE = /\d{11}/;

/** Valida dígito verificador CURP (posición 18). */
export function isValidCurpChecksum(curp: string): boolean {
  const c = String(curp || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (c.length !== 18 || !/^[A-Z]{4}\d{6}[HM]/.test(c)) return false;
  if (!CURP_RE.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = c[i] === 'Ñ' ? 'Ñ' : c[i]!;
    const idx = CURP_CHECK_DICT.indexOf(ch);
    if (idx < 0) return false;
    sum += idx * (18 - i);
  }
  const expected = String((10 - (sum % 10)) % 10);
  return c[17] === expected;
}

export function normalizeCurp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ascii = String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const m = ascii.match(CURP_RE);
  if (m) return m[0];
  // Excel a veces trunca a 17: aún útil como dato de ficha (SACJ…).
  if (ascii.length >= 16 && ascii.length <= 17 && /^[A-Z]{4}\d{6}[HM]/.test(ascii)) {
    return ascii;
  }
  return null;
}

/** Como normalizeCurp pero exige dígito verificador válido (para OCR). */
export function normalizeCurpStrict(
  raw: string | null | undefined
): string | null {
  const c = normalizeCurp(raw);
  if (!c) return null;
  return isValidCurpChecksum(c) ? c : null;
}

export function extractCurpFromText(
  text: string | null | undefined,
  opts?: { strict?: boolean }
): string | null {
  if (!text) return null;
  const upper = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const norm = opts?.strict ? normalizeCurpStrict : normalizeCurp;
  // Preferir folio pegado; también con espacios OCR sueltos
  const direct = norm(upper.replace(/\s+/g, ''));
  if (direct) return direct;
  const spaced = upper.match(
    /[A-Z]{4}\s*\d{6}\s*[HM]\s*[A-Z]{5}\s*[0-9A-Z]\s*\d/
  );
  return spaced ? norm(spaced[0]) : null;
}

function isPdfBuffer(bytes: Buffer, mimeType?: string | null): boolean {
  const mime = String(mimeType || '').toLowerCase();
  return mime.includes('pdf') || bytes.subarray(0, 5).toString('utf8') === '%PDF-';
}

/**
 * Extrae CURP de bytes PDF/imagen-texto (capa texto PDF).
 * INE y constancia CURP suelen traer el folio en texto seleccionable.
 */
export function extractCurpFromDocBytes(
  bytes: Buffer,
  mimeType?: string | null
): string | null {
  if (isPdfBuffer(bytes, mimeType)) {
    return extractCurpFromText(extractTextFromPdfBytes(bytes));
  }
  // Imágenes sin OCR aquí: solo si el buffer trae ASCII accidental
  return extractCurpFromText(bytes.toString('latin1').slice(0, 200_000));
}

/** CURP con OCR si la capa de texto falla (escaneos). Checksum estricto en OCR. */
export async function extractCurpFromDocBytesAsync(
  bytes: Buffer,
  mimeType?: string | null
): Promise<string | null> {
  const layerText = isPdfBuffer(bytes, mimeType)
    ? extractTextFromPdfBytes(bytes)
    : bytes.toString('latin1').slice(0, 200_000);
  const fromLayerStrict = extractCurpFromText(layerText, { strict: true });
  if (fromLayerStrict) return fromLayerStrict;
  const fromLayer = extractCurpFromText(layerText);
  if (fromLayer && isValidCurpChecksum(fromLayer)) return fromLayer;

  if (!isPdfBuffer(bytes, mimeType)) {
    return extractCurpFromText(layerText, { strict: true }) || fromLayer;
  }

  const { text } = await extractPdfTextWithOcr(bytes, { forceOcr: true });
  const fromOcrStrict = extractCurpFromText(text, { strict: true });
  if (fromOcrStrict) return fromOcrStrict;
  // Capa texto digital sin checksum válido (raro) > OCR inválido
  return fromLayer;
}

export function normalizeNss(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11) return digits;
  // A veces Excel guarda como número y pierde ceros a la izquierda
  if (digits.length >= 10 && digits.length < 11) {
    const padded = digits.padStart(11, '0');
    return NSS_DIGITS_RE.test(padded) ? padded : null;
  }
  if (digits.length > 11) {
    const m = digits.match(NSS_DIGITS_RE);
    return m ? m[0] : null;
  }
  return null;
}

export function extractNssFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const upper = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // Preferir contexto etiquetado (evita teléfonos / fechas)
  const labeled = upper.match(
    /(?:NSS|N\.?\s*S\.?\s*S\.?|IMSS|SEGURO\s*SOCIAL|NUMERO\s*(?:DE\s*)?(?:AFILIACION|SEGURIDAD))\s*[:#.]?\s*([\d\s-]{10,20})/i
  );
  if (labeled?.[1]) {
    const n = normalizeNss(labeled[1]);
    if (n) return n;
  }

  const spaced = upper.match(
    /\b(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{3})\b/
  );
  if (spaced) {
    const n = normalizeNss(spaced.slice(1).join(''));
    if (n) return n;
  }

  // En docs tipo NSS, un bloque de 11 dígitos suele ser el folio
  const all = upper.replace(/\s+/g, ' ');
  const m = all.match(/\b(\d{11})\b/);
  return m ? normalizeNss(m[1]) : null;
}

export function extractNssFromDocBytes(
  bytes: Buffer,
  mimeType?: string | null
): string | null {
  if (isPdfBuffer(bytes, mimeType)) {
    return extractNssFromText(extractTextFromPdfBytes(bytes));
  }
  return extractNssFromText(bytes.toString('latin1').slice(0, 200_000));
}

export async function extractNssFromDocBytesAsync(
  bytes: Buffer,
  mimeType?: string | null
): Promise<string | null> {
  const sync = extractNssFromDocBytes(bytes, mimeType);
  if (sync) return sync;
  if (!isPdfBuffer(bytes, mimeType)) {
    return extractNssFromText(bytes.toString('latin1').slice(0, 200_000));
  }
  const { text } = await extractPdfTextWithOcr(bytes, { forceOcr: true });
  return extractNssFromText(text);
}

/** Fecha civil plausible para personal (≈14–100 años). */
export function isPlausibleDobIso(iso: string | null | undefined): boolean {
  const s = String(iso || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return false;
  }
  const nowY = new Date().getFullYear();
  const age = nowY - y;
  return age >= 14 && age <= 100;
}

/** Normaliza ISO YYYY-MM-DD o null si no es DOB plausible. */
export function normalizeFechaNacimiento(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const s = String(raw).trim().slice(0, 10);
  return isPlausibleDobIso(s) ? s : null;
}

/** dd/mm/yyyy · dd-mm-yyyy · dd.mm.yyyy → ISO (día/mes mexicanos). */
export function parseMexicanDateToIso(raw: string): string | null {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  const month = Number(m[2]);
  const day = Number(m[1]);
  if (m[3]!.length === 2) {
    // Misma heurística que CURP: 00–(año%100) → 2000s, si no 1900s + edad.
    const yy = y;
    const nowY = new Date().getFullYear();
    y = yy > nowY % 100 ? 1900 + yy : 2000 + yy;
    if (!isPlausibleDobIso(
      `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    )) {
      const alt = y >= 2000 ? 1900 + yy : 2000 + yy;
      y = alt;
    }
  }
  const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return normalizeFechaNacimiento(iso);
}

/**
 * DOB desde posiciones 5–10 del CURP (YYMMDD).
 * Siglo: prefiere edad 14–100; si ambos caben, el más reciente ≤ hoy.
 */
export function dobIsoFromCurp(curp: string | null | undefined): string | null {
  const c = normalizeCurp(curp);
  if (!c || c.length < 10) return null;
  const yy = Number(c.slice(4, 6));
  const mm = Number(c.slice(6, 8));
  const dd = Number(c.slice(8, 10));
  if (!Number.isFinite(yy) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const nowY = new Date().getFullYear();
  const candidates = [1900 + yy, 2000 + yy]
    .map((y) => {
      const iso = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      return normalizeFechaNacimiento(iso);
    })
    .filter((x): x is string => !!x && Number(x.slice(0, 4)) <= nowY);
  if (!candidates.length) return null;
  // Preferir el más reciente (p. ej. 2005 sobre 1905).
  candidates.sort((a, b) => b.localeCompare(a));
  return candidates[0]!;
}

export type DobExtractSource = 'label' | 'curp';

/**
 * Extrae fecha de nacimiento de texto de Acta.
 * Prioriza el campo «Fecha de Nacimiento»; si no, CURP embebido (pos. 5–10).
 * Ignora constancias CURP (aunque citen el acta).
 */
export function extractFechaNacimientoFromActaText(
  text: string | null | undefined
): { iso: string; source: DobExtractSource } | null {
  if (!text) return null;
  const raw = String(text);
  if (clearlyCurpConstanciaSignals(raw) && !clearlyActaSignals(raw)) {
    return null;
  }

  const upper = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // Etiqueta Acta (evitar «Fecha de Registro»).
  const labelRe = /FECHA\s*DE\s*NAC\w*\s*[:.#]?\s*/gi;
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = labelRe.exec(upper))) {
    const tail = upper.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 80);
    // No tomar «REGISTRO» si aparece antes de un número de fecha.
    const dateM = tail.match(
      /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/
    );
    if (dateM) {
      const iso = parseMexicanDateToIso(dateM[0]);
      if (iso) return { iso, source: 'label' };
    }
  }

  // Fallback: CURP en el acta (solo si parece acta o hay título).
  const looksActa =
    clearlyActaSignals(raw) ||
    /\bACTA\s+DE\s+NACIMIENTO\b/i.test(upper) ||
    /\bFECHA\s+DE\s+NACIMIENTO\b/i.test(upper);
  if (!looksActa) return null;

  const curp = extractCurpFromText(upper, { strict: true }) || extractCurpFromText(upper);
  const fromCurp = dobIsoFromCurp(curp);
  if (fromCurp) return { iso: fromCurp, source: 'curp' };
  return null;
}

/** Capa texto PDF/imagen; sin OCR. */
export function extractFechaNacimientoFromActaBytes(
  bytes: Buffer,
  mimeType?: string | null
): { iso: string; source: DobExtractSource } | null {
  if (isPdfBuffer(bytes, mimeType)) {
    return extractFechaNacimientoFromActaText(extractTextFromPdfBytes(bytes));
  }
  return extractFechaNacimientoFromActaText(
    bytes.toString('latin1').slice(0, 200_000)
  );
}

/** Con OCR si la capa de texto no rinde (escaneos de acta). */
export async function extractFechaNacimientoFromActaBytesAsync(
  bytes: Buffer,
  mimeType?: string | null
): Promise<{ iso: string; source: DobExtractSource } | null> {
  const sync = extractFechaNacimientoFromActaBytes(bytes, mimeType);
  if (sync?.source === 'label') return sync;

  if (!isPdfBuffer(bytes, mimeType)) {
    return sync;
  }

  const { text } = await extractPdfTextWithOcr(bytes, { forceOcr: true });
  const fromOcr = extractFechaNacimientoFromActaText(text);
  if (fromOcr?.source === 'label') return fromOcr;
  // Preferir etiqueta capa texto > CURP OCR > CURP capa
  return fromOcr || sync;
}

export type CurpSource =
  | 'field'
  | 'base_datos'
  | 'doc_curp'
  | 'doc_ine'
  | 'doc_acta'
  | 'leave'
  | 'none';

export type NssSource = 'field' | 'base_datos' | 'doc_nss' | 'none';

export type FechaNacimientoSource =
  | 'field'
  | 'base_datos'
  | 'doc_acta_label'
  | 'doc_acta_curp'
  | 'curp_field'
  | 'none';

export type EmployeeIdentity = {
  employeeId: string;
  curp: string | null;
  source: CurpSource;
};

export type IdentityFillResult = {
  employeeId: string;
  fullName?: string;
  curp: string | null;
  nss: string | null;
  fechaNacimiento: string | null;
  curpSource: CurpSource;
  nssSource: NssSource;
  fechaNacimientoSource: FechaNacimientoSource;
  curpUpdated: boolean;
  nssUpdated: boolean;
  fechaNacimientoUpdated: boolean;
  /** true si DOB se resolvió pero falta columna fecha_nacimiento en DB */
  dobColumnMissing?: boolean;
};

type DocRow = {
  employee_id: string;
  doc_type: string;
  storage_path: string | null;
  mime_type: string | null;
  status?: string | null;
};

function curpSourceFromDocType(docType: string): CurpSource {
  if (docType === 'ine') return 'doc_ine';
  if (docType === 'acta_nacimiento') return 'doc_acta';
  return 'doc_curp';
}

function rankCurpDoc(docType: string): number {
  if (docType === 'curp') return 0;
  if (docType === 'ine') return 1;
  if (docType === 'acta_nacimiento') return 2;
  return 9;
}

/**
 * Resuelve CURP por empleado: campo hr_employees.curp, luego docs curp/ine en storage.
 */
export async function loadEmployeeCurpMap(
  sb: SupabaseClient,
  employeeIds: string[],
  opts?: { extractFromDocs?: boolean; maxDocExtracts?: number }
): Promise<Map<string, EmployeeIdentity>> {
  const fills = await fillEmptyEmployeeIdentity(sb, employeeIds, {
    dryRun: true,
    extractFromDocs: opts?.extractFromDocs,
    maxDocExtracts: opts?.maxDocExtracts,
    write: false,
  });
  const out = new Map<string, EmployeeIdentity>();
  for (const f of fills) {
    out.set(f.employeeId, {
      employeeId: f.employeeId,
      curp: f.curp,
      source: f.curpSource,
    });
  }
  return out;
}

export type BaseDatosIdentityHint = {
  curp?: string | null;
  nss?: string | null;
  fecha_nacimiento?: string | null;
};

/**
 * Rellena CURP/NSS/fecha_nacimiento vacíos desde BASE DATOS (hints),
 * actas de nacimiento (etiqueta o CURP embebido), docs CURP/INE/NSS y leave.
 * Nunca sobrescribe un valor ya presente y plausible en hr_employees.
 */
export async function fillEmptyEmployeeIdentity(
  sb: SupabaseClient,
  employeeIds: string[],
  opts?: {
    dryRun?: boolean;
    /** Si false, solo calcula (igual que dryRun para writes). Default true. */
    write?: boolean;
    extractFromDocs?: boolean;
    maxDocExtracts?: number;
    includeLeavePayloads?: boolean;
    baseDatosByEmployeeId?: Map<string, BaseDatosIdentityHint>;
  }
): Promise<IdentityFillResult[]> {
  const write = opts?.write !== false && !opts?.dryRun;
  const extractFromDocs = opts?.extractFromDocs !== false;
  const includeLeave = opts?.includeLeavePayloads === true;
  const maxExtracts = opts?.maxDocExtracts ?? 120;
  const baseHints = opts?.baseDatosByEmployeeId;

  const results: IdentityFillResult[] = [];
  const byId = new Map<string, IdentityFillResult>();

  for (const id of employeeIds) {
    const row: IdentityFillResult = {
      employeeId: id,
      curp: null,
      nss: null,
      fechaNacimiento: null,
      curpSource: 'none',
      nssSource: 'none',
      fechaNacimientoSource: 'none',
      curpUpdated: false,
      nssUpdated: false,
      fechaNacimientoUpdated: false,
    };
    results.push(row);
    byId.set(id, row);
  }
  if (!employeeIds.length) return results;

  const { data: emps, error: empErr } = await sb
    .from('hr_employees')
    .select('id, full_name, curp, nss, fecha_nacimiento')
    .in('id', employeeIds);

  let empRows = (emps || []) as Array<{
    id: string;
    full_name?: string | null;
    curp: string | null;
    nss: string | null;
    fecha_nacimiento?: string | null;
  }>;

  const missingDobCol =
    !!empErr &&
    /fecha_nacimiento|column .* does not exist|42703/i.test(empErr.message || '');
  if (missingDobCol) {
    const { data: empsNoDob } = await sb
      .from('hr_employees')
      .select('id, full_name, curp, nss')
      .in('id', employeeIds);
    empRows = (empsNoDob || []).map((r) => ({
      ...(r as {
        id: string;
        full_name?: string | null;
        curp: string | null;
        nss: string | null;
      }),
      fecha_nacimiento: null,
    }));
  }

  for (const row of empRows) {
    const slot = byId.get(row.id);
    if (!slot) continue;
    slot.fullName = row.full_name || undefined;
    const curp = normalizeCurp(row.curp);
    const nss = normalizeNss(row.nss);
    const dob = missingDobCol
      ? null
      : normalizeFechaNacimiento(row.fecha_nacimiento);
    if (curp) {
      slot.curp = curp;
      slot.curpSource = 'field';
    }
    if (nss) {
      slot.nss = nss;
      slot.nssSource = 'field';
    }
    if (dob) {
      slot.fechaNacimiento = dob;
      slot.fechaNacimientoSource = 'field';
    }
  }

  // Si falta la columna, aún calculamos DOB en memoria pero no persistimos.
  const canWriteDob = !missingDobCol;

  // 1) BASE DATOS PERSONAL (hints ya matcheados)
  if (baseHints?.size) {
    for (const id of employeeIds) {
      const slot = byId.get(id)!;
      const hint = baseHints.get(id);
      if (!hint) continue;
      if (!slot.curp) {
        const c = normalizeCurp(hint.curp);
        if (c) {
          slot.curp = c;
          slot.curpSource = 'base_datos';
        }
      }
      if (!slot.nss) {
        const n = normalizeNss(hint.nss);
        if (n) {
          slot.nss = n;
          slot.nssSource = 'base_datos';
        }
      }
      if (!slot.fechaNacimiento) {
        const d = normalizeFechaNacimiento(hint.fecha_nacimiento);
        if (d) {
          slot.fechaNacimiento = d;
          slot.fechaNacimientoSource = 'base_datos';
        }
      }
    }
  }

  // 2) Leave request payload.curp
  if (includeLeave) {
    const needCurp = employeeIds.filter((id) => !byId.get(id)?.curp);
    if (needCurp.length) {
      const { data: leaves } = await sb
        .from('hr_leave_requests')
        .select('employee_id, payload')
        .in('employee_id', needCurp)
        .not('payload', 'is', null)
        .limit(500);
      for (const raw of leaves || []) {
        const row = raw as {
          employee_id: string;
          payload: { curp?: string } | null;
        };
        const slot = byId.get(row.employee_id);
        if (!slot || slot.curp) continue;
        const c = normalizeCurp(row.payload?.curp);
        if (c) {
          slot.curp = c;
          slot.curpSource = 'leave';
        }
      }
    }
  }

  // 3) Documentos en storage (CURP/NSS + Acta → fecha_nacimiento)
  if (extractFromDocs) {
    const needCurp = employeeIds.filter((id) => !byId.get(id)?.curp);
    const needNss = employeeIds.filter((id) => !byId.get(id)?.nss);
    const needDob = employeeIds.filter((id) => !byId.get(id)?.fechaNacimiento);
    const needAny = [...new Set([...needCurp, ...needNss, ...needDob])];

    if (needAny.length) {
      const docTypes = [
        ...(needCurp.length ? ['curp', 'ine', 'acta_nacimiento'] : []),
        ...(needNss.length ? ['nss'] : []),
        ...(needDob.length && !needCurp.length ? ['acta_nacimiento'] : []),
      ];
      // Si ya pedimos acta por CURP, no duplicar; si solo DOB, asegurar acta.
      const uniqueTypes = [...new Set(docTypes)];
      const { data: docs } = await sb
        .from('hr_employee_documents')
        .select('employee_id, doc_type, storage_path, mime_type, status')
        .in('employee_id', needAny)
        .in('doc_type', uniqueTypes)
        .not('storage_path', 'is', null);

      const byEmp = new Map<string, DocRow[]>();
      for (const d of (docs || []) as DocRow[]) {
        const id = String(d.employee_id);
        const list = byEmp.get(id) || [];
        list.push(d);
        byEmp.set(id, list);
      }

      let extracts = 0;
      for (const id of needAny) {
        if (extracts >= maxExtracts) break;
        const slot = byId.get(id)!;
        const list = byEmp.get(id) || [];

        if (!slot.curp) {
          const ordered = [...list]
            .filter((d) =>
              ['curp', 'ine', 'acta_nacimiento'].includes(String(d.doc_type))
            )
            .sort(
              (a, b) =>
                rankCurpDoc(String(a.doc_type)) - rankCurpDoc(String(b.doc_type))
            );
          for (const doc of ordered) {
            if (extracts >= maxExtracts) break;
            if (!doc.storage_path) continue;
            extracts += 1;
            try {
              const dl = await sb.storage
                .from(HR_DOCS_BUCKET)
                .download(doc.storage_path);
              if (dl.error || !dl.data) continue;
              const buf = Buffer.from(await dl.data.arrayBuffer());
              const curp = await extractCurpFromDocBytesAsync(buf, doc.mime_type);
              if (curp) {
                slot.curp = curp;
                slot.curpSource = curpSourceFromDocType(String(doc.doc_type));
              }
              // Misma descarga de acta → DOB (etiqueta o CURP)
              if (
                !slot.fechaNacimiento &&
                String(doc.doc_type) === 'acta_nacimiento'
              ) {
                const dob = await extractFechaNacimientoFromActaBytesAsync(
                  buf,
                  doc.mime_type
                );
                if (dob) {
                  slot.fechaNacimiento = dob.iso;
                  slot.fechaNacimientoSource =
                    dob.source === 'label' ? 'doc_acta_label' : 'doc_acta_curp';
                }
              }
              if (slot.curp) break;
            } catch {
              /* ignore */
            }
          }
        }

        if (!slot.nss) {
          const nssDocs = list.filter((d) => String(d.doc_type) === 'nss');
          for (const doc of nssDocs) {
            if (extracts >= maxExtracts) break;
            if (!doc.storage_path) continue;
            extracts += 1;
            try {
              const dl = await sb.storage
                .from(HR_DOCS_BUCKET)
                .download(doc.storage_path);
              if (dl.error || !dl.data) continue;
              const buf = Buffer.from(await dl.data.arrayBuffer());
              const nss = await extractNssFromDocBytesAsync(buf, doc.mime_type);
              if (nss) {
                slot.nss = nss;
                slot.nssSource = 'doc_nss';
                break;
              }
            } catch {
              /* ignore */
            }
          }
        }

        // Acta → fecha_nacimiento si aún falta (CURP ya estaba en ficha)
        if (!slot.fechaNacimiento) {
          const actas = list.filter(
            (d) => String(d.doc_type) === 'acta_nacimiento'
          );
          for (const doc of actas) {
            if (extracts >= maxExtracts) break;
            if (!doc.storage_path) continue;
            extracts += 1;
            try {
              const dl = await sb.storage
                .from(HR_DOCS_BUCKET)
                .download(doc.storage_path);
              if (dl.error || !dl.data) continue;
              const buf = Buffer.from(await dl.data.arrayBuffer());
              const dob = await extractFechaNacimientoFromActaBytesAsync(
                buf,
                doc.mime_type
              );
              if (dob) {
                slot.fechaNacimiento = dob.iso;
                slot.fechaNacimientoSource =
                  dob.source === 'label' ? 'doc_acta_label' : 'doc_acta_curp';
                break;
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  // 4) Fallback DOB desde CURP ya resuelta (campo / docs / base) — sin re-OCR
  for (const id of employeeIds) {
    const slot = byId.get(id)!;
    if (slot.fechaNacimiento || !slot.curp) continue;
    const fromCurp = dobIsoFromCurp(slot.curp);
    if (!fromCurp) continue;
    slot.fechaNacimiento = fromCurp;
    slot.fechaNacimientoSource =
      slot.curpSource === 'doc_acta' ? 'doc_acta_curp' : 'curp_field';
  }

  // Persist only empty → filled (nunca sobrescribe valor existente plausible)
  for (const slot of results) {
    const wantCurp =
      !!slot.curp && slot.curpSource !== 'field' && slot.curpSource !== 'none';
    const wantNss =
      !!slot.nss && slot.nssSource !== 'field' && slot.nssSource !== 'none';
    const wantDob =
      canWriteDob &&
      !!slot.fechaNacimiento &&
      slot.fechaNacimientoSource !== 'field' &&
      slot.fechaNacimientoSource !== 'none';
    slot.curpUpdated = wantCurp;
    slot.nssUpdated = wantNss;
    slot.fechaNacimientoUpdated = wantDob;
    if (!write) continue;

    const now = new Date().toISOString();
    if (wantCurp && slot.curp) {
      const ok = await updateIfBlank(sb, slot.employeeId, 'curp', slot.curp, now);
      if (!ok) slot.curpUpdated = false;
    }
    if (wantNss && slot.nss) {
      const ok = await updateIfBlank(sb, slot.employeeId, 'nss', slot.nss, now);
      if (!ok) slot.nssUpdated = false;
    }
    if (wantDob && slot.fechaNacimiento) {
      const ok = await updateDobIfBlank(
        sb,
        slot.employeeId,
        slot.fechaNacimiento,
        now
      );
      if (!ok) slot.fechaNacimientoUpdated = false;
    }
  }

  if (missingDobCol) {
    for (const slot of results) {
      if (
        slot.fechaNacimiento &&
        slot.fechaNacimientoSource !== 'field' &&
        slot.fechaNacimientoSource !== 'none'
      ) {
        slot.dobColumnMissing = true;
      }
    }
  }

  return results;
}

async function updateIfBlank(
  sb: SupabaseClient,
  employeeId: string,
  column: 'curp' | 'nss',
  value: string,
  updatedAt: string
): Promise<boolean> {
  const patch = { [column]: value, updated_at: updatedAt };
  const nullRes = await sb
    .from('hr_employees')
    .update(patch)
    .eq('id', employeeId)
    .is(column, null)
    .select('id');
  if (!nullRes.error && (nullRes.data?.length || 0) > 0) return true;
  const emptyRes = await sb
    .from('hr_employees')
    .update(patch)
    .eq('id', employeeId)
    .eq(column, '')
    .select('id');
  return !emptyRes.error && (emptyRes.data?.length || 0) > 0;
}

/** Solo escribe si falta o la fecha actual no es un DOB plausible. */
async function updateDobIfBlank(
  sb: SupabaseClient,
  employeeId: string,
  value: string,
  updatedAt: string
): Promise<boolean> {
  const { data: cur, error: readErr } = await sb
    .from('hr_employees')
    .select('fecha_nacimiento')
    .eq('id', employeeId)
    .maybeSingle();
  if (readErr) return false;
  const existing = (cur as { fecha_nacimiento?: string | null } | null)
    ?.fecha_nacimiento;
  if (normalizeFechaNacimiento(existing)) return false;
  const { data, error } = await sb
    .from('hr_employees')
    .update({ fecha_nacimiento: value, updated_at: updatedAt })
    .eq('id', employeeId)
    .select('id');
  return !error && (data?.length || 0) > 0;
}

/** Agrupa employeeIds que comparten la misma CURP (2+). */
export function curpDuplicateGroups(
  identities: Map<string, EmployeeIdentity>
): Map<string, string[]> {
  const byCurp = new Map<string, string[]>();
  for (const idn of identities.values()) {
    if (!idn.curp) continue;
    const list = byCurp.get(idn.curp) || [];
    list.push(idn.employeeId);
    byCurp.set(idn.curp, list);
  }
  for (const [k, ids] of [...byCurp.entries()]) {
    if (ids.length < 2) byCurp.delete(k);
  }
  return byCurp;
}
