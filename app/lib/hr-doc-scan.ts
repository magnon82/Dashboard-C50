/**
 * Prepara capturas de cámara/galería como escaneo de documentación
 * (resolución alta, JPEG document-friendly) — no OCR.
 */

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.88;

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    /\.pdf$/i.test(file.name) ||
    (file.type === 'application/octet-stream' && /\.pdf$/i.test(file.name))
  );
}

/**
 * Si es imagen: reescala el lado largo a ≤2400px y exporta JPEG.
 * PDF y no-imágenes se dejan igual.
 */
export async function prepareDocumentScan(file: File): Promise<File> {
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
    const scale = long > MAX_EDGE ? MAX_EDGE / long : 1;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;

    const base = file.name.replace(/\.[^.]+$/, '') || 'documento';
    return new File([blob], `${base}-scan.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
