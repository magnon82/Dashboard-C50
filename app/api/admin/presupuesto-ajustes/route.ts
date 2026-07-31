import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  verifySessionToken,
  canAccessAdmin,
  type SessionUser,
} from '@/app/lib/auth';
import {
  ADMIN_EDITABLE_BUDGETS,
  SOURCE_AJUSTE,
  adminBudgetKey,
  buildPresupuestoRubros,
  findAdminEditable,
  normRubroKey,
} from '@/app/lib/presupuesto';
import { getServiceSupabase } from '@/app/lib/users';
import type { FinancialRecord } from '@/app/lib/ventas-semana';

export const runtime = 'nodejs';

const EDITABLE_KEYS = new Set(
  ADMIN_EDITABLE_BUDGETS.map((b) => adminBudgetKey(b.rubro, b.parent ?? null))
);

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
      { error: 'Solo el administrador puede editar presupuestos' },
      { status: 403 }
    );
  }
  return session;
}

function monthDate(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function nextMonthDate(year: number, month: number): string {
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

function parseAjuste(r: {
  id?: string;
  category: string | null;
  amount?: number | null;
  description: string | null;
}): { id?: string; rubro: string; parent: string | null; presupuesto: number } {
  let rubro = r.category || '';
  let parent: string | null = null;
  let presupuesto = Number(r.amount || 0);
  try {
    const d = JSON.parse(String(r.description || '{}')) as {
      rubro?: string;
      parent?: string | null;
      presupuesto?: number;
    };
    if (d.rubro) rubro = d.rubro;
    if (d.parent != null && d.parent !== '') parent = d.parent;
    if (d.presupuesto != null) presupuesto = Number(d.presupuesto);
  } catch {
    /* keep */
  }
  return { id: r.id, rubro, parent, presupuesto };
}

function resolveEditable(
  rubro: string,
  parent?: string | null
): { rubro: string; parent: string | null; key: string } | null {
  const entry = findAdminEditable(rubro, parent ?? null);
  if (!entry) {
    // Compat: match solo por nombre (incluye rubros movidos a un padre)
    const byRubro = ADMIN_EDITABLE_BUDGETS.find(
      (b) => normRubroKey(b.rubro) === normRubroKey(rubro)
    );
    if (!byRubro) return null;
    const key = adminBudgetKey(byRubro.rubro, byRubro.parent ?? null);
    if (!EDITABLE_KEYS.has(key)) return null;
    return { rubro: byRubro.rubro, parent: byRubro.parent ?? null, key };
  }
  const key = adminBudgetKey(entry.rubro, entry.parent ?? null);
  if (!EDITABLE_KEYS.has(key)) return null;
  return { rubro: entry.rubro, parent: entry.parent ?? null, key };
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'year y month requeridos' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const from = monthDate(year, month);
    const to = nextMonthDate(year, month);

    const { data, error } = await sb
      .from('financial_records')
      .select('id,date,type,category,amount,description,source_file')
      .in('source_file', [
        'presupuesto_rubro',
        'presupuesto_semana',
        SOURCE_AJUSTE,
      ])
      .gte('date', from)
      .lt('date', to);
    if (error) throw new Error(error.message);

    const records = (data || []) as FinancialRecord[];
    const { rows, meta, weekCount } = buildPresupuestoRubros(records, year, month);

    const recordsNoAjuste = records.filter((r) => r.source_file !== SOURCE_AJUSTE);
    const { rows: baseRows } = buildPresupuestoRubros(
      recordsNoAjuste,
      year,
      month
    );

    const adjustments = records
      .filter((r) => r.source_file === SOURCE_AJUSTE)
      .map((r) => parseAjuste(r));

    const overrideKeys = new Set(
      adjustments.map((a) => adminBudgetKey(a.rubro, a.parent))
    );

    const established = ADMIN_EDITABLE_BUDGETS.map((b) => {
      const parent = b.parent ?? null;
      const key = adminBudgetKey(b.rubro, parent);
      const row = rows.find(
        (r) =>
          !r.isParent &&
          adminBudgetKey(r.rubro, r.parent) === key
      );
      const base = baseRows.find(
        (r) =>
          !r.isParent &&
          adminBudgetKey(r.rubro, r.parent) === key
      );
      const hasOverride = overrideKeys.has(key);
      const efectivo = row?.presupuesto ?? 0;
      const formulaOrExcel = base?.presupuesto ?? b.defaultPresupuesto ?? 0;
      return {
        rubro: b.rubro,
        parent,
        weeklyRate: b.weeklyRate ?? null,
        ventaPct: b.ventaPct ?? null,
        note: b.note ?? null,
        defaultPresupuesto: b.defaultPresupuesto ?? null,
        establecido: efectivo,
        base: formulaOrExcel,
        hasOverride,
        overrideAmount: hasOverride
          ? adjustments.find((a) => adminBudgetKey(a.rubro, a.parent) === key)
              ?.presupuesto ?? null
          : null,
      };
    });

    return NextResponse.json({
      adjustments,
      editable: ADMIN_EDITABLE_BUDGETS,
      established,
      weekCount,
      meta,
      year,
      month,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al leer ajustes' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: {
    year?: number;
    month?: number;
    rubro?: string;
    parent?: string | null;
    presupuesto?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const year = Number(body.year);
  const month = Number(body.month);
  const rubroRaw = String(body.rubro || '').trim();
  const parentRaw =
    body.parent != null && String(body.parent).trim() !== ''
      ? String(body.parent).trim()
      : null;
  const presupuesto = Number(body.presupuesto);
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'year y month inválidos' }, { status: 400 });
  }
  const resolved = resolveEditable(rubroRaw, parentRaw);
  if (!resolved) {
    return NextResponse.json({ error: 'Rubro no editable' }, { status: 400 });
  }
  if (!Number.isFinite(presupuesto) || presupuesto < 0) {
    return NextResponse.json({ error: 'Presupuesto inválido' }, { status: 400 });
  }

  const { rubro: catalogRubro, parent, key } = resolved;
  const date = monthDate(year, month);
  const description = JSON.stringify({
    rubro: catalogRubro,
    parent,
    presupuesto,
    field: 'presupuesto',
  });

  try {
    const sb = getServiceSupabase();
    const { data: existing, error: findErr } = await sb
      .from('financial_records')
      .select('id,category,description')
      .eq('source_file', SOURCE_AJUSTE)
      .eq('date', date);
    if (findErr) throw new Error(findErr.message);

    const match = (existing || []).find((r) => {
      const parsed = parseAjuste(r);
      return adminBudgetKey(parsed.rubro, parsed.parent) === key;
    });

    if (match) {
      const { error } = await sb
        .from('financial_records')
        .update({
          category: catalogRubro,
          amount: presupuesto,
          description,
        })
        .eq('id', match.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: match.id });
    }

    const { data, error } = await sb
      .from('financial_records')
      .insert({
        date,
        type: 'expense',
        category: catalogRubro,
        amount: presupuesto,
        description,
        source_file: SOURCE_AJUSTE,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al guardar' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));
  const rubro = String(url.searchParams.get('rubro') || '').trim();
  const parentParam = url.searchParams.get('parent');
  const parent =
    parentParam != null && parentParam.trim() !== '' ? parentParam.trim() : null;
  if (!year || !month || !rubro) {
    return NextResponse.json({ error: 'year, month y rubro requeridos' }, { status: 400 });
  }

  const resolved = resolveEditable(rubro, parent);
  if (!resolved) {
    return NextResponse.json({ error: 'Rubro no editable' }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const date = monthDate(year, month);
    const { data: existing, error: findErr } = await sb
      .from('financial_records')
      .select('id,category,description')
      .eq('source_file', SOURCE_AJUSTE)
      .eq('date', date);
    if (findErr) throw new Error(findErr.message);

    const match = (existing || []).find((r) => {
      const parsed = parseAjuste(r);
      return adminBudgetKey(parsed.rubro, parsed.parent) === resolved.key;
    });
    if (!match) {
      return NextResponse.json({ ok: true, deleted: false });
    }
    const { error } = await sb.from('financial_records').delete().eq('id', match.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al borrar' },
      { status: 500 }
    );
  }
}
