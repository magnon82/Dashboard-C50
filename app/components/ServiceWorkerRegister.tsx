'use client';

import { useEffect } from 'react';

/** Registers `/sw.js` so Chromium can treat the site as an installable PWA. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* ignore — install UI falls back to browser menu / iOS share */
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
