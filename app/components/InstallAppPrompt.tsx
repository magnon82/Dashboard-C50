'use client';

import { useEffect, useState } from 'react';
import { PRODUCT_NAME } from '@/app/lib/product';
import { SUITE } from '@/app/lib/themes';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const PROD_URL = 'https://admin.carranza50.com.mx';

/**
 * CTA para instalar el Suite como app en el celular (PWA).
 * No hay App Store: el usuario abre el sitio con su cuenta y lo instala desde el navegador.
 * Android/Chrome: beforeinstallprompt → botón. iOS: guía «Añadir a inicio».
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
  const [likelyMobile, setLikelyMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
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
    const isMobile =
      isIos ||
      /Android|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
      window.matchMedia('(max-width: 768px)').matches;
    setIosHint(isIos);
    setLikelyMobile(isMobile);

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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(PROD_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
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
        {deferred
          ? `Instalar ${PRODUCT_NAME}`
          : 'Cómo obtener la app en el teléfono'}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        No se descarga de Play Store ni App Store. Es este mismo sitio, instalado
        en la pantalla de inicio. Cada persona entra con <strong>su usuario</strong>{' '}
        (Master le da acceso y módulos, p. ej. corte).
      </p>

      {!compact ? (
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-slate-600">
          <li>
            Abre en el celular:{' '}
            <span className="font-semibold text-slate-800">{PROD_URL}</span>
          </li>
          <li>Inicia sesión con tu usuario y contraseña.</li>
          <li>
            {iosHint
              ? 'Safari → Compartir → Añadir a pantalla de inicio.'
              : 'Pulsa «Instalar app» abajo (o menú del navegador → Instalar aplicación).'}
          </li>
        </ol>
      ) : null}

      {deferred ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void install()}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60 sm:w-auto"
          style={{ backgroundColor: SUITE.orangeDeep }}
        >
          {busy ? 'Abriendo…' : 'Instalar app en este teléfono'}
        </button>
      ) : iosHint ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
          En iPhone usa <strong>Safari</strong> → botón Compartir →{' '}
          <strong>Añadir a pantalla de inicio</strong>.
        </p>
      ) : likelyMobile ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          En Chrome/Edge: menú ⋮ → <strong>Instalar aplicación</strong> o{' '}
          <strong>Añadir a pantalla de inicio</strong>. El botón automático
          aparece cuando el navegador lo permite.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => void copyLink()}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800"
        >
          {copied ? 'Enlace copiado' : 'Copiar enlace para el celular'}
        </button>
      )}
    </div>
  );
}
