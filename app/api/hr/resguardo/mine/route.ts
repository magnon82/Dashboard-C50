import { NextResponse } from 'next/server';
import { canAccessAdmin } from '@/app/lib/auth';
import { getServiceSupabase } from '@/app/lib/users';
import {
  requireStaffOrRrhhSession,
  resolveLinkedEmployee,
  sessionHasRrhh,
} from '@/app/lib/hr-api';
import {
  HR_RESGUARDO_SELECT,
  HR_RESGUARDO_SELECT_LEGACY,
  asResguardoRequest,
  isResguardoAcceptedByEmployee,
  isResguardoAwaitingAcceptance,
  type HrResguardoPayload,
  type HrResguardoRequest,
} from '@/app/lib/hr-resguardo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function missingAcceptedCols(message: string | undefined | null): boolean {
  if (!message) return false;
  return /accepted_at|accepted_by|schema cache|42703/i.test(message);
}

async function selectMine(
  sb: ReturnType<typeof getServiceSupabase>,
  employeeId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null; legacy: boolean }> {
  const full = await sb
    .from('hr_resguardo_requests')
    .select(HR_RESGUARDO_SELECT)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!full.error) {
    return {
      rows: (full.data || []) as Record<string, unknown>[],
      error: null,
      legacy: false,
    };
  }

  if (missingAcceptedCols(full.error.message)) {
    const legacy = await sb
      .from('hr_resguardo_requests')
      .select(HR_RESGUARDO_SELECT_LEGACY)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (legacy.error) {
      return { rows: [], error: legacy.error.message, legacy: true };
    }
    return {
      rows: (legacy.data || []) as Record<string, unknown>[],
      error: null,
      legacy: true,
    };
  }

  return { rows: [], error: full.error.message, legacy: false };
}

/**
 * GET /api/hr/resguardo/mine — resguardos del colaborador vinculado a la sesión.
 */
export async function GET() {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  try {
    const sb = getServiceSupabase();
    const linked = await resolveLinkedEmployee(sb, auth);

    if (!linked) {
      return NextResponse.json({
        ready: true,
        linkedEmployee: null,
        requests: [] as HrResguardoRequest[],
        pendingCount: 0,
        message:
          'Tu usuario no está vinculado a un colaborador. Pide a Master que te enlace en /admin → Usuarios.',
      });
    }

    const { rows, error } = await selectMine(sb, linked.id);
    if (error) {
      const missing =
        /does not exist|42P01/i.test(error) || /schema cache/i.test(error);
      return NextResponse.json({
        ready: !missing,
        linkedEmployee: linked,
        requests: [] as HrResguardoRequest[],
        pendingCount: 0,
        message: missing
          ? 'Tabla hr_resguardo_requests no migrada. Ejecuta supabase/hr_resguardo.sql.'
          : error,
        error,
      });
    }

    const requests = rows.map(asResguardoRequest);
    const pendingCount = requests.filter(isResguardoAwaitingAcceptance).length;

    return NextResponse.json({
      ready: true,
      linkedEmployee: linked,
      requests,
      pendingCount,
      message: null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ready: false,
        linkedEmployee: null,
        requests: [],
        pendingCount: 0,
        message: e instanceof Error ? e.message : 'Error al listar resguardos',
        error: e instanceof Error ? e.message : 'Error',
      },
      { status: 200 }
    );
  }
}

/**
 * PATCH /api/hr/resguardo/mine — el colaborador acepta su resguardo.
 * Body: { id, action: 'accept' }
 * Admin / RH también pueden aceptar en nombre del colaborador.
 */
export async function PATCH(request: Request) {
  const auth = await requireStaffOrRrhhSession();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = String(body.id || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!id) {
    return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  }
  if (action !== 'accept') {
    return NextResponse.json(
      { error: 'Acción no soportada. Usa action: "accept".' },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();
    const linked = await resolveLinkedEmployee(sb, auth);
    const isPrivileged =
      canAccessAdmin(auth) || sessionHasRrhh(auth);

    if (!linked && !isPrivileged) {
      return NextResponse.json(
        {
          error:
            'Tu usuario no está vinculado a un colaborador. Pide a Master el enlace en /admin.',
        },
        { status: 403 }
      );
    }

    let rowRes = await sb
      .from('hr_resguardo_requests')
      .select(HR_RESGUARDO_SELECT)
      .eq('id', id)
      .maybeSingle();

    let legacyCols = false;
    if (rowRes.error && missingAcceptedCols(rowRes.error.message)) {
      legacyCols = true;
      rowRes = await sb
        .from('hr_resguardo_requests')
        .select(HR_RESGUARDO_SELECT_LEGACY)
        .eq('id', id)
        .maybeSingle();
    }

    if (rowRes.error) {
      return NextResponse.json({ error: rowRes.error.message }, { status: 400 });
    }
    if (!rowRes.data) {
      return NextResponse.json({ error: 'Resguardo no encontrado' }, { status: 404 });
    }

    const current = asResguardoRequest(rowRes.data as Record<string, unknown>);

    if (!isPrivileged) {
      if (!linked || current.employee_id !== linked.id) {
        return NextResponse.json(
          { error: 'Solo puedes aceptar tus propios resguardos' },
          { status: 403 }
        );
      }
    }

    if (current.status === 'cancelado' || current.status === 'devuelto') {
      return NextResponse.json(
        { error: 'Este resguardo ya no puede aceptarse' },
        { status: 400 }
      );
    }

    if (!isResguardoAwaitingAcceptance(current) && isResguardoAcceptedByEmployee(current)) {
      return NextResponse.json({
        ok: true,
        already: true,
        request: current,
      });
    }

    const now = new Date().toISOString();
    const accepter = auth.username.trim().toLowerCase();
    const payload: HrResguardoPayload = {
      ...current.payload,
      acepta_condiciones: true,
      empleado_aceptado_at: now,
      empleado_aceptado_por: accepter,
    };

    const patchFull: Record<string, unknown> = {
      status: 'entregado',
      accepted_at: now,
      accepted_by: accepter,
      reviewed_by: accepter,
      reviewed_at: now,
      payload,
      updated_at: now,
    };

    let upd = legacyCols
      ? await sb
          .from('hr_resguardo_requests')
          .update({
            status: 'entregado',
            payload,
            reviewed_by: accepter,
            reviewed_at: now,
            updated_at: now,
          })
          .eq('id', id)
          .select(HR_RESGUARDO_SELECT_LEGACY)
          .single()
      : await sb
          .from('hr_resguardo_requests')
          .update(patchFull)
          .eq('id', id)
          .select(HR_RESGUARDO_SELECT)
          .single();

    if (upd.error && !legacyCols && missingAcceptedCols(upd.error.message)) {
      upd = await sb
        .from('hr_resguardo_requests')
        .update({
          status: 'entregado',
          payload,
          reviewed_by: accepter,
          reviewed_at: now,
          updated_at: now,
        })
        .eq('id', id)
        .select(HR_RESGUARDO_SELECT_LEGACY)
        .single();
    }

    if (upd.error) {
      return NextResponse.json({ error: upd.error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      request: asResguardoRequest(upd.data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error al aceptar' },
      { status: 500 }
    );
  }
}
