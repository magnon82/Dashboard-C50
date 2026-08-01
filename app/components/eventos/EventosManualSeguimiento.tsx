'use client';

import { useState, type ReactNode } from 'react';
import { SUITE } from '@/app/lib/themes';
import {
  FOLLOW_UP_STEPS,
  type FollowUpStepId,
} from '@/app/lib/eventos-follow-up';

/** Nodos del diagrama — ids alineados a FOLLOW_UP_STEPS del CRM. */
const FLOW_NODES: {
  id: FollowUpStepId;
  title: string;
  when: string;
  channel: string;
  summary: string;
  optional?: boolean;
}[] = [
  {
    id: 'captura',
    title: 'Captura',
    when: 'Día 0 · <1 h',
    channel: 'Llamada',
    summary:
      'Primer contacto humano del lead (formulario, referido o lead creado al guardar cotización). Si no contesta → WhatsApp en ≤5 min.',
  },
  {
    id: 'bienvenida',
    title: 'Bienvenida',
    when: 'Día 0',
    channel: 'WhatsApp',
    summary: 'WA de bienvenida + confirmar fecha y necesidades (brief).',
  },
  {
    id: 'alta_cliente',
    title: 'Alta de cliente',
    when: 'Antes de cotizar',
    channel: 'CRM / Cotizador',
    summary:
      'Obligatorio: registrar o elegir el cliente en CRM («+ Alta cliente» en Cotizador). Sin cliente no se cotiza en sistema.',
  },
  {
    id: 'cotizacion',
    title: 'Cotización + PDF',
    when: 'Día 1 · ≤24 h',
    channel: 'Cotizador + Email/WA',
    summary:
      'Generar la cotización en Cotizador (se guarda y vincula el lead). Luego enviar o compartir el PDF — no armar Word/PDF a mano.',
  },
  {
    id: 'seg_d3',
    title: 'Seguimiento día 3',
    when: 'Día 3',
    channel: 'WhatsApp',
    summary: 'WA post-cotización: ¿revisó la propuesta?',
  },
  {
    id: 'seg_d5',
    title: 'Seguimiento día 5',
    when: 'Día 5',
    channel: 'Llamada / WA',
    summary: '«¿Qué le pareció? ¿Hay algún ajuste?»',
  },
  {
    id: 'hold',
    title: 'Hold 72 h',
    when: 'Si aplica',
    channel: 'CRM',
    summary: 'Hold 72 h hábiles (no si faltan <15 días al evento).',
    optional: true,
  },
  {
    id: 'cierre',
    title: 'Cierre',
    when: 'Día 15',
    channel: 'Llamada',
    summary:
      'Reservar o congelar + OS (Drive) + depósito. Nunca descartar por silencio.',
  },
];

type Machote = {
  id: string;
  stepId?: FollowUpStepId;
  title: string;
  hint: string;
  lines: string[];
  tips?: string[];
};

