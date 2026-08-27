import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
} from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';
import { getVapidPublicKey, isWebPushConfigured } from '@/app/lib/web-push';
import { hrSchemaMissing } from '@/app/lib/hr-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  expirationTime?: number | null;
};

/**
 * GET /api/push/subscribe — ¿push configurado? + clave pública.
 * POST — guarda/actualiza suscripción del usuario de sesión.
 * DELETE — elimina por endpoint.
 */
export async function GET() {
  return NextResponse.json({
    configured: isWebPushConfigured(),
    publicKey: getVapidPublicKey(),
  });
}

export async function POST(request: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!isWebPushConfigured()) {
    return NextResponse.json(
      { error: 'Web Push no configurado en el servidor' },
      { status: 503 }
    );
  }

  let body: SubBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const endpoint = String(body.endpoint || '').trim();
  const p256dh = String(body.keys?.p256dh || '').trim();
  const auth = String(body.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: 'endpoint y keys.p256dh / keys.auth requeridos' },
      { status: 400 }
    );
  }

  const username = session.username.trim().toLowerCase();
  const ua = request.headers.get('user-agent')?.slice(0, 240) || null;
  const now = new Date().toISOString();

  try {
    const sb = getServiceSupabase();
    const { error } = await sb.from('push_subscriptions').upsert(
      {
        username,
        endpoint,
        p256dh,
        auth,
        user_agent: ua,
        updated_at: now,
      },
      { onConflict: 'endpoint' }
    );
    if (error) {
      if (hrSchemaMissing(error.message)) {
        return NextResponse.json(
          {
            error:
              'Ejecuta supabase/push_subscriptions.sql en Supabase.',
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }

  let endpoint = '';
  try {
    const body = (await request.json()) as { endpoint?: string };
    endpoint = String(body.endpoint || '').trim();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    await sb
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .ilike('username', session.username.trim().toLowerCase());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
