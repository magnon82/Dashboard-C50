'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminHrPuestosMap } from '@/app/components/AdminHrPuestosMap';
import {
  ADMIN_STORAGE_PLATFORMS,
  ALL_SOURCE_FILES,
  resourceBranchSearchText,
  SOURCE_FILE_UPDATE,
  type ResourceBranch,
  type ResourceItemKind,
  type ResourceLeaf,
  type ResourcePlatform,
  type ResourcePlatformId,
} from '@/app/lib/admin-resources';
import {
  formatBytesEs,
  type DataInventoryResult,
  type DetectedSourceFile,
  type DrivePathStat,
  type SourceFileMergeStatus,
  type StorageStatsResult,
} from '@/app/lib/storage-format';
import {
  formatTimestampCdmxShort,
  lastUpdateForInventoryBranch,
  type AreaLastUpdate,
} from '@/app/lib/admin-last-updates';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

const KIND_LABEL: Record<ResourceItemKind, string> = {
  source_file: 'source_file',
  path: 'ruta',
  script: 'script',
  route: 'ruta UI',
  workflow: 'workflow',
  file: 'archivo',
};

const STATUS_LABEL: Record<SourceFileMergeStatus, string> = {
  detectado: 'Detectado',
  sin_datos: 'Sin datos aún',
  no_documentado: 'Sin documentar',
  desconocido: 'Sin medición',
};

function statusStyle(status: SourceFileMergeStatus): { background: string; color: string } {
  switch (status) {
    case 'detectado':
      return { background: '#E7F6EE', color: '#1F6B45' };
    case 'sin_datos':
      return { background: '#F1F5F9', color: '#64748B' };
    case 'no_documentado':
      return { background: '#FFF3E0', color: '#B45309' };
    case 'desconocido':
      return { background: '#EEF2FF', color: '#4338CA' };
  }
}

function mergeStatusFor(
  sourceFile: string,
  documented: Set<string>,
  detected: Map<string, DetectedSourceFile>,
  detectionReady: boolean,
): SourceFileMergeStatus {
  const hit = detected.get(sourceFile);
  const isDoc = documented.has(sourceFile);
  if (!detectionReady) return 'desconocido';
  if (hit && hit.rowCount > 0) {
    return isDoc ? 'detectado' : 'no_documentado';
  }
  if (isDoc) return 'sin_datos';
  return 'no_documentado';
}

