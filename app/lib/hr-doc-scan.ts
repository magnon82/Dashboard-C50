/**
 * Prepara capturas de cámara/galería:
 * · escaneo de documentación (alta res, JPEG document-friendly)
 * · fotografía (res típica de foto, sin tratamiento de documento)
 * Tope duro: 2.5 MB por foto (cualquier origen). Sin OCR.
 */

import { HR_DOC_PHOTO_MAX_BYTES } from '@/app/lib/hr-doc-limits';

export type HrCaptureMode = 'scan' | 'photo' | 'file';
export { HR_DOC_PHOTO_MAX_BYTES };

const SCAN_MAX_EDGE = 2400;
const SCAN_JPEG_QUALITY = 0.88;

const PHOTO_MAX_EDGE = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

const MIN_EDGE = 720;
const MIN_QUALITY = 0.45;

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name) ||
    (file.type === 'application/octet-stream' && /\.pdf$/i.test(file.name))
  );
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(file.name);
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

async function resizeImageJpeg(
  file: File,
  opts: {
    maxEdge: number;
    quality: number;
    whiteBackground: boolean;
    nameSuffix: string;
  }
): Promise<File> {
  if (isPdf(file) || !isImageFile(file)) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size > HR_DOC_PHOTO_MAX_BYTES) {
      throw new Error(
        'La foto supera 2.5 MB y no se pudo comprimir en este navegador. Usa JPEG/PNG o una foto más liviana.'
      );
    }
    return file;
  }

  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const long = Math.max(srcW, srcH);
    let scale = long > opts.maxEdge ? opts.maxEdge / long : 1;
    let w = Math.max(1, Math.round(srcW * scale));
    let h = Math.max(1, Math.round(srcH * scale));
    let quality = opts.quality;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (file.size > HR_DOC_PHOTO_MAX_BYTES) {
        throw new Error(
          'No se pudo comprimir la foto (canvas). Prueba otra imagen ≤ 2.5 MB.'
        );
      }
      return file;
    }

    const encode = async (qw: number, qh: number, q: number) => {
      canvas.width = qw;
      canvas.height = qh;
      if (opts.whiteBackground) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, qw, qh);
      }
      ctx.drawImage(bitmap, 0, 0, qw, qh);
      return canvasToJpegBlob(canvas, q);
    };

    let blob = await encode(w, h, quality);
    if (!blob) {
      throw new Error('No se pudo preparar la foto');
    }

    while (blob.size > HR_DOC_PHOTO_MAX_BYTES && quality > MIN_QUALITY + 0.01) {
      quality = Math.round((quality - 0.08) * 100) / 100;
      if (quality < MIN_QUALITY) quality = MIN_QUALITY;
      blob = (await encode(w, h, quality)) || blob;
    }

    while (
      blob.size > HR_DOC_PHOTO_MAX_BYTES &&
      Math.max(w, h) > MIN_EDGE + 40
    ) {
      w = Math.max(1, Math.round(w * 0.85));
      h = Math.max(1, Math.round(h * 0.85));
      if (Math.max(w, h) < MIN_EDGE) {
        const boost = MIN_EDGE / Math.max(w, h);
        w = Math.round(w * boost);
        h = Math.round(h * boost);
        blob = (await encode(w, h, Math.max(MIN_QUALITY, quality - 0.05))) || blob;
        break;
      }
      blob = (await encode(w, h, Math.max(MIN_QUALITY, quality))) || blob;
    }

    if (blob.size > HR_DOC_PHOTO_MAX_BYTES) {
      throw new Error(
        'La foto sigue sobre 2.5 MB tras comprimir. Toma otra más cerca/lejos o elige un archivo más liviano.'
      );
    }

    const base = file.name.replace(/\.[^.]+$/, '') || 'captura';
    return new File([blob], `${base}${opts.nameSuffix}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Si es imagen: reescala el lado largo a ≤2400px, JPEG, fondo blanco, ≤2.5 MB.
 * PDF y no-imágenes se dejan igual.
 */
export async function prepareDocumentScan(file: File): Promise<File> {
  return resizeImageJpeg(file, {
    maxEdge: SCAN_MAX_EDGE,
    quality: SCAN_JPEG_QUALITY,
    whiteBackground: true,
    nameSuffix: '-scan',
  });
}

/**
 * Foto (cámara/galería): reescala ≤1600px, JPEG, ≤2.5 MB.
 * PDF y no-imágenes se dejan igual.
 */
export async function preparePhoto(file: File): Promise<File> {
  return resizeImageJpeg(file, {
    maxEdge: PHOTO_MAX_EDGE,
    quality: PHOTO_JPEG_QUALITY,
    whiteBackground: false,
    nameSuffix: '-photo',
  });
}

/**
 * Prepara según modo. Imágenes desde «Archivo»/carpeta también se comprimen
 * a ≤2.5 MB (antes se subían sin tocar).
 */
export async function prepareHrCapture(
  file: File,
  mode: HrCaptureMode
): Promise<File> {
  if (isPdf(file)) return file;
  if (mode === 'scan') return prepareDocumentScan(file);
  if (mode === 'photo') return preparePhoto(file);
  // mode === 'file': imagen de carpeta → mismo tope; PDF ya retornó arriba
  if (isImageFile(file)) return prepareDocumentScan(file);
  return file;
}

/** Etiqueta corta para notes / metadata. */
export function hrCaptureSourceNote(mode: HrCaptureMode): string | null {
  if (mode === 'scan') return 'Escaneo documentación';
  if (mode === 'photo') return 'Fotografía';
  return null;
}

/** True si el MIME/nombre indica imagen (no PDF). */
export function isHrDocImageFile(file: File): boolean {
  return isImageFile(file) && !isPdf(file);
}
