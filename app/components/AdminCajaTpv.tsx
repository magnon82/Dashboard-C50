'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TPV_TERMINALS,
  moneyMx,
  type TpvCorteUpload,
  type TpvTerminalNumber,
} from '@/app/lib/tpv-cortes';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

function formatCorteDateDisplay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

type DayGroup = {
  date: string;
  byTerminal: Map<TpvTerminalNumber, TpvCorteUpload>;
};

function groupByDate(uploads: TpvCorteUpload[]): DayGroup[] {
  const map = new Map<string, Map<TpvTerminalNumber, TpvCorteUpload>>();
  for (const u of uploads) {
    let byT = map.get(u.corte_date);
    if (!byT) {
      byT = new Map();
      map.set(u.corte_date, byT);
    }
    const prev = byT.get(u.terminal_number);
    if (!prev || prev.updated_at < u.updated_at) {
      byT.set(u.terminal_number, u);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, byTerminal]) => ({ date, byTerminal }));
}

function TerminalSlot({
  terminal,
  upload,
}: {
  terminal: TpvTerminalNumber;
  upload: TpvCorteUpload | undefined;
}) {
  if (!upload) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-3">
        <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
          T{terminal}
        </p>
        <p className="mt-1 text-xs text-slate-400">Sin registro</p>
      </div>
    );
  }

  if (upload.entry_kind === 'unused') {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
        <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
          T{terminal}
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-500">No se usó</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {upload.uploader_username}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
            T{terminal}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">
            {upload.uploader_username}
            {upload.status === 'verified' ? ' · verificado' : ''}
          </p>
        </div>
        {upload.image_url ? (
          <a
            href={upload.image_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-bold underline"
            style={{ color: SUITE.orangeDeep }}
          >
            Ver foto
          </a>
        ) : (
          <span className="shrink-0 text-xs text-slate-400">Sin archivo</span>
        )}
      </div>

      {upload.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <a
          href={upload.image_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block overflow-hidden rounded-lg bg-slate-50"
        >
          <img
            src={upload.image_url}
            alt={`Corte T${terminal} · ${upload.corte_date}`}
            className="max-h-36 w-full object-contain"
          />
        </a>
      ) : null}

      <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
        <div>
          <p className="text-slate-400">Cobrado</p>
          <p className="font-semibold text-slate-700">
            {moneyMx(upload.total_cobrado)}
          </p>
        </div>
        <div>
          <p className="text-slate-400">Propina</p>
          <p className="font-semibold text-slate-700">
            {moneyMx(upload.propina)}
          </p>
        </div>
        <div>
          <p className="text-slate-400">Neto</p>
          <p className="font-semibold text-slate-700">
            {moneyMx(upload.neto_banco)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Caja en Master Panel: guía + galería de fotos TPV por fecha. */
export function AdminCajaTpv() {
  const [uploads, setUploads] = useState<TpvCorteUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tpv-cortes?recent=1&urls=1', {
        cache: 'no-store',
      });
      const json = (await res.json()) as {
        error?: string;
        hint?: string;
        uploads?: TpvCorteUpload[];
      };
      if (!res.ok) {
        setError(
          [json.error, json.hint].filter(Boolean).join(' ') ||
            'No se pudieron cargar las fotos de caja'
        );
        setUploads([]);
        return;
      }
      setUploads(json.uploads || []);
    } catch {
      setError('Error de red al cargar fotos de caja');
      setUploads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => groupByDate(uploads), [uploads]);

  return (
    <div className="space-y-4">
      {/* Guía — antes de la galería Caja */}
      <Link
        href="/ventas/corte-tpv/guia"
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold text-white shadow-sm transition-opacity hover:opacity-95"
        style={{ backgroundColor: '#0F9F9C' }}
      >
        Guía de fotografía
      </Link>

      <div
        className="rounded-[24px] border border-slate-100 bg-white p-5"
        style={{ boxShadow: SUITE.shadow, borderTop: `4px solid ${SUITE.navy}` }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: SUITE.navy }}
            >
              Operación · Caja
            </p>
            <h3 className="mt-1 text-lg font-bold" style={{ color: theme.title }}>
              Caja · fotos TPV
            </h3>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              Cortes de terminales T1–T3 por fecha (más recientes primero). Abre
              cada foto para revisar el ticket.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? 'Cargando…' : 'Actualizar'}
            </button>
            <Link
              href="/ventas/corte-tpv"
              className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold text-white"
              style={{ backgroundColor: SUITE.navy }}
            >
              Tomar / editar fotos
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {loading && days.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            Cargando fotos de caja…
          </p>
        ) : null}

        {!loading && !error && days.length === 0 ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            Aún no hay cortes TPV registrados.
          </p>
        ) : null}

        <div className="mt-5 space-y-5">
          {days.map((day) => (
            <div
              key={day.date}
              className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4"
            >
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h4
                  className="text-sm font-bold capitalize"
                  style={{ color: theme.title }}
                >
                  {formatCorteDateDisplay(day.date)}
                </h4>
                <p className="font-mono text-xs text-slate-400">{day.date}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {TPV_TERMINALS.map((n) => (
                  <TerminalSlot
                    key={n}
                    terminal={n}
                    upload={day.byTerminal.get(n)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
