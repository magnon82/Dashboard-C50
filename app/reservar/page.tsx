'use client';

import { FormEvent, useMemo, useState } from 'react';
import { BrandLogo } from '@/app/components/BrandLogo';
import {
  buildReservaWhatsAppTemplate,
  buildWhatsAppHref,
  todayYmdMexico,
} from '@/app/lib/reservas';
import { SUITE } from '@/app/lib/themes';

const HORAS_SUGERIDAS = [
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
  '22:00',
] as const;

type FormState = {
  nombre: string;
  personas: string;
  telefono: string;
  fecha: string;
  hora: string;
  motivo: string;
  alergias: string;
  notas: string;
};

const emptyForm = (minDate: string): FormState => ({
  nombre: '',
  personas: '2',
  telefono: '',
  fecha: minDate,
  hora: '20:00',
  motivo: '',
  alergias: '',
  notas: '',
});

export default function ReservarMesaPage() {
  const minDate = useMemo(() => todayYmdMexico(), []);
  const [form, setForm] = useState<FormState>(() => emptyForm(minDate));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const level1Href = useMemo(
    () => buildWhatsAppHref(buildReservaWhatsAppTemplate()),
    []
  );

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setDone(false);

    try {
      const res = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre,
          personas: Number(form.personas),
          telefono: form.telefono,
          fecha: form.fecha,
          hora: form.hora,
          motivo: form.motivo,
          alergias: form.alergias,
          notas: form.notas,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'No se pudo enviar la solicitud');
        return;
      }
      if (typeof json.waHref === 'string' && json.waHref) {
        window.open(json.waHref, '_blank', 'noopener,noreferrer');
      }
      setDone(true);
    } catch {
      setError('Error de conexión. Intenta de nuevo o usa WhatsApp directo.');
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100';

  return (
    <main
      className="relative min-h-screen px-4 py-10 sm:py-14"
      style={{
        backgroundColor: SUITE.pageBg,
        backgroundImage: `
          radial-gradient(ellipse 80% 50% at 10% -10%, rgba(232,163,23,0.18), transparent 55%),
          radial-gradient(ellipse 60% 40% at 100% 0%, rgba(27,42,74,0.12), transparent 50%),
          linear-gradient(180deg, ${SUITE.pageBg} 0%, #dfe5ee 100%)
        `,
      }}
    >
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-8 text-center">
          <BrandLogo
            variant="navy"
            priority
            className="mx-auto mb-5 h-auto w-[min(100%,280px)]"
          />
          <h1
            className="text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ color: SUITE.navy, fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            Reservar mesa
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: SUITE.muted }}>
            Completa el formulario; al enviar se abre WhatsApp con tu solicitud
            lista. Te confirmamos en breve.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-[28px] bg-white px-6 py-7 sm:px-8"
          style={{ boxShadow: SUITE.shadow }}
        >
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {done && !error && (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{
                borderColor: '#D4E5C8',
                backgroundColor: '#F3F9EE',
                color: SUITE.navy,
              }}
            >
              Recibimos tu solicitud; te confirmamos en breve por WhatsApp.
            </div>
          )}

          <div>
            <label htmlFor="nombre" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Nombre
            </label>
            <input
              id="nombre"
              name="nombre"
              required
              autoComplete="name"
              value={form.nombre}
              onChange={(e) => setField('nombre', e.target.value)}
              className={fieldClass}
              placeholder="Tu nombre"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="personas" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Personas
              </label>
              <input
                id="personas"
                name="personas"
                type="number"
                min={1}
                max={40}
                required
                value={form.personas}
                onChange={(e) => setField('personas', e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="telefono" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Teléfono
              </label>
              <input
                id="telefono"
                name="telefono"
                type="tel"
                inputMode="tel"
                required
                autoComplete="tel"
                value={form.telefono}
                onChange={(e) => setField('telefono', e.target.value)}
                className={fieldClass}
                placeholder="442 123 4567"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fecha" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Fecha
              </label>
              <input
                id="fecha"
                name="fecha"
                type="date"
                required
                min={minDate}
                value={form.fecha}
                onChange={(e) => setField('fecha', e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="hora" className="mb-1.5 block text-sm font-semibold text-slate-700">
                Hora
              </label>
              <select
                id="hora"
                name="hora"
                required
                value={form.hora}
                onChange={(e) => setField('hora', e.target.value)}
                className={fieldClass}
              >
                {HORAS_SUGERIDAS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="motivo" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Motivo <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="motivo"
              name="motivo"
              value={form.motivo}
              onChange={(e) => setField('motivo', e.target.value)}
              className={fieldClass}
              placeholder="Cumpleaños, aniversario…"
            />
          </div>

          <div>
            <label htmlFor="alergias" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Alergias <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="alergias"
              name="alergias"
              value={form.alergias}
              onChange={(e) => setField('alergias', e.target.value)}
              className={fieldClass}
              placeholder="Ninguna / gluten / mariscos…"
            />
          </div>

          <div>
            <label htmlFor="notas" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Notas <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <textarea
              id="notas"
              name="notas"
              rows={2}
              value={form.notas}
              onChange={(e) => setField('notas', e.target.value)}
              className={`${fieldClass} resize-none`}
              placeholder="Silla infantil, terraza, etc."
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl px-4 py-3.5 text-sm font-bold text-white transition enabled:hover:brightness-105 disabled:opacity-60"
            style={{ backgroundColor: SUITE.navy }}
          >
            {loading ? 'Enviando…' : 'Reservar mesa'}
          </button>

          <p className="text-center text-xs leading-relaxed" style={{ color: SUITE.muted }}>
            Sin costo de API: el mensaje se abre en tu WhatsApp y el restaurante
            responde como siempre. Las reservas viven en el chat (+ registro
            interno).
          </p>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: SUITE.muted }}>
          <a
            href={level1Href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline-offset-2 hover:underline"
            style={{ color: SUITE.navy }}
          >
            Solo WhatsApp (plantilla vacía)
          </a>
        </p>
      </div>
    </main>
  );
}
