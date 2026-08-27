/**
 * Web Push (VAPID) — envío server-side.
 * Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 */

import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PushSubscriptionRow = {
  id: string;
  username: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

function clean(v: string | undefined): string {
  return (v || '').trim().replace(/^["']|["']$/g, '');
}

export function getVapidPublicKey(): string | null {
  const k = clean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  return k || null;
}

export function isWebPushConfigured(): boolean {
  return Boolean(
    getVapidPublicKey() &&
      clean(process.env.VAPID_PRIVATE_KEY) &&
      clean(process.env.VAPID_SUBJECT || 'mailto:admin@carranza50.com.mx')
  );
}

function ensureVapid(): boolean {
  const pub = getVapidPublicKey();
  const priv = clean(process.env.VAPID_PRIVATE_KEY);
  const subject = clean(
    process.env.VAPID_SUBJECT || 'mailto:admin@carranza50.com.mx'
  );
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

export async function sendWebPush(
  sub: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushPayload
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  if (!ensureVapid()) {
    return { ok: false, error: 'Web Push no configurado (VAPID)' };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || '/',
        tag: payload.tag || 'c50',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      }),
      { TTL: 60 * 60 * 12 }
    );
    return { ok: true };
  } catch (e) {
    const status =
      e && typeof e === 'object' && 'statusCode' in e
        ? Number((e as { statusCode?: number }).statusCode)
        : 0;
    if (status === 404 || status === 410) {
      return { ok: false, gone: true, error: 'subscription gone' };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'send failed',
    };
  }
}

export async function listSubscriptionsForUsernames(
  sb: SupabaseClient,
  usernames: string[]
): Promise<PushSubscriptionRow[]> {
  if (!usernames.length) return [];
  const lower = [...new Set(usernames.map((u) => u.trim().toLowerCase()))];
  const { data, error } = await sb
    .from('push_subscriptions')
    .select('id, username, endpoint, p256dh, auth')
    .in('username', lower);
  if (error) throw new Error(error.message);
  return (data || []) as PushSubscriptionRow[];
}

export async function deleteSubscriptionByEndpoint(
  sb: SupabaseClient,
  endpoint: string
): Promise<void> {
  await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/**
 * Envía a todas las suscripciones de los usernames; limpia endpoints muertos.
 */
export async function notifyUsernames(
  sb: SupabaseClient,
  usernames: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number; pruned: number }> {
  const subs = await listSubscriptionsForUsernames(sb, usernames);
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const sub of subs) {
    const r = await sendWebPush(sub, payload);
    if (r.ok) {
      sent += 1;
    } else if (r.gone) {
      await deleteSubscriptionByEndpoint(sb, sub.endpoint);
      pruned += 1;
    } else {
      failed += 1;
    }
  }
  return { sent, failed, pruned };
}
