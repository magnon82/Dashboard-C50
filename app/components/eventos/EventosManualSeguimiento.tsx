'use client';

import { useState, type ReactNode } from 'react';
import { SUITE } from '@/app/lib/themes';

const PILLARS: {
  id: string;
  title: string;
  summary: string;
  points: string[];
}[] = [
  {
    id: 'canales',
    title: 'Varios canales',
    summary: 'Llamada, WhatsApp y email según el momento del lead.',
    points: [
      'Alterna canal si no hay respuesta: no insistas en el mismo medio.',
      'Prioriza el contacto humano al inicio; WA/email para confirmar y enviar.',
      'Horario laboral: respeta tiempos y no satures fuera de ventana.',
    ],
  },
  {
    id: 'estructura',
    title: 'Estructura clara',
    summary: 'Un recorrido corto y predecible del lead al cierre.',
    points: [
      'Captura → bienvenida → alta de cliente → cotización/PDF → seguimientos → cierre.',
      'Cada paso tiene dueño y fecha; el checklist del CRM marca el avance.',
      'Hold solo si aplica (bloquea fecha ~72 h; no si faltan <15 días al evento).',
    ],
  },
  {
    id: 'conversion',
    title: 'Maximizar conversión sin agobiar',
    summary: 'Seguimiento persistente, no pesado.',
    points: [
      'Pregunta por claridad y ajustes; no presiones con «¿ya decidió?»',
      'Si no responde: cambia de canal y espacia el contacto.',
      'Nunca descartes por silencio: congela e invita de nuevo más adelante.',
    ],
  },
];

const TOOLS: {
  id: string;
  title: string;
  role: string;
  points: string[];
}[] = [
  {
    id: 'crm',
    title: 'CRM',
    role: 'Checklist y alertas',
    points: [
      'Checklist del lead: mismos pasos del flujo comercial.',
      'Alertas de seguimiento para no olvidar día 3, 5 y cierre.',
      'Registra interacciones y mueve el estado (activo / hold / ganado / congelado).',
    ],
  },
  {
    id: 'cotizador',
    title: 'Cotizador',
    role: 'Alta + PDF',
    points: [
      'Alta de cliente obligatoria antes de cotizar.',
      'Arma y guarda la cotización en sistema; no armes Word/PDF a mano.',
      'Envía o comparte el PDF generado; al guardar se crea o reutiliza el lead.',
    ],
  },
  {
    id: 'os',
    title: 'OS en Drive',
    role: 'Cierre operativo',
    points: [
      'Al confirmar: orden de servicio (PDF en Drive) + instrucciones de depósito.',
      'Confirma depósito con administración y avisa a operaciones.',
      'Deja el lead en «Ganado» / eventos confirmados en CRM.',
    ],
  },
];

function Accordion({
  id,
  open,
  onToggle,
  title,
  hint,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-2xl bg-white"
      style={{ boxShadow: SUITE.shadow }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left sm:px-5"
      >
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ backgroundColor: open ? SUITE.orangeDeep : SUITE.navy }}
          aria-hidden
        >
          {open ? '−' : '+'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-bold" style={{ color: SUITE.navy }}>
            {title}
          </span>
          {hint ? (
            <span className="mt-0.5 block text-xs" style={{ color: SUITE.muted }}>
              {hint}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function EventosManualSeguimiento() {
  const [openId, setOpenId] = useState<string | null>('canales');

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: SUITE.orangeDeep }}
        >
          Eventos · Biblioteca
        </p>
        <h1
          className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl"
          style={{ color: SUITE.navy }}
        >
          Manual de seguimiento
        </h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: SUITE.muted }}>
          Cómo dar seguimiento a leads de eventos en Carranza 50: canales,
          estructura y herramientas — sin scripts largos ni presión innecesaria.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/eventos"
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← Volver a Eventos
          </a>
          <a
            href="#herramientas"
            className="rounded-xl px-3.5 py-2 text-xs font-semibold text-white"
            style={{ backgroundColor: SUITE.orangeDeep }}
          >
            Ir a herramientas
          </a>
        </div>
      </header>

      <aside
        className="rounded-2xl border px-4 py-3"
        style={{
          backgroundColor: SUITE.orangeSoft,
          borderColor: `${SUITE.orange}66`,
        }}
      >
        <p
          className="text-[11px] font-bold uppercase tracking-wide"
          style={{ color: SUITE.orangeDeep }}
        >
          Filosofía
        </p>
        <p className="mt-1 text-sm font-semibold" style={{ color: SUITE.navy }}>
          «Seguimiento persistente, no pesado»
        </p>
        <p className="mt-1 text-sm text-slate-700">
          Varios canales, estructura clara. Maximizar conversión sin agobiar.
          Herramientas: CRM (checklist/alertas), Cotizador (alta + PDF) y OS en
          Drive.
        </p>
      </aside>

      <section className="mt-8 space-y-3" aria-labelledby="pilares-title">
        <div>
          <h2
            id="pilares-title"
            className="text-lg font-bold tracking-tight sm:text-xl"
            style={{ color: SUITE.navy }}
          >
            Cómo trabajar el seguimiento
          </h2>
          <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
            Tres principios. Ábrelo solo si necesitas el detalle.
          </p>
        </div>

        {PILLARS.map((p) => (
          <Accordion
            key={p.id}
            id={p.id}
            open={openId === p.id}
            onToggle={() => toggle(p.id)}
            title={p.title}
            hint={p.summary}
          >
            <ul className="space-y-2">
              {p.points.map((t) => (
                <li
                  key={t}
                  className="flex gap-2 text-sm leading-snug text-slate-700"
                >
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                    style={{ backgroundColor: SUITE.navy }}
                    aria-hidden
                  >
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </Accordion>
        ))}
      </section>

      <section
        id="herramientas"
        className="mt-10 scroll-mt-24"
        aria-labelledby="herramientas-title"
      >
        <div className="mb-4">
          <h2
            id="herramientas-title"
            className="text-lg font-bold tracking-tight sm:text-xl"
            style={{ color: SUITE.navy }}
          >
            Herramientas
          </h2>
          <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
            CRM, Cotizador y OS en Drive — el stack del seguimiento.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {TOOLS.map((tool) => (
            <div
              key={tool.id}
              className="rounded-2xl bg-white px-4 py-4"
              style={{ boxShadow: SUITE.shadow }}
            >
              <p
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ color: SUITE.orangeDeep }}
              >
                {tool.role}
              </p>
              <p
                className="mt-1 text-sm font-bold"
                style={{ color: SUITE.navy }}
              >
                {tool.title}
              </p>
              <ul className="mt-3 space-y-2">
                {tool.points.map((t) => (
                  <li key={t} className="text-sm leading-snug text-slate-700">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-center">
        <p className="text-xs" style={{ color: SUITE.muted }}>
          Alineado a CRM (checklist/alertas), Cotizador (alta + PDF) y OS en Drive.
        </p>
        <a
          href="/eventos"
          className="mt-3 inline-block text-sm font-semibold"
          style={{ color: SUITE.orangeDeep }}
        >
          Volver a Eventos → Biblioteca
        </a>
      </footer>
    </div>
  );
}
