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
 * Android/Chrome: beforeinstallprompt → botón (requiere service worker público).
 * iOS/Safari: no hay beforeinstallprompt — guía Compartir → Añadir a inicio.
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
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
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

  const step3 = iosHint
    ? 'En Safari: Compartir → «Añadir a pantalla de inicio» (no hay botón Instalar).'
    : deferred
      ? 'Pulsa «Instalar app» abajo, o menú ⋮ → Instalar aplicación.'
      : 'En Chrome: menú ⋮ → Instalar aplicación / Añadir a pantalla de inicio.';

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
          : iosHint
            ? 'Añadir a pantalla de inicio (iPhone)'
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
          <li>{step3}</li>
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
        <div className="mt-3 space-y-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <p>
            En <strong>iPhone/iPad no existe</strong> el botón «Instalar app». Usa
            solo <strong>Safari</strong> (no Chrome):
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Toca el botón <strong>Compartir</strong> (cuadrado con flecha).
            </li>
            <li>
              Elige <strong>Añadir a pantalla de inicio</strong>.
            </li>
            <li>
              Confirma con <strong>Añadir</strong>.
            </li>
          </ol>
        </div>
      ) : likelyMobile ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          En <strong>Chrome/Edge (Android)</strong>: menú <strong>⋮</strong> →{' '}
          <strong>Instalar aplicación</strong> o{' '}
          <strong>Añadir a pantalla de inicio</strong>. El botón automático aparece
          cuando Chrome marca el sitio como instalable (tras cargar el service
          worker).
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Desde la PC: copia el enlace y ábrelo en el teléfono. En Android usa
            Chrome; en iPhone usa Safari → Compartir → Añadir a pantalla de inicio.
          </p>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800"
          >
            {copied ? 'Enlace copiado' : 'Copiar enlace para el celular'}
          </button>
        </div>
      )}
    </div>
  );
}
