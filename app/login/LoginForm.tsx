'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandLogo } from '@/app/components/BrandLogo';
import { InstallAppPrompt } from '@/app/components/InstallAppPrompt';
import { homePathForModules } from '@/app/lib/modules';
import { PRODUCT_NAME, PRODUCT_ORG, PRODUCT_TAGLINE } from '@/app/lib/product';
import { getTheme, SUITE } from '@/app/lib/themes';

const theme = getTheme('suite');

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'No se pudo iniciar sesión');
        return;
      }

      const from = searchParams.get('from');
      const modules: string[] = data.user?.modules ?? [];
      // Deep-link `from` wins; otherwise hub or sole module
      const destination =
        from && from !== '/' ? from : homePathForModules(modules);
      router.replace(destination);
      router.refresh();
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: theme.pageBg }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[28px] bg-white"
        style={{ boxShadow: SUITE.shadow }}
      >
        <div className="px-8 py-7 text-white" style={{ backgroundColor: SUITE.navy }}>
          <BrandLogo
            variant="onDark"
            priority
            className="mb-5 h-auto w-[min(100%,320px)] opacity-95"
          />
          <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
            {PRODUCT_ORG}
          </p>
          <h1 className="mt-2 text-2xl font-bold">{PRODUCT_NAME}</h1>
          <p className="mt-1 text-sm text-white/65">{PRODUCT_TAGLINE}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-8 py-8">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-slate-700">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white transition-opacity disabled:opacity-60"
            style={{ backgroundColor: SUITE.orange }}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="border-t border-slate-100 px-6 pb-6 pt-2">
          <InstallAppPrompt compact />
        </div>
      </div>
    </main>
  );
}