function StatusBadge({ status }: { status: SourceFileMergeStatus }) {
  const style = statusStyle(status);
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
      style={style}
      title={
        status === 'detectado'
          ? 'Documentado y presente en Supabase'
          : status === 'sin_datos'
            ? 'Documentado en código, sin filas aún'
            : status === 'no_documentado'
              ? 'Presente en Supabase, falta documentar en admin-resources.ts'
              : 'No se pudo medir detección'
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function PlatformIcon({ id, size = 18 }: { id: ResourcePlatformId; size?: number }) {
  const s = size;
  const common = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none' as const, 'aria-hidden': true };
  switch (id) {
    case 'supabase':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6.5" rx="7" ry="3" fill={SUITE.orange} />
          <path
            d="M5 6.5v8c0 2.2 3.1 4 7 4s7-1.8 7-4v-8"
            stroke={SUITE.orangeDeep}
            strokeWidth="1.6"
            fill={SUITE.orangeSoft}
          />
          <ellipse cx="12" cy="6.5" rx="7" ry="3" stroke={SUITE.orangeDeep} strokeWidth="1.4" fill="none" />
        </svg>
      );
    case 'drive':
      return (
        <svg {...common}>
          <path
            d="M4 18.5V8.2c0-.7.5-1.2 1.2-1.2h5.1L12 9h6.8c.7 0 1.2.5 1.2 1.2v8.3c0 .7-.5 1.2-1.2 1.2H5.2c-.7 0-1.2-.5-1.2-1.2Z"
            fill={SUITE.orangeSoft}
            stroke={SUITE.navy}
            strokeWidth="1.5"
          />
          <path d="M4 11h16" stroke={SUITE.navy} strokeWidth="1.3" opacity="0.35" />
        </svg>
      );
    case 'gmail':
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" fill={SUITE.orangeSoft} stroke={SUITE.navy} strokeWidth="1.5" />
          <path d="M4 7.5 12 13l8-5.5" stroke={SUITE.orangeDeep} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case 'repo':
      return (
        <svg {...common}>
          <circle cx="8" cy="6" r="2.2" fill={SUITE.navy} />
          <circle cx="8" cy="18" r="2.2" fill={SUITE.navy} />
          <circle cx="16.5" cy="12" r="2.2" fill={SUITE.orange} />
          <path d="M8 8.2v7.6M8 12h6.2" stroke={SUITE.navy} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'vercel':
      return (
        <svg {...common}>
          <path d="M12 4.5 20 19.5H4L12 4.5Z" fill={SUITE.navy} />
          <path d="M12 9.5 16.8 18H7.2L12 9.5Z" fill={SUITE.orange} opacity="0.9" />
        </svg>
      );
    default:
      return null;
  }
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0 transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path
        d="M4 6.2 8 10l4-3.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function useCopyFeedback() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  }

  return { copied, copy };
}

function CopyChip({
  label,
  value,
  kind,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  kind?: ResourceItemKind;
  copied: string | null;
  onCopy: (v: string) => void;
}) {
  const isPathLike =
    kind === 'path' || kind === 'file' || kind === 'route';

  if (isPathLike) {
    return (
      <code
        className="inline-flex max-w-full truncate rounded-md border px-2 py-1 font-mono text-[11px] font-medium"
        style={{
          borderColor: SUITE.border,
          background: '#F4F6F9',
          color: SUITE.navy,
        }}
        title={label}
      >
        {label}
      </code>
    );
  }

  const isCopied = copied === value;
  const title =
    kind === 'source_file'
      ? 'Copiar source_file'
      : 'Copiar';

  return (
    <button
      type="button"
      title={title}
      onClick={() => onCopy(value)}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] font-medium transition-colors duration-150"
      style={{
        borderColor: isCopied ? SUITE.orange : SUITE.border,
        background: isCopied ? SUITE.orangeSoft : '#F4F6F9',
        color: SUITE.navy,
      }}
    >
      <code className="truncate font-mono text-[11px]">{label}</code>
      <span
        className="shrink-0 text-[10px] font-semibold uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: isCopied ? SUITE.orangeDeep : SUITE.muted, opacity: isCopied ? 1 : undefined }}
      >
        {isCopied ? 'Listo' : 'Copiar'}
      </span>
    </button>
  );
}

function DetectionMeta({
  hit,
  status,
}: {
  hit?: DetectedSourceFile;
  status?: SourceFileMergeStatus;
}) {
  if (!status) return null;
  const ingestLabel = hit?.lastIngestedAt
    ? formatTimestampCdmxShort(hit.lastIngestedAt)
    : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge status={status} />
      {hit && hit.rowCount > 0 ? (
        <span className="text-[10px] tabular-nums" style={{ color: theme.muted }}>
          {hit.rowCount.toLocaleString('es-MX')} fila{hit.rowCount === 1 ? '' : 's'}
          {ingestLabel
            ? ` · últ. act. ${ingestLabel}`
            : hit.lastDate
              ? ` · dato ${hit.lastDate}`
              : ''}
        </span>
      ) : null}
    </span>
  );
}