const MACHOTES: Machote[] = [
  {
    id: 'llamada-captura',
    stepId: 'captura',
    title: 'Guión · Llamada de captura',
    hint: 'Objetivo: confirmar datos, generar confianza y calificar. Aplica también si el lead nació al guardar una cotización.',
    lines: [
      '«Buenos días/tarde, ¿hablo con [Nombre del Cliente]?»',
      '«Le hablo de Carranza 50, muchísimas gracias por su interés en nosotros para su [Tipo de Evento].»',
      '«Mi nombre es [Tu Nombre] y seré su contacto directo. ¿Tiene 2 minutos para confirmar los datos que nos compartió y platicarme un poco más de lo que tienen en mente?»',
    ],
  },
  {
    id: 'wa-inmediato',
    stepId: 'captura',
    title: 'WhatsApp A · Contacto inmediato',
    hint: 'Cuando no contestan la llamada (≤5–10 min después).',
    lines: [
      '¡Hola [Nombre del Cliente]!',
      'Soy [Tu Nombre], de Carranza 50 Restaurante.',
      'Le llamamos hace unos momentos porque recibimos su solicitud para su evento «[Tipo de Evento]» para la fecha [Fecha Tentativa]. ¡Nos encanta la idea!',
      'No logramos contactarle por llamada, pero por este medio estaremos al pendiente. Mi rol será ser su enlace directo y ayudarle en todo para que su evento sea exactamente como lo ha imaginado.',
      'Para poder preparar una propuesta que se ajuste a sus necesidades, ¿me permite hacerle un par de preguntas específicas?',
    ],
    tips: [
      'Inmediato → el cliente se siente prioritario',
      'Personal: nombre + restaurante',
      'CTA clara: «¿me permite hacerle un par de preguntas?»',
    ],
  },
  {
    id: 'wa-bienvenida',
    stepId: 'bienvenida',
    title: 'WhatsApp · Bienvenida',
    hint: 'Día 0: presentarte, confirmar fecha y pedir necesidades. Incluye enlace al sitio o galería.',
    lines: [
      '¡Hola [Nombre del Cliente]!',
      'Soy [Tu Nombre], de Carranza 50. Gracias por contactarnos para su [Tipo de Evento].',
      'Quiero confirmar que la fecha que tienen en mente es [Fecha Tentativa]. ¿Sigue vigente?',
      'Para armar una propuesta a la medida, ¿me comparte un poco más de lo que necesitan? (número de personas, horario, tipo de menú, etc.)',
      'Aquí puede ver nuestro espacio: [enlace sitio / galería]',
      'Quedo atento. ¡Será un gusto acompañarles!',
    ],
  },
  {
    id: 'alta-cliente',
    stepId: 'alta_cliente',
    title: 'Checklist · Alta de cliente',
    hint: 'Antes de abrir Cotizador: el cliente debe existir en CRM (event_clients).',
    lines: [
      '1. En Cotizador → «+ Alta cliente», o créalo desde CRM.',
      '2. Completa: nombre/empresa, teléfono, email y datos del evento si ya los tienes.',
      '3. Elige ese cliente al armar la cotización (obligatorio para guardar).',
      '4. Marca «Alta cliente» en el checklist del lead del CRM.',
    ],
    tips: [
      'Sin alta no hay cotización en sistema',
      'Si el lead ya tiene cliente ligado (p. ej. cotización previa), marca el paso y sigue',
      'Evita duplicar: busca por teléfono/email antes de crear otro',
    ],
  },
  {
    id: 'email-cotizacion',
    stepId: 'cotizacion',
    title: 'Email / WA · Envío del PDF de cotización',
    hint: 'La cotización se genera en Cotizador (preview o /eventos/cotizacion/[id]). Este machote es solo el envío formal (máx. 24 h).',
    lines: [
      'Asunto: Aquí está su propuesta personalizada para [Tipo de Evento] - Carranza 50',
      '',
      'Estimado/a [Nombre del Cliente],',
      'Adjunto encontrará la propuesta personalizada para su [Tipo de Evento] en Carranza 50 (PDF generado desde nuestro cotizador).',
      'Quedo atento a sus comentarios o a agendar una visita para recorrer el espacio.',
      'Saludos cordiales,',
      '[Tu Nombre]',
    ],
    tips: [
      'Cotizador → guardar → abrir cotización → imprimir/guardar PDF o compartir enlace',
      'No armes la cotización en Word/Excel a mano',
      'Al guardar, el sistema crea o reutiliza el lead del CRM',
      'Marca el paso en checklist cuando el cliente ya recibió el PDF',
    ],
  },
  {
    id: 'wa-dia3',
    stepId: 'seg_d3',
    title: 'WhatsApp B · Seguimiento día 3',
    hint: '3 días después del PDF, si no hay señal. No presionar.',
    lines: [
      'Buenos días/tarde, [Nombre del Cliente].',
      'Solo me pasaba por aquí para saludarle y ver si tuvo oportunidad de revisar la propuesta que le enviamos el [Día que se envió, ej: «lunes pasado»] para su evento en Carranza 50.',
      'Queremos asegurarnos de que todo esté claro y que la propuesta capture justo lo que usted necesita.',
      '¿Surge alguna duda sobre los menús, la renta del espacio o algún otro detalle? Estoy aquí para ayudarle en lo que sea necesario.',
      '¡Que tenga un excelente día!',
      '[Tu Nombre]',
    ],
    tips: [
      'No digas «¿ya decidió?» → di «¿está todo claro?»',
      'Rol de asesor, no de vendedor que empuja',
      'Si no responde: no insistas por WA; pasa a la llamada del día 5',
    ],
  },
  {
    id: 'llamada-dia5',
    stepId: 'seg_d5',
    title: 'Llamada / WA · Día 5',
    hint: 'Ajuste y lectura de la propuesta.',
    lines: [
      '«¿Qué le pareció la propuesta? ¿Hay algún ajuste que podamos hacer?»',
    ],
  },
  {
    id: 'llamada-cierre',
    stepId: 'cierre',
    title: 'Llamada · Cierre día 15',
    hint: 'Última llamada del ciclo: reservar o congelar.',
    lines: [
      '«Nos daría mucho gusto poder atenderle. ¿Procedemos con la reserva?»',
    ],
  },
  {
    id: 'obj-caro',
    title: 'Objeción · «Está caro» / cotizando con otros',
    hint: 'Respuesta base para precio o comparación.',
    lines: [
      '«Entiendo perfectamente, es una decisión importante. Le pregunto, ¿nuestra propuesta está dentro de su presupuesto o hay una brecha muy grande? Lo que nos diferencia en Carranza 50 es [experiencia en prebodas, renta completa, terraza, personalización, propuesta culinaria y servicio]. ¿Qué le han ofrecido los otros lugares? Quizá podamos ajustar algunos elementos para acercarnos más.»',
    ],
  },
  {
    id: 'obj-pensarlo',
    title: 'Objeción · «Necesito pensarlo» / lo consulto en familia',
    hint: 'Abrir cita o material visual sin presión.',
    lines: [
      '«¡Por supuesto! Es una decisión que se debe tomar en familia. ¿Le gustaría que agendemos una llamada o cita presencial breve con todas las personas involucradas? Así les mostramos el espacio y resolvemos dudas en conjunto. También puedo enviarle un video corto mostrando las instalaciones.»',
    ],
  },
];

