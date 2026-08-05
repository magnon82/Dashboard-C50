'use client';

import { useEffect, useState } from 'react';
import { SUITE } from '@/app/lib/themes';

type Health = {
  stale: boolean;
  message: string;
  maxInfocajaDate: string | null;
  expectedMinDate: string;
  actionsUrl: string;
};

/**
 * Aviso si Infocaja (Gmail) está atrasada — certeza operativa, no solo cron.
 */
export function InfocajaSyncBanner({ className = '' }: { className?: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [canDispatch, setCanDispatch] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('/api/ventas-sync-status', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.health) {
        setHealth(json.health as Health);
        setCanDispatch(Boolean(json.canDispatch));
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function dispatchSync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/ventas-sync-status', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setMsg(String(json.error || 'No se pudo disparar el sync'));
        return;
      }
      setMsg(String(json.message || 'Sync encolado'));
      window.setTimeout(() => void refresh(), 90_000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setBusy(false);
    }
  }

  if (!health?.stale) return null;

  return (
    <div
      className={`mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 ${className}`}
      role="status"
    >
      <p className="font-semibold">Sync de ventas atrasado</p>
      <p className="mt-1">{health.message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={health.actionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-bold text-white"
          style={{ backgroundColor: SUITE.navy }}
        >
          Ver historial Actions
        </a>
        {canDispatch ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void dispatchSync()}
            className="inline-flex min-h-10 items-center rounded-xl border border-amber-400 bg-white px-3 text-xs font-bold text-amber-950 disabled:opacity-50"
          >
            {busy ? 'Encolando…' : 'Sincronizar ahora'}
          </button>
        ) : null}
      </div>
      {msg ? <p className="mt-2 text-xs text-amber-900">{msg}</p> : null}
    </div>
  );
}
