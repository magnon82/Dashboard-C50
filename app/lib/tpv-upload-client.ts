/**
 * Cliente: comprimir fotos TPV antes de POST (límite body Vercel ~4.5 MB)
 * y parsear respuestas que a veces vienen como HTML ("Request Entity Too Large").
 */
import {
  TPV_MIN_BYTES,
  TPV_MIN_LONG_SIDE,
  TPV_MIN_SHARPNESS,
  TPV_UPLOAD_MAX_BYTES,
  TPV_UPLOAD_TARGET_BYTES,
  estimateSharpnessFromImageData,
  validateTpvImageQuality,
} from '@/app/lib/tpv-cortes';

const MAX_EDGE = 2048;

export type PreparedTpvPhoto = {
  file: File;
  width: number;
  height: number;
  sharpness: number;
  previewUrl: string;
};

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error('No se pudo comprimir la foto')),
      'image/jpeg',
      quality
    );
  });
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen'));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Redimensiona (lado largo ≤ 2048) y comprime a JPEG bajo el límite de Vercel.
 * Nitidez se mide sobre la imagen ya comprimida (probe 320px).
 */
export async function prepareTpvPhotoForUpload(
  file: File
): Promise<PreparedTpvPhoto> {
  const img = await loadImageElement(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error('No se pudo leer el tamaño de la foto');
  }

  let scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  let w = Math.max(1, Math.round(srcW * scale));
  let h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('El navegador no soporta canvas para comprimir la foto');
  }

  async function encodeAt(qw: number, qh: number, quality: number) {
    canvas.width = qw;
    canvas.height = qh;
    ctx!.drawImage(img, 0, 0, qw, qh);
    return canvasToJpegBlob(canvas, quality);
  }

  let quality = 0.84;
  let blob = await encodeAt(w, h, quality);

  while (blob.size > TPV_UPLOAD_TARGET_BYTES && quality > 0.55) {
    quality = Math.round((quality - 0.08) * 100) / 100;
    blob = await encodeAt(w, h, quality);
  }

  while (
    blob.size > TPV_UPLOAD_MAX_BYTES &&
    Math.max(w, h) > TPV_MIN_LONG_SIDE + 80
  ) {
    w = Math.max(1, Math.round(w * 0.85));
    h = Math.max(1, Math.round(h * 0.85));
    if (Math.max(w, h) < TPV_MIN_LONG_SIDE) {
      const boost = TPV_MIN_LONG_SIDE / Math.max(w, h);
      w = Math.round(w * boost);
      h = Math.round(h * boost);
      blob = await encodeAt(w, h, Math.max(0.5, quality - 0.1));
      break;
    }
    blob = await encodeAt(w, h, Math.max(0.55, quality));
  }

  if (blob.size > TPV_UPLOAD_MAX_BYTES) {
    throw new Error(
      'Foto demasiado grande incluso comprimida. Aléjate un poco del ticket y vuelve a tomar la foto.'
    );
  }
  if (blob.size < TPV_MIN_BYTES) {
    throw new Error(
      'La foto quedó demasiado comprimida. Vuelve a tomar la foto con mejor luz.'
    );
  }

  const outName = (file.name || 'corte-tpv.jpg').replace(
    /\.(heic|heif|png|webp|jpe?g)$/i,
    '.jpg'
  );
  const outFile = new File(
    [blob],
    outName.endsWith('.jpg') ? outName : `${outName}.jpg`,
    { type: 'image/jpeg', lastModified: Date.now() }
  );

  // Nitidez sobre probe de la imagen ya dibujada
  const maxProbe = 320;
  const pScale = Math.min(1, maxProbe / Math.max(w, h));
  const pw = Math.max(8, Math.round(w * pScale));
  const ph = Math.max(8, Math.round(h * pScale));
  canvas.width = pw;
  canvas.height = ph;
  ctx.drawImage(img, 0, 0, pw, ph);
  const sharpness = estimateSharpnessFromImageData(
    ctx.getImageData(0, 0, pw, ph)
  );

  const qualityCheck = validateTpvImageQuality({
    width: w,
    height: h,
    byteSize: outFile.size,
    sharpness,
  });
  if (!qualityCheck.ok) {
    throw new Error(qualityCheck.errors.join(' '));
  }
  if (sharpness < TPV_MIN_SHARPNESS) {
    throw new Error(
      'La foto se ve borrosa o fuera de foco. Enfoca el ticket del TPV y vuelve a tomar la foto.'
    );
  }

  return {
    file: outFile,
    width: w,
    height: h,
    sharpness,
    previewUrl: URL.createObjectURL(outFile),
  };
}

const TOO_LARGE_MSG =
  'Foto demasiado grande para el servidor. Cierra y vuelve a abrir la app (o actualiza la página), toma de nuevo la foto y súbela: se comprimirá sola. Si sigue fallando, aléjate un poco del ticket.';

/**
 * Lee JSON de la API; si Vercel/proxy devolvió HTML 413 u otro texto, mensaje claro en español.
 */
export async function readTpvApiJson(
  res: Response
): Promise<Record<string, unknown>> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    if (res.status === 413) {
      throw new Error(TOO_LARGE_MSG);
    }
    return {};
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    if (
      res.status === 413 ||
      /request entity too large/i.test(trimmed) ||
      /^Request En/i.test(trimmed)
    ) {
      throw new Error(TOO_LARGE_MSG);
    }
    const snippet = trimmed.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(
      res.ok
        ? `Respuesta inválida del servidor: ${snippet}`
        : `Error del servidor (${res.status}): ${snippet}`
    );
  }
}
