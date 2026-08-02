/**
 * Cola de revisión manual: «¿Qué es este documento?»
 * Páginas del expediente (pack / slots) con baja confianza o conflicto.
 */

import { PDFDocument } from 'pdf-lib';
import {
  HR_DOCS_BUCKET,
  checklistSeedRows,
  docTypeDef,
  type HrDocStatus,
  type HrDocTypeId,
} from '@/app/lib/hr-employee-profile';
import {
  PACK_DOC_ORDER,
  analyzePdfPageSignals,
  detectSharedPackPaths,
  extractPdfPageBytes,
  notesSuggestPackSplit,
  renderPdfPagePreview,
} from '@/app/lib/hr-docs-pack-split';
import { getServiceSupabase } from '@/app/lib/users';

export const REVIEW_DOC_CHOICES: Array<{
  id: HrDocTypeId;
  label: string;
}> = [
  { id: 'ine', label: 'INE' },
  { id: 'acta_nacimiento', label: 'Acta de nacimiento' },
  { id: 'curp', label: 'CURP' },
  { id: 'comprobante_domicilio', label: 'Comprobante de domicilio' },
  { id: 'cv', label: 'CV' },
];

export type DocsReviewAnswer =
  | HrDocTypeId
  | 'omit'
  | 'ignore';

export type DocsReviewMode = 'uncertain' | 'all';

export type DocsReviewItem = {
  id: string;
  storagePath: string;
  pageIndex: number;
  pageCount: number;
  /** Slot(s) del checklist que apuntan a este archivo. */
  currentSlots: HrDocTypeId[];
  suggested: HrDocTypeId | null;
  scores: Partial<Record<HrDocTypeId, number>>;
  method: 'keywords' | 'ocr' | 'empty' | 'heuristic';
  uncertain: boolean;
  reasons: string[];
  textSample: string;
  previewMime: string | null;
  /** data URL si hay raster; si no, el cliente usa viewUrl + página. */
  previewDataUrl: string | null;
  viewUrl: string | null;
};

export type DocsReviewQueue = {
  employeeId: string;
  mode: DocsReviewMode;
  items: DocsReviewItem[];
  uncertainCount: number;
  totalPages: number;
  choices: typeof REVIEW_DOC_CHOICES;
};

function isPackType(dt: string): dt is HrDocTypeId {
  return PACK_DOC_ORDER.includes(dt as HrDocTypeId);
}

function reasonLabels(opts: {
  method: DocsReviewItem['method'];
  conflicted: boolean;
  lowConfidence: boolean;
  shared: boolean;
  heuristicNotes: boolean;
  slotMismatch: boolean;
  empty: boolean;
}): string[] {
  const out: string[] = [];
  if (opts.empty) out.push('Sin texto legible');
  if (opts.conflicted) out.push('Señales mixtas (conflicto)');
  if (opts.lowConfidence && !opts.empty) out.push('Confianza baja');
  if (opts.heuristicNotes) out.push('Clasificación por orden / paquete');
  if (opts.shared) out.push('Mismo archivo en varios tipos');
  if (opts.slotMismatch) out.push('No coincide con el tipo asignado');
  if (opts.method === 'ocr') out.push('Vía OCR');
  return out;
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

async function signedUrl(path: string): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data } = await sb.storage
    .from(HR_DOCS_BUCKET)
    .createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

