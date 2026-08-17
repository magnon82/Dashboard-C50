/**
 * Jala PDFs/imágenes del expediente (File Stream local o Drive API) →
 * hr_employee_documents, contratos y médico. Clasifica por nombre; PDFs de
 * identidad se re-tipan por contenido. `Documentos.pdf` / `DOCS.*` = paquete.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  HR_DOCS_BUCKET,
  checklistSeedRows,
  docTypeDef,
  missingRequiredDocs,
  type HrDocStatus,
  type HrDocTypeId,
} from '@/app/lib/hr-employee-profile';
import {
  contractDocTypeFromFilename,
  contractEffectiveFromFilename,
  contractTitleFromFilename,
  isContractFilename,
} from '@/app/lib/hr-employee-contracts';
import {
  PACK_DOC_ORDER,
  classifyPdfBuffer,
  clearlyActaSignals,
  clearlyCurpConstanciaSignals,
  clearlyIneSignals,
  curpConstanciaBrandSignals,
  detectDocTypeFromText,
  detectSharedPackPaths,
  notesSuggestPackSplit,
  splitPackPdf,
  type PdfDocClassification,
} from '@/app/lib/hr-docs-pack-split';
import {
  hrBibliotecaContentType,
  isUnderHrRoot,
  listHrFolder,
} from '@/app/lib/hr-biblioteca';
import { HR_EXPEDIENTES_DIR } from '@/app/lib/hr';
import {
  canonicalHrEmployeeName,
  folderBasenameFromPath,
  matchPerson,
} from '@/app/lib/hr-person-match';
import {
  downloadDriveFileBuffer,
  expedienteDriveApiAvailable,
  expedienteDriveUnavailableHint,
  listDriveFilesRecursive,
  resolveExpedienteDriveFolder,
} from '@/app/lib/hr-expediente-drive';
import { localDriveFsEnabled } from '@/app/lib/local-fs';
import { getServiceSupabase } from '@/app/lib/users';

/** Local File Stream o Drive API con folder ID + credenciales. */
export function expedientePullSourceAvailable(): boolean {
  return localDriveFsEnabled() || expedienteDriveApiAvailable();
}

const MAX_BYTES = 10 * 1024 * 1024;
/** Contratos escaneados suelen superar 10 MB (p. ej. Contrato.pdf ~13–15 MB). */
const CONTRACT_MAX_BYTES = 35 * 1024 * 1024;

const REQUIRED_FROM_PACK: HrDocTypeId[] = [...PACK_DOC_ORDER];

export type MedicalPullKind =
  | 'examen'
  | 'justificante'
  | 'reembolso'
  | 'medico_doc';

export type ExpedientePullResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  scanned: number;
  matched: Array<{
    file: string;
    docType: HrDocTypeId | 'pack' | 'contrato' | MedicalPullKind;
  }>;
  contractsImported?: number;
  medicalImported?: number;
  /** `hr_employee_exams` ausente: exámenes se guardaron como reembolso-consulta. */
  examsTableMissing?: boolean;
  error?: string;
  hint?: string;
};

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** ¿PDF/imagen bajo carpeta «Gastos médicos» del expediente? */
export function isUnderGastosMedicosFolder(absolutePath: string): boolean {
  const n = normalizeName(absolutePath.replace(/\\/g, '/'));
  // «Gastos médicos», singular, guiones/underscores, sin acento.
  return /(?:^|\/)gastos?[_\s-]*medicos?(?:\/|$)/.test(n);
}

/**
 * Archivos médicos del expediente (exámenes, gastos, justificantes).
 * null = no médico. Contratos/vacaciones fuera aunque estén mal ubicados.
 */
export function classifyMedicalExpedienteFile(
  filename: string,
  absolutePath?: string
): MedicalPullKind | null {
  const n = normalizeName(filename);
  const base = n.replace(/\.[^.]+$/, '');
  if (!/\.(pdf|jpe?g|png|webp|heic|heif)$/.test(n)) return null;
  if (/desktop\.ini$/.test(n)) return null;
  if (/vacacion/.test(n)) return null;
  if (
    /contrato|reglamento|politic|responsiva|resguardo|uniforme|vale\.|kit\s*20/.test(
      n
    ) &&
    !/examen|medic|toxic|justificant|incapacidad|aptitud|receta|reembols/.test(n)
  ) {
    return null;
  }

  const inGastos = absolutePath
    ? isUnderGastosMedicosFolder(absolutePath)
    : false;

  if (/justificant|incapacidad|\bincap\b/.test(n)) return 'justificante';
  if (
    inGastos ||
    /reembols|gastos?\s*medic|factura|dentista|consulta\s*medic|recibo\s*medic/.test(
      n
    )
  ) {
    return 'reembolso';
  }
  if (
    /toxicolog|examen|aptitud|audiometr|\bvista\b|vision|covid|certificado\s*medic|dictamen\s*medic|\bmedico\b|\bmedica\b|receta/.test(
      n
    ) ||
    base === 'examen'
  ) {
    return 'examen';
  }
  if (/medic|salud|clinic/.test(n)) return 'medico_doc';
  return null;
}

function examTypeFromFilename(filename: string): string {
  const n = normalizeName(filename);
  if (/toxicolog/.test(n)) return 'Toxicológico';
  if (/audiometr/.test(n)) return 'Audiometría';
  if (/\bvista\b|vision/.test(n)) return 'Vista';
  if (/covid/.test(n)) return 'COVID-19';
  if (/receta/.test(n)) return 'Receta';
  if (/aptitud|medico|examen|certificado|dictamen/.test(n)) {
    return 'Médico / aptitud';
  }
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return base || 'Documento médico';
}

const MONTH_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** Extrae YYYY-MM-DD de nombres tipo «19 y 22 Octubre 2024» o ISO. */
export function dateFromMedicalFilename(filename: string): string | null {
  const n = normalizeName(filename);
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(n);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/.exec(n);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const monthName =
    /\b(\d{1,2})(?:\s*y\s*\d{1,2})?\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/.exec(
      n
    );
  if (monthName) {
    const mm = String(MONTH_ES[monthName[2]] || 0).padStart(2, '0');
    if (mm !== '00') {
      return `${monthName[3]}-${mm}-${monthName[1].padStart(2, '0')}`;
    }
  }
  const yearOnly = /\b(20\d{2})\b/.exec(n);
  if (yearOnly) return `${yearOnly[1]}-01-01`;
  return null;
}

