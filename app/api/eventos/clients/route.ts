import { NextResponse } from 'next/server';
import {
  indexActivityByName,
  pickActivityForClient,
} from '@/app/lib/eventos-activity';
import { loadEventClientActivity } from '@/app/lib/eventos-activity.server';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireEventosSession,
  requireEventosWrite,
} from '@/app/lib/eventos-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim().toLowerCase() || '';
  const sort = url.searchParams.get('sort') || 'activity';
  const withActivity = url.searchParams.get('activity') !== '0';

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_clients')
      .select('*')
      .order('company_name', { ascending: true })
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let clients = data || [];
    if (q) {
      clients = clients.filter((c) => {
        const hay = [c.company_name, c.contact_name, c.email, c.phone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    let activityMeta: {
      generated_at?: string;
      stats?: Record<string, number>;
    } | null = null;

    if (withActivity) {
      const payload = await loadEventClientActivity();
      if (payload) {
        activityMeta = {
          generated_at: payload.generated_at,
          stats: payload.stats as Record<string, number> | undefined,
        };
        const index = indexActivityByName(payload);
        clients = clients.map((c) => {
          const hit = pickActivityForClient(
            index,
            c.company_name,
            c.contact_name
          );
          if (!hit) {
            return {
              ...c,
              last_activity_at: null,
              last_activity_source: null,
              activity_count: 0,
              activity_timeline: [],
            };
          }
          return {
            ...c,
            last_activity_at: hit.last_activity_at,
            last_activity_source: hit.last_activity_source,
            activity_count: hit.activity_count,
            activity_timeline: (hit.timeline || []).slice(0, 12),
          };
        });
      }
    }

    if (sort === 'activity') {
      clients = [...clients].sort((a, b) => {
        const da = a.last_activity_at || '';
        const db = b.last_activity_at || '';
        if (da !== db) return db.localeCompare(da);
        return String(a.company_name || '').localeCompare(
          String(b.company_name || ''),
          'es'
        );
      });
    } else if (sort === 'name') {
      clients = [...clients].sort((a, b) =>
        String(a.company_name || '').localeCompare(
          String(b.company_name || ''),
          'es'
        )
      );
    }

    return NextResponse.json({
      clients,
      count: clients.length,
      activity: activityMeta,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al leer clientes' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  let body: {
    company_name?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    notes?: string;
    source?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const company = (body.company_name || '').trim();
  if (!company) {
    return NextResponse.json({ error: 'company_name es requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const now = new Date().toISOString();
    // source 'cotizador' no está en el check SQL → persistir como manual
    const sourceRaw = (body.source || 'manual').trim();
    const source = ['manual', 'excel_seed', 'import', 'sheets'].includes(sourceRaw)
      ? sourceRaw
      : 'manual';
    const { data, error } = await sb
      .from('event_clients')
      .insert({
        company_name: company,
        contact_name: (body.contact_name || '').trim() || null,
        email: (body.email || '').trim() || null,
        phone: (body.phone || '').trim() || null,
        notes: (body.notes || '').trim() || null,
        source,
        owner_username: auth.username,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ client: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al crear cliente' },
      { status: 500 }
    );
  }
}

/** Actualiza contacto (tel/correo) del cliente CRM — p. ej. desde el cotizador. */
export async function PATCH(request: Request) {
  const auth = await requireEventosSession();
  if (auth instanceof NextResponse) return auth;
  const denied = requireEventosWrite(auth);
  if (denied) return denied;

  let body: {
    id?: string;
    phone?: string | null;
    email?: string | null;
    contact_name?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json({ error: 'id es requerido' }, { status: 400 });
  }

  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (body.phone !== undefined) {
    patch.phone =
      typeof body.phone === 'string' ? body.phone.trim() || null : null;
  }
  if (body.email !== undefined) {
    patch.email =
      typeof body.email === 'string' ? body.email.trim() || null : null;
  }
  if (body.contact_name !== undefined) {
    patch.contact_name =
      typeof body.contact_name === 'string'
        ? body.contact_name.trim() || null
        : null;
  }
  if (
    body.phone === undefined &&
    body.email === undefined &&
    body.contact_name === undefined
  ) {
    return NextResponse.json(
      { error: 'Indica phone, email o contact_name' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('event_clients')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ client: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar cliente' },
      { status: 500 }
    );
  }
}
