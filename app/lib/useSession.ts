'use client';

import { useEffect, useState } from 'react';

export interface ClientSession {
  username: string;
  role: 'admin' | 'viewer';
  modules: string[];
  capabilities?: string[];
  canEdit: boolean;
  canAccessAdmin: boolean;
  canAccessStaffCorte?: boolean;
}

export function useSession() {
  const [user, setUser] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled) setUser(res.ok ? json.user : null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}

export function canSeeModule(user: ClientSession | null, moduleId: string): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.modules.includes('*')) return true;
  return user.modules.includes(moduleId);
}

export function canSeeAdmin(user: ClientSession | null): boolean {
  return Boolean(user?.canAccessAdmin);
}
