import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  canAccessCorteTpv,
  canAccessModule,
  verifySessionToken,
} from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';

export const dynamic = 'force-dynamic';

/** Módulos que leen registros financieros (ventas, cortes, socios, finanzas). */
const MODULES_WITH_ACCESS = ['finanzas', 'ventas', 'cortes', 'reportes-socios'];

export async function GET(request: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const allowed =
    MODULES_WITH_ACCESS.some((m) => canAccessModule(session, m)) ||
    canAccessCorteTpv(session);
  if (!allowed) {
    return NextResponse.json({ error: 'Sin acceso a registros financieros' }, { status: 403 });
  }

  // Solo servidor: service role (la anon key no debe leer esta tabla).
  let supabase: ReturnType<typeof getServiceSupabase>;
  try {
    supabase = getServiceSupabase();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Supabase no configurado' },
      { status: 500 }
    );
  }
  const all: unknown[] = [];
  let from = 0;
  const pageSize = 1000;

  const reqUrl = new URL(request.url);
  const sourcesParam = reqUrl.searchParams.get('sources');
  const sourceFilter = sourcesParam
    ? sourcesParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  while (true) {
    let q = supabase
      .from('financial_records')
      .select('*')
      .neq('source_file', 'dashboard_auth')
      .order('date', { ascending: false })
      .order('id', { ascending: false });

    if (sourceFilter?.length) {
      q = q.in('source_file', sourceFilter);
    }

    const { data, error } = await q.range(from, from + pageSize - 1);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({ records: all, count: all.length });
}
