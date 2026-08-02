'use client';

import { useEffect } from 'react';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  HR_CULTURA_BRAND,
  HR_CULTURA_FOLDER_PATH,
  HR_CULTURA_INTRO,
  HR_CULTURA_MISION,
  HR_CULTURA_TITLE,
  HR_CULTURA_VALORES,
  HR_CULTURA_VISION,
  type HrCulturaValor,
} from '@/app/lib/hr-cultura';

const theme = getTheme('suite');

/** Soft cards: verde/teal, terracotta, amarillo — armónicos con navy/naranja Suite. */
const ACCENT = {
  teal: {
    bg: '#E6F4F3',
    border: '#0F9F9C',
    label: '#0A7A78',
  },
  terracotta: {
    bg: '#F8EDE6',
    border: '#C47B0A',
    label: '#9A5F08',
  },
  amber: {
    bg: '#FFF8E6',
    border: SUITE.orange,
    label: SUITE.orangeDeep,
  },
  navy: {
    bg: '#E8EEF8',
    border: SUITE.navySoft,
    label: SUITE.navy,
  },
} as const;

function ValorCard({ valor }: { valor: HrCulturaValor }) {
  const a = ACCENT[valor.accent];
  return (
    <article
      className="rounded-[18px] border-l-[3px] px-4 py-4"
      style={{
        backgroundColor: a.bg,
        borderLeftColor: a.border,
        boxShadow: '0 4px 16px rgba(27, 42, 74, 0.04)',
      }}
    >
      <h4
        className="text-[11px] font-bold uppercase tracking-[0.16em]"
        style={{ color: a.label }}
      >
        {valor.title}
      </h4>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{valor.body}</p>
    </article>
  );
}

export function RrhhCulturaView({
  onClose,
  onExploreFolder,
  folderPath = HR_CULTURA_FOLDER_PATH,
  driveUrl,
}: {
  onClose: () => void;
  /** Abre el explorador de carpeta (HrDocViewer) como respaldo. */
  onExploreFolder?: () => void;
  folderPath?: string | null;
  driveUrl?: string | null;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rrhh-cultura-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[24px] bg-white sm:rounded-[24px]"
        style={{ boxShadow: SUITE.shadow }}
      >
        {/* Hero encabezado */}
        <header
          className="relative shrink-0 overflow-hidden px-5 pb-5 pt-5 sm:px-7 sm:pt-6"
          style={{
            background: `linear-gradient(135deg, ${SUITE.navyDeep} 0%, ${SUITE.navy} 55%, ${SUITE.navySoft} 100%)`,
          }}
        >
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full opacity-20"
            style={{ background: SUITE.orange }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-24 rounded-full opacity-10"
            style={{ background: '#0F9F9C' }}
            aria-hidden
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">
                Biblioteca RH · Cultura
              </p>
              <h2
                id="rrhh-cultura-title"
                className="mt-1.5 text-xl font-bold leading-snug text-white sm:text-2xl"
              >
                {HR_CULTURA_TITLE}
              </h2>
              <p
                className="mt-1.5 text-sm font-semibold"
                style={{ color: SUITE.orange }}
              >
                {HR_CULTURA_BRAND}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/10"
            >
              Cerrar
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {/* Intro */}
          <section className="space-y-3">
            {HR_CULTURA_INTRO.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-slate-600">
                {p}
              </p>
            ))}
          </section>

          {/* Misión + Visión */}
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <article
              className="rounded-[20px] border-t-[3px] px-4 py-4"
              style={{
                backgroundColor: ACCENT.teal.bg,
                borderTopColor: ACCENT.teal.border,
              }}
            >
              <h3
                className="text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{ color: ACCENT.teal.label }}
              >
                {HR_CULTURA_MISION.title}
              </h3>
              <p
                className="mt-2.5 text-[15px] font-semibold leading-snug"
                style={{ color: theme.title }}
              >
                {HR_CULTURA_MISION.body}
              </p>
            </article>
            <article
              className="rounded-[20px] border-t-[3px] px-4 py-4"
              style={{
                backgroundColor: ACCENT.terracotta.bg,
                borderTopColor: ACCENT.terracotta.border,
              }}
            >
              <h3
                className="text-[11px] font-bold uppercase tracking-[0.16em]"
                style={{ color: ACCENT.terracotta.label }}
              >
                {HR_CULTURA_VISION.title}
              </h3>
              <p
                className="mt-2.5 text-[15px] font-semibold leading-snug"
                style={{ color: theme.title }}
              >
                {HR_CULTURA_VISION.body}
              </p>
            </article>
          </section>

          {/* Valores */}
          <section className="mt-7">
            <div className="mb-3 flex items-baseline gap-2">
              <h3
                className="text-sm font-bold tracking-wide"
                style={{ color: theme.title }}
              >
                Valores
              </h3>
              <span className="text-xs text-slate-400">
                {HR_CULTURA_VALORES.length}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {HR_CULTURA_VALORES.map((v) => (
                <ValorCard key={v.id} valor={v} />
              ))}
            </div>
          </section>
        </div>

        {/* Pie: acciones secundarias */}
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 sm:px-7">
          {onExploreFolder && folderPath ? (
            <button
              type="button"
              onClick={onExploreFolder}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Abrir carpeta Drive
            </button>
          ) : null}
          {driveUrl ? (
            <a
              href={driveUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Abrir en Drive
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-bold text-white"
            style={{ backgroundColor: SUITE.navy }}
          >
            Listo
          </button>
        </footer>
      </div>
    </div>
  );
}
