/**
 * Prepara capturas de cámara/galería:
 * · escaneo de documentación (alta res, JPEG document-friendly)
 * · fotografía (res típica de foto, sin tratamiento de documento)
 * Sin OCR.
 */

export type HrCaptureMode = 'scan' | 'photo' | 'file';

const SCAN_MAX_EDGE = 2400;
const SCAN_JPEG_QUALITY = 0.88;

const PHOTO_MAX_EDGE = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name) ||
    (file.type === 'application/octet-stream' && /\.pdf$/i.test(file.name))
  );
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
  if (isPdf(file) || !file.type.startsWith('image/')) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const { width, height } = bitmap;
    const long = Math.max(width, height);
    const scale = long > opts.maxEdge ? opts.maxEdge / long : 1;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    if (opts.whiteBackground) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', opts.quality)
    );
    if (!blob) return file;

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
 * Si es imagen: reescala el lado largo a ≤2400px y exporta JPEG (fondo blanco).
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
 * Foto (cámara/galería): reescala ≤1600px, JPEG típico, sin fondo blanco de documento.
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

/** Prepara según modo de captura. `file` (archivo/PDF) no transforma. */
export async function prepareHrCapture(
  file: File,
  mode: HrCaptureMode
): Promise<File> {
  if (mode === 'scan') return prepareDocumentScan(file);
  if (mode === 'photo') return preparePhoto(file);
  return file;
}

/** Etiqueta corta para notes / metadata. */
export function hrCaptureSourceNote(mode: HrCaptureMode): string | null {
  if (mode === 'scan') return 'Escaneo documentación';
  if (mode === 'photo') return 'Fotografía';
  return null;
}