function FlowArrow() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path
          d="M8 2v14M3 12l5 5 5-5"
          stroke={SUITE.navy}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.35"
        />
      </svg>
    </div>
  );
}

function ScriptBlock({ lines }: { lines: string[] }) {
  return (
    <div
      className="rounded-xl border px-3.5 py-3 font-mono text-[13px] leading-relaxed sm:text-sm"
      style={{
        backgroundColor: '#F8FAFC',
        borderColor: SUITE.border,
        color: SUITE.navy,
      }}
    >
      {lines.map((line, i) =>
        line === '' ? (
          <div key={i} className="h-2" />
        ) : (
          <p key={i} className={i > 0 && lines[i - 1] !== '' ? 'mt-2' : undefined}>
            {line}
          </p>
        )
      )}
    </div>
  );
}

function Accordion({
  id,
  open,
  onToggle,
  title,
  hint,
  badge,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
  badge?: string;
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
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-bold" style={{ color: SUITE.navy }}>
              {title}
            </span>
            {badge ? (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ backgroundColor: SUITE.orangeDeep }}
              >
                {badge}
              </span>
            ) : null}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          /* ignore */
        }
      }}
      className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-slate-50"
      style={{ borderColor: SUITE.border, color: SUITE.navy }}
    >
      {copied ? 'Copiado' : 'Copiar texto'}
    </button>
  );
}

