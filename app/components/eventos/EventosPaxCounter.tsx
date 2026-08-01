'use client';

import { useEffect, useState } from 'react';
import {
  EVENTOS_MAX_PAX,
  EVENTOS_MIN_PAX_GRUPOS,
} from '@/app/lib/eventos';

export function clampEventosPax(n: number): number {
  if (!Number.isFinite(n)) return EVENTOS_MIN_PAX_GRUPOS;
  return Math.min(
    EVENTOS_MAX_PAX,
    Math.max(EVENTOS_MIN_PAX_GRUPOS, Math.round(n))
  );
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function EventosPaxCounter({
  value,
  onChange,
  disabled = false,
  size = 'md',
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** `sm` matches CRM form density; `md` matches Cotizador inputs */
  size?: 'md' | 'sm';
}) {
  const clamped = clampEventosPax(value);
  const [text, setText] = useState(String(clamped));

  useEffect(() => {
    setText(String(clampEventosPax(value)));
  }, [value]);

  function commit(raw: string) {
    const digits = digitsOnly(raw);
    const next =
      digits === ''
        ? EVENTOS_MIN_PAX_GRUPOS
        : clampEventosPax(Number(digits));
    setText(String(next));
    onChange(next);
  }

  const btnPad = size === 'sm' ? 'px-2.5 py-2' : 'px-3 py-2';
  const inputPad = size === 'sm' ? 'px-2 py-2 text-sm' : 'px-2 py-2';

  return (
    <div
      className={`mt-1 flex w-full overflow-hidden rounded-lg border border-slate-300 bg-white ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        aria-label="Disminuir personas"
        disabled={disabled || clamped <= EVENTOS_MIN_PAX_GRUPOS}
        onClick={() => onChange(clampEventosPax(clamped - 1))}
        className={`${btnPad} shrink-0 border-r border-slate-300 text-base font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white`}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label="Personas (pax)"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const digits = digitsOnly(e.target.value);
          setText(digits);
          if (digits === '') return;
          const n = Number(digits);
          if (!Number.isFinite(n)) return;
          // Cap high values while typing; allow below-min draft until blur
          if (n > EVENTOS_MAX_PAX) {
            setText(String(EVENTOS_MAX_PAX));
            onChange(EVENTOS_MAX_PAX);
          } else if (n >= EVENTOS_MIN_PAX_GRUPOS) {
            onChange(n);
          }
        }}
        onBlur={() => commit(text)}
        className={`min-w-0 flex-1 border-0 bg-transparent text-center tabular-nums text-slate-800 outline-none focus:ring-0 ${inputPad}`}
      />
      <button
        type="button"
        aria-label="Aumentar personas"
        disabled={disabled || clamped >= EVENTOS_MAX_PAX}
        onClick={() => onChange(clampEventosPax(clamped + 1))}
        className={`${btnPad} shrink-0 border-l border-slate-300 text-base font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white`}
      >
        +
      </button>
    </div>
  );
}
