'use client';

import { useEffect, useState } from 'react';
import { PRODUCT_NAME } from '@/app/lib/product';
import { SUITE } from '@/app/lib/themes';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * CTA para instalar el Suite como app en el celular (PWA).
 * Android/Chrome: beforeinstallprompt. iOS: guía «Añadir a inicio».
 */
export function InstallAppPrompt({
  className = '',
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      Boolean(
        (window.navigator as Navigator & { standalone?: boolean }).standalone
      );
    if (standalone) {
      setInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent || '';
    const isIos =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIosHint(isIos);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', () => setInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  if (installed) return null;

  async function install() {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`}
      style={{ boxShadow: compact ? undefined : SUITE.shadow }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: SUITE.navy }}
      >
        App en el celular
      </p>
      <p className="mt-1 text-sm font-semibold" style={{ color: SUITE.navy }}>
        Instalar {PRODUCT_NAME}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Sitio web instalable. Cada usuario entra con su cuenta y ve solo los
        módulos y funciones (p. ej. corte) que Master le asigne.
      </p>
      {deferred ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void install()}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60 sm:w-auto"
          style={{ backgroundColor: SUITE.orangeDeep }}
        >
          {busy ? 'Abriendo…' : 'Descargar / instalar app'}
        </button>
      ) : iosHint ? (
        <p className="mt-3 text-xs text-slate-600">
          En iPhone: Safari → Compartir → <strong>Añadir a pantalla de inicio</strong>.
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          En Chrome/Edge del teléfono: menú → <strong>Instalar aplicación</strong>{' '}
          (aparece cuando el sitio cumple los requisitos PWA).
        </p>
      )}
    </div>
  );
}