function todayCdmx(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function expedienteNote(fileName: string): string {
  return `Desde expediente: ${fileName}`;
}

/** Nota cuando el archivo es examen pero `hr_employee_exams` aún no existe. */
function expedienteExamFallbackNote(fileName: string): string {
  return `Desde expediente (examen): ${fileName}`;
}

function alreadyFromExpediente(
  notes: string | null | undefined,
  fileName: string
): boolean {
  const n = String(notes || '');
  return (
    n.includes(expedienteNote(fileName)) ||
    n.includes(expedienteExamFallbackNote(fileName))
  );
}

/** Heurística por nombre · null = ignorar (contratos, vacaciones, etc.). */
export function classifyExpedienteFile(
  filename: string
): HrDocTypeId | 'pack' | null {
  const n = normalizeName(filename);
  const base = n.replace(/\.[^.]+$/, '');

  // Domicilio antes del filtro amplio (recibo_cfe / 3meses no son “recibo” genérico).
  if (
    /comp\.?\s*domicilio|comprobante[.\s_-]*domicilio|actualizacion[.\s_-]*de[.\s_-]*domicilio|\bdomicilio\b|recibo[.\s_-]*cfe|\bcfe\b|megacable|\bmega\b|comprobante[.\s_-]*(luz|agua|gas|telefono)|recibo[.\s_-]*(luz|agua|gas|cfe|telefono)|\b3\s*meses\b|luz\s*y\s*fuerza|telmex|izzi|totalplay/.test(
      n
    )
  ) {
    return 'comprobante_domicilio';
  }

  if (
    /vacacion|contrato|reglamento|politic|responsiva|resguardo|uniforme|examen|vale\.|recibo\b|kit\s*20|justificant|incapacidad|reembols|toxicolog|gastos?\s*medic/.test(
      n
    )
  ) {
    return null;
  }
  if (/acta\s*administrativa|administrativa/.test(n)) return null;
  if (/\bine\b|identificacion|credencial\s*para\s*votar/.test(n)) return 'ine';
  // Constancia CURP / SEGOB / RENAPO antes de “nacimiento” genérico.
  if (
    /\bcurp\b|constancia[.\s_-]*(de[.\s_-]*)?(curp|clave)|renapo|\bsegob\b|clave[.\s_-]*unica/.test(
      n
    )
  ) {
    return 'curp';
  }
  if (
    (/acta[.\s_-]*de[.\s_-]*nacimiento|acta[.\s_-]*nacimiento/.test(n) ||
      (/^nacimiento\b|\bnacimiento\b/.test(n) && /acta/.test(n))) &&
    !/administrativa/.test(n)
  ) {
    return 'acta_nacimiento';
  }
  // Solo “nacimiento” sin acta/curp: histórico de carpetas Drive.
  if (/\bnacimiento\b/.test(n) && !/administrativa/.test(n)) {
    return 'acta_nacimiento';
  }
  if (/\bcv\b|curriculum|curriculo/.test(n)) return 'cv';
  if (/\bnss\b|\bimss\b|seguro\s*social/.test(n)) return 'nss';
  if (
    /cartas?[.\s_-]*recomend|recomendacion/.test(n)
  ) {
    return 'cartas_recomendacion';
  }
  if (
    /\.(jpe?g|png|webp|heic|heif)$/.test(n) &&
    /foto|perfil|retrato|rostro/.test(n)
  ) {
    return 'foto_perfil';
  }

  // Paquete de alta: Documentos.pdf, DOCS.*, Documentos Nombre.pdf
  if (
    base === 'documentos' ||
    base === 'docs' ||
    /^documentos([\s._-]|$)/.test(base) ||
    /^docs?([\s._-]|$)/.test(base)
  ) {
    return 'pack';
  }

  return null;
}

async function ensureChecklist(employeeId: string) {
  const sb = getServiceSupabase();
  const { data: existing, error } = await sb
    .from('hr_employee_documents')
    .select('doc_type')
    .eq('employee_id', employeeId);
  if (error) throw new Error(error.message);
  const have = new Set((existing || []).map((r) => String(r.doc_type)));
  const missing = checklistSeedRows(employeeId).filter(
    (r) => !have.has(r.doc_type)
  );
  if (missing.length) {
    const ins = await sb.from('hr_employee_documents').insert(missing);
    if (ins.error) throw new Error(ins.error.message);
  }
}

async function listFilesRecursive(
  folderPath: string,
  depth = 0
): Promise<Array<{ name: string; path: string; sizeBytes: number | null }>> {
  const listed = await listHrFolder(folderPath);
  const files = listed.items
    .filter((it) => it.kind === 'file')
    .map((it) => ({
      name: it.name,
      path: it.path,
      sizeBytes: it.sizeBytes,
    }));
  // Hasta 3 niveles (p. ej. DOCUMENTOS CAJA/Contrato/*.pdf).
  if (depth >= 3) return files;
  for (const folder of listed.items.filter((it) => it.kind === 'folder')) {
    try {
      const inner = await listFilesRecursive(folder.path, depth + 1);
      files.push(...inner);
    } catch {
      /* ignore nested */
    }
  }
  return files;
}

function extForMime(mime: string, fileName: string): string {
  if (mime.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

async function uploadAndLink(opts: {
  employeeId: string;
  docType: HrDocTypeId;
  localPath: string;
  fileName: string;
  buf: Buffer | Uint8Array;
  mime: string;
  who: string;
  force: boolean;
  /** Sustituye nota por defecto (p. ej. paquete partido). */
  notes?: string;
  /**
   * Si true, permite reescribir filas `uploaded` que comparten storage con
   * otros tipos del paquete (migración / reparación).
   */
  allowReplaceShared?: boolean;
}): Promise<'imported' | 'skipped' | { imported: true; storagePath: string }> {
  const sb = getServiceSupabase();
  const def = docTypeDef(opts.docType);
  if (!def) return 'skipped';

  const { data: existing } = await sb
    .from('hr_employee_documents')
    .select('id, storage_path, status')
    .eq('employee_id', opts.employeeId)
    .eq('doc_type', opts.docType)
    .maybeSingle();

  if (existing?.storage_path && existing.status === 'verified' && !opts.force) {
    return 'skipped';
  }
  if (
    existing?.storage_path &&
    existing.status === 'uploaded' &&
    !opts.force &&
    !opts.allowReplaceShared
  ) {
    return 'skipped';
  }

  const bytes = Buffer.isBuffer(opts.buf) ? opts.buf : Buffer.from(opts.buf);
  const ext = extForMime(opts.mime, opts.fileName);
  const storagePath = `${opts.employeeId}/${opts.docType}-exp-${Date.now()}.${ext}`;
  const up = await sb.storage.from(HR_DOCS_BUCKET).upload(storagePath, bytes, {
    contentType: opts.mime,
    upsert: true,
  });
  if (up.error) {
    throw new Error(up.error.message);
  }
  if (existing?.storage_path && existing.storage_path !== storagePath) {
    // No borrar aún si otros tipos del pack siguen apuntando al path viejo;
    // la reparación limpia paths huérfanos al final.
    const { data: stillUsed } = await sb
      .from('hr_employee_documents')
      .select('id')
      .eq('storage_path', existing.storage_path)
      .neq('id', existing.id)
      .limit(1);
    if (!stillUsed?.length) {
      await sb.storage.from(HR_DOCS_BUCKET).remove([existing.storage_path]);
    }
  }

  const row = {
    employee_id: opts.employeeId,
    doc_type: opts.docType,
    title: def.title,
    storage_path: storagePath,
    mime_type: opts.mime,
    byte_size: bytes.length,
    required: def.required,
    status: 'uploaded' as HrDocStatus,
    notes: opts.notes || `Desde expediente: ${opts.fileName}`,
    uploaded_by: opts.who,
    verified_by: null,
    verified_at: null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await sb
      .from('hr_employee_documents')
      .update(row)
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from('hr_employee_documents').insert(row);
    if (error) throw new Error(error.message);
  }

  if (opts.docType === 'foto_perfil') {
    await sb
      .from('hr_employees')
      .update({
        photo_storage_path: storagePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.employeeId);
  }

  return { imported: true, storagePath };
}

async function linkSplitPackParts(opts: {
  employeeId: string;
  packFileName: string;
  packBuf: Buffer;
  who: string;
  force: boolean;
  /** Tipos que ya tienen archivo propio (no del pack compartido). */
  skipTypes: Set<string>;
  /** Tipos cuyo storage actual es el paquete compartido → reescribir. */
  sharedTypes: Set<string>;
}): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  let split;
  try {
    split = await splitPackPdf(opts.packBuf);
  } catch {
    // PDF ilegible: no compartir el paquete entero entre tipos.
    return { imported: 0, skipped: REQUIRED_FROM_PACK.length };
  }

  const produced = new Set<HrDocTypeId>();
  for (const part of split.parts) {
    const partBuf = Buffer.from(part.bytes);
    let docType = part.docType;
    try {
      docType = await resolveIdentityDocTypeFromPdf(part.docType, partBuf);
    } catch {
      docType = part.docType;
    }
    if (produced.has(docType)) {
      skipped += 1;
      continue;
    }

    const isShared = opts.sharedTypes.has(docType);
    const hasOwn = opts.skipTypes.has(docType);

    // Archivo propio distinto del paquete: no pisar salvo force.
    if (hasOwn && !isShared && !opts.force) {
      skipped += 1;
      continue;
    }

    try {
      const res = await uploadAndLink({
        employeeId: opts.employeeId,
        docType,
        localPath: '',
        fileName: opts.packFileName,
        buf: part.bytes,
        mime: 'application/pdf',
        who: opts.who,
        force: opts.force,
        allowReplaceShared: isShared,
        notes: `Desde expediente (paquete ${part.pageLabel}, ${split.method}): ${opts.packFileName}`,
      });
      if (res === 'skipped') skipped += 1;
      else {
        imported += 1;
        produced.add(docType);
      }
    } catch {
      skipped += 1;
    }
  }

  for (const docType of REQUIRED_FROM_PACK) {
    if (!produced.has(docType)) skipped += 1;
  }

  return { imported, skipped };
}

/**
 * Importa documentos del folder `drive_folder_path` del empleado.
 * Local (File Stream) si hay I:\; si no, Drive API → Storage.
 * No pisa `verified` salvo force.
 */
export async function pullExpedienteDocuments(opts: {
  employeeId: string;
  driveFolderPath: string | null | undefined;
  /** Para resolver Altas/Bajas si aún no hay path (nombre corto Excel OK). */
  fullName?: string | null;
  who?: string;
  force?: boolean;
}): Promise<ExpedientePullResult> {
  const who = opts.who || 'sistema';
  const force = Boolean(opts.force);
  let folder = (opts.driveFolderPath || '').trim();

  type ListedFile = {
    name: string;
    path: string;
    sizeBytes: number | null;
    fileId?: string;
  };

  let files: ListedFile[] = [];

  if (localDriveFsEnabled()) {
    // Soft-resolve: nombre corto («Elizabeth Torrijos») ↔ carpeta Altas completa.
    if (
      opts.fullName &&
      (!folder || !existsSync(folder) || !isUnderHrRoot(folder))
    ) {
      const resolved = await resolveExpedienteFolder({
        employeeId: opts.employeeId,
        fullName: opts.fullName,
        driveFolderPath: folder || null,
      });
      if (resolved) folder = resolved;
    } else if (folder && opts.fullName) {
      await resolveExpedienteFolder({
        employeeId: opts.employeeId,
        fullName: opts.fullName,
        driveFolderPath: folder,
      });
    }

    if (!folder) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        scanned: 0,
        matched: [],
        error: 'Empleado sin carpeta de expediente vinculada',
        hint: 'Vincula el expediente en Plantilla (Altas) o ejecuta el backfill de paths.',
      };
    }
    if (!isUnderHrRoot(folder) || !existsSync(folder)) {
      // Disco stale → intentar Drive API si está configurado.
      if (!expedienteDriveApiAvailable()) {
        return {
          ok: false,
          imported: 0,
          skipped: 0,
          scanned: 0,
          matched: [],
          error: 'Carpeta de expediente no encontrada en disco',
          hint: folder,
        };
      }
    } else {
      try {
        files = await listFilesRecursive(folder);
      } catch (e) {
        return {
          ok: false,
          imported: 0,
          skipped: 0,
          scanned: 0,
          matched: [],
          error:
            e instanceof Error ? e.message : 'No se pudo listar el expediente',
        };
      }
    }
  }

  if (!files.length && expedienteDriveApiAvailable()) {
    try {
      const driveFolder = await resolveExpedienteDriveFolder({
        employeeId: opts.employeeId,
        fullName: String(opts.fullName || ''),
        driveFolderPath: folder || opts.driveFolderPath || null,
      });
      if (!driveFolder) {
        return {
          ok: false,
          imported: 0,
          skipped: 0,
          scanned: 0,
          matched: [],
          error: 'Empleado sin carpeta de expediente en Drive',
          hint:
            'Verifica el nombre en Altas/Bajas o vincula drive_folder_path. ' +
            (folder ? `Path índice: ${folder}` : ''),
        };
      }
      folder = driveFolder.logicalPath;
      const listed = await listDriveFilesRecursive(driveFolder.folderId);
      files = listed.map((f) => ({
        name: f.name,
        path: f.path,
        sizeBytes: f.sizeBytes,
        fileId: f.fileId,
      }));
    } catch (e) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        scanned: 0,
        matched: [],
        error: e instanceof Error ? e.message : 'No se pudo listar Drive',
        hint: expedienteDriveUnavailableHint(),
      };
    }
  }

  if (!files.length) {
    if (!localDriveFsEnabled() && !expedienteDriveApiAvailable()) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        scanned: 0,
        matched: [],
        error: 'Sin fuente de expediente (local ni Drive API)',
        hint: expedienteDriveUnavailableHint(),
      };
    }
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      scanned: 0,
      matched: [],
      error: 'Empleado sin carpeta de expediente vinculada',
      hint: 'Vincula el expediente en Plantilla (Altas) o configura HR_EXPEDIENTES_DRIVE_FOLDER_ID.',
    };
  }

  try {
    await ensureChecklist(opts.employeeId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error checklist';
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      scanned: 0,
      matched: [],
      error: msg,
      hint: /relation|does not exist/i.test(msg)
        ? 'Ejecuta supabase/hr_employee_documents.sql en Supabase'
        : undefined,
    };
  }

  type Classified = {
    name: string;
    path: string;
    sizeBytes: number | null;
    kind: HrDocTypeId | 'pack';
    fileId?: string;
  };
  const classified: Classified[] = [];
  for (const f of files) {
    // Contratos (carpeta Contrato/ o nombre) no van al checklist de alta.
    if (isContractFilename(f.name, f.path)) continue;
    const kind = classifyExpedienteFile(f.name);
    if (!kind) continue;
    if (f.sizeBytes != null && f.sizeBytes > MAX_BYTES) continue;
    classified.push({ ...f, kind });
  }

  let imported = 0;
  let skipped = 0;
  const bufCache = new Map<string, { buf: Buffer; mime: string }>();
  const fileIdByPath = new Map(
    files.filter((f) => f.fileId).map((f) => [f.path, f.fileId!])
  );

  async function loadBuf(filePath: string, fileName: string) {
    const hit = bufCache.get(filePath);
    if (hit) return hit;
    let buf: Buffer;
    let mime: string;
    const driveId = fileIdByPath.get(filePath);
    if (driveId) {
      const dl = await downloadDriveFileBuffer(driveId);
      buf = dl.buffer;
      mime = dl.mimeType;
      if (mime === 'application/octet-stream' && fileName.toLowerCase().endsWith('.pdf')) {
        mime = 'application/pdf';
      }
    } else {
      buf = await readFile(filePath);
      const { contentType } = hrBibliotecaContentType(filePath);
      mime =
        contentType === 'application/octet-stream'
          ? fileName.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'application/octet-stream'
          : contentType.split(';')[0];
    }
    const maxAllowed = /contrato/i.test(filePath) || /contrato/i.test(fileName)
      ? CONTRACT_MAX_BYTES
      : MAX_BYTES;
    if (buf.length > maxAllowed) {
      throw new Error(`${fileName}: supera ${Math.round(maxAllowed / (1024 * 1024))} MB`);
    }
    const entry = { buf, mime };
    bufCache.set(filePath, entry);
    return entry;
  }
  const byType = new Map<HrDocTypeId, Classified>();
  const packs: Classified[] = [];
  for (const c of classified) {
    if (c.kind === 'pack') {
      packs.push(c);
      continue;
    }
    // Contenido PDF manda sobre nombre Drive (p. ej. CURP mal nombrado como acta).
    let kind = c.kind;
    try {
      if (REQUIRED_FROM_PACK.includes(c.kind) && /\.pdf$/i.test(c.name)) {
        const loaded = await loadBuf(c.path, c.name);
        kind = await resolveIdentityDocTypeFromPdf(c.kind, loaded.buf);
      }
    } catch {
      /* filename kind */
    }
    const prev = byType.get(kind);
    if (!prev || (c.sizeBytes || 0) > (prev.sizeBytes || 0)) {
      byType.set(kind, { ...c, kind });
    }
  }

  const matched: ExpedientePullResult['matched'] = [
    ...[...byType.entries()].map(([docType, f]) => ({
      file: f.name,
      docType,
    })),
    ...packs.map((p) => ({ file: p.name, docType: 'pack' as const })),
  ];

  for (const [docType, file] of byType) {
    try {
      const { buf, mime } = await loadBuf(file.path, file.name);
      const res = await uploadAndLink({
        employeeId: opts.employeeId,
        docType,
        localPath: file.path,
        fileName: file.name,
        buf,
        mime,
        who,
        force,
      });
      if (res === 'skipped') skipped += 1;
      else imported += 1;
    } catch {
      skipped += 1;
    }
  }

  // Contratos (historial): no van al checklist único por doc_type.
  let contractsImported = 0;
  try {
    const contractPull = await pullExpedienteContracts({
      employeeId: opts.employeeId,
      files,
      loadBuf,
      who,
      force,
    });
    contractsImported = contractPull.imported;
    imported += contractPull.imported;
    skipped += contractPull.skipped;
    matched.push(...contractPull.matched);
  } catch {
    /* tabla o bucket ausente · no tumba el pull de alta */
  }

  // Médico: exámenes / gastos médicos / justificantes del expediente.
  let medicalImported = 0;
  let examsTableMissing = false;
  try {
    const medicalPull = await pullExpedienteMedical({
      employeeId: opts.employeeId,
      files,
      loadBuf,
      who,
      force,
    });
    medicalImported = medicalPull.imported;
    examsTableMissing = Boolean(medicalPull.examsTableMissing);
    imported += medicalPull.imported;
    skipped += medicalPull.skipped;
    matched.push(...medicalPull.matched);
  } catch {
    /* schema médico ausente · best-effort */
  }

  const pack = packs.sort(
    (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)
  )[0];
  if (pack) {
    try {
      const { buf, mime } = await loadBuf(pack.path, pack.name);
      if (!mime.includes('pdf') && !pack.name.toLowerCase().endsWith('.pdf')) {
        // Paquete no-PDF: no reutilizar el mismo binario en todos los tipos.
        skipped += REQUIRED_FROM_PACK.length;
      } else {
        const sb = getServiceSupabase();
        const { data: rows } = await sb
          .from('hr_employee_documents')
          .select('doc_type, storage_path, status')
          .eq('employee_id', opts.employeeId);

        const sharedPaths = new Set(detectSharedPackPaths(rows || []));
        const sharedTypes = new Set<string>();
        const filledOwn = new Set<string>();

        for (const r of rows || []) {
          const dt = String(r.doc_type);
          if (!REQUIRED_FROM_PACK.includes(dt as HrDocTypeId)) continue;
          if (!r.storage_path) continue;
          if (r.status !== 'uploaded' && r.status !== 'verified') continue;
          if (sharedPaths.has(r.storage_path)) {
            sharedTypes.add(dt);
          } else if (!force) {
            filledOwn.add(dt);
          }
        }

        // Archivos sueltos ya clasificados en este pull tienen prioridad.
        for (const dt of byType.keys()) {
          if (!force) filledOwn.add(dt);
        }

        const packRes = await linkSplitPackParts({
          employeeId: opts.employeeId,
          packFileName: pack.name,
          packBuf: buf,
          who,
          force,
          skipTypes: filledOwn,
          sharedTypes,
        });
        imported += packRes.imported;
        skipped += packRes.skipped;
      }
    } catch {
      skipped += 1;
    }
  }

  return {
    ok: true,
    imported,
    skipped,
    scanned: files.length,
    matched,
    contractsImported,
    medicalImported,
    examsTableMissing: examsTableMissing || undefined,
    hint: examsTableMissing
      ? 'Exámenes del expediente: ejecuta supabase/hr_employee_exams.sql (mientras tanto se muestran en Médico vía fallback).'
      : undefined,
  };
}

