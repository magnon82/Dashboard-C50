import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  type SessionUser,
} from '@/app/lib/auth';
import {
  ESTADO_SOURCES,
  isEstadoSource,
  type EstadoMovimientoPayload,
  type MatchStatus,
} from '@/app/lib/estados-cuenta';
import { getServiceSupabase } from '@/app/lib/users';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireSession(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  return session;
}

function parseDesc(raw: string | null | undefined): EstadoMovimientoPayload {
  try {
    return JSON.parse(String(raw || '{}')) as EstadoMovimientoPayload;
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const bank = (url.searchParams.get('bank') || 'all').toUpperCase();
  const year = Number(url.searchParams.get('year') || 0);
  const month = Number(url.searchParams.get('month') || 0);
  const status = url.searchParams.get('status') || 'all';

  try {
    const sb = getServiceSupabase();
    const sources =
      bank === 'MIFEL'
        ? ['estado_mifel']
        : bank === 'BBVA'
          ? ['estado_bbva']
          : [...ESTADO_SOURCES];

    const all: FinancialRecord[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await sb
        .from('financial_records')
        .select('id,date,type,category,amount,description,source_file')
        .in('source_file', sources)
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data?.length) break;
      all.push(...(data as FinancialRecord[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const filtered = all.filter((r) => {
      const d = parseDesc(r.description);
      const fecha = String(d.fecha || r.date || '').slice(0, 10);
      if (year || month) {
        const [y, m] = fecha.split('-').map(Number);
        if (year && y !== year) return false;
        if (month && m !== month) return false;
      }
      if (status !== 'all') {
        const st = d.match_status || 'unmatched';
        if (st !== status) return false;
      }
      return true;
    });

    return NextResponse.json({ records: filtered, count: filtered.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al leer estados' },
      { status: 500 }
    );
  }
}

/**
 * PATCH body:
 * { id, observaciones?, matched_rubro?, matched_parent?, clear_match? }
 */
export async function PATCH(request: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  if (!auth.canEdit && auth.role !== 'admin') {
    return NextResponse.json(
      { error: 'Sin permiso para editar conciliaciones' },
      { status: 403 }
    );
  }

  let body: {
    id?: string;
    observaciones?: string;
    matched_rubro?: string | null;
    matched_parent?: string | null;
    clear_match?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data: row, error: readErr } = await sb
      .from('financial_records')
      .select('id,date,type,category,amount,description,source_file')
      .eq('id', body.id)
      .maybeSingle();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!row || !isEstadoSource(row.source_file)) {
      return NextResponse.json(
        { error: 'Movimiento de estado no encontrado' },
        { status: 404 }
      );
    }

    const d = parseDesc(row.description);

    if (body.observaciones !== undefined) {
      d.observaciones = String(body.observaciones ?? '');
    }

    if (body.clear_match) {
      d.matched_rubro = null;
      d.matched_parent = null;
      d.match_status = 'unmatched';
      d.match_source = 'manual';
      d.match_confidence = 0;
    } else if (body.matched_rubro !== undefined) {
      const rubro = body.matched_rubro ? String(body.matched_rubro).trim() : '';
      if (!rubro) {
        d.matched_rubro = null;
        d.matched_parent = null;
        d.match_status = 'unmatched' as MatchStatus;
        d.match_source = 'manual';
        d.match_confidence = 0;
      } else {
        d.matched_rubro = rubro;
        d.matched_parent =
          body.matched_parent != null && body.matched_parent !== ''
            ? String(body.matched_parent)
            : d.matched_parent ?? null;
        d.match_status = 'overridden';
        d.match_source = 'manual';
        d.match_confidence = 1;
      }
    }

    const category = d.matched_rubro || d.bank || row.category;
    const { data: updated, error: updErr } = await sb
      .from('financial_records')
      .update({
        category,
        description: JSON.stringify(d),
      })
      .eq('id', body.id)
      .select('id,date,type,category,amount,description,source_file')
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ record: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al actualizar' },
      { status: 500 }
    );
  }
}