function ChipSection({
  title,
  items,
  kind,
  copied,
  onCopy,
  documentedSet,
  detectedMap,
  detectionReady,
}: {
  title: string;
  items: string[];
  kind: ResourceItemKind;
  copied: string | null;
  onCopy: (v: string) => void;
  documentedSet?: Set<string>;
  detectedMap?: Map<string, DetectedSourceFile>;
  detectionReady?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const freq = kind === 'source_file' ? SOURCE_FILE_UPDATE[item] : undefined;
          const status =
            kind === 'source_file' && documentedSet && detectedMap
              ? mergeStatusFor(item, documentedSet, detectedMap, Boolean(detectionReady))
              : undefined;
          const hit = detectedMap?.get(item);
          return (
            <span key={`${kind}-${item}`} className="inline-flex max-w-full flex-wrap items-center gap-1">
              <CopyChip label={item} value={item} kind={kind} copied={copied} onCopy={onCopy} />
              {status ? <DetectionMeta hit={hit} status={status} /> : null}
              {freq ? (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: '#E8EEF7', color: SUITE.navySoft }}
                >
                  {freq}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LeafRow({
  leaf,
  copied,
  onCopy,
  documentedSet,
  detectedMap,
  detectionReady,
}: {
  leaf: ResourceLeaf;
  copied: string | null;
  onCopy: (v: string) => void;
  documentedSet?: Set<string>;
  detectedMap?: Map<string, DetectedSourceFile>;
  detectionReady?: boolean;
}) {
  const kind = leaf.kind ?? 'file';
  const value = leaf.copyValue ?? leaf.label;
  const sourceKey = kind === 'source_file' ? value : null;
  const status =
    sourceKey && documentedSet && detectedMap
      ? mergeStatusFor(sourceKey, documentedSet, detectedMap, Boolean(detectionReady))
      : undefined;
  const hit = sourceKey ? detectedMap?.get(sourceKey) : undefined;
  const softEmpty = status === 'sin_datos';

  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      style={{ opacity: softEmpty ? 0.72 : 1 }}
    >
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ background: SUITE.orangeSoft, color: SUITE.orangeDeep }}
      >
        {KIND_LABEL[kind]}
      </span>
      <CopyChip label={leaf.label} value={value} kind={kind} copied={copied} onCopy={onCopy} />
      {status ? <DetectionMeta hit={hit} status={status} /> : null}
      {leaf.updateFrequency ? (
        <span
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: '#E8EEF7', color: SUITE.navySoft }}
          title="Actualización"
        >
          {leaf.updateFrequency}
        </span>
      ) : null}
      {leaf.note ? (
        <span className="text-xs" style={{ color: theme.muted }}>
          {leaf.note}
        </span>
      ) : null}
    </li>
  );
}

