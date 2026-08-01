'use client';

import { useEffect } from 'react';
import { getTheme, SUITE } from '@/app/lib/themes';
import {
  getPoliticaDoc,
  type PoliticaBlock,
  type PoliticaDocId,
  type PoliticaListItem,
} from '@/app/lib/eventos-politicas-content';

const theme = getTheme('suite');

function ListItems({ items }: { items: PoliticaListItem[] }) {
  return (
    <ul className="space-y-2.5 pl-0">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
          <span
            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: SUITE.orangeDeep }}
            aria-hidden
          />
          <div className="min-w-0">
            <p>{item.text}</p>
            {item.children && item.children.length > 0 ? (
              <ul className="mt-2 space-y-1.5 border-l-2 border-slate-100 pl-3">
                {item.children.map((child, j) => (
                  <li
                    key={j}
                    className="text-[13px] leading-relaxed text-slate-600"
                  >
                    {child}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BlockView({ block }: { block: PoliticaBlock }) {
  if (block.type === 'p') {
    return (
      <p className="text-sm leading-relaxed text-slate-700">{block.text}</p>
    );
  }
  if (block.type === 'note') {
    return (
      <p
        className="rounded-xl px-3 py-2.5 text-[13px] leading-relaxed"
        style={{
          backgroundColor: SUITE.orangeSoft,
          color: SUITE.navy,
        }}
      >
        {block.text}
      </p>
    );
  }
  return <ListItems items={block.items} />;
}

export function EventosPoliticaModal({
  docId,
  onClose,
}: {
  docId: PoliticaDocId;
  onClose: () => void;
}) {
  const doc = getPoliticaDoc(docId);

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
      aria-labelledby="eventos-politica-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[24px] bg-white sm:rounded-[24px]"
        style={{ boxShadow: SUITE.shadow }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"
          style={{ backgroundColor: '#F8FAFC' }}
        >
          <div className="min-w-0">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: theme.muted }}
            >
              Políticas · consulta en pantalla
            </p>
            <h2
              id="eventos-politica-title"
              className="mt-1 text-lg font-bold leading-snug"
              style={{ color: theme.title }}
            >
              {doc.title}
            </h2>
            {doc.subtitle ? (
              <p className="mt-1 text-sm text-slate-500">{doc.subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/70"
          >
            Cerrar
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <div className="space-y-7">
            {doc.sections.map((section) => (
              <section key={section.id} className="space-y-3">
                <h3
                  className="text-sm font-bold tracking-wide"
                  style={{ color: SUITE.navy }}
                >
                  {section.title}
                </h3>
                <div className="space-y-3">
                  {section.blocks.map((block, i) => (
                    <BlockView key={i} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3"
          style={{ backgroundColor: '#F8FAFC' }}
        >
          <span className="text-xs text-slate-400">
            Original: {doc.sourceFilename}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-bold text-white"
            style={{ backgroundColor: SUITE.navy }}
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
