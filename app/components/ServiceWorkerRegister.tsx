'use client';

import { useEffect } from 'react';

/**
 * Registra `/sw.js` (PWA) y, si hay versión nueva, activa el SW
 * y recarga sola (sin pedir clic ni cerrar sesión).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;
    let reloading = false;

    const reloadOnce = () => {
      if (reloading || cancelled) return;
      reloading = true;
      window.location.reload();
    };

    const activateWaiting = (worker: ServiceWorker | null | undefined) => {
      if (!worker || cancelled) return;
      const onControllerChange = () => reloadOnce();
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        onControllerChange,
        { once: true }
      );
      worker.postMessage({ type: 'SKIP_WAITING' });
      // Fallback si el evento no dispara
      window.setTimeout(() => reloadOnce(), 1500);
    };

    const watchInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          activateWaiting(worker);
        }
      });
    };

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        if (cancelled) return;

        // Ya hay un SW en waiting (deploy mientras la app estaba abierta)
        if (reg.waiting && navigator.serviceWorker.controller) {
          activateWaiting(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          watchInstalling(reg.installing);
        });

        const check = () => {
          void reg.update().catch(() => {});
        };
        check();

        const onFocus = () => check();
        const onVis = () => {
          if (document.visibilityState === 'visible') check();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVis);
        const iv = window.setInterval(check, 10 * 60 * 1000);

        return () => {
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVis);
          window.clearInterval(iv);
        };
      } catch {
        /* ignore */
      }
    };

    let cleanup: (() => void) | undefined;
    const start = () => {
      void register().then((c) => {
        cleanup = c;
      });
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
