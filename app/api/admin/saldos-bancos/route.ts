import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import {
  CAT_SALDO_BBVA,
  CAT_SALDO_MIFEL,
  SOURCE_SALDOS_BANCOS_MANUAL,
  SOURCE_SALDOS_PRESUPUESTO,
} from '@/app/lib/saldos';
import { getServiceSupabase } from '@/app/lib/users';
import { parseIsoDate } from '@/app/lib/ventas-semana';

export const runtime = 'nodejs';

async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  if (!canAccessAdmin(session)) {
    return NextResponse.json(
      { error: 'Solo el administrador puede actualizar saldos bancarios' },
      { status: 403 }
    );
  }
  return session;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isIsoDate(s: string): boolean {
  return Boolean(parseIsoDate(s));
}

type SaldoRow = {
  id: string;
  date: string;
  category: string | null;
  amount: number | null;
  description: string | null;
  source_file: string | null;
};

function latestPair(
  rows: SaldoRow[],
  source: string
): { date: string; mifel: number | null; bbva: number | null } | null {
  const filtered = rows
    .filter((r) => r.source_file === source)
    .map((r) => ({ ...r, parsed: parseIsoDate(r.date) }))
    .filter((r) => r.parsed)
    .sort((a, b) => (a.parsed!.key < b.parsed!.key ? -1 : 1));
  if (!filtered.length) return null;
  const lastKey = filtered[filtered.length - 1].parsed!.key;
  const day = filtered.filter((r) => r.parsed!.key === lastKey);
  const mifelRow = day.find((r) => r.category === CAT_SALDO_MIFEL);
  const bbvaRow = day.find((r) => r.category === CAT_SALDO_BBVA);
  return {
    date: lastKey,
    mifel: mifelRow != null ? Number(mifelRow.amount || 0) : null,
    bbva: bbvaRow != null ? Number(bbvaRow.amount || 0) : null,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('financial_records')
      .select('id,date,category,amount,description,source_file')
      .in('source_file', [SOURCE_SALDOS_BANCOS_MANUAL, SOURCE_SALDOS_PRESUPUESTO])
      .order('date', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = (data || []) as SaldoRow[];
    const manual = latestPair(rows, SOURCE_SALDOS_BANCOS_MANUAL);
    const presupuesto = latestPair(rows, SOURCE_SALDOS_PRESUPUESTO);

    return NextResponse.json({
      today: todayIso(),
      manual,
      presupuesto,
      display: manual ?? presupuesto,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al leer saldos' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { date?: string; mifel?: unknown; bbva?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const date = String(body.date || todayIso()).trim();
  if (!isIsoDate(date)) {
    return NextResponse.json({ error: 'Fecha inválida (YYYY-MM-DD)' }, { status: 400 });
  }

  const mifel = parseAmount(body.mifel);
  const bbva = parseAmount(body.bbva);
  if (mifel == null || mifel < 0 || bbva == null || bbva < 0) {
    return NextResponse.json(
      { error: 'Montos de Mifel y BBVA deben ser números ≥ 0' },
      { status: 400 }
    );
  }

  const description = JSON.stringify({
    source: 'admin_manual',
    updatedBy: auth.username,
    updatedAt: new Date().toISOString(),
  });

  try {
    const sb = getServiceSupabase();
    const { data: existing, error: findErr } = await sb
      .from('financial_records')
      .select('id,category')
      .eq('source_file', SOURCE_SALDOS_BANCOS_MANUAL)
      .eq('date', date);
    if (findErr) throw new Error(findErr.message);

    const pairs: Array<{ category: string; amount: number }> = [
      { category: CAT_SALDO_MIFEL, amount: mifel },
      { category: CAT_SALDO_BBVA, amount: bbva },
    ];

    const ids: string[] = [];
    for (const pair of pairs) {
      const match = (existing || []).find((r) => r.category === pair.category);
      if (match) {
        const { error } = await sb
          .from('financial_records')
          .update({
            type: 'income',
            amount: pair.amount,
            description,
          })
          .eq('id', match.id);
        if (error) throw new Error(error.message);
        ids.push(match.id);
      } else {
        const { data, error } = await sb
          .from('financial_records')
          .insert({
            date,
            type: 'income',
            category: pair.category,
            amount: pair.amount,
            description,
            source_file: SOURCE_SALDOS_BANCOS_MANUAL,
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        if (data?.id) ids.push(data.id);
      }
    }

    return NextResponse.json({
      ok: true,
      date,
      mifel,
      bbva,
      ids,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar' },
      { status: 500 }
    );
  }
}