function toDataUrl(mime: string, bytes: Buffer): string | null {
  // Evitar payloads enormes en JSON (~1.2 MB de base64).
  if (bytes.length > 900_000) return null;
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

type DocRow = {
  id: string;
  doc_type: string;
  storage_path: string | null;
  status: string;
  notes: string | null;
  mime_type: string | null;
};

/**
 * Arma la cola de páginas a revisar para un empleado.
 */
export async function buildDocsReviewQueue(opts: {
  employeeId: string;
  mode?: DocsReviewMode;
  /** Máx. previews raster en la respuesta (el resto solo viewUrl). */
  previewLimit?: number;
}): Promise<DocsReviewQueue> {
  const mode: DocsReviewMode = opts.mode === 'all' ? 'all' : 'uncertain';
  const previewLimit = opts.previewLimit ?? 12;
  const sb = getServiceSupabase();

  await ensureChecklist(opts.employeeId);

  const { data: rows, error } = await sb
    .from('hr_employee_documents')
    .select('id, doc_type, storage_path, status, notes, mime_type')
    .eq('employee_id', opts.employeeId);
  if (error) throw new Error(error.message);

  const packRows = ((rows || []) as DocRow[]).filter(
    (r) => r.storage_path && isPackType(r.doc_type)
  );
  const sharedPaths = new Set(
    detectSharedPackPaths(
      packRows.map((r) => ({
        doc_type: r.doc_type,
        storage_path: r.storage_path,
        status: r.status,
      }))
    )
  );

  const byPath = new Map<string, DocRow[]>();
  for (const r of packRows) {
    const p = r.storage_path!;
    const list = byPath.get(p) || [];
    list.push(r);
    byPath.set(p, list);
  }

  const items: DocsReviewItem[] = [];
  let previewBudget = previewLimit;

  for (const [storagePath, holders] of byPath) {
    const slots = holders
      .map((h) => h.doc_type as HrDocTypeId)
      .filter(isPackType);
    const notesBlob = holders.map((h) => h.notes || '').join(' · ');
    const heuristicNotes =
      notesSuggestPackSplit(notesBlob) ||
      /heuristic|paquete|orden/i.test(notesBlob);
    const shared = sharedPaths.has(storagePath);
    const alreadyManual = /clasificado manualmente/i.test(notesBlob);

    let buf: Buffer;
    try {
      const dl = await sb.storage.from(HR_DOCS_BUCKET).download(storagePath);
      if (dl.error || !dl.data) continue;
      buf = Buffer.from(await dl.data.arrayBuffer());
      if (buf.length < 5 || buf.subarray(0, 4).toString() !== '%PDF') {
        // Imagen suelta: tratar como 1 «página».
        if ((holders[0]?.mime_type || '').startsWith('image/')) {
          const viewUrl = await signedUrl(storagePath);
          const suggested = slots[0] || null;
          const uncertain =
            !alreadyManual && (shared || slots.length !== 1 || heuristicNotes);
          const item: DocsReviewItem = {
            id: `${storagePath}#0`,
            storagePath,
            pageIndex: 0,
            pageCount: 1,
            currentSlots: slots,
            suggested,
            scores: suggested ? { [suggested]: 1 } : {},
            method: 'empty',
            uncertain,
            reasons: reasonLabels({
              method: 'empty',
              conflicted: false,
              lowConfidence: true,
              shared,
              heuristicNotes,
              slotMismatch: false,
              empty: true,
            }),
            textSample: '',
            previewMime: holders[0]?.mime_type || 'image/jpeg',
            previewDataUrl: null,
            viewUrl,
          };
          if (uncertain || mode === 'all') items.push(item);
        }
        continue;
      }
    } catch {
      continue;
    }

    let pageCount = 1;
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      pageCount = src.getPageCount();
    } catch {
      continue;
    }

    const viewUrl = await signedUrl(storagePath);

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      let pageBytes: Uint8Array;
      try {
        pageBytes = await extractPdfPageBytes(buf, pageIndex);
      } catch {
        continue;
      }

      const signals = await analyzePdfPageSignals(pageBytes);
      const method: DocsReviewItem['method'] =
        signals.method === 'empty' && heuristicNotes
          ? 'heuristic'
          : signals.method;

      const primarySlot = slots.length === 1 ? slots[0] : null;
      const slotMismatch = Boolean(
        signals.suggested &&
          primarySlot &&
          signals.suggested !== primarySlot
      );
      const empty = signals.method === 'empty';
      const uncertain =
        !alreadyManual &&
        (empty ||
          signals.conflicted ||
          signals.lowConfidence ||
          shared ||
          heuristicNotes ||
          slotMismatch);

      if (mode === 'uncertain' && !uncertain) continue;

      let previewMime: string | null = null;
      let previewDataUrl: string | null = null;
      if (previewBudget > 0) {
        try {
          const prev = await renderPdfPagePreview(buf, pageIndex);
          if (prev) {
            previewMime = prev.mime;
            previewDataUrl = toDataUrl(prev.mime, prev.bytes);
            if (previewDataUrl) previewBudget -= 1;
          }
        } catch {
          /* sin preview raster */
        }
      }

      items.push({
        id: `${storagePath}#${pageIndex}`,
        storagePath,
        pageIndex,
        pageCount,
        currentSlots: slots,
        suggested: signals.suggested,
        scores: signals.scores,
        method,
        uncertain,
        reasons: reasonLabels({
          method,
          conflicted: signals.conflicted,
          lowConfidence: signals.lowConfidence,
          shared,
          heuristicNotes,
          slotMismatch,
          empty,
        }),
        textSample: signals.textSample,
        previewMime,
        previewDataUrl,
        viewUrl,
      });
    }
  }

  items.sort((a, b) => {
    if (a.uncertain !== b.uncertain) return a.uncertain ? -1 : 1;
    if (a.storagePath !== b.storagePath) {
      return a.storagePath.localeCompare(b.storagePath);
    }
    return a.pageIndex - b.pageIndex;
  });

  const uncertainCount = items.filter((i) => i.uncertain).length;
  return {
    employeeId: opts.employeeId,
    mode,
    items,
    uncertainCount,
    totalPages: items.length,
    choices: REVIEW_DOC_CHOICES,
  };
}