export function EventosManualSeguimiento() {
  const [activeStep, setActiveStep] = useState<FollowUpStepId | null>('captura');
  const [openMachote, setOpenMachote] = useState<string | null>(null);
  const [extrasOpen, setExtrasOpen] = useState(false);

  const activeNode = FLOW_NODES.find((n) => n.id === activeStep) ?? null;
  const crmLabel =
    FOLLOW_UP_STEPS.find((s) => s.id === activeStep)?.label ?? null;

  function selectStep(id: FollowUpStepId) {
    setActiveStep(id);
    const first = MACHOTES.find((m) => m.stepId === id);
    if (first) {
      setOpenMachote(first.id);
      window.requestAnimationFrame(() => {
        document.getElementById('machotes')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    }
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
          Flujo comercial Carranza 50 alineado a CRM + Cotizador. Alta de cliente
          primero; cotización en sistema y envío del PDF. Toca un paso para ver su
          machote — el checklist del CRM usa los mismos nombres.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/eventos"
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← Volver a Eventos
          </a>
          <a
            href="#machotes"
            className="rounded-xl px-3.5 py-2 text-xs font-semibold text-white"
            style={{ backgroundColor: SUITE.orangeDeep }}
          >
            Ir a machotes
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
          Herramientas: CRM (checklist/alertas), Cotizador (alta + PDF) y OS en Drive.
        </p>
      </aside>

      {/* ── Diagrama de flujo (héroe) ── */}
      <section className="mt-8" aria-labelledby="flujo-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="flujo-title"
              className="text-lg font-bold tracking-tight sm:text-xl"
              style={{ color: SUITE.navy }}
            >
              Flujo del lead
            </h2>
            <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
              Captura → alta cliente → Cotizador/PDF → cierre en 15 días. Pasos =
              checklist del CRM.
            </p>
          </div>
        </div>

        <ol className="mx-auto max-w-md">
          {FLOW_NODES.map((node, idx) => {
            const selected = activeStep === node.id;
            return (
              <li key={node.id}>
                {idx > 0 ? <FlowArrow /> : null}
                <button
                  type="button"
                  onClick={() => selectStep(node.id)}
                  className="relative w-full rounded-2xl border-2 bg-white px-4 py-3.5 text-left transition-shadow"
                  style={{
                    borderColor: selected ? SUITE.orangeDeep : 'transparent',
                    boxShadow: selected
                      ? `0 0 0 3px ${SUITE.orange}33, ${SUITE.shadow}`
                      : SUITE.shadow,
                    opacity: node.optional && !selected ? 0.92 : 1,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{
                        backgroundColor: selected
                          ? SUITE.orangeDeep
                          : node.optional
                            ? SUITE.navySoft
                            : SUITE.navy,
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="text-sm font-bold"
                          style={{ color: SUITE.navy }}
                        >
                          {node.title}
                        </p>
                        {node.optional ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                            style={{
                              backgroundColor: '#EEF2F8',
                              color: SUITE.navySoft,
                            }}
                          >
                            Opcional
                          </span>
                        ) : null}
                      </div>
                      <p
                        className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: SUITE.orangeDeep }}
                      >
                        {node.when} · {node.channel}
                      </p>
                      <p className="mt-1.5 text-sm leading-snug text-slate-600">
                        {node.summary}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Bifurcación visual bajo captura */}
                {node.id === 'captura' ? (
                  <div
                    className="mx-auto mt-2 max-w-[90%] rounded-xl border border-dashed px-3 py-2 text-center text-[11px] leading-snug text-slate-600"
                    style={{
                      borderColor: `${SUITE.orange}88`,
                      backgroundColor: SUITE.orangeSoft,
                    }}
                  >
                    Si no contesta → WA inmediato ≤5 min (machote A)
                  </div>
                ) : null}

                {node.id === 'alta_cliente' ? (
                  <div
                    className="mx-auto mt-2 max-w-[90%] rounded-xl border border-dashed px-3 py-2 text-center text-[11px] leading-snug text-slate-600"
                    style={{
                      borderColor: `${SUITE.navy}44`,
                      backgroundColor: '#EEF2F8',
                    }}
                  >
                    Cotizador exige cliente CRM · guardar cotización crea/reusa el lead
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {activeNode && crmLabel ? (
          <p
            className="mx-auto mt-4 max-w-md text-center text-xs"
            style={{ color: SUITE.muted }}
          >
            CRM:{' '}
            <span className="font-semibold" style={{ color: SUITE.navy }}>
              {crmLabel}
            </span>
            {' · '}
            <a
              href="#machotes"
              className="font-semibold underline-offset-2 hover:underline"
              style={{ color: SUITE.orangeDeep }}
            >
              ver machote
            </a>
          </p>
        ) : null}
      </section>

      {/* ── Machotes ── */}
      <section
        id="machotes"
        className="mt-10 scroll-mt-24 space-y-3"
        aria-labelledby="machotes-title"
      >
        <div>
          <h2
            id="machotes-title"
            className="text-lg font-bold tracking-tight sm:text-xl"
            style={{ color: SUITE.navy }}
          >
            Machotes
          </h2>
          <p className="mt-1 text-sm" style={{ color: SUITE.muted }}>
            Textos y checklists listos para copiar. Personaliza nombre, fecha y tipo
            de evento.
          </p>
        </div>

        <div
          className="rounded-xl border px-3 py-2 text-xs text-slate-600"
          style={{ borderColor: SUITE.border, backgroundColor: '#fff' }}
        >
          <strong style={{ color: SUITE.navy }}>Uso:</strong> personaliza siempre ·
          horario laboral (10:00–18:00) · cambia de canal si no hay respuesta (WA →
          llamada).
        </div>

        {MACHOTES.map((m) => {
          const open = openMachote === m.id;
          const stepBadge = m.stepId
            ? FLOW_NODES.find((n) => n.id === m.stepId)?.when
            : undefined;
          const highlight =
            activeStep && m.stepId === activeStep
              ? { outline: `2px solid ${SUITE.orangeDeep}`, outlineOffset: 2 }
              : undefined;
          return (
            <div key={m.id} style={highlight} className="rounded-2xl">
              <Accordion
                id={`machote-${m.id}`}
                open={open}
                onToggle={() => {
                  setOpenMachote(open ? null : m.id);
                  if (m.stepId) setActiveStep(m.stepId);
                }}
                title={m.title}
                hint={m.hint}
                badge={stepBadge}
              >
                <div className="flex justify-end">
                  <CopyButton text={m.lines.filter(Boolean).join('\n')} />
                </div>
                <ScriptBlock lines={m.lines} />
                {m.tips && m.tips.length > 0 ? (
                  <ul className="space-y-1.5">
                    {m.tips.map((t) => (
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
                ) : null}
              </Accordion>
            </div>
          );
        })}
      </section>

      {/* ── Detalle compacto (holds / cierre / sheets) ── */}
      <section className="mt-10">
        <Accordion
          id="extras"
          open={extrasOpen}
          onToggle={() => setExtrasOpen((v) => !v)}
          title="Reglas rápidas: hold, cierre y comisión"
          hint="Política comercial y checklist de cierre"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                t: 'Hold · duración',
                d: '72 horas hábiles. Admin puede extender. Se marca en el CRM del lead.',
              },
              {
                t: 'Hold · sin hold',
                d: 'Si faltan <15 días al evento, no se coloca hold.',
              },
              {
                t: 'Cotizador',
                d: 'Alta cliente → armar líneas → guardar → PDF/preview. El lead se crea o reutiliza solo.',
              },
            ].map((c) => (
              <div
                key={c.t}
                className="rounded-xl border px-3 py-2.5"
                style={{ borderColor: SUITE.border }}
              >
                <p
                  className="text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: SUITE.orangeDeep }}
                >
                  {c.t}
                </p>
                <p className="mt-1 text-sm leading-snug text-slate-700">{c.d}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: SUITE.border }}
            >
              <p
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ color: '#15803D' }}
              >
                Cierre (venta confirmada)
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                <li>Cliente acepta verbalmente o por escrito</li>
                <li>
                  Enviar orden de servicio (PDF en Drive / pestaña OS) +
                  instrucciones de depósito
                </li>
                <li>Recibir depósito y confirmar con administración</li>
                <li>Mover el lead a «Ganado» / Eventos Confirmados en CRM</li>
                <li>Avisar a operaciones</li>
              </ul>
            </div>
            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: SUITE.border }}
            >
              <p
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ color: '#B45309' }}
              >
                Descarte (solo si…)
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-700">
                <li>
                  Dice: «Ya contraté con otro» o «Ya no haremos el evento»
                </li>
                <li>
                  Ciclo de 15 días sin respuesta <em>y</em> la fecha del evento ya
                  pasó
                </li>
              </ul>
              <p
                className="mt-2 rounded-lg px-2.5 py-2 text-xs leading-snug"
                style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
              >
                Nunca descartes por silencio: marca{' '}
                <strong>Inactivo / Congelado</strong> y contacta esporádicamente
                (ej. 1× al mes).
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-700">
            Registra cada interacción. La comisión del evento está sujeta al
            cumplimiento de estos pasos / KPIs del plan de seguimiento.
          </p>
        </Accordion>
      </section>

      <footer className="mt-12 border-t border-slate-200 pt-6 text-center">
        <p className="text-xs" style={{ color: SUITE.muted }}>
          Alineado al checklist CRM (
          <code className="text-[11px]">eventos-follow-up.ts</code>
          ), Cotizador y al Manual de seguimiento eventos.
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
