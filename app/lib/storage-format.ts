/**
 * Tipos y formato legible de pesos (seguro para cliente y servidor).
 */

export type DrivePathStat = {
  id: string;
  label: string;
  paths: string[];
  bytes: number | null;
  available: boolean;
  fileCount: number;
  message?: string;
};

export type StorageStatsResult = {
  supabaseBytes: number | null;
  supabaseMethod: 'rpc' | 'estimate' | null;
  supabaseRowCount: number | null;
  supabaseError: string | null;
  driveBytes: number | null;
  driveAvailable: boolean;
  driveMessage: string | null;
  driveByPath: DrivePathStat[];
};

/** Formato legible: "345 MB" / "1.2 GB". */
export function formatBytesEs(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    const n = kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10;
    return `${formatNum(n)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    const n = mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${formatNum(n)} MB`;
  }
  const gb = mb / 1024;
  const n = gb >= 10 ? Math.round(gb * 10) / 10 : Math.round(gb * 100) / 100;
  return `${formatNum(n)} GB`;
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const fixed = n.toFixed(n >= 10 ? 1 : 2);
  return fixed.replace(/\.0$/, '').replace(/(\.\d)0$/, '$1');
}
