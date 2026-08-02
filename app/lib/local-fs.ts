/**
 * Detecta si este runtime puede (y debe) sondear discos locales
 * tipo Google Drive File Stream (`I:\Mi unidad\…`).
 *
 * En Vercel / serverless el path local no existe: no bloqueamos la UI
 * ni tratamos `existsSync` fallido como error operativo.
 */

export function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTION_TARGET
  );
}

/**
 * True solo cuando tiene sentido leer File Stream / Descargas locales.
 * - `HR_ALLOW_LOCAL_FS=1` fuerza habilitar (PC de sync / dev con I:\).
 * - `HR_ALLOW_LOCAL_FS=0` fuerza deshabilitar.
 * - En serverless: off salvo opt-in.
 * - En Node local: on por defecto.
 */
export function localDriveFsEnabled(): boolean {
  const flag = process.env.HR_ALLOW_LOCAL_FS?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'on') return true;
  if (isServerlessRuntime()) return false;
  return true;
}

/** URL web de carpeta Drive a partir de un folder ID. */
export function driveFolderWebUrl(
  folderId: string | null | undefined
): string | null {
  const id = (folderId || '').trim();
  if (!id) return null;
  return `https://drive.google.com/drive/folders/${id}`;
}

/** URL web de archivo Drive a partir de un file ID. */
export function driveFileWebUrl(
  fileId: string | null | undefined
): string | null {
  const id = (fileId || '').trim();
  if (!id) return null;
  return `https://drive.google.com/file/d/${id}/view`;
}