type LoadBufFn = (
  filePath: string,
  fileName: string
) => Promise<{ buf: Buffer; mime: string }>;

/**
 * Importa PDFs/imágenes de contrato del expediente → hr_employee_contracts.
 * Detecta por nombre (contrato/contract/convenio/indeterminado/N meses) o
 * por carpeta Contrato/ (archivos con el nombre del empleado).
 * El más reciente (año en nombre / tamaño) queda vigente si aún no hay uno.
 */
async function pullExpedienteContracts(opts: {
  employeeId: string;
  files: Array<{ name: string; path: string; sizeBytes: number | null }>;
  loadBuf: LoadBufFn;
  who: string;
  force: boolean;
}): Promise<{
  imported: number;
  skipped: number;
  matched: Array<{ file: string; docType: 'contrato' }>;
}> {
  const sb = getServiceSupabase();
  const contractFiles = opts.files.filter((f) =>
    isContractFilename(f.name, f.path)
  );
  if (!contractFiles.length) {
    return { imported: 0, skipped: 0, matched: [] };
  }

  const { data: existingRows, error: existErr } = await sb
    .from('hr_employee_contracts')
    .select('id, source_filename, status, storage_path')
    .eq('employee_id', opts.employeeId);

  if (existErr) {
    // Schema ausente: fallback a hr_employee_documents (contrato__*).
    if (
      /does not exist|relation|42P01|schema cache|Could not find the table/i.test(
        existErr.message
      )
    ) {
      return pullExpedienteContractsViaDocuments(opts, contractFiles);
    }
    throw new Error(existErr.message);
  }

  const bySource = new Map(
    (existingRows || [])
      .filter((r) => r.source_filename)
      .map((r) => [String(r.source_filename).toLowerCase(), r])
  );
  const hasVigente = (existingRows || []).some((r) => r.status === 'vigente');

  const ranked = [...contractFiles].sort((a, b) => {
    const ya = contractEffectiveFromFilename(a.name) || '';
    const yb = contractEffectiveFromFilename(b.name) || '';
    if (ya !== yb) return yb.localeCompare(ya);
    return (b.sizeBytes || 0) - (a.sizeBytes || 0);
  });

  let imported = 0;
  let skipped = 0;
  const matched: Array<{ file: string; docType: 'contrato' }> = [];

  for (let i = 0; i < ranked.length; i++) {
    const file = ranked[i];
    matched.push({ file: file.name, docType: 'contrato' });
    const key = file.name.toLowerCase();
    const prev = bySource.get(key);

    if (prev?.storage_path && !opts.force) {
      skipped += 1;
      continue;
    }
    if (file.sizeBytes != null && file.sizeBytes > CONTRACT_MAX_BYTES) {
      skipped += 1;
      continue;
    }

    try {
      // Lectura propia: el loadBuf general corta a 10 MB y varios contratos lo superan.
      const buf = await readFile(file.path);
      if (buf.length > CONTRACT_MAX_BYTES) {
        skipped += 1;
        continue;
      }
      const { contentType } = hrBibliotecaContentType(file.path);
      const mime =
        contentType === 'application/octet-stream'
          ? file.name.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'application/octet-stream'
          : contentType.split(';')[0];
      if (
        !mime.includes('pdf') &&
        !mime.startsWith('image/') &&
        !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name)
      ) {
        skipped += 1;
        continue;
      }
      const ext = extForMime(mime, file.name);
      const storagePath = `${opts.employeeId}/contrato-exp-${Date.now()}-${i}.${ext}`;
      const up = await sb.storage.from(HR_DOCS_BUCKET).upload(storagePath, buf, {
        contentType: mime,
        upsert: true,
      });
      if (up.error) throw new Error(up.error.message);

      if (prev?.storage_path && prev.storage_path !== storagePath) {
        await sb.storage.from(HR_DOCS_BUCKET).remove([prev.storage_path]);
      }

      const title = contractTitleFromFilename(file.name);
      const effective_from = contractEffectiveFromFilename(file.name);
      const keepVigente = prev?.status === 'vigente';
      const row = {
        employee_id: opts.employeeId,
        title,
        // provisional: se normaliza al final si no había vigente
        status: (keepVigente ? 'vigente' : 'historico') as
          | 'vigente'
          | 'historico',
        effective_from,
        effective_to: null as string | null,
        source_filename: file.name,
        storage_path: storagePath,
        mime_type: mime,
        byte_size: buf.length,
        notes: `Desde expediente: ${file.name}`,
        uploaded_by: opts.who,
        updated_at: new Date().toISOString(),
      };

      if (prev?.id) {
        const { error } = await sb
          .from('hr_employee_contracts')
          .update(row)
          .eq('id', prev.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb.from('hr_employee_contracts').insert(row);
        if (error) throw new Error(error.message);
      }
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  // Asegura un vigente: si no había, el archivo más reciente importado/existente.
  if (!hasVigente) {
    const { data: all } = await sb
      .from('hr_employee_contracts')
      .select('id, effective_from, created_at, source_filename')
      .eq('employee_id', opts.employeeId);
    if (all?.length) {
      const pick = [...all].sort((a, b) => {
        const da =
          a.effective_from ||
          contractEffectiveFromFilename(a.source_filename || '') ||
          a.created_at ||
          '';
        const db =
          b.effective_from ||
          contractEffectiveFromFilename(b.source_filename || '') ||
          b.created_at ||
          '';
        return String(db).localeCompare(String(da));
      })[0];
      if (pick?.id) {
        await sb
          .from('hr_employee_contracts')
          .update({
            status: 'historico',
            updated_at: new Date().toISOString(),
          })
          .eq('employee_id', opts.employeeId)
          .eq('status', 'vigente');
        await sb
          .from('hr_employee_contracts')
          .update({
            status: 'vigente',
            updated_at: new Date().toISOString(),
          })
          .eq('id', pick.id);
      }
    }
  }

  return { imported, skipped, matched };
}

/**
 * Fallback: guarda contratos en hr_employee_documents con doc_type `contrato__*`.
 * Así Documentos/Contrato funcionan aunque falte supabase/hr_employee_contracts.sql.
 */
async function pullExpedienteContractsViaDocuments(
  opts: {
    employeeId: string;
    who: string;
    force: boolean;
  },
  contractFiles: Array<{ name: string; path: string; sizeBytes: number | null }>
): Promise<{
  imported: number;
  skipped: number;
  matched: Array<{ file: string; docType: 'contrato' }>;
}> {
  const sb = getServiceSupabase();
  const { data: existingRows, error } = await sb
    .from('hr_employee_documents')
    .select('id, doc_type, storage_path, notes, status')
    .eq('employee_id', opts.employeeId)
    .like('doc_type', 'contrato__%');
  if (error) throw new Error(error.message);

  const byType = new Map(
    (existingRows || []).map((r) => [String(r.doc_type), r])
  );

  const ranked = [...contractFiles].sort((a, b) => {
    const ya = contractEffectiveFromFilename(a.name) || '';
    const yb = contractEffectiveFromFilename(b.name) || '';
    if (ya !== yb) return yb.localeCompare(ya);
    return (b.sizeBytes || 0) - (a.sizeBytes || 0);
  });

  let imported = 0;
  let skipped = 0;
  const matched: Array<{ file: string; docType: 'contrato' }> = [];

  for (let i = 0; i < ranked.length; i++) {
    const file = ranked[i];
    matched.push({ file: file.name, docType: 'contrato' });
    const docType = contractDocTypeFromFilename(file.name);
    const prev = byType.get(docType);

    if (prev?.storage_path && !opts.force) {
      skipped += 1;
      continue;
    }
    if (file.sizeBytes != null && file.sizeBytes > CONTRACT_MAX_BYTES) {
      skipped += 1;
      continue;
    }

    try {
      const buf = await readFile(file.path);
      if (buf.length > CONTRACT_MAX_BYTES) {
        skipped += 1;
        continue;
      }
      const { contentType } = hrBibliotecaContentType(file.path);
      const mime =
        contentType === 'application/octet-stream'
          ? file.name.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'application/octet-stream'
          : contentType.split(';')[0];
      if (
        !mime.includes('pdf') &&
        !mime.startsWith('image/') &&
        !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name)
      ) {
        skipped += 1;
        continue;
      }
      const ext = extForMime(mime, file.name);
      const storagePath = `${opts.employeeId}/contrato-exp-${Date.now()}-${i}.${ext}`;
      const up = await sb.storage.from(HR_DOCS_BUCKET).upload(storagePath, buf, {
        contentType: mime,
        upsert: true,
      });
      if (up.error) throw new Error(up.error.message);

      if (prev?.storage_path && prev.storage_path !== storagePath) {
        await sb.storage.from(HR_DOCS_BUCKET).remove([prev.storage_path]);
      }

      const title = contractTitleFromFilename(file.name);
      const row = {
        employee_id: opts.employeeId,
        doc_type: docType,
        title,
        storage_path: storagePath,
        mime_type: mime,
        byte_size: buf.length,
        required: false,
        status: 'uploaded' as HrDocStatus,
        notes: `Desde expediente: ${file.name}`,
        uploaded_by: opts.who,
        verified_by: null,
        verified_at: null,
        updated_at: new Date().toISOString(),
      };

      if (prev?.id) {
        const { error: updErr } = await sb
          .from('hr_employee_documents')
          .update(row)
          .eq('id', prev.id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await sb
          .from('hr_employee_documents')
          .insert(row);
        if (insErr) throw new Error(insErr.message);
      }
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  return { imported, skipped, matched };
}

/**
 * Importa PDFs/imágenes médicos del expediente:
 * · carpeta «Gastos médicos» o nombre reembolso → hr_medical_reimbursements
 * · justificante / incapacidad → hr_medical_justifications
 * · examen / toxicológico / etc. → hr_employee_exams
 * No crea filas sin archivo. Dedup por notes «Desde expediente: …».
 */
async function pullExpedienteMedical(opts: {
  employeeId: string;
  files: Array<{ name: string; path: string; sizeBytes: number | null }>;
  loadBuf: LoadBufFn;
  who: string;
  force: boolean;
}): Promise<{
  imported: number;
  skipped: number;
  matched: Array<{ file: string; docType: MedicalPullKind }>;
  examsTableMissing?: boolean;
}> {
  const sb = getServiceSupabase();
  const medicalFiles = opts.files
    .map((f) => ({
      ...f,
      kind: classifyMedicalExpedienteFile(f.name, f.path),
    }))
    .filter(
      (f): f is typeof f & { kind: MedicalPullKind } => f.kind != null
    );

  if (!medicalFiles.length) {
    return { imported: 0, skipped: 0, matched: [] };
  }

  const [examsRes, remRes, jusRes] = await Promise.all([
    sb
      .from('hr_employee_exams')
      .select('id, notes, storage_path')
      .eq('employee_id', opts.employeeId),
    sb
      .from('hr_medical_reimbursements')
      .select('id, notes, storage_path')
      .eq('employee_id', opts.employeeId),
    sb
      .from('hr_medical_justifications')
      .select('id, notes, storage_path')
      .eq('employee_id', opts.employeeId),
  ]);

  const schemaMissing = (msg: string | undefined) =>
    Boolean(msg && /does not exist|relation|42P01|schema cache/i.test(msg));

  const allMissing = [examsRes, remRes, jusRes].every(
    (r) => r.error && schemaMissing(r.error.message)
  );
  if (allMissing) {
    return { imported: 0, skipped: 0, matched: [] };
  }

  const examsTableMissing = Boolean(
    examsRes.error && schemaMissing(examsRes.error.message)
  );

  type MedPullRow = {
    id: string;
    notes: string | null;
    storage_path: string | null;
  };
  // Mutable caches: untyped Supabase tables infer Postgrest data as never.
  const remRows: MedPullRow[] = [...((remRes.data || []) as MedPullRow[])];
  const jusRows: MedPullRow[] = [...((jusRes.data || []) as MedPullRow[])];
  const examRows: MedPullRow[] = [...((examsRes.data || []) as MedPullRow[])];

  const matchedExamKinds = medicalFiles.some(
    (f) => f.kind === 'examen' || f.kind === 'medico_doc'
  );

  let imported = 0;
  let skipped = 0;
  const matched: Array<{ file: string; docType: MedicalPullKind }> = [];

  for (const file of medicalFiles) {
    matched.push({ file: file.name, docType: file.kind });
    if (file.sizeBytes != null && file.sizeBytes > MAX_BYTES) {
      skipped += 1;
      continue;
    }

    const kind = file.kind;
    // Exámenes sin tabla → reembolso con nota especial (consulta en Médico).
    const useExamFallback =
      (kind === 'examen' || kind === 'medico_doc') && examsTableMissing;
    const note = useExamFallback
      ? expedienteExamFallbackNote(file.name)
      : expedienteNote(file.name);
    const existingRows =
      kind === 'reembolso' || useExamFallback
        ? remRows
        : kind === 'justificante'
          ? jusRows
          : examRows;

    const prev = existingRows.find((r) =>
      alreadyFromExpediente(r.notes, file.name)
    );
    if (prev?.storage_path && !opts.force) {
      skipped += 1;
      continue;
    }

    try {
      const { buf, mime } = await opts.loadBuf(file.path, file.name);
      if (
        !mime.includes('pdf') &&
        !mime.startsWith('image/') &&
        !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name)
      ) {
        skipped += 1;
        continue;
      }
      const ext = extForMime(mime, file.name);
      const prefix =
        kind === 'reembolso'
          ? 'reembolso'
          : kind === 'justificante'
            ? 'justificante'
            : 'examen';
      const storagePath = `${opts.employeeId}/${prefix}-exp-${Date.now()}.${ext}`;
      const up = await sb.storage.from(HR_DOCS_BUCKET).upload(storagePath, buf, {
        contentType: mime,
        upsert: true,
      });
      if (up.error) throw new Error(up.error.message);

      if (prev?.storage_path && prev.storage_path !== storagePath) {
        await sb.storage.from(HR_DOCS_BUCKET).remove([prev.storage_path]);
      }

      const when = dateFromMedicalFilename(file.name) || todayCdmx();

      if (kind === 'reembolso' || useExamFallback) {
        if (remRes.error) {
          skipped += 1;
          continue;
        }
        const exam_type = useExamFallback
          ? examTypeFromFilename(file.name)
          : null;
        const row = {
          employee_id: opts.employeeId,
          amount: 0,
          expense_date: when,
          description: useExamFallback
            ? exam_type || file.name.replace(/\.[^.]+$/, '')
            : file.name.replace(/\.[^.]+$/, ''),
          storage_path: storagePath,
          mime_type: mime,
          status: 'solicitado' as const,
          notes: note,
          created_by: opts.who,
          updated_by: opts.who,
          updated_at: new Date().toISOString(),
        };
        if (prev?.id) {
          const { error } = await sb
            .from('hr_medical_reimbursements')
            .update(row)
            .eq('id', prev.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await sb
            .from('hr_medical_reimbursements')
            .insert(row);
          if (error) throw new Error(error.message);
          remRows.push({
            id: 'new',
            notes: note,
            storage_path: storagePath,
          });
        }
      } else if (kind === 'justificante') {
        if (jusRes.error) {
          skipped += 1;
          continue;
        }
        const row = {
          employee_id: opts.employeeId,
          absence_date: when,
          absence_end_date: null as string | null,
          description: file.name.replace(/\.[^.]+$/, ''),
          storage_path: storagePath,
          mime_type: mime,
          status: 'pendiente' as const,
          pays_absence: true,
          notes: note,
          created_by: opts.who,
          updated_at: new Date().toISOString(),
        };
        if (prev?.id) {
          const { error } = await sb
            .from('hr_medical_justifications')
            .update(row)
            .eq('id', prev.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await sb
            .from('hr_medical_justifications')
            .insert(row);
          if (error) throw new Error(error.message);
        }
      } else {
        if (examsRes.error) {
          skipped += 1;
          continue;
        }
        const exam_type = examTypeFromFilename(file.name);
        const row = {
          employee_id: opts.employeeId,
          exam_type,
          test_date: when,
          result: 'En expediente',
          notes: note,
          storage_path: storagePath,
          mime_type: mime,
          created_by: opts.who,
          updated_by: opts.who,
          updated_at: new Date().toISOString(),
        };
        if (prev?.id) {
          const { error } = await sb
            .from('hr_employee_exams')
            .update(row)
            .eq('id', prev.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await sb.from('hr_employee_exams').insert(row);
          if (error) throw new Error(error.message);
        }
      }
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    imported,
    skipped,
    matched,
    examsTableMissing: examsTableMissing && matchedExamKinds,
  };
}
export async function repairSharedPackFromStorage(opts: {
  employeeId: string;
  who?: string;
  /** Reescribe también verificados. */
  force?: boolean;
}): Promise<{ imported: number; skipped: number; repaired: boolean }> {
  const who = opts.who || 'sistema';
  const force = Boolean(opts.force);
  const sb = getServiceSupabase();

  const { data: rows, error } = await sb
    .from('hr_employee_documents')
    .select('id, doc_type, storage_path, status, notes')
    .eq('employee_id', opts.employeeId);
  if (error || !rows?.length) {
    return { imported: 0, skipped: 0, repaired: false };
  }

  const sharedPaths = detectSharedPackPaths(rows);
  if (!sharedPaths.length) {
    return { imported: 0, skipped: 0, repaired: false };
  }

  // Usar el path compartido con más tipos (suele ser el paquete).
  const pathRank = new Map<string, number>();
  for (const r of rows) {
    if (!r.storage_path || !sharedPaths.includes(r.storage_path)) continue;
    pathRank.set(
      r.storage_path,
      (pathRank.get(r.storage_path) || 0) + 1
    );
  }
  const packPath = [...pathRank.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!packPath) return { imported: 0, skipped: 0, repaired: false };

  const sharedTypes = new Set(
    rows
      .filter((r) => r.storage_path === packPath)
      .map((r) => String(r.doc_type))
  );

  // No tocar verificados salvo force.
  if (!force) {
    for (const r of rows) {
      if (
        r.storage_path === packPath &&
        r.status === 'verified' &&
        sharedTypes.has(String(r.doc_type))
      ) {
        sharedTypes.delete(String(r.doc_type));
      }
    }
  }
  if (!sharedTypes.size) {
    return { imported: 0, skipped: 0, repaired: false };
  }

  const dl = await sb.storage.from(HR_DOCS_BUCKET).download(packPath);
  if (dl.error || !dl.data) {
    return { imported: 0, skipped: 0, repaired: false };
  }
  const ab = await dl.data.arrayBuffer();
  const packBuf = Buffer.from(ab);
  if (packBuf.length < 5 || packBuf.subarray(0, 4).toString() !== '%PDF') {
    return { imported: 0, skipped: 0, repaired: false };
  }

  const noteHint =
    rows.find((r) => r.storage_path === packPath)?.notes || '';
  const packNameMatch = /Desde expediente[^:]*:\s*(.+)$/i.exec(noteHint || '');
  const packFileName = (packNameMatch?.[1] || 'Documentos.pdf').trim();

  const skipTypes = new Set<string>();
  for (const r of rows) {
    const dt = String(r.doc_type);
    if (!REQUIRED_FROM_PACK.includes(dt as HrDocTypeId)) continue;
    if (!r.storage_path) continue;
    if (sharedTypes.has(dt)) continue;
    if (r.status === 'uploaded' || r.status === 'verified') {
      skipTypes.add(dt);
    }
  }

  const packRes = await linkSplitPackParts({
    employeeId: opts.employeeId,
    packFileName,
    packBuf,
    who,
    force,
    skipTypes,
    sharedTypes,
  });

  // Limpia el objeto paquete si ya nadie lo referencia.
  const { data: still } = await sb
    .from('hr_employee_documents')
    .select('id')
    .eq('storage_path', packPath)
    .limit(1);
  if (!still?.length) {
    await sb.storage.from(HR_DOCS_BUCKET).remove([packPath]);
  }

  return {
    imported: packRes.imported,
    skipped: packRes.skipped,
    repaired: packRes.imported > 0,
  };
}

/**
 * ¿Conviene soft-pull? (sin docs / obligatorios faltantes).
 * No bloquear GET del perfil: usar `profileSoftPullPending` + sync en background.
 */
export async function shouldSoftPullExpediente(
  employeeId: string
): Promise<boolean> {
  if (!expedientePullSourceAvailable()) return false;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_employee_documents')
      .select('storage_path, doc_type, status')
      .eq('employee_id', employeeId);
    if (error) return false;
    const rows = data || [];
    if (!rows.length) return true;
    if (rows.every((r) => !r.storage_path)) return true;
    // Parcial: p. ej. INE ya jalado pero domicilio aún en el paquete Drive.
    const missing = missingRequiredDocs(
      rows.map((r) => ({
        doc_type: String(r.doc_type),
        status: String(r.status || 'pending'),
        storage_path: r.storage_path ?? null,
      }))
    );
    return missing.length > 0;
  } catch {
    return false;
  }
}

/** Soft-pull de contratos si aún no hay archivo en sistema para este empleado. */
export async function shouldSoftPullContracts(
  employeeId: string
): Promise<boolean> {
  if (!expedientePullSourceAvailable()) return false;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_employee_contracts')
      .select('id, storage_path')
      .eq('employee_id', employeeId)
      .limit(20);
    if (error) {
      if (
        /does not exist|relation|42P01|schema cache|Could not find the table/i.test(
          error.message
        )
      ) {
        // Fallback: ¿ya hay contrato__* en documents?
        const docs = await sb
          .from('hr_employee_documents')
          .select('id, storage_path')
          .eq('employee_id', employeeId)
          .like('doc_type', 'contrato__%')
          .limit(5);
        if (docs.error) return false;
        const rows = docs.data || [];
        return !rows.length || rows.every((r) => !r.storage_path);
      }
      return false;
    }
    const rows = data || [];
    if (!rows.length) return true;
    return rows.every((r) => !r.storage_path);
  } catch {
    return false;
  }
}

/**
 * Soft-pull médico si aún no hay archivos en exámenes / reembolsos / justificantes.
 * (Aunque el checklist documental ya esté lleno.)
 * No usar solo para bloquear/abrir perfil: carpeta médica vacía es común.
 */
export async function shouldSoftPullMedical(
  employeeId: string
): Promise<boolean> {
  if (!expedientePullSourceAvailable()) return false;
  try {
    const sb = getServiceSupabase();
    const checks = await Promise.all([
      sb
        .from('hr_employee_exams')
        .select('id')
        .eq('employee_id', employeeId)
        .not('storage_path', 'is', null)
        .limit(1),
      sb
        .from('hr_medical_reimbursements')
        .select('id')
        .eq('employee_id', employeeId)
        .not('storage_path', 'is', null)
        .limit(1),
      sb
        .from('hr_medical_justifications')
        .select('id')
        .eq('employee_id', employeeId)
        .not('storage_path', 'is', null)
        .limit(1),
    ]);
    for (const r of checks) {
      if (r.error) {
        if (/does not exist|relation|42P01|schema cache/i.test(r.error.message)) {
          continue;
        }
        return false;
      }
      if (r.data?.length) return false;
    }
    // Si las 3 tablas faltan, no dispara soft-pull médico.
    const usable = checks.some(
      (r) =>
        !r.error ||
        !/does not exist|relation|42P01|schema cache/i.test(r.error.message)
    );
    return usable;
  } catch {
    return false;
  }
}

/**
 * ¿El perfil necesita sync de expediente en background?
 * Ligero (solo DB): docs faltantes, contratos vacíos o pack a reparar.
 * Médico vacío solo no dispara (muy común) — el pull completo lo incluye si corre.
 * Nunca await-ear pull/OCR en el GET del perfil.
 */
export async function profileSoftPullPending(
  employeeId: string,
  opts?: { docsRequired?: boolean }
): Promise<boolean> {
  const docsRequired = opts?.docsRequired !== false;
  try {
    const tasks: Promise<boolean>[] = [
      shouldRepairSharedPack(employeeId),
      shouldRepairMislabeledPack(employeeId),
    ];
    if (expedientePullSourceAvailable()) {
      if (docsRequired) tasks.push(shouldSoftPullExpediente(employeeId));
      tasks.push(shouldSoftPullContracts(employeeId));
    }
    const flags = await Promise.all(tasks);
    return flags.some(Boolean);
  } catch {
    return false;
  }
}

/** ¿Hay tipos del pack apuntando al mismo archivo? (reparar sin File Stream). */
export async function shouldRepairSharedPack(
  employeeId: string
): Promise<boolean> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_employee_documents')
      .select('doc_type, storage_path, status')
      .eq('employee_id', employeeId);
    if (error) return false;
    const shared = detectSharedPackPaths(data || []);
    if (!shared.length) return false;
    // Solo si alguno sigue en uploaded (no todos verificados con path compartido).
    return (data || []).some(
      (r) =>
        r.storage_path &&
        shared.includes(r.storage_path) &&
        r.status === 'uploaded'
    );
  } catch {
    return false;
  }
}

/** Marca de soft-check con heurística identidad actual (invalida marcas viejas). */
const IDENTITY_CONTENT_OK = 'contenido verificado identidad-2026-08-17';

const IDENTITY_REPAIR_TYPES: HrDocTypeId[] = [
  'ine',
  'acta_nacimiento',
  'curp',
  'comprobante_domicilio',
];

function notesAlreadyIdentityChecked(notes: string): boolean {
  const low = notes.toLowerCase();
  return low.includes(IDENTITY_CONTENT_OK);
}

/**
 * ¿Conviene re-clasificar PDFs del pack ya separados?
 * (p. ej. CURP en acta o en INE tras heurística de orden del paquete).
 */
export async function shouldRepairMislabeledPack(
  employeeId: string
): Promise<boolean> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('hr_employee_documents')
      .select('doc_type, storage_path, status, notes')
      .eq('employee_id', employeeId);
    if (error) return false;
    const rows = data || [];
    const uploadedIdentity = rows.filter(
      (r) =>
        IDENTITY_REPAIR_TYPES.includes(String(r.doc_type) as HrDocTypeId) &&
        r.storage_path &&
        (r.status === 'uploaded' || r.status === 'verified')
    );
    const missingIdentity = IDENTITY_REPAIR_TYPES.filter(
      (dt) =>
        dt !== 'comprobante_domicilio' &&
        !uploadedIdentity.some((r) => String(r.doc_type) === dt)
    );
    // CURP/acta/INE vacío con otro PDF de identidad: casi seguro slot cruzado.
    if (missingIdentity.length > 0 && uploadedIdentity.length > 0) {
      return uploadedIdentity.some(
        (r) =>
          r.status === 'uploaded' &&
          !notesAlreadyIdentityChecked(String(r.notes || ''))
      );
    }
    return rows.some((r) => {
      const dt = String(r.doc_type);
      if (!IDENTITY_REPAIR_TYPES.includes(dt as HrDocTypeId)) return false;
      if (!r.storage_path || r.status !== 'uploaded') return false;
      const notes = String(r.notes || '');
      if (notesAlreadyIdentityChecked(notes)) return false;
      if (notesSuggestPackSplit(notes)) return true;
      return /(?:^|\/)(?:ine|acta_nacimiento|curp|comprobante_domicilio)-exp-\d+\./i.test(
        r.storage_path
      );
    });
  } catch {
    return false;
  }
}

/**
 * Si el PDF tiene señal fuerte de otro tipo, corrige el slot del nombre Drive.
 * Prioridad: marca constancia CURP > título acta > INE > clasificador.
 */
export async function resolveIdentityDocTypeFromPdf(
  filenameKind: HrDocTypeId,
  buf: Buffer
): Promise<HrDocTypeId> {
  if (!REQUIRED_FROM_PACK.includes(filenameKind)) return filenameKind;
  if (buf.length < 5 || buf.subarray(0, 4).toString() !== '%PDF') {
    return filenameKind;
  }
  try {
    const classification = await classifyPdfBuffer(buf);
    const sample = classification.textSample || '';
    if (
      classification.docType === 'curp' ||
      curpConstanciaBrandSignals(sample) ||
      clearlyCurpConstanciaSignals(sample)
    ) {
      return 'curp';
    }
    if (clearlyActaSignals(sample) && !clearlyIneSignals(sample)) {
      return 'acta_nacimiento';
    }
    if (clearlyIneSignals(sample) && !clearlyActaSignals(sample)) {
      return 'ine';
    }
    const detected =
      classification.docType &&
      REQUIRED_FROM_PACK.includes(classification.docType)
        ? classification.docType
        : detectDocTypeFromText(sample);
    if (
      detected &&
      REQUIRED_FROM_PACK.includes(detected) &&
      detected !== filenameKind &&
      (filenameKind === 'acta_nacimiento' ||
        filenameKind === 'curp' ||
        filenameKind === 'ine' ||
        detected === 'acta_nacimiento' ||
        detected === 'curp' ||
        detected === 'ine')
    ) {
      return detected;
    }
  } catch {
    /* filename kind */
  }
  return filenameKind;
}

function resolveDetectedType(
  classification: PdfDocClassification
): HrDocTypeId | null {
  // classifyPdfBuffer ya aplicó reglas duras sobre el texto completo.
  if (
    classification.docType &&
    REQUIRED_FROM_PACK.includes(classification.docType)
  ) {
    return classification.docType;
  }
  // Fallback: textSample truncado (solo si el clasificador no pudo tipar).
  const fromText = detectDocTypeFromText(classification.textSample || '');
  if (fromText && REQUIRED_FROM_PACK.includes(fromText)) return fromText;
  return null;
}

async function clearDocFile(opts: {
  employeeId: string;
  docType: HrDocTypeId;
  who: string;
  existingId: string;
  oldPath: string | null;
}): Promise<void> {
  const sb = getServiceSupabase();
  const def = docTypeDef(opts.docType);
  if (!def) return;

  if (opts.oldPath) {
    const { data: stillUsed } = await sb
      .from('hr_employee_documents')
      .select('id')
      .eq('storage_path', opts.oldPath)
      .neq('id', opts.existingId)
      .limit(1);
    if (!stillUsed?.length) {
      await sb.storage.from(HR_DOCS_BUCKET).remove([opts.oldPath]);
    }
  }

  await sb
    .from('hr_employee_documents')
    .update({
      storage_path: null,
      mime_type: null,
      byte_size: null,
      status: 'pending' as HrDocStatus,
      notes: 'Reclasificado: contenido no correspondía a este tipo',
      uploaded_by: opts.who,
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.existingId);
}

/**
 * Re-lee PDFs del pack en Storage, clasifica por contenido y reasigna slots.
 * Corrige el caso Acta←CURP sin necesitar File Stream ni path compartido.
 */
export async function repairMislabeledPackFromStorage(opts: {
  employeeId: string;
  who?: string;
  force?: boolean;
}): Promise<{
  imported: number;
  skipped: number;
  repaired: boolean;
  swaps: Array<{ from: string; to: string }>;
}> {
  const who = opts.who || 'sistema';
  const force = Boolean(opts.force);
  const sb = getServiceSupabase();

  const { data: rows, error } = await sb
    .from('hr_employee_documents')
    .select('id, doc_type, storage_path, status, notes, mime_type')
    .eq('employee_id', opts.employeeId);
  if (error || !rows?.length) {
    return { imported: 0, skipped: 0, repaired: false, swaps: [] };
  }

  type Cand = {
    id: string;
    slot: HrDocTypeId;
    path: string;
    status: string;
    buf: Buffer;
    detected: HrDocTypeId;
    score: number;
    classification: PdfDocClassification;
  };

  const candidates: Cand[] = [];
  let skipped = 0;
  // Identidad del pack: INE/acta/CURP/domicilio (la heurística de orden
  // a menudo deja la constancia CURP en el slot INE o acta).
  const focusTypes: HrDocTypeId[] = force
    ? [...REQUIRED_FROM_PACK]
    : [...IDENTITY_REPAIR_TYPES];

  for (const row of rows) {
    const slot = String(row.doc_type) as HrDocTypeId;
    if (!focusTypes.includes(slot)) continue;
    if (!row.storage_path) {
      skipped += 1;
      continue;
    }
    if (row.status === 'verified' && !force) {
      skipped += 1;
      continue;
    }
    if (row.status !== 'uploaded' && row.status !== 'verified') {
      skipped += 1;
      continue;
    }

    try {
      const dl = await sb.storage.from(HR_DOCS_BUCKET).download(row.storage_path);
      if (dl.error || !dl.data) {
        skipped += 1;
        continue;
      }
      const buf = Buffer.from(await dl.data.arrayBuffer());
      if (buf.length < 5 || buf.subarray(0, 4).toString() !== '%PDF') {
        skipped += 1;
        continue;
      }
      const classification = await classifyPdfBuffer(buf);
      const detected = resolveDetectedType(classification);
      if (!detected || !REQUIRED_FROM_PACK.includes(detected)) {
        skipped += 1;
        continue;
      }
      candidates.push({
        id: String(row.id),
        slot,
        path: row.storage_path,
        status: String(row.status || ''),
        buf,
        detected,
        score: classification.scores[detected] || 0,
        classification,
      });
    } catch {
      skipped += 1;
    }
  }

  const mismatched = candidates.filter((c) => c.slot !== c.detected);
  if (!mismatched.length) {
    // Evita OCR en cada apertura de perfil una vez el contenido cuadra.
    for (const c of candidates) {
      const row = rows.find((r) => String(r.id) === c.id);
      const notes = String(row?.notes || '');
      const low = notes.toLowerCase();
      if (notesAlreadyIdentityChecked(notes) || low.includes(IDENTITY_CONTENT_OK)) {
        continue;
      }
      if (
        IDENTITY_REPAIR_TYPES.includes(c.slot) &&
        !notesSuggestPackSplit(notes) &&
        !/(?:^|\/)(?:ine|acta_nacimiento|curp|comprobante_domicilio)-exp-\d+\./i.test(
          c.path
        )
      ) {
        continue;
      }
      const mark = IDENTITY_CONTENT_OK;
      try {
        await sb
          .from('hr_employee_documents')
          .update({
            notes: notes ? `${notes} · ${mark}` : mark,
            updated_at: new Date().toISOString(),
          })
          .eq('id', c.id);
      } catch {
        /* best-effort */
      }
    }
    return { imported: 0, skipped, repaired: false, swaps: [] };
  }

  // Mejor buffer por tipo detectado.
  const bestByType = new Map<HrDocTypeId, Cand>();
  for (const c of candidates) {
    const prev = bestByType.get(c.detected);
    if (!prev || c.score > prev.score) bestByType.set(c.detected, c);
  }

  const swaps: Array<{ from: string; to: string }> = [];
  let imported = 0;
  const filled = new Set<HrDocTypeId>();

  for (const docType of focusTypes) {
    const best = bestByType.get(docType);
    if (!best) continue;

    const target = rows.find((r) => String(r.doc_type) === docType);
    if (!target) continue;
    if (target.status === 'verified' && !force) continue;

    // Ya está bien en su slot.
    if (best.slot === docType && best.path === target.storage_path) {
      filled.add(docType);
      continue;
    }

    try {
      const res = await uploadAndLink({
        employeeId: opts.employeeId,
        docType,
        localPath: '',
        fileName: `${docType}-reclassified.pdf`,
        buf: best.buf,
        mime: 'application/pdf',
        who,
        force: true,
        allowReplaceShared: true,
        notes: `Reclasificado por contenido (${best.classification.method}): era ${best.slot}`,
      });
      if (res !== 'skipped') {
        imported += 1;
        filled.add(docType);
        if (best.slot !== docType) {
          swaps.push({ from: best.slot, to: docType });
        }
      }
    } catch {
      skipped += 1;
    }
  }

  // Vaciar slots que aún tienen contenido de otro tipo (p. ej. acta con CURP
  // cuando CURP ya tiene su copia correcta).
  const { data: afterRows } = await sb
    .from('hr_employee_documents')
    .select('id, doc_type, storage_path, status')
    .eq('employee_id', opts.employeeId);

  for (const row of afterRows || []) {
    const dt = String(row.doc_type) as HrDocTypeId;
    if (!focusTypes.includes(dt)) continue;
    if (!row.storage_path) continue;
    if (row.status === 'verified' && !force) continue;

    try {
      const dl = await sb.storage.from(HR_DOCS_BUCKET).download(row.storage_path);
      if (dl.error || !dl.data) continue;
      const buf = Buffer.from(await dl.data.arrayBuffer());
      if (buf.subarray(0, 4).toString() !== '%PDF') continue;
      const classification = await classifyPdfBuffer(buf);
      const detected = resolveDetectedType(classification);
      if (!detected || detected === dt) continue;

      const correctHasFile = (afterRows || []).some(
        (r) =>
          String(r.doc_type) === detected &&
          r.storage_path &&
          r.storage_path !== row.storage_path
      );

      if (correctHasFile || filled.has(detected)) {
        await clearDocFile({
          employeeId: opts.employeeId,
          docType: dt,
          who,
          existingId: String(row.id),
          oldPath: row.storage_path,
        });
        swaps.push({ from: dt, to: `(cleared→${detected})` });
        imported += 1;
      } else {
        await uploadAndLink({
          employeeId: opts.employeeId,
          docType: detected,
          localPath: '',
          fileName: `${detected}-reclassified.pdf`,
          buf,
          mime: 'application/pdf',
          who,
          force: true,
          allowReplaceShared: true,
          notes: `Reclasificado por contenido: movido desde ${dt}`,
        });
        await clearDocFile({
          employeeId: opts.employeeId,
          docType: dt,
          who,
          existingId: String(row.id),
          oldPath: row.storage_path,
        });
        swaps.push({ from: dt, to: detected });
        imported += 1;
        filled.add(detected);
      }
    } catch {
      /* best-effort */
    }
  }

  return {
    imported,
    skipped,
    repaired: imported > 0,
    swaps,
  };
}


/**
 * Resuelve carpeta de expediente: `drive_folder_path` o match en Altas/Bajas.
 * Si encuentra match auto-link: persiste path (si faltaba) y corrige
 * `full_name` a «nombres + un apellido» desde el basename de carpeta.
 */
export async function resolveExpedienteFolder(opts: {
  employeeId: string;
  fullName: string;
  driveFolderPath?: string | null;
  /** Si true, también reescribe full_name desde carpeta (default true). */
  syncName?: boolean;
}): Promise<string | null> {
  const existing = (opts.driveFolderPath || '').trim();
  const syncName = opts.syncName !== false;
  if (
    existing &&
    localDriveFsEnabled() &&
    isUnderHrRoot(existing) &&
    existsSync(existing)
  ) {
    if (syncName) {
      await syncEmployeeNameFromFolder(opts.employeeId, existing, opts.fullName);
    }
    return existing;
  }
  if (!localDriveFsEnabled()) return existing || null;

  const buckets = [
    path.join(HR_EXPEDIENTES_DIR, 'Altas'),
    path.join(HR_EXPEDIENTES_DIR, 'Bajas'),
  ];
  const candidate = {
    id: opts.employeeId,
    full_name: opts.fullName,
    aliases: existing
      ? [folderBasenameFromPath(existing)].filter(Boolean)
      : undefined,
  };

  for (const bucket of buckets) {
    if (!existsSync(bucket) || !isUnderHrRoot(bucket)) continue;
    try {
      const listed = await listHrFolder(bucket);
      for (const item of listed.items.filter((it) => it.kind === 'folder')) {
        const m = matchPerson(item.name, [candidate]);
        if (
          m.employeeId === opts.employeeId &&
          (m.autoLink ||
            m.confidence === 'exact' ||
            m.confidence === 'high')
        ) {
          try {
            const sb = getServiceSupabase();
            const canonical = canonicalHrEmployeeName(item.name, opts.fullName);
            const pathMissingOrStale =
              !existing ||
              !existsSync(existing) ||
              !isUnderHrRoot(existing);
            const patch: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            };
            if (pathMissingOrStale) patch.drive_folder_path = item.path;
            if (
              syncName &&
              canonical &&
              canonical !== String(opts.fullName || '').replace(/\s+/g, ' ').trim()
            ) {
              patch.full_name = canonical;
            }
            if (Object.keys(patch).length > 1) {
              await sb
                .from('hr_employees')
                .update(patch)
                .eq('id', opts.employeeId);
            }
          } catch {
            /* best-effort */
          }
          return item.path;
        }
      }
    } catch {
      /* next bucket */
    }
  }
  return existing || null;
}

async function syncEmployeeNameFromFolder(
  employeeId: string,
  folderPath: string,
  currentName: string
): Promise<void> {
  const base = folderBasenameFromPath(folderPath);
  if (!base) return;
  const canonical = canonicalHrEmployeeName(base, currentName);
  const cur = String(currentName || '').replace(/\s+/g, ' ').trim();
  if (!canonical || canonical === cur) return;
  try {
    const sb = getServiceSupabase();
    await sb
      .from('hr_employees')
      .update({
        full_name: canonical,
        updated_at: new Date().toISOString(),
      })
      .eq('id', employeeId);
  } catch {
    /* best-effort */
  }
}
