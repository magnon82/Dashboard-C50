'use client';

import {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
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

/** Pax for one food menu line: 1 … remaining (remaining capped at event max). */
export function clampLinePax(n: number, remaining: number): number {
  const cap = Math.max(0, Math.min(EVENTOS_MAX_PAX, Math.floor(remaining)));
  if (cap < 1) return 0;
  if (!Number.isFinite(n)) return cap;
  return Math.min(cap, Math.max(1, Math.round(n)));
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
        role="spinbutton"
        aria-label={`Personas (pax), mín. ${EVENTOS_MIN_PAX_GRUPOS}, máx. ${EVENTOS_MAX_PAX}`}
        aria-valuemin={EVENTOS_MIN_PAX_GRUPOS}
        aria-valuemax={EVENTOS_MAX_PAX}
        aria-valuenow={clamped}
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

/**
 * Editable pax for the next food menu line (green control in Cotizador).
 * Range: 1 … remaining. Default/suggestion comes from the parent (usually remaining).
 */
export function EventosLinePaxControl({
  value,
  remaining,
  onChange,
  onEnter,
  disabled = false,
  variant = 'circle',
}: {
  value: number;
  remaining: number;
  onChange: (next: number) => void;
  /** Receives the committed qty so Enter can add without waiting for setState. */
  onEnter?: (qty: number) => void;
  disabled?: boolean;
  variant?: 'circle' | 'field';
}) {
  const cap = Math.max(0, Math.min(EVENTOS_MAX_PAX, Math.floor(remaining)));
  const clamped = clampLinePax(value, cap);
  const [text, setText] = useState(clamped > 0 ? String(clamped) : '');
  const locked = disabled || cap < 1;

  useEffect(() => {
    const next = clampLinePax(value, cap);
    setText(next > 0 ? String(next) : '');
  }, [value, cap]);

  function commit(raw: string): number {
    if (cap < 1) {
      setText('');
      onChange(0);
      return 0;
    }
    const digits = digitsOnly(raw);
    const next =
      digits === '' ? clampLinePax(cap, cap) : clampLinePax(Number(digits), cap);
    setText(String(next));
    onChange(next);
    return next;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = commit(text);
    onEnter?.(next);
  }

  const inputShared = {
    type: 'text' as const,
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
    autoComplete: 'off' as const,
    role: 'spinbutton' as const,
    'aria-label': 'Personas por línea de menú',
    'aria-valuemin': 1,
    'aria-valuemax': Math.max(1, cap),
    'aria-valuenow': clamped > 0 ? clamped : undefined,
    disabled: locked,
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const digits = digitsOnly(e.target.value);
      setText(digits);
      if (digits === '') return;
      const n = Number(digits);
      if (!Number.isFinite(n)) return;
      if (n > cap) {
        setText(String(cap));
        onChange(cap);
      } else if (n >= 1) {
        onChange(n);
      }
    },
    onBlur: () => commit(text),
    onKeyDown,
  };

  if (variant === 'field') {
    return (
      <div
        className={`mt-1 flex w-full overflow-hidden rounded-lg border ${
          locked ? 'opacity-60' : ''
        }`}
        style={{
          borderColor: '#F97316',
          backgroundColor: '#FFF7ED',
        }}
      >
        <button
          type="button"
          aria-label="Disminuir personas de la línea"
          disabled={locked || clamped <= 1}
          onClick={() => onChange(clampLinePax(clamped - 1, cap))}
          className="shrink-0 border-r px-3 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: '#FDBA74', color: '#9A3412' }}
        >
          −
        </button>
        <input
          {...inputShared}
          className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-center text-sm font-semibold tabular-nums outline-none focus:ring-0"
          style={{ color: '#0B1F33' }}
        />
        <button
          type="button"
          aria-label="Aumentar personas de la línea"
          disabled={locked || clamped >= cap}
          onClick={() => onChange(clampLinePax(clamped + 1, cap))}
          className="shrink-0 border-l px-3 py-2 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: '#FDBA74', color: '#9A3412' }}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-1.5 ${locked ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Disminuir personas de la línea"
          disabled={locked || clamped <= 1}
          onClick={() => onChange(clampLinePax(clamped - 1, cap))}
          className="flex h-8 w-8 items-center justify-center rounded-full border text-base font-bold disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: '#0F9F9C',
            backgroundColor: '#FFFFFF',
            color: '#0B6E6C',
          }}
        >
          −
        </button>
        <input
          {...inputShared}
          className="h-16 w-16 rounded-full border-2 text-center text-lg font-bold tabular-nums outline-none focus:ring-2 disabled:opacity-50"
          style={{
            borderColor: '#0F9F9C',
            backgroundColor: '#E6F7F6',
            color: '#0B6E6C',
            boxShadow: '0 0 0 3px rgba(15, 159, 156, 0.15)',
          }}
        />
        <button
          type="button"
          aria-label="Aumentar personas de la línea"
          disabled={locked || clamped >= cap}
          onClick={() => onChange(clampLinePax(clamped + 1, cap))}
          className="flex h-8 w-8 items-center justify-center rounded-full border text-base font-bold disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: '#0F9F9C',
            backgroundColor: '#FFFFFF',
            color: '#0B6E6C',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