async function clearSlotFile(opts: {
  employeeId: string;
  docType: HrDocTypeId;
  who: string;
}): Promise<void> {
  const sb = getServiceSupabase();
  const { data: existing } = await sb
    .from('hr_employee_documents')
    .select('id, storage_path, status')
    .eq('employee_id', opts.employeeId)
    .eq('doc_type', opts.docType)
    .maybeSingle();
  if (!existing) return;
  if (existing.status === 'verified') return;

  if (existing.storage_path) {
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

  await sb
    .from('hr_employee_documents')
    .update({
      storage_path: null,
      mime_type: null,
      byte_size: null,
      status: 'pending' as HrDocStatus,
      notes: 'Revisión manual: no es documento de alta',
      uploaded_by: opts.who,
      verified_by: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
}

async function uploadPageToSlot(opts: {
  employeeId: string;
  docType: HrDocTypeId;
  pageBytes: Uint8Array;
  who: string;
  note: string;
}): Promise<{ storagePath: string }> {
  const sb = getServiceSupabase();
  const def = docTypeDef(opts.docType);
  if (!def) throw new Error('doc_type inválido');

  await ensureChecklist(opts.employeeId);

  const { data: existing } = await sb
    .from('hr_employee_documents')
    .select('id, storage_path, status')
    .eq('employee_id', opts.employeeId)
    .eq('doc_type', opts.docType)
    .maybeSingle();

  if (existing?.status === 'verified') {
    throw new Error(
      `${def.title} ya está verificado · desverifica o pide a Master forzar`
    );
  }

  const storagePath = `${opts.employeeId}/${opts.docType}-review-${Date.now()}.pdf`;
  const up = await sb.storage.from(HR_DOCS_BUCKET).upload(
    storagePath,
    Buffer.from(opts.pageBytes),
    { contentType: 'application/pdf', upsert: true }
  );
  if (up.error) throw new Error(up.error.message);

  if (existing?.storage_path && existing.storage_path !== storagePath) {
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
    mime_type: 'application/pdf',
    byte_size: opts.pageBytes.byteLength,
    required: def.required,
    status: 'uploaded' as HrDocStatus,
    notes: opts.note,
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
    const { error } = await sb.from('hr_employee_documents').insert({
      ...row,
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  return { storagePath };
}

/**
 * Aplica la respuesta del revisor a una página.
 */
export async function applyDocsReviewAnswer(opts: {
  employeeId: string;
  storagePath: string;
  pageIndex: number;
  answer: DocsReviewAnswer;
  who: string;
}): Promise<{
  ok: true;
  message: string;
  assignedType?: HrDocTypeId;
}> {
  const answer = opts.answer;
  if (answer === 'omit') {
    return { ok: true, message: 'Omitido · pasamos al siguiente' };
  }

  const sb = getServiceSupabase();
  const { data: holders } = await sb
    .from('hr_employee_documents')
    .select('id, doc_type, storage_path, status, notes')
    .eq('employee_id', opts.employeeId)
    .eq('storage_path', opts.storagePath);

  const slots = ((holders || []) as DocRow[])
    .map((h) => h.doc_type as HrDocTypeId)
    .filter(isPackType);

  if (answer === 'ignore') {
    // Si el archivo solo vive en un slot no verificado, vaciarlo.
    const sole = slots.length === 1 ? slots[0] : null;
    if (sole) {
      const row = (holders || []).find((h) => h.doc_type === sole);
      if (row && row.status !== 'verified') {
        let pageCount = 1;
        try {
          const dl = await sb.storage
            .from(HR_DOCS_BUCKET)
            .download(opts.storagePath);
          if (!dl.error && dl.data) {
            const buf = Buffer.from(await dl.data.arrayBuffer());
            if (buf.subarray(0, 4).toString() === '%PDF') {
              const src = await PDFDocument.load(buf, {
                ignoreEncryption: true,
              });
              pageCount = src.getPageCount();
            }
          }
        } catch {
          /* keep 1 */
        }
        if (pageCount <= 1) {
          await clearSlotFile({
            employeeId: opts.employeeId,
            docType: sole,
            who: opts.who,
          });
          return {
            ok: true,
            message: `Marcado: no es documento de alta · se liberó ${docTypeDef(sole)?.title || sole}`,
          };
        }
      }
    }
    return {
      ok: true,
      message:
        'Marcado: no es documento de alta · sin cambios en checklist (archivo multipágina o compartido)',
    };
  }

  if (!isPackType(answer)) {
    throw new Error('Respuesta de tipo inválida');
  }

  const dl = await sb.storage.from(HR_DOCS_BUCKET).download(opts.storagePath);
  if (dl.error || !dl.data) {
    throw new Error('No se pudo leer el archivo fuente');
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  let pageBytes: Uint8Array;
  if (buf.subarray(0, 4).toString() === '%PDF') {
    pageBytes = await extractPdfPageBytes(buf, opts.pageIndex);
  } else {
    // Imagen: convertir no; subir PDF wrapper es complejo — rechazar si no PDF.
    throw new Error('Solo se pueden reclasificar páginas PDF por ahora');
  }

  const label = docTypeDef(answer)?.title || answer;
  await uploadPageToSlot({
    employeeId: opts.employeeId,
    docType: answer,
    pageBytes,
    who: opts.who,
    note: `Clasificado manualmente (revisión p.${opts.pageIndex + 1}) → ${label}`,
  });

  // Si venía de un único slot distinto y era 1 página, limpiar el anterior.
  const sole = slots.length === 1 ? slots[0] : null;
  if (sole && sole !== answer) {
    let pageCount = 1;
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      pageCount = src.getPageCount();
    } catch {
      /* keep */
    }
    if (pageCount <= 1) {
      const still = await sb
        .from('hr_employee_documents')
        .select('id, storage_path')
        .eq('employee_id', opts.employeeId)
        .eq('doc_type', sole)
        .maybeSingle();
      if (
        still.data?.storage_path === opts.storagePath &&
        (holders || []).find((h) => h.doc_type === sole)?.status !== 'verified'
      ) {
        await clearSlotFile({
          employeeId: opts.employeeId,
          docType: sole,
          who: opts.who,
        });
      }
    }
  }

  return {
    ok: true,
    message: `Asignado a ${label}`,
    assignedType: answer,
  };
}
