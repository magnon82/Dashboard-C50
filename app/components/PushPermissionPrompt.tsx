'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/app/lib/useSession';
import { SUITE } from '@/app/lib/themes';

const LS_ASKED = 'c50.push.permissionAsked';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function ensureSw(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  return res.ok;
}

/**
 * Pide permiso de notificaciones una sola vez (Allow/Deny).
 * Tras Allow, suscribe Web Push con ícono C50 (SW).
 */
export function PushPermissionPrompt() {
  const { user, loading } = useSession();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (localStorage.getItem(LS_ASKED) === '1') return;
    if (Notification.permission === 'denied') {
      localStorage.setItem(LS_ASKED, '1');
      return;
    }
    if (Notification.permission === 'granted') {
      // Ya dio Allow antes: asegurar suscripción sin volver a preguntar
      void (async () => {
        try {
          const cfg = await fetch('/api/push/subscribe', { cache: 'no-store' });
          const json = (await cfg.json()) as {
            configured?: boolean;
            publicKey?: string | null;
          };
          if (!json.configured || !json.publicKey) return;
          const reg = await ensureSw();
          if (!reg) return;
          let sub = await reg.pushManager.getSubscription();
          if (!sub) {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(
                json.publicKey
              ) as BufferSource,
            });
          }
          await postSubscription(sub);
        } catch {
          /* ignore */
        }
      })();
      localStorage.setItem(LS_ASKED, '1');
      return;
    }

    void (async () => {
      try {
        const cfg = await fetch('/api/push/subscribe', { cache: 'no-store' });
        const json = (await cfg.json()) as {
          configured?: boolean;
          publicKey?: string | null;
        };
        if (!json.configured || !json.publicKey) return;
        setPublicKey(json.publicKey);
        setVisible(true);
      } catch {
        /* ignore */
      }
    })();
  }, [loading, user]);

  async function onAllow() {
    if (!publicKey) return;
    setBusy(true);
    try {
      localStorage.setItem(LS_ASKED, '1');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setVisible(false);
        return;
      }
      const reg = await ensureSw();
      if (!reg) {
        setVisible(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      await postSubscription(sub);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      setVisible(false);
    }
  }

  function onDismiss() {
    localStorage.setItem(LS_ASKED, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-md rounded-2xl bg-white p-4 shadow-lg sm:left-auto"
      style={{ borderLeft: `4px solid ${SUITE.orange}` }}
      role="dialog"
      aria-label="Activar notificaciones C50"
    >
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt="C50"
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: SUITE.navy }}>
            Notificaciones C50
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Recibe avisos de tus módulos (horarios, vacaciones, etc.). Solo se
            pide este permiso una vez.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAllow()}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: SUITE.navy }}
            >
              {busy ? 'Activando…' : 'Permitir'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDismiss}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600"
            >
              Ahora no
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