function ResourceAccordion({
  branch,
  platform,
  defaultOpen,
  showPlatformBadge,
  copied,
  onCopy,
  driveStat,
  documentedSet,
  detectedMap,
  detectionReady,
  accentUndocumented,
  areaLast,
}: {
  branch: ResourceBranch;
  platform: ResourcePlatform;
  defaultOpen?: boolean;
  showPlatformBadge?: boolean;
  copied: string | null;
  onCopy: (v: string) => void;
  driveStat?: DrivePathStat | null;
  documentedSet?: Set<string>;
  detectedMap?: Map<string, DetectedSourceFile>;
  detectionReady?: boolean;
  accentUndocumented?: boolean;
  areaLast?: AreaLastUpdate | null;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const showHrPuestosMap = branch.id === 'drive-rh';
  const hasDetail =
    Boolean(branch.note) ||
    Boolean(branch.updateFrequency) ||
    Boolean(areaLast) ||
    Boolean(branch.leaves?.length) ||
    Boolean(branch.sourceFiles?.length) ||
    Boolean(branch.scripts?.length) ||
    Boolean(branch.routes?.length) ||
    Boolean(driveStat) ||
    showHrPuestosMap;

  const sizeLabel =
    platform.id === 'drive' && driveStat
      ? driveStat.available
        ? formatBytesEs(driveStat.bytes)
        : 'no disponible'
      : null;

  return (
    <div
      className="overflow-hidden rounded-xl border bg-white transition-shadow duration-200 hover:shadow-sm"
      style={{
        borderColor: accentUndocumented
          ? 'rgba(180, 83, 9, 0.45)'
          : open
            ? 'rgba(232, 163, 23, 0.45)'
            : SUITE.border,
        boxShadow: open ? '0 4px 16px rgba(27, 42, 74, 0.06)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150"
        style={{ background: open ? (accentUndocumented ? '#FFF8F0' : '#FFFBF3') : undefined }}
        aria-expanded={open}
      >
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: open ? SUITE.orangeSoft : '#F1F5F9' }}
        >
          <PlatformIcon id={platform.id} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold" style={{ color: SUITE.navy }}>
              {branch.label}
            </span>
            {accentUndocumented ? <StatusBadge status="no_documentado" /> : null}
            {sizeLabel ? (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                style={{ background: SUITE.orangeSoft, color: SUITE.orangeDeep }}
                title={
                  driveStat?.available
                    ? `${driveStat.fileCount.toLocaleString('es-MX')} archivo${driveStat.fileCount === 1 ? '' : 's'}`
                    : driveStat?.message
                }
              >
                {sizeLabel}
              </span>
            ) : null}
            {showPlatformBadge ? (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: '#E8EEF7', color: SUITE.navySoft }}
              >
                {platform.title}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs leading-snug" style={{ color: theme.muted }}>
            {branch.role}
          </span>
          {branch.updateFrequency ? (
            <span className="mt-1 block text-[11px] leading-snug">
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Actualización:{' '}
              </span>
              <span style={{ color: SUITE.orangeDeep }}>{branch.updateFrequency}</span>
            </span>
          ) : null}
          {areaLast ? (
            <span className="mt-0.5 block text-[11px] leading-snug font-semibold" style={{ color: SUITE.orangeDeep }}>
              {areaLast.display}
            </span>
          ) : null}
        </span>
        <span className="mt-1" style={{ color: open ? SUITE.orangeDeep : theme.muted }}>
          <Chevron open={open} />
        </span>
      </button>

      {open && hasDetail ? (
        <div className="space-y-3 border-t px-4 py-3.5" style={{ borderColor: SUITE.border, background: '#FCFDFE' }}>
          {branch.updateFrequency ? (
            <p className="text-xs" style={{ color: theme.muted }}>
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Actualización:{' '}
              </span>
              <span className="font-semibold" style={{ color: SUITE.orangeDeep }}>
                {branch.updateFrequency}
              </span>
            </p>
          ) : null}
          {areaLast ? (
            <p className="text-xs font-semibold" style={{ color: SUITE.orangeDeep }}>
              {areaLast.display}
            </p>
          ) : null}

          {branch.note ? (
            <p className="text-xs" style={{ color: theme.muted }}>
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Ubicación:{' '}
              </span>
              <code className="rounded bg-[#F4F6F9] px-1.5 py-0.5 font-mono text-[11px]" style={{ color: SUITE.navy }}>
                {branch.note}
              </code>
            </p>
          ) : null}

          {driveStat ? (
            <p className="text-xs" style={{ color: theme.muted }}>
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Peso en disco:{' '}
              </span>
              {driveStat.available ? (
                <>
                  <span className="tabular-nums font-semibold" style={{ color: SUITE.orangeDeep }}>
                    {formatBytesEs(driveStat.bytes)}
                  </span>
                  <span className="ml-1">
                    · {driveStat.fileCount.toLocaleString('es-MX')} archivo
                    {driveStat.fileCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <span>{driveStat.message ?? 'no disponible en este servidor'}</span>
              )}
            </p>
          ) : null}

          {branch.leaves?.length ? (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: theme.muted }}>
                Detalle
              </p>
              <ul className="space-y-2">
                {branch.leaves.map((leaf) => (
                  <LeafRow
                    key={leaf.label}
                    leaf={leaf}
                    copied={copied}
                    onCopy={onCopy}
                    documentedSet={documentedSet}
                    detectedMap={detectedMap}
                    detectionReady={detectionReady}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {showHrPuestosMap ? <AdminHrPuestosMap /> : null}

          <ChipSection
            title="source_file"
            items={branch.sourceFiles ?? []}
            kind="source_file"
            copied={copied}
            onCopy={onCopy}
            documentedSet={documentedSet}
            detectedMap={detectedMap}
            detectionReady={detectionReady}
          />
          <ChipSection
            title="Scripts"
            items={branch.scripts ?? []}
            kind="script"
            copied={copied}
            onCopy={onCopy}
          />
          <ChipSection
            title="Rutas UI / API"
            items={branch.routes ?? []}
            kind="route"
            copied={copied}
            onCopy={onCopy}
          />
        </div>
      ) : null}
    </div>
  );
}

function inventoryToStorageStats(inv: DataInventoryResult): StorageStatsResult {
  return {
    supabaseBytes: inv.sizes.supabaseBytes,
    supabaseMethod: inv.sizes.supabaseMethod,
    supabaseRowCount: inv.sizes.supabaseRowCount,
    supabaseError: inv.sizes.supabaseError,
    driveBytes: inv.sizes.driveBytes,
    driveAvailable: inv.sizes.driveAvailable,
    driveMessage: inv.sizes.driveMessage,
    driveByPath: inv.driveFolders,
    detectedSourceFiles: inv.detectedSourceFiles,
    detectedSourceFilesError: inv.detectedSourceFilesError,
  };
}

export function AdminAlmacenamientoRecursos() {
  const [open, setOpen] = useState(false);
  const [platformId, setPlatformId] = useState<ResourcePlatformId>('supabase');
  const [query, setQuery] = useState('');
  const { copied, copy } = useCopyFeedback();

  const [storageStats, setStorageStats] = useState<StorageStatsResult | null>(null);
  const [areaLastUpdates, setAreaLastUpdates] = useState<AreaLastUpdate[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    let cancelled = false;
    fetchedRef.current = true;
    setStorageLoading(true);
    setStorageError(null);

    fetch('/api/admin/data-inventory')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === 'string' ? data.error : `Error ${res.status}`,
          );
        }
        return data as DataInventoryResult;
      })
      .then((data) => {
        if (!cancelled) {
          setStorageStats(inventoryToStorageStats(data));
          setAreaLastUpdates(
            Array.isArray(data.areaLastUpdates) ? data.areaLastUpdates : [],
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStorageError(err instanceof Error ? err.message : 'No se pudo cargar el inventario');
          fetchedRef.current = false;
        }
      })
      .finally(() => {
        if (!cancelled) setStorageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const documentedSet = useMemo(() => new Set(ALL_SOURCE_FILES), []);

  const detectedMap = useMemo(() => {
    const map = new Map<string, DetectedSourceFile>();
    for (const row of storageStats?.detectedSourceFiles ?? []) {
      map.set(row.sourceFile, row);
    }
    return map;
  }, [storageStats]);

  /** true si ya hay agregación usable (RPC ok, vacío ok, o fallback con filas). */
  const detectionReady = Boolean(
    storageStats &&
      ((storageStats.detectedSourceFiles?.length ?? 0) > 0 ||
        !storageStats.detectedSourceFilesError),
  );

  const undocumentedSources = useMemo(() => {
    const out: DetectedSourceFile[] = [];
    for (const row of storageStats?.detectedSourceFiles ?? []) {
      if (!documentedSet.has(row.sourceFile) && row.rowCount > 0) {
        out.push(row);
      }
    }
    return out;
  }, [documentedSet, storageStats]);

  const platforms = useMemo((): ResourcePlatform[] => {
    return ADMIN_STORAGE_PLATFORMS.map((platform) => {
      if (platform.id !== 'supabase' || undocumentedSources.length === 0) {
        return platform;
      }
      const extraBranch: ResourceBranch = {
        id: 'supabase-undocumented',
        label: 'Detectados (sin documentar)',
        role: 'source_file presentes en Supabase que aún no están en admin-resources.ts.',
        updateFrequency: 'Detección en vivo · documentar al confirmar el ingest',
        leaves: undocumentedSources.map((s) => ({
          label: s.sourceFile,
          kind: 'source_file' as const,
          note: `${s.rowCount.toLocaleString('es-MX')} fila${s.rowCount === 1 ? '' : 's'}${
            s.lastIngestedAt
              ? ` · últ. act. ${formatTimestampCdmxShort(s.lastIngestedAt)}`
              : s.lastDate
                ? ` · dato ${s.lastDate}`
                : ''
          }`,
        })),
        sourceFiles: undocumentedSources.map((s) => s.sourceFile),
      };
      return { ...platform, branches: [...platform.branches, extraBranch] };
    });
  }, [undocumentedSources]);

  const driveStatById = useMemo(() => {
    const map = new Map<string, DrivePathStat>();
    for (const row of storageStats?.driveByPath ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [storageStats]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const activePlatform = useMemo(
    () => platforms.find((p) => p.id === platformId) ?? platforms[0],
    [platformId, platforms],
  );

  const filteredByPlatform = useMemo(() => {
    if (!searching) {
      return activePlatform.branches.map((branch) => ({ platform: activePlatform, branch }));
    }
    const hits: { platform: ResourcePlatform; branch: ResourceBranch }[] = [];
    for (const platform of platforms) {
      for (const branch of platform.branches) {
        if (resourceBranchSearchText(branch).includes(q) || platform.title.toLowerCase().includes(q)) {
          hits.push({ platform, branch });
        }
      }
    }
    return hits;
  }, [activePlatform, platforms, q, searching]);

  const matchCountByPlatform = useMemo(() => {
    if (!searching) return null;
    const counts: Partial<Record<ResourcePlatformId, number>> = {};
    for (const platform of platforms) {
      counts[platform.id] = platform.branches.filter(
        (b) => resourceBranchSearchText(b).includes(q) || platform.title.toLowerCase().includes(q),
      ).length;
    }
    return counts;
  }, [platforms, q, searching]);

  function platformSizeHint(id: ResourcePlatformId): string | null {
    if (storageLoading) return '…';
    if (storageError) return null;
    if (!storageStats) return null;
    if (id === 'supabase') {
      if (storageStats.supabaseBytes == null) return null;
      const label = formatBytesEs(storageStats.supabaseBytes);
      return storageStats.supabaseMethod === 'estimate' ? `~${label}` : label;
    }
    if (id === 'drive') {
      if (!storageStats.driveAvailable || storageStats.driveBytes == null) {
        return 'no disponible';
      }
      return formatBytesEs(storageStats.driveBytes);
    }
    return null;
  }

  const headerSizeHint = !searching ? platformSizeHint(activePlatform.id) : null;

  const detectSummary = useMemo(() => {
    if (!storageStats) return null;
    let detectado = 0;
    let sinDatos = 0;
    for (const sf of ALL_SOURCE_FILES) {
      const st = mergeStatusFor(sf, documentedSet, detectedMap, detectionReady);
      if (st === 'detectado') detectado += 1;
      if (st === 'sin_datos') sinDatos += 1;
    }
    return {
      detectado,
      sinDatos,
      noDocumentado: undocumentedSources.length,
    };
  }, [detectionReady, detectedMap, documentedSet, storageStats, undocumentedSources.length]);

  return (
    <section
      className="mb-8 overflow-hidden rounded-[20px] bg-white"
      style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${SUITE.orange}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold" style={{ color: theme.title }}>
            Inventario de datos
          </h2>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: theme.muted }}>
            Dónde vive cada dato: metadatos curados + detección en vivo (Supabase source_file y
            carpetas Drive). El mapa de arriba es arquitectura; aquí consultas, estados y copias.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: SUITE.navy }}
        >
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-slate-100 px-5 py-4">
          {/* Search */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.5" stroke={SUITE.muted} strokeWidth="1.5" />
              <path d="M10.5 10.5 13.5 13.5" stroke={SUITE.muted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar source_file, ruta, script…"
              className="w-full rounded-xl border bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(232,163,23,0.25)]"
              style={{ borderColor: SUITE.border, color: SUITE.navy }}
              aria-label="Buscar recursos"
            />
          </div>

          {/* Platform segmented control */}
          <div
            className="flex flex-wrap gap-1.5 rounded-xl p-1.5"
            style={{ background: '#F1F5F9' }}
            role="tablist"
            aria-label="Plataforma"
          >
            {platforms.map((p) => {
              const selected = !searching && p.id === platformId;
              const hitCount = matchCountByPlatform?.[p.id] ?? 0;
              const dimSearch = searching && hitCount === 0;
              const tabSize = platformSizeHint(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setPlatformId(p.id);
                    if (searching) setQuery('');
                  }}
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-150"
                  style={{
                    background: selected ? SUITE.navy : dimSearch ? 'transparent' : 'transparent',
                    color: selected ? '#fff' : dimSearch ? '#A0AEC0' : SUITE.navy,
                    boxShadow: selected ? '0 2px 8px rgba(27, 42, 74, 0.2)' : undefined,
                    opacity: dimSearch ? 0.55 : 1,
                  }}
                >
                  <PlatformIcon id={p.id} size={16} />
                  <span>{p.title}</span>
                  {searching && hitCount > 0 ? (
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: SUITE.orangeSoft, color: SUITE.orangeDeep }}
                    >
                      {hitCount}
                    </span>
                  ) : null}
                  {!searching && tabSize && (p.id === 'supabase' || p.id === 'drive') ? (
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                      style={{
                        background: selected ? 'rgba(255,255,255,0.18)' : SUITE.orangeSoft,
                        color: selected ? '#fff' : SUITE.orangeDeep,
                      }}
                    >
                      {tabSize}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Leyenda de fusión documentado ↔ detectado */}
          {!searching && activePlatform.id === 'supabase' ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[11px]"
              style={{ background: '#F8FAFC', color: theme.muted }}
            >
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Estado source_file:
              </span>
              <StatusBadge status="detectado" />
              <StatusBadge status="sin_datos" />
              <StatusBadge status="no_documentado" />
              {detectSummary ? (
                <span className="ml-auto tabular-nums font-semibold" style={{ color: SUITE.navySoft }}>
                  {detectSummary.detectado} con datos · {detectSummary.sinDatos} sin datos
                  {detectSummary.noDocumentado > 0
                    ? ` · ${detectSummary.noDocumentado} sin documentar`
                    : ''}
                </span>
              ) : storageLoading ? (
                <span className="ml-auto">Detectando…</span>
              ) : null}
            </div>
          ) : null}

          {/* Active platform blurb (when not searching) */}
          {!searching ? (
            <div className="flex flex-wrap items-start gap-3 rounded-xl px-3.5 py-3" style={{ background: '#F8FAFC' }}>
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: SUITE.orangeSoft }}
              >
                <PlatformIcon id={activePlatform.id} size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
                  {activePlatform.title}
                </p>
                <p className="text-xs leading-snug" style={{ color: theme.muted }}>
                  {activePlatform.role}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: theme.muted }}>
                  {activePlatform.subtitle}
                </p>
                {storageError && (activePlatform.id === 'supabase' || activePlatform.id === 'drive') ? (
                  <p className="mt-1 text-[11px]" style={{ color: '#B45309' }}>
                    Inventario: {storageError}
                  </p>
                ) : null}
                {!storageError &&
                activePlatform.id === 'supabase' &&
                storageStats?.detectedSourceFilesError ? (
                  <p className="mt-1 text-[11px]" style={{ color: '#B45309' }}>
                    Detección source_file: {storageStats.detectedSourceFilesError}
                  </p>
                ) : null}
                {!storageError &&
                activePlatform.id === 'supabase' &&
                storageStats?.supabaseMethod === 'estimate' &&
                storageStats.supabaseBytes != null ? (
                  <p className="mt-1 text-[11px]" style={{ color: theme.muted }}>
                    Estimado por filas
                    {storageStats.supabaseRowCount != null
                      ? ` (${storageStats.supabaseRowCount.toLocaleString('es-MX')} filas)`
                      : ''}
                    {storageStats.supabaseError ? ` · ${storageStats.supabaseError}` : ''}
                    . Para tamaño exacto ejecuta{' '}
                    <code className="text-[10px]">supabase/admin_relation_size.sql</code>.
                  </p>
                ) : null}
                {!storageError &&
                activePlatform.id === 'drive' &&
                storageStats &&
                !storageStats.driveAvailable ? (
                  <p className="mt-1 text-[11px]" style={{ color: theme.muted }}>
                    {storageStats.driveMessage ?? 'no disponible en este servidor'}
                  </p>
                ) : null}
              </div>
              <p
                className="ml-auto flex flex-col items-end gap-0.5 text-[11px] font-semibold"
                style={{ color: SUITE.orangeDeep }}
              >
                <span>
                  {filteredByPlatform.length} grupo{filteredByPlatform.length === 1 ? '' : 's'}
                  {headerSizeHint ? (
                    <span className="tabular-nums">
                      {' '}
                      · {headerSizeHint}
                    </span>
                  ) : storageLoading &&
                    (activePlatform.id === 'supabase' || activePlatform.id === 'drive') ? (
                    <span> · …</span>
                  ) : null}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-xs font-medium" style={{ color: theme.muted }}>
              {filteredByPlatform.length === 0
                ? 'Sin coincidencias.'
                : `${filteredByPlatform.length} resultado${filteredByPlatform.length === 1 ? '' : 's'} en todas las plataformas`}
            </p>
          )}

          {/* Accordion groups */}
          <div className="space-y-2.5">
            {filteredByPlatform.map(({ platform, branch }) => (
              <ResourceAccordion
                key={`${platform.id}-${branch.id}-${searching ? 'q' : 'p'}`}
                platform={platform}
                branch={branch}
                defaultOpen={searching || branch.id === 'supabase-undocumented'}
                showPlatformBadge={searching}
                copied={copied}
                onCopy={copy}
                driveStat={platform.id === 'drive' ? driveStatById.get(branch.id) ?? null : null}
                documentedSet={documentedSet}
                detectedMap={detectedMap}
                detectionReady={detectionReady}
                accentUndocumented={branch.id === 'supabase-undocumented'}
                areaLast={lastUpdateForInventoryBranch(branch.id, areaLastUpdates)}
              />
            ))}
          </div>

          <p className="text-xs leading-relaxed" style={{ color: theme.muted }}>
            Metadatos curados en{' '}
            <code className="text-[11px]">app/lib/admin-resources.ts</code>
            {' '}(labels, frecuencias, paths, scripts). Detección en vivo vía{' '}
            <code className="text-[11px]">/api/admin/data-inventory</code>
            {' '}(DISTINCT source_file + Drive). El mapa de orígenes sigue siendo manual; este
            inventario fusiona documentado + detectado. Haz clic en un chip para copiar.
          </p>
        </div>
      ) : null}
    </section>
  );
}
