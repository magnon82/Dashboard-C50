'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ADMIN_STORAGE_PLATFORMS,
  resourceBranchSearchText,
  SOURCE_FILE_UPDATE,
  type ResourceBranch,
  type ResourceItemKind,
  type ResourceLeaf,
  type ResourcePlatform,
  type ResourcePlatformId,
} from '@/app/lib/admin-resources';
import { formatBytesEs, type DrivePathStat, type StorageStatsResult } from '@/app/lib/storage-format';
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
  const isCopied = copied === value;
  const title =
    kind === 'source_file'
      ? 'Copiar source_file'
      : kind === 'path' || kind === 'file'
        ? 'Copiar ruta'
        : kind === 'route'
          ? 'Copiar ruta'
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

function ChipSection({
  title,
  items,
  kind,
  copied,
  onCopy,
}: {
  title: string;
  items: string[];
  kind: ResourceItemKind;
  copied: string | null;
  onCopy: (v: string) => void;
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
          return (
            <span key={`${kind}-${item}`} className="inline-flex max-w-full flex-wrap items-center gap-1">
              <CopyChip label={item} value={item} kind={kind} copied={copied} onCopy={onCopy} />
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
}: {
  leaf: ResourceLeaf;
  copied: string | null;
  onCopy: (v: string) => void;
}) {
  const kind = leaf.kind ?? 'file';
  const value = leaf.copyValue ?? leaf.label;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ background: SUITE.orangeSoft, color: SUITE.orangeDeep }}
      >
        {KIND_LABEL[kind]}
      </span>
      <CopyChip label={leaf.label} value={value} kind={kind} copied={copied} onCopy={onCopy} />
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
}: {
  branch: ResourceBranch;
  platform: ResourcePlatform;
  defaultOpen?: boolean;
  showPlatformBadge?: boolean;
  copied: string | null;
  onCopy: (v: string) => void;
  driveStat?: DrivePathStat | null;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const hasDetail =
    Boolean(branch.note) ||
    Boolean(branch.updateFrequency) ||
    Boolean(branch.leaves?.length) ||
    Boolean(branch.sourceFiles?.length) ||
    Boolean(branch.scripts?.length) ||
    Boolean(branch.routes?.length) ||
    Boolean(driveStat);

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
        borderColor: open ? 'rgba(232, 163, 23, 0.45)' : SUITE.border,
        boxShadow: open ? '0 4px 16px rgba(27, 42, 74, 0.06)' : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150"
        style={{ background: open ? '#FFFBF3' : undefined }}
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

          {branch.note ? (
            <p className="text-xs" style={{ color: theme.muted }}>
              <span className="font-semibold" style={{ color: SUITE.navy }}>
                Ubicación:{' '}
              </span>
              <code className="rounded bg-[#F4F6F9] px-1.5 py-0.5 font-mono text-[11px]" style={{ color: SUITE.navy }}>
                {branch.note}
              </code>
              <button
                type="button"
                className="ml-2 text-[11px] font-semibold"
                style={{ color: SUITE.orangeDeep }}
                onClick={() => onCopy(branch.note!)}
              >
                {copied === branch.note ? 'Copiado' : 'Copiar ruta'}
              </button>
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
                  <LeafRow key={leaf.label} leaf={leaf} copied={copied} onCopy={onCopy} />
                ))}
              </ul>
            </div>
          ) : null}

          <ChipSection
            title="source_file"
            items={branch.sourceFiles ?? []}
            kind="source_file"
            copied={copied}
            onCopy={onCopy}
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

export function AdminAlmacenamientoRecursos() {
  const [open, setOpen] = useState(false);
  const [platformId, setPlatformId] = useState<ResourcePlatformId>('supabase');
  const [query, setQuery] = useState('');
  const { copied, copy } = useCopyFeedback();

  const [storageStats, setStorageStats] = useState<StorageStatsResult | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    let cancelled = false;
    fetchedRef.current = true;
    setStorageLoading(true);
    setStorageError(null);

    fetch('/api/admin/storage-stats')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === 'string' ? data.error : `Error ${res.status}`,
          );
        }
        return data as StorageStatsResult;
      })
      .then((data) => {
        if (!cancelled) setStorageStats(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStorageError(err instanceof Error ? err.message : 'No se pudo cargar el peso');
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
    () => ADMIN_STORAGE_PLATFORMS.find((p) => p.id === platformId) ?? ADMIN_STORAGE_PLATFORMS[0],
    [platformId],
  );

  const filteredByPlatform = useMemo(() => {
    if (!searching) {
      return activePlatform.branches.map((branch) => ({ platform: activePlatform, branch }));
    }
    const hits: { platform: ResourcePlatform; branch: ResourceBranch }[] = [];
    for (const platform of ADMIN_STORAGE_PLATFORMS) {
      for (const branch of platform.branches) {
        if (resourceBranchSearchText(branch).includes(q) || platform.title.toLowerCase().includes(q)) {
          hits.push({ platform, branch });
        }
      }
    }
    return hits;
  }, [activePlatform, q, searching]);

  const matchCountByPlatform = useMemo(() => {
    if (!searching) return null;
    const counts: Partial<Record<ResourcePlatformId, number>> = {};
    for (const platform of ADMIN_STORAGE_PLATFORMS) {
      counts[platform.id] = platform.branches.filter(
        (b) => resourceBranchSearchText(b).includes(q) || platform.title.toLowerCase().includes(q),
      ).length;
    }
    return counts;
  }, [q, searching]);

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
            Dónde vive cada dato: Supabase, Drive/I:, Gmail, repo y rutas en Vercel. El mapa de
            arriba muestra el flujo; aquí consultas y copias rutas o source_file.
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
            {ADMIN_STORAGE_PLATFORMS.map((p) => {
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
                    Peso: {storageError}
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
                defaultOpen={searching}
                showPlatformBadge={searching}
                copied={copied}
                onCopy={copy}
                driveStat={platform.id === 'drive' ? driveStatById.get(branch.id) ?? null : null}
              />
            ))}
          </div>

          <p className="text-xs" style={{ color: theme.muted }}>
            Fuente compartida:{' '}
            <code className="text-[11px]">app/lib/admin-resources.ts</code>
            {' '}· actualiza ahí al agregar orígenes. Haz clic en un chip para copiar.
          </p>
        </div>
      ) : null}
    </section>
  );
}
